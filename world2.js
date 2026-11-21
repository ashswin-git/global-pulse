// World Pulse v2: layers, time slider, country panel, keyword/near-me alerts, arcs, URL state, 2D fallback.
// Ideas (not code) inspired by worldmonitor, situation-monitor, globalthreatmap, LiveActionMap, OSINT-War-Room; see README credits.
const W2 = (() => {
  const LAYER_GROUPS = [
    ['Live events', { news: 'Conflict news points', heat: 'Conflict heat (hexbin)', quakes: 'Earthquakes M4.5+ (USGS)', dis: 'Disasters (GDACS)', eonet: 'Hazards (NASA EONET)', cams: 'Live public cameras' }],
    ['Markets', { ex: 'Stock exchanges', crypto: 'Crypto exchanges' }],
    ['Infrastructure', { cables: 'Undersea internet cables', nuclear: 'Nuclear power plants', power: 'Major power plants (1 GW+)', pipes: 'Oil & gas pipelines', ports: 'Major ports' }],
    ['Intel', { bases: 'Military bases', tech: 'Data centers, hubs & AI labs', chokepoints: 'Strategic chokepoints' }],
  ];
  const LAYERS = Object.assign({}, ...LAYER_GROUPS.map(([, o]) => o));
  const url = new URLSearchParams(location.search);
  const st = {
    layers: new Set((url.get('layers') || 'news,heat,quakes,dis,eonet,ex').split(',').filter(k => LAYERS[k])),
    win: url.get('t') === '7d' ? 168 : 24, pos: null, pov: url.get('pov'), view: url.get('view'),
    camVideoOnly: url.get('vid') === '1',
    bm: (window.GPUI && GPUI.readPageBasemap()) || 'night',
  };
  st.pos = Math.min(+url.get('at') || st.win, st.win);
  const extra = { quakes: [], eonet: [] };
  const INTEL = { cables: [], nuclear: [], power: [], crypto: [], tech: [], bases: [], ports: [], pipes: [], chokepoints: [], cameras: [] };
  const INTEL_FILE = { cables: 'cables', nuclear: 'nuclear', power: 'power', crypto: 'crypto-exchanges', tech: 'tech', bases: 'bases', ports: 'ports', pipes: 'pipelines', chokepoints: 'chokepoints', cameras: 'cameras' };
  let countries = [], leafletMap = null, leafletLayer = null, leafletLines = null, playing = false, raf = 0, viewMode = '3d';

  function saveUrl() {
    const q = new URLSearchParams();
    q.set('layers', [...st.layers].join(',')); if (REGION !== 'All') q.set('region', REGION);
    q.set('t', st.win === 168 ? '7d' : '24h'); if (st.pos < st.win) q.set('at', Math.round(st.pos));
    if (st.camVideoOnly) q.set('vid', '1');
    if (st.bm) q.set('bm', st.bm);
    if (globe) { const p = globe.pointOfView(); q.set('pov', [p.lat, p.lng, p.altitude].map(n => n.toFixed(2)).join(',')); }
    if (viewMode === '2d') q.set('view', '2d');
    if (leafletMap && viewMode === '2d') { const c = leafletMap.getCenter(); q.set('z', String(leafletMap.getZoom())); q.set('c', c.lat.toFixed(3) + ',' + c.lng.toFixed(3)); }
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
    updateLayerCounts(); render(); checkNearMe();
  }
  const INTEL_READY = {};
  function layerIntelKey(k) { return k === 'cams' ? 'cameras' : (INTEL_FILE[k] ? k : null); }
  async function loadIntelIndex() {
    try {
      const idx = await (await fetchT('data/intel/index.json')).json();
      INTEL._counts = idx.counts || {};
      INTEL._videoCams = idx.videoCams;
      updateLayerCounts();
    } catch {}
  }
  async function ensureIntel(key) {
    if (!key || INTEL_READY[key]) return;
    INTEL_READY[key] = 1;
    const file = INTEL_FILE[key];
    if (!file) return;
    try {
      const d = await (await fetchT('data/intel/' + file + '.json')).json();
      INTEL[key] = d.items || [];
      INTEL._meta = INTEL._meta || {};
      INTEL._meta[key] = d.meta;
    } catch { INTEL[key] = []; }
    updateLayerCounts();
    render();
  }
  function loadIntelForLayers() {
    return Promise.all([...st.layers].map(k => { const ik = layerIntelKey(k); return ik ? ensureIntel(ik) : null; }));
  }
  function intelPts(key, kind) {
    return (INTEL[key] || []).map(it => ({
      lat: it.lat, lng: it.lng, label: it.n, kind, k: kind, intel: it,
      region: regionOf(it.lat, it.lng), src: INTEL._meta?.[key],
    }));
  }
  function intelPaths(key, kind) {
    if (!st.layers.has(key)) return [];
    const out = [];
    for (const it of INTEL[key] || []) {
      for (const line of it.lines || []) {
        if (line.length < 2) continue;
        out.push({ coords: line, label: it.n, kind, k: kind, intel: it, src: INTEL._meta?.[key] });
      }
    }
    return out;
  }

  // ---- render (replaces app.js updateGlobe) ----
  const COL = { open: '#22d3ee', lunch: '#67e8f9', closed: '#64748b', holiday: '#64748b', war: '#f43f5e', dis: '#f59e0b', quake: '#a78bfa', eonet: '#34d399', cable: '#7dd3fc', nuclear: '#f472b6', power: '#fbbf24', crypto: '#fde047', tech: '#818cf8', bases: '#a3e635', ports: '#2dd4bf', pipe: '#fb923c', chokepoints: '#fda4af', cams: '#38bdf8' };
  const STATIC_KIND = new Set(['exchange', 'nuclear', 'power', 'crypto', 'tech', 'bases', 'ports', 'chokepoints', 'cable', 'pipe', 'cams']);
  function visible() {
    const L = st.layers, reg = p => REGION === 'All' || p.region === REGION, out = [];
    if (L.has('ex')) EXCHANGES.forEach(e => { const s = status(e); out.push({ ...e, label: `${e.ex} — ${ST_LABEL[s].slice(2)}`, st: s, k: s }); });
    if (L.has('news')) conflictPts.forEach(h => out.push({ ...h, label: h.ref ? h.name + ' (reference)' : h.label, k: 'war' }));
    if (L.has('dis')) disasterPts.forEach(d => out.push({ ...d, k: 'dis' }));
    if (L.has('quakes')) extra.quakes.forEach(d => out.push({ ...d, k: 'quake' }));
    if (L.has('eonet')) extra.eonet.forEach(d => out.push({ ...d, k: 'eonet' }));
    if (L.has('nuclear')) intelPts('nuclear', 'nuclear').forEach(d => out.push(d));
    if (L.has('power')) intelPts('power', 'power').forEach(d => out.push(d));
    if (L.has('crypto')) intelPts('crypto', 'crypto').forEach(d => out.push(d));
    if (L.has('tech')) intelPts('tech', 'tech').forEach(d => out.push(d));
    if (L.has('bases')) intelPts('bases', 'bases').forEach(d => out.push(d));
    if (L.has('ports')) intelPts('ports', 'ports').forEach(d => out.push(d));
    if (L.has('chokepoints')) intelPts('chokepoints', 'chokepoints').forEach(d => out.push(d));
    if (L.has('cams')) intelPts('cameras', 'cams').filter(d => !st.camVideoOnly || d.intel?.vid || d.intel?.stream).forEach(d => out.push(d));
    return out.filter(p => reg(p) && (STATIC_KIND.has(p.kind) || inTime(p.t)));
  }
  function arcs(pts) {
    if (reduceMotion) return [];
    const big = pts.filter(p => (p.k === 'dis' && p.p?.alertlevel === 'Red') || (p.k === 'quake' && p.mag >= 6) || (p.k === 'war' && (p.count || 0) >= 20)).slice(0, 15);
    return big.map(p => { const e = EXCHANGES.reduce((a, b) => dist(p, a) < dist(p, b) ? a : b); return { startLat: p.lat, startLng: p.lng, endLat: e.lat, endLng: e.lng, color: [COL[p.k], '#22d3ee'] }; });
  }
  function render() {
    let pts = visible();
    if (viewMode !== '2d' && pts.length > 900) {
      const alt = (globe && globe.pointOfView && globe.pointOfView().altitude) || 2;
      if (alt > 0.9) {
        const keep = new Set(['exchange', 'war', 'dis', 'quake', 'eonet', 'chokepoints', 'nuclear', 'cams']);
        let n = 0;
        pts = pts.filter(p => keep.has(p.kind) || keep.has(p.k) ? (n++, true) : (n++ % 4 === 0));
      }
    }
    const paths = [...intelPaths('cables', 'cable'), ...intelPaths('pipes', 'pipe')];
    $('w2count').textContent = `${pts.length} markers${paths.length ? ` · ${paths.length} routes` : ''} · window ${st.win === 168 ? '7 days' : '24 hours'}${st.pos < st.win ? ` up to ${new Date(Date.now() - (st.win - st.pos) * 3600e3).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`;
    if (viewMode === '2d' && leafletMap) return render2d(pts, paths);
    if (!globe) return;
    const R = { war: 4, open: 4, chokepoints: 5, nuclear: 3, crypto: 3, ports: 2.8, tech: 2.6, bases: 2.2, power: 1.8, cams: 2.4 };
    const RING = new Set(['open', 'lunch', 'war', 'dis', 'quake', 'chokepoints', 'nuclear']);
    const dots = pts.map(p => ({ ...p, solid: COL[p.k] || '#94a3b8', color: hexA(COL[p.k] || '#94a3b8'), r: p.k === 'quake' ? Math.max(1.5, (p.mag - 4) * 1.6) : (R[p.k] || 2.5), period: p.k === 'open' || p.k === 'chokepoints' ? 1200 : 1600, ring: RING.has(p.k) }));
    let rings = reduceMotion ? [] : dots.filter(p => p.ring); if (isMobile) rings = rings.slice(0, 20);
    globe.pointsData(dots).ringsData(rings.slice(0, 80))
      .hexBinPointsData(st.layers.has('heat') ? conflictPts.filter(p => !p.ref && inTime(p.t) && (REGION === 'All' || p.region === REGION)) : [])
      .arcsData(arcs(pts))
      .pathsData(paths);
  }
  const hexA = h => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},1)`; };
  const dist = (a, b) => { const r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };


  // ---- hover tooltips (throttled, shared by 3D + 2D) ----
  const KIND_NAME = { open: 'Stock exchange (open)', lunch: 'Stock exchange (lunch)', closed: 'Stock exchange (closed)', holiday: 'Stock exchange (holiday)', exchange: 'Stock exchange', war: 'Conflict report', dis: 'Disaster alert (GDACS)', quake: 'Earthquake (USGS)', eonet: 'Natural hazard (NASA EONET)', nuclear: 'Nuclear power plant', power: 'Major power plant', cable: 'Submarine communication cable', pipe: 'Oil / gas pipeline', ports: 'Major port', bases: 'Military installation', tech: 'Tech site', crypto: 'Crypto exchange', chokepoints: 'Strategic chokepoint', cams: 'Live public camera', heat: 'Conflict heat cluster', country: 'Country' };
  const CAM_SRC = () => INTEL._meta?.cameras?.sources || {};
  function tipHTML(d) {
    if (!d) return '';
    if (d.kind === 'heat' || d.points) {
      const n = d.points?.length || d.label || '';
      return `<b>${n} conflict locations</b><span class="typ">Conflict heat</span><span>${esc((d.points || []).slice(0, 4).map(p => p.label).join(' · '))}</span><span class="mut">GDELT · click a cell for details</span>`;
    }
    if (d.kind === 'country' || (d.properties && d.properties.name && !d.k)) {
      return `<b>${esc(d.properties?.name || d.label)}</b><span class="typ">Country</span><span class="mut">Click for a briefing</span>`;
    }
    const it = d.intel || {}, src = d.src || {}, k = d.k || d.kind, typ = KIND_NAME[k] || KIND_NAME[d.kind] || '';
    const bits = [];
    if (d.kind === 'exchange') { const s = status(d); bits.push(ST_LABEL[s] + ' (approx.)', `${d.o}–${d.c} ${d.tz}`); }
    else if (d.kind === 'war') bits.push(d.ref ? 'Static reference hotspot' : 'Mentioned in recent GDELT reporting', d.count ? `${d.count} mentions` : '');
    else if (d.kind === 'dis') bits.push(d.p?.alertlevel ? 'Alert ' + d.p.alertlevel : '', d.p?.country || '');
    else if (d.kind === 'quake') bits.push(d.mag != null ? 'M' + d.mag : '', d.t ? new Date(d.t).toLocaleString() : '');
    else if (d.kind === 'eonet') bits.push(it.cat || '', d.t ? new Date(d.t).toLocaleString() : '');
    else if (d.kind === 'nuclear' || d.kind === 'power') bits.push(it.fuel || '', it.mw != null ? it.mw + ' MW' : '', it.c || '');
    else if (d.kind === 'cable' || d.kind === 'pipe') bits.push(it.fuel || it.cat || '', it.km ? it.km + ' km (simplified)' : '', it.op || '');
    else if (d.kind === 'ports') bits.push(it.c || '', it.rank != null ? 'Natural Earth rank ' + it.rank : '');
    else if (d.kind === 'bases') bits.push(it.typ || '', it.arm || '', it.c || '');
    else if (d.kind === 'tech' || d.kind === 'crypto') bits.push(it.typ || '', it.c || '');
    else if (d.kind === 'chokepoints') bits.push(it.typ || '', it.src || '');
    else if (d.kind === 'cams') {
      const s = CAM_SRC()[it.src] || {};
      const media = (it.vid || it.stream) ? 'Video' : 'Snapshot';
      bits.push(media, it.c || '', s.name || it.src || 'Official public camera');
    }
    const credit = d.kind === 'cams' ? (CAM_SRC()[it.src]?.name || src.attribution || '') : (src.attribution || src.source || '');
    return `<b>${esc(d.label || it.n || '')}</b>${typ ? `<span class="typ">${esc(typ)}</span>` : ''}${bits.filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}${credit ? `<span class="mut">${esc(credit)}</span>` : ''}<span class="mut">Click for full details</span>`;
  }
  const hover = { point: null, path: null, hex: null, country: null, x: 0, y: 0, raf: 0, key: '' };
  function hoverTop() { return hover.point || hover.path || hover.hex || hover.country; }
  function tipKey(d) { return d ? (d.kind + '|' + (d.label || d.intel?.n || d.properties?.name || '') + '|' + (d.lat || '') + '|' + (d.lng || '')) : ''; }
  function placeTip() {
    hover.raf = 0;
    const el = $('mapTip'); if (!el) return;
    const d = hoverTop();
    if (!d) { el.hidden = true; el.innerHTML = ''; hover.key = ''; return; }
    const key = tipKey(d);
    if (key !== hover.key) { el.innerHTML = tipHTML(d); hover.key = key; }
    el.hidden = false;
    const wrap = el.parentElement.getBoundingClientRect();
    const tw = el.offsetWidth || 240, th = el.offsetHeight || 80;
    let x = hover.x + 14, y = hover.y + 14;
    if (x + tw > wrap.width - 8) x = hover.x - tw - 10;
    if (y + th > wrap.height - 8) y = hover.y - th - 10;
    el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }
  function scheduleTip() { if (!hover.raf) hover.raf = requestAnimationFrame(placeTip); }
  function setHover(slot, d) { hover[slot] = d || null; scheduleTip(); }
  function onTipMove(e) {
    const wrap = $('mapTip')?.parentElement; if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    hover.x = e.clientX - r.left; hover.y = e.clientY - r.top;
    scheduleTip();
  }
  function tipHTMLLeaflet(d) { return tipHTML(d); }

  // ---- 3D globe extras ----
  function enhanceGlobe() {

    if (!globe) return;
    globe.hexBinPointWeight(d => Math.max(1, d.count || 1)).hexBinResolution(3).hexMargin(0.2)
      .hexAltitude(d => Math.min(0.25, 0.01 + d.sumWeight / 400)).hexTopColor(() => 'rgba(244,63,94,0.85)').hexSideColor(() => 'rgba(244,63,94,0.35)')
      .hexLabel(() => null).onHexHover(d => setHover('hex', d && { kind: 'heat', points: d.points, label: (d.points||[]).length + ' conflict locations' }))
      .onHexClick(d => setFocus(d.points[0]))
      .arcColor('color').arcStroke(0.4).arcDashLength(0.4).arcDashGap(2).arcDashAnimateTime(reduceMotion ? 0 : 3000)
      .pointLabel(() => null).pointColor(d => d.solid)
      .onPointHover(d => setHover('point', d))
      .onPointClick(d => d.url && (d.k === 'quake' || d.k === 'eonet') ? setFocus({ ...d, kind: d.k }) : setFocus(d))
      .pathsData([]).pathPoints(d => d.coords).pathPointLat(p => p[0]).pathPointLng(p => p[1])
      .pathColor(d => COL[d.k] || '#7dd3fc').pathStroke(0.55).pathTransitionDuration(0)
      .pathLabel(() => null).onPathHover(d => setHover('path', d))
      .onPathClick(d => setFocus({ ...d, kind: d.kind }))
      .polygonCapColor(() => 'rgba(0,0,0,0)').polygonSideColor(() => 'rgba(0,0,0,0)').polygonStrokeColor(() => (st.bm === 'night' || st.bm === 'dark') ? 'rgba(34,211,238,0.5)' : 'rgba(148,163,184,0.25)').polygonAltitude(0.004)
      .polygonLabel(() => null)
      .onPolygonHover(h => { globe.polygonCapColor(d => d === h ? 'rgba(34,211,238,0.15)' : 'rgba(0,0,0,0)'); setHover('country', h && { kind: 'country', properties: h.properties, label: h.properties?.name }); })
      .onPolygonClick(d => countryPanel(d.properties.name));
    const ctl = globe.controls(); ctl.minDistance = 1.08; ctl.maxDistance = 1000;
    if (st.pov) { const [lat, lng, altitude] = st.pov.split(',').map(Number); if ([lat, lng, altitude].every(isFinite)) { globe.pointOfView({ lat, lng, altitude }); globe.controls().autoRotate = rotating = false; } }
    let t; globe.onZoom(() => {
      clearTimeout(t); t = setTimeout(saveUrl, 800);
      const p = globe.pointOfView();
      if (viewMode === '3d' && p.altitude < 0.28) {
        const z = Math.max(5, Math.min(14, Math.round(2 - Math.log2(Math.max(0.02, p.altitude) / 2.2))));
        setViewMode('2d', p.lat, p.lng, z);
      }
    });
    if (countries.length) globe.polygonsData(countries);
    const gEl = $('globe');
    gEl.addEventListener('pointermove', onTipMove, { passive: true });
    gEl.addEventListener('pointerleave', () => { hover.point = hover.path = hover.hex = hover.country = null; scheduleTip(); });
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
    if (window.GPUI) GPUI.toast(title, body, { href });
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
  function updateLayerCounts() {
    const c0 = INTEL._counts || {};
    const n = {
      news: conflictPts.filter(p => !p.ref).length || conflictPts.length,
      heat: conflictPts.filter(p => !p.ref).length,
      quakes: extra.quakes.length,
      dis: disasterPts.length,
      eonet: extra.eonet.length,
      cams: (INTEL.cameras || []).length || c0.cameras || c0.cams,
      ex: typeof EXCHANGES !== 'undefined' ? EXCHANGES.length : '',
      crypto: (INTEL.crypto || []).length || c0.crypto,
      cables: (INTEL.cables || []).length || c0.cables,
      nuclear: (INTEL.nuclear || []).length || c0.nuclear,
      power: (INTEL.power || []).length || c0.power,
      pipes: (INTEL.pipes || []).length || c0.pipes,
      ports: (INTEL.ports || []).length || c0.ports,
      bases: (INTEL.bases || []).length || c0.bases,
      tech: (INTEL.tech || []).length || c0.tech,
      chokepoints: (INTEL.chokepoints || []).length || c0.chokepoints,
    };
    for (const [k, v] of Object.entries(n)) {
      const el = document.querySelector('#layers [data-c="' + k + '"]');
      if (el && v !== '' && v != null) el.textContent = v;
    }
    const ev = document.querySelector('#layers [data-c="camsvid"]');
    if (ev && INTEL._videoCams) ev.textContent = INTEL._videoCams;
  }
  function init2d() {
    const el = $('map2d') || $('globe');
    if (leafletMap) return;
    let center = [20, 40], z = isMobile ? 2 : 3;
    const c = new URLSearchParams(location.search).get('c');
    const zq = +new URLSearchParams(location.search).get('z');
    if (c) { const [a, b] = c.split(',').map(Number); if (isFinite(a) && isFinite(b)) center = [a, b]; }
    if (isFinite(zq) && zq >= 1) z = Math.min(19, zq);
    leafletMap = L.map(el, { worldCopyJump: true, zoomControl: true, minZoom: 1, maxZoom: 20, renderer: L.canvas({ padding: 0.5 }) }).setView(center, z);
    if (window.GPUI) GPUI.setLeafletBasemap(leafletMap, st.bm);
    else L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      maxZoom: 20, maxNativeZoom: 19,
    }).addTo(leafletMap);
    leafletLayer = L.markerClusterGroup({ maxClusterRadius: 48, disableClusteringAtZoom: 11, spiderfyOnMaxZoom: true, showCoverageOnHover: false }).addTo(leafletMap);
    leafletLines = L.layerGroup().addTo(leafletMap);
    leafletMap.on('moveend', saveUrl);
    if (countries.length) addLeafletCountries();
  }

  function applyBasemap(mode) {
    if (mode) st.bm = mode;
    if (window.GPUI) GPUI.persistBasemap('gp:basemap', st.bm);
    if (window.GPUI) {
      if (globe) {
        GPUI.applyGlobeBasemap(globe, st.bm);
        const lit = st.bm === 'night' || st.bm === 'dark';
        globe.polygonStrokeColor(() => lit ? 'rgba(34,211,238,0.5)' : 'rgba(148,163,184,0.25)');
      }
      if (leafletMap) GPUI.setLeafletBasemap(leafletMap, st.bm);
    }
    saveUrl();
  }
  let _init3d;
  async function setViewMode(mode, lat, lng, zoom) {
    viewMode = mode;
    const g = $('globe'), m = $('map2d');
    if (m) { m.hidden = mode !== '2d'; if (g) g.hidden = mode !== '3d'; }
    if (mode === '2d') {
      if (window.GPUI) await GPUI.loadLeaflet();
      if (!leafletMap && window.L) init2d();
      if ($('rotateBtn')) $('rotateBtn').hidden = true;
      if (leafletMap) {
        leafletMap.invalidateSize();
        if (lat != null) leafletMap.setView([lat, lng], zoom || Math.max(leafletMap.getZoom(), 8));
      }
    } else {
      if (window.GPUI) await GPUI.loadGlobeLib();
      if (!globe && typeof _init3d === 'function') { _init3d(); enhanceGlobe(); }
      if ($('rotateBtn')) $('rotateBtn').hidden = false;
    }
    if ($('viewBtn')) $('viewBtn').textContent = mode === '2d' ? '🌍 3D globe' : '🗺 2D map';
    render(); saveUrl();
  }
  function flyTo(lat, lng, zoom) {
    if (lat == null || lng == null) return;
    setViewMode('2d', lat, lng, zoom || 16);
  }
  function addLeafletCountries() {
    L.geoJSON({ type: 'FeatureCollection', features: countries }, { style: { color: '#334155', weight: 0.6, fillOpacity: 0 }, onEachFeature: (f, l) => l.on('click', () => countryPanel(f.properties.name)) }).addTo(leafletMap).bringToBack();
  }
  function render2d(pts, paths) {
    leafletLayer.clearLayers();
    if (leafletLines) leafletLines.clearLayers();
    for (const p of pts) {
      const m = L.circleMarker([p.lat, p.lng], { radius: p.k === 'quake' ? Math.max(4, (p.mag - 4) * 3) : p.k === 'war' || p.k === 'chokepoints' ? 6 : 5, color: COL[p.k], fillColor: COL[p.k], fillOpacity: 0.7, weight: 1 });
      m.bindTooltip(tipHTMLLeaflet(p), { sticky: true, opacity: 1, className: 'map-tip', direction: 'top' }); m.on('click', () => setFocus(p.k === 'quake' || p.k === 'eonet' ? { ...p, kind: p.k } : p)); leafletLayer.addLayer(m);
    }
    for (const path of paths || []) {
      const pl = L.polyline(path.coords, { color: COL[path.k], weight: 1.6, opacity: 0.85 });
      pl.bindTooltip(tipHTMLLeaflet(path), { sticky: true, opacity: 1, className: 'map-tip', direction: 'top' }); pl.on('click', () => setFocus({ ...path, kind: path.kind }));
      leafletLines.addLayer(pl);
    }
  }

  // ---- wire up ----
  function ui() {
    const DOT = { news: COL.war, heat: COL.war, quakes: COL.quake, dis: COL.dis, eonet: COL.eonet, cams: COL.cams, ex: COL.open, crypto: COL.crypto, cables: COL.cable, nuclear: COL.nuclear, power: COL.power, pipes: COL.pipe, ports: COL.ports, bases: COL.bases, tech: COL.tech, chokepoints: COL.chokepoints };
    $('layers').innerHTML = LAYER_GROUPS.map(([title, group]) => `<div class="layer-group"><b>${title}</b>${Object.entries(group).map(([k, n]) => `<label class="layer-row"><input type="checkbox" data-l="${k}" ${st.layers.has(k) ? 'checked' : ''}> <i class="dot" style="background:${DOT[k]}"></i><span>${n}</span><span class="count" data-c="${k}"></span></label>`).join('')}${title === 'Live events' ? `<label class="layer-row sub"><input type="checkbox" id="camVideoOnly" ${st.camVideoOnly ? 'checked' : ''}> <span>Video cameras only</span><span class="count" data-c="camsvid"></span></label>` : ''}</div>`).join(''); updateLayerCounts();
    $('layers').onchange = async e => {
      const k = e.target.dataset.l; if (!k) return;
      if (e.target.checked) { st.layers.add(k); const ik = layerIntelKey(k); if (ik) await ensureIntel(ik); }
      else st.layers.delete(k);
      render(); saveUrl();
    };
    const vidBox = $('camVideoOnly');
    if (vidBox) {
      vidBox.checked = !!st.camVideoOnly;
      vidBox.onchange = () => { st.camVideoOnly = vidBox.checked; render(); saveUrl(); };
    }
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
    if (window.GPUI) {
      GPUI.wirePanel(); GPUI.wireIntelTabs();
      GPUI.mountBasemapToggle('basemapToggle', { value: st.bm, store: 'gp:basemap', fallback: 'night', onChange: applyBasemap });
    }
    $('viewBtn').textContent = viewMode === '2d' ? '🌍 3D globe' : '🗺 2D map';
    $('viewBtn').onclick = () => setViewMode(viewMode === '2d' ? '3d' : '2d');
    const r = url.get('region'); if (r) { $('region').value = r; REGION = $('region').value; }
    $('region').addEventListener('change', saveUrl);
    renderKw();
  }

  return {
    async boot(origInit) {
      _init3d = origInit;
      if (window.GPUI) GPUI.persistBasemap('gp:basemap', st.bm);
      const want2d = st.view === '2d' || (st.view !== '3d' && isMobile) || !webglOK();
      viewMode = want2d ? '2d' : '3d';
      if (want2d) {
        if (window.GPUI) await GPUI.loadLeaflet();
        if (window.L) { init2d(); setViewMode('2d'); }
      } else {
        if (window.GPUI) await GPUI.loadGlobeLib();
        origInit(); enhanceGlobe();
        const g = $('globe'), m = $('map2d'); if (m) m.hidden = true; if (g) g.hidden = false;
      }
      ui();
      loadIntelIndex();
      loadIntelForLayers();
      loadExtra();
      setTimeout(() => { if (window.GPUI) GPUI.loadTopo().then(loadCountries); else loadCountries(); }, 0);
      setInterval(loadExtra, 15 * 60000);
    },
    render, checkKw, flyTo, setViewMode, updateLayerCounts, applyBasemap,
    basemap: () => st.bm,
    showHover(d, x, y) { hover.point = d || null; if (x != null) hover.x = x; if (y != null) hover.y = y; placeTip(); },
  };
})();
window.W2 = W2;
// Hook into app.js
const _origInit = initGlobe;
initGlobe = () => W2.boot(_origInit);
updateGlobe = () => W2.render();
const _origRenderNews = renderNews;
renderNews = () => { _origRenderNews(); W2.checkKw(); };
