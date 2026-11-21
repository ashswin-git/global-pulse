// Global Pulse — Weather (standalone page). Own map instance and state.
// RainViewer radar, Open-Meteo forecast grid, NHC/JTWC/GDACS cyclones, USGS + EONET + GDACS nature layers.
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u, location.href); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : ''; } catch { return ''; } };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = innerWidth < 800;
const fetchT = (url, ms = 20000) => fetch(url, { signal: AbortSignal.timeout(ms) });

const GROUPS = [
  ['Atmosphere', { wind: 'Animated wind', radar: 'Precipitation radar', clouds: 'Clouds', temp: 'Temperature' }],
  ['Cyclones', { tc: 'Tropical cyclones (all basins)' }],
  ['Nature', { quakes: 'Earthquakes M4.5+', volcanoes: 'Volcanoes', wildfires: 'Wildfires', floods: 'Floods', dis: 'GDACS disasters', eonet: 'NASA EONET' }],
];
const LAYERS = Object.assign({}, ...GROUPS.map(([, o]) => o));
const DOT = { wind: '#7dd3fc', radar: '#38bdf8', clouds: '#e2e8f0', temp: '#fb923c', tc: '#f43f5e', quakes: '#a78bfa', volcanoes: '#fb7185', wildfires: '#f97316', floods: '#38bdf8', dis: '#f59e0b', eonet: '#34d399' };
const BASINS = ['Atlantic', 'E Pacific', 'C Pacific', 'W Pacific', 'North Indian (Arabian Sea)', 'North Indian (Bay of Bengal)', 'South Indian', 'Australia', 'South Pacific'];

const url = new URLSearchParams(location.search);
const st = {
  layers: new Set((url.get('layers') || 'wind,radar,tc,quakes,dis').split(',').filter(k => LAYERS[k])),
  hour: Math.max(0, Math.min(56, +url.get('h') || 0)),
  view: url.get('view') === '3d' ? '3d' : '2d',
  bm: (window.GPUI && GPUI.readPageBasemap()) || 'sat',
};
let map, markers, lines, radarLayer = null, cloudLayer = null, tempLayer = null, windLayer = null;
let globe = null, viewMode = st.view;
let rv = { host: 'https://tilecache.rainviewer.com', frames: [], i: 0, playing: false, timer: 0 };
let grid = [];          // {lat,lng, temps[], rains[], clouds[], ws[], wd[]}
let times = [];         // ISO hourly stamps aligned with grid arrays
let cyclones = [];
let nature = { quakes: [], volcanoes: [], wildfires: [], floods: [], dis: [], eonet: [] };
let counts = {};
let hover = { d: null, x: 0, y: 0, raf: 0 };

function saveUrl() {
  const q = new URLSearchParams();
  q.set('layers', [...st.layers].join(','));
  if (st.hour) q.set('h', String(st.hour));
  if (viewMode === '3d') q.set('view', '3d');
  if (st.bm) q.set('bm', st.bm);
  if (map && viewMode === '2d') {
    const c = map.getCenter();
    q.set('z', String(map.getZoom()));
    q.set('c', c.lat.toFixed(3) + ',' + c.lng.toFixed(3));
  }
  history.replaceState(null, '', '?' + q.toString().replace(/%2C/g, ','));
}

// ---- Layer panel ----
function renderPanel() {
  const box = $('layers');
  box.innerHTML = GROUPS.map(([title, group]) => `<div class="layer-group"><b>${esc(title)}</b>${
    Object.entries(group).map(([k, n]) => `<label class="layer-row"><input type="checkbox" data-l="${k}" ${st.layers.has(k) ? 'checked' : ''}> <i class="dot" style="background:${DOT[k]}"></i><span>${esc(n)}</span><span class="count" data-c="${k}">${counts[k] != null ? counts[k] : ''}</span></label>`).join('')
  }</div>`).join('');
  box.onchange = e => {
    const k = e.target.dataset.l; if (!k) return;
    e.target.checked ? st.layers.add(k) : st.layers.delete(k);
    applyLayers(); saveUrl();
  };
  renderBasins();
}
function setCount(k, n) {
  counts[k] = n;
  const el = document.querySelector(`[data-c="${k}"]`);
  if (el) el.textContent = n;
}

function renderBasins() {
  const by = Object.fromEntries(BASINS.map(b => [b, []]));
  for (const s of cyclones) {
    const b = s.basin || 'South Pacific';
    (by[b] || (by[b] = [])).push(s);
  }
  $('basinList').innerHTML = '<b>Basins</b><br>' + BASINS.map(b => {
    const list = by[b] || [];
    return list.length
      ? `${esc(b)}: ${list.map(s => esc((s.name || '').replace(/^Tropical Cyclone\s+/i, ''))).join(', ')}`
      : `${esc(b)}: <span class="mut">quiet</span>`;
  }).join('<br>');
}

// ---- Map ----
function initMap() {
  const el = $('wxmap');
  const z = Math.max(1, Math.min(19, +url.get('z') || (isMobile ? 2 : 3)));
  let center = [8, 10];
  if (url.get('c')) { const [a, b] = url.get('c').split(',').map(Number); if (isFinite(a) && isFinite(b)) center = [a, b]; }
  map = L.map(el, { worldCopyJump: true, zoomControl: true, minZoom: 1, maxZoom: 20, renderer: L.canvas({ padding: 0.5 }) }).setView(center, z);
  if (window.GPUI) { map._gpCreditExtra = 'Radar: RainViewer.'; GPUI.setLeafletBasemap(map, st.bm); }
  else L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 20, maxNativeZoom: 19,
  }).addTo(map);
  lines = L.layerGroup().addTo(map);
  markers = L.markerClusterGroup({ maxClusterRadius: 48, disableClusteringAtZoom: 11, spiderfyOnMaxZoom: true, showCoverageOnHover: false }).addTo(map);
  map.on('moveend', saveUrl);
  map.on('mousemove', e => {
    const wrap = $('mapTip').parentElement.getBoundingClientRect();
    hover.x = e.originalEvent.clientX - wrap.left;
    hover.y = e.originalEvent.clientY - wrap.top;
    if (st.layers.has('temp') || st.layers.has('wind')) showGridTip(e.latlng);
  });
  map.getContainer().addEventListener('mouseleave', () => hideTip());
  defineWindOverlay();
  windLayer = new WindOverlay();
  map.addLayer(windLayer);
}

const CIRC = (color, r = 8) => L.divIcon({ className: '', html: `<span style="display:block;width:${r}px;height:${r}px;border-radius:50%;background:${color};border:1px solid #fff8;box-shadow:0 0 0 1px #0006"></span>`, iconSize: [r, r], iconAnchor: [r / 2, r / 2] });

// ---- Wind particle overlay ----

let WindOverlay;
function defineWindOverlay() {
  if (WindOverlay) return;
  WindOverlay = L.Layer.extend({
  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'wind-canvas');
    map.getPanes().overlayPane.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
    L.DomUtil.addClass(this._canvas, 'leaflet-zoom-hide');
    this._particles = [];
    this._running = true;
    this._onMove = () => this._reset();
    map.on('move resize zoom', this._onMove);
    this._reset();
    if (!reduceMotion) this._raf = requestAnimationFrame(() => this._frame());
  },
  onRemove(map) {
    this._running = false;
    cancelAnimationFrame(this._raf);
    map.off('move resize zoom', this._onMove);
    this._canvas?.remove();
  },
  redraw() { if (this._running && !this._raf && !reduceMotion) this._raf = requestAnimationFrame(() => this._frame()); },
  _reset() {
    const map = this._map, canvas = this._canvas; if (!map || !canvas) return;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const sz = map.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(sz.x * dpr);
    canvas.height = Math.round(sz.y * dpr);
    canvas.style.width = sz.x + 'px';
    canvas.style.height = sz.y + 'px';
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = reduceMotion || isMobile ? 500 : 2200;
    if (this._particles.length !== n) this._particles = Array.from({ length: n }, () => this._spawn());
  },
  _spawn(p) {
    p = p || {};
    const sz = this._map.getSize();
    p.x = Math.random() * sz.x; p.y = Math.random() * sz.y;
    p.age = Math.random() * 80; p.life = 60 + Math.random() * 80;
    return p;
  },
  _sample(ll) {
    if (!grid.length || !st.layers.has('wind')) return null;
    const i = hourIndex();
    let best = null, bd = 1e9;
    for (const g of grid) {
      const d = (g.lat - ll.lat) ** 2 + ((g.lng - ll.lng) * Math.cos(ll.lat * Math.PI / 180)) ** 2;
      if (d < bd) { bd = d; best = g; }
    }
    if (!best || !best.ws) return null;
    const ws = best.ws[i], wd = best.wd[i];
    if (ws == null || wd == null) return null;
    const th = (wd + 180) * Math.PI / 180;
    return { u: Math.sin(th) * ws, v: -Math.cos(th) * ws, ws, wd };
  },
  _frame() {
    this._raf = 0;
    const map = this._map, ctx = this._ctx, canvas = this._canvas;
    if (!this._running || !ctx || !map) return;
    const size = map.getSize();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, size.x, size.y);
    ctx.restore();
    if (!st.layers.has('wind') || reduceMotion) { canvas.style.opacity = '0'; return; }
    canvas.style.opacity = '1';
    ctx.strokeStyle = 'rgba(186,230,253,0.55)';
    ctx.lineWidth = 1;
    for (const p of this._particles) {
      const ll = map.containerPointToLatLng([p.x, p.y]);
      const s = this._sample(ll);
      if (!s) { this._spawn(p); continue; }
      const k = 0.35 * Math.pow(2, Math.max(0, map.getZoom() - 2) * 0.15);
      const x2 = p.x + s.u * k, y2 = p.y + s.v * k;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x2, y2); ctx.stroke();
      p.x = x2; p.y = y2; p.age++;
      if (p.age > p.life || p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y) this._spawn(p);
    }
    if (this._running) this._raf = requestAnimationFrame(() => this._frame());
  },
});
}



// ---- RainViewer ----
async function loadRadar() {
  try {
    const j = await (await fetchT('https://api.rainviewer.com/public/weather-maps.json')).json();
    rv.host = j.host || rv.host;
    const past = j.radar?.past || [], nowcast = j.radar?.nowcast || [];
    rv.frames = [...past, ...nowcast].map(f => ({ time: f.time, path: f.path, nowcast: nowcast.includes(f) }));
    rv.ir = (j.satellite?.infrared || []).map(f => ({ time: f.time, path: f.path }));
    rv.i = Math.max(0, past.length - 1);
    setCount('radar', rv.frames.length ? `${past.length} past` + (nowcast.length ? ` + ${nowcast.length} nowcast` : '') : '0');
    $('radarClock').textContent = rv.frames.length ? frameLabel(rv.frames[rv.i]) : 'Radar unavailable';
    applyLayers();
  } catch (e) {
    $('radarClock').textContent = 'Radar unavailable';
    setCount('radar', 'offline');
  }
}
function frameLabel(f) {
  if (!f) return '';
  const d = new Date(f.time * 1000);
  return (f.nowcast ? 'Nowcast ' : '') + d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function radarUrl(f) {
  return `${rv.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
}
function irUrl(f) {
  return `${rv.host}${f.path}/256/{z}/{x}/{y}/0/0_0.png`;
}
function showRadarFrame() {
  if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
  if (!st.layers.has('radar') || !rv.frames.length) return;
  const f = rv.frames[rv.i];
  radarLayer = L.tileLayer(radarUrl(f), { opacity: 0.7, maxZoom: 20, maxNativeZoom: 7, attribution: '<a href="https://www.rainviewer.com/api.html">RainViewer</a>' }).addTo(map);
  $('radarClock').textContent = frameLabel(f);
}
function showClouds() {
  if (cloudLayer) { map.removeLayer(cloudLayer); cloudLayer = null; }
  if (!st.layers.has('clouds')) return;
  if (rv.ir && rv.ir.length) {
    const f = rv.ir[rv.ir.length - 1];
    cloudLayer = L.tileLayer(irUrl(f), { opacity: 0.45, maxZoom: 20, maxNativeZoom: 7, attribution: 'RainViewer IR' }).addTo(map);
    setCount('clouds', 'IR satellite');
    return;
  }
  // Open-Meteo cloud cover as translucent discs
  const i = hourIndex();
  const group = L.layerGroup();
  for (const g of grid) {
    const c = g.clouds?.[i];
    if (c == null || c < 15) continue;
    L.circle([g.lat, g.lng], { radius: 180000, color: '#fff', weight: 0, fillColor: '#f8fafc', fillOpacity: Math.min(0.35, c / 280) }).addTo(group);
  }
  cloudLayer = group.addTo(map);
  setCount('clouds', grid.length ? 'Open-Meteo cover' : '…');
}

function tempColor(t) {
  if (t == null) return '#64748b';
  const stops = [[-30, '#312e81'], [-10, '#1d4ed8'], [0, '#22d3ee'], [12, '#4ade80'], [22, '#facc15'], [32, '#f97316'], [42, '#ef4444']];
  let a = stops[0], b = stops.at(-1);
  for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  if (t <= stops[0][0]) return stops[0][1];
  if (t >= stops.at(-1)[0]) return stops.at(-1)[1];
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  const hex = s => parseInt(s.slice(1), 16);
  const ca = hex(a[1]), cb = hex(b[1]);
  const mix = (s, t, u) => Math.round(((s >> t) & 255) * (1 - u) + ((cb >> t) & 255) * u);
  // fix mix using ca
  const ch = (off) => Math.round(((ca >> off) & 255) * (1 - u) + ((cb >> off) & 255) * u);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function showTemp() {
  if (tempLayer) { map.removeLayer(tempLayer); tempLayer = null; }
  if (!st.layers.has('temp') || !grid.length) return;
  const i = hourIndex();
  const group = L.layerGroup();
  for (const g of grid) {
    const t = g.temps?.[i];
    if (t == null) continue;
    const c = tempColor(t);
    const mk = L.circleMarker([g.lat, g.lng], { radius: 7, color: c, weight: 1, fillColor: c, fillOpacity: 0.75 });
    mk.bindTooltip(`${Math.round(t)}°C`, { sticky: true, className: 'map-tip', direction: 'top' });
    mk.on('click', () => setFocus({ kind: 'temp', label: `${Math.round(t)}°C`, lat: g.lat, lng: g.lng, t, rain: g.rains?.[i], cloud: g.clouds?.[i], ws: g.ws?.[i], wd: g.wd?.[i] }));
    mk.addTo(group);
  }
  tempLayer = group.addTo(map);
}

// ---- Open-Meteo grid ----
function hourIndex() { return Math.max(0, Math.min((times.length || 1) - 1, st.hour)); }

async function loadForecast() {
  $('wxStatus').textContent = 'Loading Open-Meteo forecast…';
  const lats = [], lngs = [];
  for (let lat = -60; lat <= 75; lat += 15) {
    for (let lng = -180; lng < 180; lng += 15) { lats.push(lat); lngs.push(lng); }
  }
  const batch = 80;
  const chunks = [];
  for (let i = 0; i < lats.length; i += batch) chunks.push([lats.slice(i, i + batch), lngs.slice(i, i + batch)]);
  grid = []; times = [];
  try {
    for (const [la, lo] of chunks) {
      const q = new URLSearchParams({
        latitude: la.join(','), longitude: lo.join(','),
        hourly: 'temperature_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m',
        forecast_days: '7', wind_speed_unit: 'ms', timezone: 'UTC',
      });
      const raw = await (await fetchT('https://api.open-meteo.com/v1/forecast?' + q, 40000)).json();
      const rows = Array.isArray(raw) ? raw : [raw];
      for (const row of rows) {
        const h = row.hourly || {};
        if (!times.length) times = h.time || [];
        grid.push({
          lat: row.latitude, lng: row.longitude,
          temps: h.temperature_2m || [], rains: h.precipitation || [],
          clouds: h.cloud_cover || [], ws: h.wind_speed_10m || [], wd: h.wind_direction_10m || [],
        });
      }
    }
    // Align slider: hour 0 = closest to now
    const now = Date.now();
    let start = 0, best = 1e15;
    times.forEach((t, i) => { const d = Math.abs(Date.parse(t + 'Z') - now); if (d < best) { best = d; start = i; } });
    // keep from "now" onward — remap arrays
    if (start > 0) {
      times = times.slice(start);
      for (const g of grid) for (const k of ['temps', 'rains', 'clouds', 'ws', 'wd']) g[k] = (g[k] || []).slice(start);
    }
    const max = Math.max(0, times.length - 1);
    $('fcSlider').max = String(max);
    st.hour = Math.min(st.hour, max);
    $('fcSlider').value = st.hour;
    updateFcLabel();
    setCount('temp', grid.length + ' pts');
    setCount('wind', grid.length + ' pts');
    $('wxStatus').textContent = `Open-Meteo 7-day forecast · ${grid.length}-point global grid · ${times.length} hourly steps.`;
    applyLayers();
  } catch (e) {
    $('wxStatus').textContent = 'Open-Meteo forecast failed to load. Radar and cyclones still work.';
    GPUI.toast('Forecast unavailable', 'Open-Meteo could not be reached. Other layers still work.');
  }
}
function updateFcLabel() {
  const t = times[hourIndex()];
  $('fcLabel').textContent = t ? new Date(t + 'Z').toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit' }) : 'Now';
}

function showGridTip(ll) {
  if (!grid.length) return;
  let best = null, bd = 1e9;
  for (const g of grid) {
    const d = (g.lat - ll.lat) ** 2 + ((g.lng - ll.lng) * Math.cos(ll.lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = g; }
  }
  if (!best || bd > 80) return hideTip();
  const i = hourIndex();
  const bits = [];
  if (st.layers.has('temp') && best.temps[i] != null) bits.push(`${Math.round(best.temps[i])}°C`);
  if (st.layers.has('wind') && best.ws[i] != null) bits.push(`${best.ws[i].toFixed(1)} m/s wind`);
  if (st.layers.has('clouds') && best.clouds[i] != null) bits.push(`${Math.round(best.clouds[i])}% cloud`);
  if (best.rains?.[i]) bits.push(`${best.rains[i]} mm rain`);
  if (!bits.length) return hideTip();
  showTip(`<b>${bits[0]}</b><span class="typ">Open-Meteo</span>${bits.slice(1).map(x => `<span>${esc(x)}</span>`).join('')}<span class="mut">${ll.lat.toFixed(1)}°, ${ll.lng.toFixed(1)}°</span>`);
}

// ---- Cyclones ----
async function loadCyclones() {
  try {
    const j = await (await fetchT('data/cyclones.json?' + Math.floor(Date.now() / 6e5))).json();
    cyclones = j.items || [];
  } catch { cyclones = []; }
  setCount('tc', cyclones.length);
  renderBasins();
  applyLayers();
}

function drawCyclones() {
  // drawn as part of applyLayers together with nature into lines + markers
}

function cycloneTip(s) {
  return `<b>${esc(s.name)}</b><span class="typ">${esc(s.basin || 'Tropical cyclone')}</span>
    <span>${s.kt ? s.kt + ' kt sustained' : ''}${s.gustKt ? ' · gusts ' + s.gustKt + ' kt' : ''}</span>
    <span>${esc(s.movement || '')}</span>
    <span class="mut">${esc(s.agency || s.source || '')} · click for track</span>`;
}

// ---- Nature layers ----
async function loadNature() {
  const eonetCats = { volcanoes: /volcano/i, wildfires: /wildfire|fire/i, floods: /flood/i };
  try {
    let j;
    try { j = await (await fetchT('data/quakes.json')).json(); } catch {}
    if (!j) j = await (await fetchT('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson')).json();
    nature.quakes = (j.features || []).map(f => ({
      kind: 'quakes', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      label: `M${f.properties.mag} ${f.properties.place || ''}`, mag: f.properties.mag, t: f.properties.time, url: f.properties.url,
    }));
  } catch { nature.quakes = []; }
  setCount('quakes', nature.quakes.length);

  try {
    let j;
    try { j = await (await fetchT('data/gdacs.json')).json(); } catch {}
    if (!j) j = await (await fetchT('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=Orange;Red')).json();
    const feats = j.features || [];
    nature.dis = feats.map(f => {
      const p = f.properties || {}, c = f.geometry?.coordinates || [];
      return { kind: 'dis', lat: c[1], lng: c[0], label: p.name || 'GDACS event', p, t: Date.parse(p.fromdate), url: p.url?.report, typ: p.eventtype };
    }).filter(d => isFinite(d.lat) && isFinite(d.lng));
    nature.volcanoes = nature.dis.filter(d => d.typ === 'VO');
    nature.wildfires = nature.dis.filter(d => d.typ === 'WF');
    nature.floods = nature.dis.filter(d => d.typ === 'FL');
  } catch { nature.dis = []; }
  setCount('dis', nature.dis.length);

  try {
    let ev;
    try { const file = await (await fetchT('data/eonet.json')).json(); ev = file.features ? null : file; if (file.features) nature._eonetFeats = file.features; } catch {}
    if (!nature._eonetFeats) {
      const r = await (await fetchT('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=200')).json();
      ev = r;
    }
    const events = ev?.events || [];
    const pts = (events.length ? events.map(e => {
      const g = (e.geometry || []).filter(g => g.type === 'Point').at(-1);
      return g && { kind: 'eonet', lat: g.coordinates[1], lng: g.coordinates[0], label: e.title, cat: e.categories?.[0]?.title, t: Date.parse(g.date), url: e.link || e.sources?.[0]?.url };
    }).filter(Boolean) : (nature._eonetFeats || []).map(f => ({ kind: 'eonet', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.properties.title, cat: f.properties.cat, t: Date.parse(f.properties.date), url: f.properties.url })));
    nature.eonet = pts;
    const more = (k, re) => pts.filter(p => re.test(p.cat || p.label || ''));
    if (!nature.volcanoes.length) nature.volcanoes = more('volcanoes', eonetCats.volcanoes);
    else nature.volcanoes = [...nature.volcanoes, ...more('volcanoes', eonetCats.volcanoes)];
    if (!nature.wildfires.length) nature.wildfires = more('wildfires', eonetCats.wildfires);
    else nature.wildfires = [...nature.wildfires, ...more('wildfires', eonetCats.wildfires)];
    if (!nature.floods.length) nature.floods = more('floods', eonetCats.floods);
    else nature.floods = [...nature.floods, ...more('floods', eonetCats.floods)];
  } catch { nature.eonet = nature.eonet || []; }
  setCount('eonet', nature.eonet.length);
  setCount('volcanoes', nature.volcanoes.length);
  setCount('wildfires', nature.wildfires.length);
  setCount('floods', nature.floods.length);
  applyLayers();
}

function markerFor(p) {
  const m = L.marker([p.lat, p.lng], { icon: CIRC(DOT[p.kind] || '#94a3b8', p.kind === 'tc' ? 14 : p.kind === 'quakes' ? Math.max(8, (p.mag || 5) * 1.6) : 9) });
  m.bindTooltip(p.kind === 'tc' ? cycloneTip(p) : `<b>${esc(p.label)}</b><span class="typ">${esc(LAYERS[p.kind] || p.kind)}</span>${p.t ? `<span class="mut">${new Date(p.t).toLocaleString()}</span>` : ''}<span class="mut">Click for details</span>`, { sticky: true, className: 'map-tip', direction: 'top', opacity: 1 });
  m.on('click', () => setFocus(p));
  return m;
}

function applyLayers() {
  if (!map) return;
  markers.clearLayers();
  lines.clearLayers();
  showRadarFrame();
  showClouds();
  showTemp();
  windLayer?.redraw();
  if (st.layers.has('tc')) {
    for (const s of cyclones) {
      if (s.cone?.length) {
        L.polygon(s.cone.map(p => Array.isArray(p) ? p : [p.lat, p.lng]), { color: '#fda4af', weight: 1, fillColor: '#f43f5e', fillOpacity: 0.15 }).bindTooltip(cycloneTip(s), { sticky: true, className: 'map-tip' }).on('click', () => setFocus({ ...s, kind: 'tc', label: s.name })).addTo(lines);
      }
      if (s.past?.length >= 2) L.polyline(s.past, { color: '#e2e8f0', weight: 2, dashArray: '4 4' }).addTo(lines);
      if (s.forecast?.length >= 2) L.polyline(s.forecast, { color: '#fb7185', weight: 3 }).addTo(lines);
      markers.addLayer(markerFor({ ...s, kind: 'tc', label: s.name }));
    }
  }
  for (const k of ['quakes', 'volcanoes', 'wildfires', 'floods', 'dis', 'eonet']) {
    if (!st.layers.has(k)) continue;
    // When both dis and a subtype are on, subtypes still show (ok to overlap slightly)
    for (const p of nature[k] || []) markers.addLayer(markerFor({ ...p, kind: k }));
  }
  if (viewMode === '3d') renderGlobe();
}

// ---- Details / hover ----
function showTip(html) {
  const el = $('mapTip');
  el.innerHTML = html; el.hidden = false;
  const wrap = el.parentElement.getBoundingClientRect();
  const tw = el.offsetWidth || 240, th = el.offsetHeight || 80;
  let x = hover.x + 14, y = hover.y + 14;
  if (x + tw > wrap.width - 8) x = hover.x - tw - 10;
  if (y + th > wrap.height - 8) y = hover.y - th - 10;
  el.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
}
function hideTip() { $('mapTip').hidden = true; }

function setFocus(d) {
  const panel = $('details');
  if (!d) { panel.hidden = true; return; }
  let body = '';
  if (d.kind === 'tc') {
    body = `<p>${esc(d.basin || '')}${d.kt ? ' · ' + d.kt + ' kt sustained' : ''}${d.gustKt ? ' · gusts ' + d.gustKt + ' kt' : ''}</p>
      ${d.movement ? `<p>Movement: ${esc(d.movement)}</p>` : ''}
      <p class="mut">${esc(d.agency || d.source || '')}. Official track and cone when the agency published them.</p>
      ${d.past?.length ? `<p>Past track: ${d.past.length} points</p>` : ''}
      ${d.forecast?.length ? `<p>Forecast track: ${d.forecast.length} points</p>` : ''}
      ${safeUrl(d.sourceUrl) ? `<p><a href="${esc(safeUrl(d.sourceUrl))}" target="_blank" rel="noopener">Official bulletin →</a></p>` : ''}`;
  } else if (d.kind === 'temp') {
    body = `<p>Sampled Open-Meteo forecast at this grid point.</p>
      <p>Temperature: <b>${Math.round(d.t)}°C</b></p>
      ${d.ws != null ? `<p>Wind: ${d.ws.toFixed(1)} m/s${d.wd != null ? ' from ' + Math.round(d.wd) + '°' : ''}</p>` : ''}
      ${d.cloud != null ? `<p>Cloud cover: ${Math.round(d.cloud)}%</p>` : ''}
      ${d.rain ? `<p>Precipitation: ${d.rain} mm</p>` : ''}
      <p class="mut">Open-Meteo, keyless. Values are interpolated on a coarse global grid.</p>`;
  } else if (d.kind === 'quakes') {
    body = `<p>Earthquake (USGS)${d.mag != null ? ' · M' + d.mag : ''}${d.t ? ' · ' + new Date(d.t).toLocaleString() : ''}</p>${safeUrl(d.url) ? `<p><a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">USGS event page →</a></p>` : ''}`;
  } else if (d.kind === 'dis' || d.kind === 'volcanoes' || d.kind === 'wildfires' || d.kind === 'floods') {
    const p = d.p || {};
    body = `<p>${esc(p.description || LAYERS[d.kind] || '')}</p>
      ${p.alertlevel ? `<p>Alert: <b>${esc(p.alertlevel)}</b> · ${esc(p.country || '')}</p>` : ''}
      ${d.cat ? `<p>${esc(d.cat)}</p>` : ''}
      ${p.fromdate ? `<p>Since ${esc(String(p.fromdate).slice(0, 10))}</p>` : ''}
      ${safeUrl(d.url) ? `<p><a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">Source →</a></p>` : ''}`;
  } else {
    body = `<p>${esc(d.cat || LAYERS[d.kind] || 'Event')}</p>${d.t ? `<p>${esc(new Date(d.t).toLocaleString())}</p>` : ''}${safeUrl(d.url) ? `<p><a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">Source →</a></p>` : ''}`;
  }
  panel.innerHTML = `<button class="close" type="button" aria-label="Close details">✕</button><h3>${esc(d.label || d.name || '')}</h3>${body}`;
  panel.querySelector('.close').onclick = () => setFocus(null);
  panel.hidden = false;
  if (d.lat != null && map && viewMode === '2d' && map.getZoom() < 5) map.panTo([d.lat, d.lng]);
}

// ---- 3D globe (optional) ----
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

function applyBasemap(mode) {
  if (mode) st.bm = mode;
  if (window.GPUI) GPUI.persistBasemap('gp:wx:basemap', st.bm);
  if (window.GPUI) {
    if (globe) {
      GPUI.applyGlobeBasemap(globe, st.bm);
      const lit = st.bm === 'night' || st.bm === 'dark';
      globe.polygonStrokeColor(() => lit ? 'rgba(34,211,238,0.5)' : 'rgba(148,163,184,0.2)');
      if (lit) loadWxCountries();
    }
    if (map) GPUI.setLeafletBasemap(map, st.bm);
  }
  const extra = st.layers.has('radar') ? 'Radar: RainViewer.' : '';
  if (window.GPUI) GPUI.setMapCredit(st.bm, extra);
  saveUrl();
}

let wxCountries = [];
async function loadWxCountries() {
  if (wxCountries.length || !window.GPUI) return;
  try {
    await GPUI.loadTopo();
    const topo = await (await fetchT('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')).json();
    wxCountries = topojson.feature(topo, topo.objects.countries).features;
  } catch { return; }
  if (globe) renderGlobe();
}

async function switchView(mode) {
  viewMode = mode;
  $('wxmap').hidden = mode !== '2d';
  $('globe').hidden = mode !== '3d';
  $('viewBtn').textContent = mode === '2d' ? '🌍 3D globe' : '🗺 2D map';
  if (mode === '2d') {
    if (window.GPUI) await GPUI.loadLeaflet();
    if (!map) initMap();
    map.invalidateSize(); applyLayers();
  } else {
    if (window.GPUI) await GPUI.loadGlobeLib();
    initGlobe(); renderGlobe();
  }
  saveUrl();
}
function initGlobe() {
  if (globe || !window.Globe || !webglOK()) return;
  const el = $('globe'); el.hidden = false;
  const H = () => el.clientHeight || 520, W = () => el.clientWidth || innerWidth - 80;
  globe = Globe()(el)
    .backgroundColor('rgba(0,0,0,0)').atmosphereColor('#38bdf8').atmosphereAltitude(0.16)
    .width(W()).height(H()).pointAltitude(0.01).pointRadius(0.55).pointColor(d => d.color)
    .pointLabel(() => null)
    .onPointClick(d => setFocus(d))
    .pathPoints(d => d.coords).pathPointLat(p => p[0]).pathPointLng(p => p[1]).pathColor(d => d.color).pathStroke(0.7)
    .pathLabel(() => null)
    .polygonCapColor(d => d.cap || 'rgba(244,63,94,0.2)').polygonSideColor(() => 'rgba(244,63,94,0.1)').polygonStrokeColor(() => 'rgba(253,164,175,0.6)')
    .polygonLabel(d => d.label);
  window.globe = globe;
  if (window.GPUI) {
    GPUI.tuneGlobe(globe);
    GPUI.applyGlobeBasemap(globe, st.bm);
  }
  if (st.bm === 'night' || st.bm === 'dark') loadWxCountries();
  const ctl = globe.controls(); ctl.autoRotate = !reduceMotion; ctl.autoRotateSpeed = 0.4; ctl.minDistance = 1.08; ctl.maxDistance = 1000;
  globe.pointOfView({ lat: -10, lng: -160, altitude: 2.2 });
  new ResizeObserver(() => globe.width(W()).height(H())).observe(el);
  globe.onZoom(() => {
    const p = globe.pointOfView();
    if (viewMode === '3d' && p.altitude < 0.28) {
      const z = Math.max(4, Math.min(12, Math.round(2 - Math.log2(Math.max(0.02, p.altitude) / 2.2))));
      switchView('2d').then(() => map && map.setView([p.lat, p.lng], z));
    }
  });
}
function renderGlobe() {
  if (!globe) return;
  const pts = [], paths = [], polys = [];
  if (st.layers.has('tc')) for (const s of cyclones) {
    pts.push({ ...s, kind: 'tc', label: s.name, color: '#f43f5e', tip: s.name + ' · ' + (s.basin || '') });
    if (s.past?.length) paths.push({ coords: s.past, color: '#e2e8f0', label: s.name + ' past track' });
    if (s.forecast?.length) paths.push({ coords: s.forecast, color: '#fb7185', label: s.name + ' forecast' });
    if (s.cone?.length) polys.push({ geometry: { type: 'Polygon', coordinates: [s.cone.map(p => [p[1], p[0]])] }, label: s.name, cap: 'rgba(244,63,94,0.22)' });
  }
  for (const k of ['quakes', 'volcanoes', 'wildfires', 'floods', 'dis', 'eonet']) {
    if (!st.layers.has(k)) continue;
    for (const p of nature[k] || []) pts.push({ ...p, color: DOT[k], label: p.label });
  }
  if ((st.bm === 'night' || st.bm === 'dark') && wxCountries.length) {
    for (const f of wxCountries) polys.push({ ...f, label: f.properties?.name, cap: 'rgba(0,0,0,0)' });
  }
  globe.pointsData(pts).pathsData(paths).polygonsData(polys);
}

// ---- Clock & boot ----
let UTC = false;
function tick() {
  const n = new Date();
  $('clock').textContent = UTC
    ? n.toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' UTC'
    : n.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
}

async function boot() {
  GPUI.boot();
  GPUI.wirePanel();
  GPUI.wireIntelTabs();
  GPUI.persistBasemap('gp:wx:basemap', st.bm);
  GPUI.mountBasemapToggle('basemapToggle', { value: st.bm, store: 'gp:wx:basemap', fallback: 'sat', onChange: applyBasemap });
  renderPanel();
  await GPUI.loadLeaflet();
  initMap();
  $('tzBtn').onclick = () => { UTC = !UTC; $('tzBtn').textContent = UTC ? 'Show local' : 'Show UTC'; tick(); };
  tick(); setInterval(tick, 1000);
  $('fcSlider').oninput = () => { st.hour = +$('fcSlider').value; updateFcLabel(); showTemp(); showClouds(); windLayer?.redraw(); saveUrl(); };
  $('radarPlay').onclick = () => {
    rv.playing = !rv.playing;
    $('radarPlay').textContent = rv.playing ? '⏸ Radar loop' : '▶ Radar loop';
    clearInterval(rv.timer);
    if (rv.playing && rv.frames.length) {
      rv.timer = setInterval(() => { rv.i = (rv.i + 1) % rv.frames.length; showRadarFrame(); }, reduceMotion ? 1200 : 450);
    }
  };
  $('viewBtn').onclick = () => switchView(viewMode === '2d' ? '3d' : '2d');
  if (viewMode === '3d') await switchView('3d');
  loadRadar(); loadForecast(); loadCyclones(); loadNature();
  setTimeout(() => {
    if (cyclones[0] && !url.get('c') && viewMode === '2d' && map) {
      const s = cyclones[0];
      const pts = [...(s.past || []), ...(s.forecast || []), [s.lat, s.lng]].filter(Boolean);
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 5 });
    }
  }, 800);
}

document.addEventListener('DOMContentLoaded', boot);
