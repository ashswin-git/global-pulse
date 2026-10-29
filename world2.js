// World Pulse v2: layers, time slider, country panel, keyword/near-me alerts, arcs, URL state, 2D fallback.
// Ideas (not code) inspired by worldmonitor, situation-monitor, globalthreatmap, LiveActionMap, OSINT-War-Room; see README credits.
const W2 = (() => {
  const LAYERS = { news: 'Conflict news points', heat: 'Conflict heat (hexbin)', quakes: 'Earthquakes M4.5+ (USGS)', dis: 'Disasters (GDACS)', eonet: 'Hazards (NASA EONET)', ex: 'Stock exchanges' };
  const url = new URLSearchParams(location.search);
  const st = {
    layers: new Set((url.get('layers') || 'news,heat,quakes,dis,eonet,ex').split(',').filter(k => LAYERS[k])),
    win: url.get('t') === '7d' ? 168 : 24, pos: null, pov: url.get('pov'), view: url.get('view'),
  };
  st.pos = Math.min(+url.get('at') || st.win, st.win);
  const extra = { quakes: [], eonet: [] };
  let countries = [], leafletMap = null, leafletLayer = null, playing = false, raf = 0;

  function saveUrl() {
    const q = new URLSearchParams();
    q.set('layers', [...st.layers].join(',')); if (REGION !== 'All') q.set('region', REGION);
    q.set('t', st.win === 168 ? '7d' : '24h'); if (st.pos < st.win) q.set('at', Math.round(st.pos));
    if (globe) { const p = globe.pointOfView(); q.set('pov', [p.lat, p.lng, p.altitude].map(n => n.toFixed(2)).join(',')); }
    if (leafletMap) q.set('view', '2d');
    history.replaceState(null, '', '?' + q.toString().replace(/%2C/g, ','));
  }
  const inTime = t => { if (!t) return true; const now = Date.now(), start = now - st.win * 3600e3; return t >= start && t <= start + st.pos * 3600e3; };

  // ---- data from cron files (with live fallback) ----
  async function loadExtra() {
    const q = await dataFile('quakes'); let j = q?.data;
    if (!j) try { j = await (await fetchT('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson')).json(); } catch {}
    extra.quakes = (j?.features || []).map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: `M${f.properties.mag} ${f.properties.place || ''}`, kind: 'quake', mag: f.properties.mag, t: f.properties.time, url: f.properties.url, region: regionOf(f.geometry.coordinates[1], f.geometry.coordinates[0]) }));
    const e = await dataFile('eonet'); let k = e?.data;
    if (!k) try { const r = await (await fetchT('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7&limit=200')).json(); k = { features: (r.events || []).map(ev => { const g = (ev.geometry || []).filter(g => g.type === 'Point').at(-1); return g && { geometry: { coordinates: g.coordinates }, properties: { title: ev.title, cat: ev.categories?.[0]?.title, date: g.date, url: ev.link } }; }).filter(Boolean) }; } catch {}
    extra.eonet = (k?.features || []).map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: `${f.properties.title} (${f.properties.cat || 'hazard'})`, kind: 'eonet', t: Date.parse(f.properties.date), url: f.properties.url, region: regionOf(f.geometry.coordinates[1], f.geometry.coordinates[0]) }));
    render(); checkNearMe();
  }

  // ---- render (replaces app.js updateGlobe) ----
  const COL = { open: '#22d3ee', lunch: '#67e8f9', closed: '#64748b', holiday: '#64748b', war: '#f43f5e', dis: '#f59e0b', quake: '#a78bfa', eonet: '#34d399' };
  function visible() {
    const L = st.layers, reg = p => REGION === 'All' || p.region === REGION, out = [];
    if (L.has('ex')) EXCHANGES.forEach(e => { const s = status(e); out.push({ ...e, label: `${e.ex} — ${ST_LABEL[s].slice(2)}`, st: s, k: s }); });
    if (L.has('news')) conflictPts.forEach(h => out.push({ ...h, label: h.ref ? h.name + ' (reference)' : h.label, k: 'war' }));
    if (L.has('dis')) disasterPts.forEach(d => out.push({ ...d, k: 'dis' }));
    if (L.has('quakes')) extra.quakes.forEach(d => out.push({ ...d, k: 'quake' }));
    if (L.has('eonet')) extra.eonet.forEach(d => out.push({ ...d, k: 'eonet' }));
    return out.filter(p => reg(p) && (p.kind === 'exchange' || inTime(p.t)));
  }
  function arcs(pts) {
    if (reduceMotion) return [];
    const big = pts.filter(p => (p.k === 'dis' && p.p?.alertlevel === 'Red') || (p.k === 'quake' && p.mag >= 6) || (p.k === 'war' && (p.count || 0) >= 20)).slice(0, 15);
    return big.map(p => { const e = EXCHANGES.reduce((a, b) => dist(p, a) < dist(p, b) ? a : b); return { startLat: p.lat, startLng: p.lng, endLat: e.lat, endLng: e.lng, color: [COL[p.k], '#22d3ee'] }; });
  }
  function render() {
    const pts = visible();
    $('w2count').textContent = `${pts.length} markers · window ${st.win === 168 ? '7 days' : '24 hours'}${st.pos < st.win ? ` up to ${new Date(Date.now() - (st.win - st.pos) * 3600e3).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`;
    if (leafletMap) return render2d(pts);
    if (!globe) return;
    const dots = pts.map(p => ({ ...p, solid: COL[p.k], color: hexA(COL[p.k]), r: p.k === 'war' ? 4 : p.k === 'quake' ? Math.max(1.5, (p.mag - 4) * 1.6) : p.k === 'open' ? 4 : 2.5, period: p.k === 'open' ? 1200 : 1600, ring: !['closed', 'holiday', 'eonet'].includes(p.k) }));
    let rings = reduceMotion ? [] : dots.filter(p => p.ring); if (isMobile) rings = rings.slice(0, 20);
    globe.pointsData(dots).ringsData(rings.slice(0, 80))
      .hexBinPointsData(st.layers.has('heat') ? conflictPts.filter(p => !p.ref && inTime(p.t) && (REGION === 'All' || p.region === REGION)) : [])
      .arcsData(arcs(pts));
  }
  const hexA = h => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},1)`; };
  const dist = (a, b) => { const r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

  // ---- 3D globe extras ----
  function enhanceGlobe() {
    if (!globe) return;
    globe.hexBinPointWeight(d => Math.max(1, d.count || 1)).hexBinResolution(3).hexMargin(0.2)
      .hexAltitude(d => Math.min(0.25, 0.01 + d.sumWeight / 400)).hexTopColor(() => 'rgba(244,63,94,0.85)').hexSideColor(() => 'rgba(244,63,94,0.35)')
      .hexLabel(d => `<b>${d.points.length} conflict locations</b><br>${esc(d.points.slice(0, 3).map(p => p.label).join(' · '))}`)
      .onHexClick(d => setFocus(d.points[0]))
      .arcColor('color').arcStroke(0.4).arcDashLength(0.4).arcDashGap(2).arcDashAnimateTime(reduceMotion ? 0 : 3000)
      .pointLabel(d => `<b>${esc(d.label)}</b>`).pointColor(d => d.solid)
      .onPointClick(d => d.url && (d.k === 'quake' || d.k === 'eonet') ? setFocus({ ...d, kind: d.k }) : setFocus(d))
      .polygonCapColor(() => 'rgba(0,0,0,0)').polygonSideColor(() => 'rgba(0,0,0,0)').polygonStrokeColor(() => 'rgba(148,163,184,0.25)').polygonAltitude(0.004)
      .polygonLabel(d => `<b>${esc(d.properties.name)}</b><br><small>Click for country briefing</small>`)
      .onPolygonHover(h => globe.polygonCapColor(d => d === h ? 'rgba(34,211,238,0.15)' : 'rgba(0,0,0,0)'))
      .onPolygonClick(d => countryPanel(d.properties.name));
    if (st.pov) { const [lat, lng, altitude] = st.pov.split(',').map(Number); if ([lat, lng, altitude].every(isFinite)) { globe.pointOfView({ lat, lng, altitude }); globe.controls().autoRotate = rotating = false; } }
    let t; globe.onZoom(() => { clearTimeout(t); t = setTimeout(saveUrl, 800); });
    if (countries.length) globe.polygonsData(countries);
  }
  async function loadCountries() {
    try { const topo = await (await fetchT('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')).json(); countries = topojson.feature(topo, topo.objects.countries).features; } catch { return; }
    if (globe) globe.polygonsData(countries);
    if (leafletMap) addLeafletCountries();
  }

  // ---- country panel ----
  const INDEX = { India: 'BSE:SENSEX', 'United States of America': 'FOREXCOM:SPXUSD', Japan: 'INDEX:NKY', 'United Kingdom': 'FOREXCOM:UKXGBP', Germany: 'XETR:DAX', China: 'INDEX:HSI', Canada: 'FOREXCOM:SPXUSD' };
  const ALIASES = { 'United States of America': ['United States', 'U.S.', 'US '], 'Russia': ['Russian'], 'Ukraine': ['Ukrainian', 'Kyiv'], 'Israel': ['Israeli', 'Gaza'], 'Palestine': ['Gaza', 'West Bank', 'Palestinian'], 'Iran': ['Iranian', 'Tehran'], 'China': ['Chinese', 'Beijing'], 'Dem. Rep. Congo': ['Congo', 'DRC'], 'S. Sudan': ['South Sudan'] };
  function countryPanel(name) {
    const words = [name, ...(ALIASES[name] || [])].map(w => w.toLowerCase());
    const news = newsArts.filter(a => words.some(w => (a.title || '').toLowerCase().includes(w)) || (a.sourcecountry || '').toLowerCase() === name.toLowerCase()).slice(0, 12);
    const doms = Object.entries(news.reduce((m, a) => (m[a.domain] = (m[a.domain] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const dis = [...disasterRaw.filter(x => (x.properties.country || '').toLowerCase().includes(name.toLowerCase())).map(x => x.properties.name), ...extra.quakes.filter(q => q.label.toLowerCase().includes(name.toLowerCase())).map(q => q.label)].slice(0, 8);
    const idx = INDEX[name];
    $('details').innerHTML = `<button class="close" onclick="setFocus(null)" aria-label="Close details">✕</button><h3>${esc(name)}</h3>
      <p class="mut">Headlines (GDELT, title or source country match)</p>${news.length ? news.map(a => `<a class="item" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.title)}<small>${esc(a.domain)}</small></a>`).join('') : '<p class="empty">No matching headlines in the loaded set.</p>'}
      ${doms.length ? `<p class="mut">Sources</p><div class="chips">${doms.map(([d, n]) => `<span class="chip">${esc(d)} ×${n}</span>`).join('')}</div>` : ''}
      <p class="mut">Disasters / quakes</p>${dis.length ? dis.map(d => `<div class="item">${esc(d)}</div>`).join('') : '<p class="empty">None in current feeds.</p>'}
      ${idx ? `<p><a href="./?s=${encodeURIComponent(idx)}">📈 Open ${esc(idx)} on Markets →</a></p>` : ''}`;
    $('details').hidden = false;
  }

  // ---- keyword watch (localStorage + Notification API) ----
  const kw = () => { try { return JSON.parse(localStorage.getItem('gp:kw')) || []; } catch { return []; } };
  const seen = new Set(JSON.parse(localStorage.getItem('gp:kwseen') || '[]'));
  function renderKw() { $('kwList').innerHTML = kw().map(k => `<span class="chip">${esc(k)} <button data-k="${esc(k)}" aria-label="Remove ${esc(k)}">✕</button></span>`).join('') || '<span class="mut">No keywords yet.</span>'; checkKw(); }
  function notify(title, body, href) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: 'favicon.svg' }); if (href) n.onclick = () => open(href, '_blank', 'noopener');
  }
  function checkKw() {
    const ks = kw().map(k => k.toLowerCase()); if (!ks.length) { $('kwHits').innerHTML = ''; return; }
    const hits = newsArts.filter(a => ks.some(k => (a.title || '').toLowerCase().includes(k)));
    $('kwHits').innerHTML = hits.slice(0, 8).map(a => `<a class="item" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.title)}<small>${esc(a.domain)}</small></a>`).join('') || '<p class="empty">No matches in the loaded headlines.</p>';
    for (const a of hits.slice(0, 5)) if (!seen.has(a.url)) { seen.add(a.url); notify('Global Pulse keyword match', a.title, safeUrl(a.url)); }
    localStorage.setItem('gp:kwseen', JSON.stringify([...seen].slice(-300)));
  }

  // ---- near-me geofence ----
  function checkNearMe() {
    let me; try { me = JSON.parse(localStorage.getItem('gp:near')); } catch {} if (!me) return;
    const R = me.km || 500;
    const near = [...extra.quakes, ...extra.eonet, ...disasterPts].map(p => ({ p, d: dist(me, p) })).filter(x => x.d <= R).sort((a, b) => a.d - b.d);
    $('nearOut').innerHTML = near.length ? near.slice(0, 6).map(({ p, d }) => `<div class="item">${esc(p.label)}<small>${Math.round(d)} km away</small></div>`).join('') : `<p class="empty">Nothing within ${R} km right now.</p>`;
    $('nearBtn').textContent = '📍 Near-me alerts on (turn off)';
    for (const { p, d } of near.slice(0, 3)) { const id = 'n:' + p.label; if (!seen.has(id)) { seen.add(id); notify('Near you: ' + p.label, Math.round(d) + ' km away'); } }
  }

  // ---- time slider ----
  function setPos(v) { st.pos = v; $('tSlider').value = v; render(); }
  function play() {
    if (reduceMotion) return; playing = !playing; $('playBtn').textContent = playing ? '⏸ Pause' : '▶ Play';
    if (!playing) { cancelAnimationFrame(raf); saveUrl(); return; }
    if (st.pos >= st.win) st.pos = 0; let last = performance.now();
    const step = now => { const dt = now - last; last = now; st.pos = Math.min(st.win, st.pos + dt / 10000 * st.win); $('tSlider').value = st.pos; render(); if (st.pos < st.win && playing) raf = requestAnimationFrame(step); else { playing = false; $('playBtn').textContent = '▶ Play'; saveUrl(); } };
    raf = requestAnimationFrame(step);
  }

  // ---- Leaflet 2D fallback ----
  function init2d() {
    const el = $('globe'); el.innerHTML = ''; el.setAttribute('aria-label', '2D world map with event markers');
    leafletMap = L.map(el, { worldCopyJump: true, zoomControl: true }).setView([20, 40], isMobile ? 1 : 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 8, className: 'dark-tiles' }).addTo(leafletMap);
    leafletLayer = L.markerClusterGroup({ maxClusterRadius: 40 }).addTo(leafletMap);
    leafletMap.on('moveend', saveUrl); $('rotateBtn').hidden = true;
    if (countries.length) addLeafletCountries();
  }
  function addLeafletCountries() {
    L.geoJSON({ type: 'FeatureCollection', features: countries }, { style: { color: '#334155', weight: 0.6, fillOpacity: 0 }, onEachFeature: (f, l) => l.on('click', () => countryPanel(f.properties.name)) }).addTo(leafletMap).bringToBack();
  }
  function render2d(pts) {
    leafletLayer.clearLayers();
    for (const p of pts) {
      const m = L.circleMarker([p.lat, p.lng], { radius: p.k === 'quake' ? Math.max(4, (p.mag - 4) * 3) : p.k === 'war' ? 6 : 5, color: COL[p.k], fillColor: COL[p.k], fillOpacity: 0.7, weight: 1 });
      m.bindTooltip(esc(p.label)); m.on('click', () => setFocus(p.k === 'quake' || p.k === 'eonet' ? { ...p, kind: p.k } : p)); leafletLayer.addLayer(m);
    }
  }

  // ---- wire up ----
  function ui() {
    $('layers').innerHTML = Object.entries(LAYERS).map(([k, n]) => `<label><input type="checkbox" data-l="${k}" ${st.layers.has(k) ? 'checked' : ''}> <i class="dot" style="background:${{ news: COL.war, heat: COL.war, quakes: COL.quake, dis: COL.dis, eonet: COL.eonet, ex: COL.open }[k]}"></i>${n}</label>`).join('');
    $('layers').onchange = e => { const k = e.target.dataset.l; e.target.checked ? st.layers.add(k) : st.layers.delete(k); render(); saveUrl(); };
    $('tWin').value = st.win === 168 ? '7d' : '24h'; $('tSlider').max = st.win; $('tSlider').value = st.pos;
    $('tWin').onchange = e => { st.win = e.target.value === '7d' ? 168 : 24; $('tSlider').max = st.win; setPos(st.win); saveUrl(); };
    $('tSlider').oninput = e => setPos(+e.target.value); $('tSlider').onchange = saveUrl;
    if (reduceMotion) { $('playBtn').disabled = true; $('playBtn').title = 'Animation off (reduced motion)'; } $('playBtn').onclick = play;
    $('kwForm').onsubmit = e => { e.preventDefault(); const v = $('kwIn').value.trim().slice(0, 40); if (v && !kw().includes(v)) localStorage.setItem('gp:kw', JSON.stringify([...kw(), v].slice(0, 20))); $('kwIn').value = ''; renderKw(); };
    $('kwList').onclick = e => { const k = e.target.dataset.k; if (k) { localStorage.setItem('gp:kw', JSON.stringify(kw().filter(x => x !== k))); renderKw(); } };
    $('notifBtn').onclick = async () => { if (!('Notification' in window)) return $('notifBtn').textContent = 'Notifications not supported'; const p = await Notification.requestPermission(); $('notifBtn').textContent = p === 'granted' ? '🔔 Alerts on' : '🔕 Alerts blocked'; };
    if ('Notification' in window && Notification.permission === 'granted') $('notifBtn').textContent = '🔔 Alerts on';
    $('nearBtn').onclick = () => {
      if (localStorage.getItem('gp:near')) { localStorage.removeItem('gp:near'); $('nearOut').innerHTML = ''; $('nearBtn').textContent = '📍 Alert me about events near me'; return; }
      if (!navigator.geolocation) return $('nearOut').textContent = 'Geolocation not supported.';
      navigator.geolocation.getCurrentPosition(p => { localStorage.setItem('gp:near', JSON.stringify({ lat: +p.coords.latitude.toFixed(2), lng: +p.coords.longitude.toFixed(2), km: +$('nearKm').value })); checkNearMe(); },
        () => $('nearOut').innerHTML = '<p class="empty">Location permission denied.</p>', { maximumAge: 3600e3, timeout: 15000 });
    };
    $('viewBtn').textContent = leafletMap ? '🌍 3D globe' : '🗺 2D map';
    $('viewBtn').onclick = () => { const q = new URLSearchParams(location.search); q.set('view', leafletMap ? '3d' : '2d'); q.delete('pov'); location.search = q; };
    const r = url.get('region'); if (r) { $('region').value = r; REGION = $('region').value; }
    $('region').addEventListener('change', saveUrl);
    renderKw();
  }

  return {
    boot(origInit) {
      const want2d = st.view === '2d' || (st.view !== '3d' && isMobile) || !webglOK() || !window.Globe;
      if (want2d && window.L) init2d(); else { origInit(); enhanceGlobe(); }
      ui(); loadCountries(); loadExtra(); setInterval(loadExtra, 15 * 60000);
    },
    render, checkKw,
  };
})();
// Hook into app.js
const _origInit = initGlobe;
initGlobe = () => W2.boot(_origInit);
updateGlobe = () => W2.render();
const _origRenderNews = renderNews;
renderNews = () => { _origRenderNews(); W2.checkKw(); };
