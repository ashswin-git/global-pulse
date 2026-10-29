// Global Pulse — Phase 2. Keyless sources; every section shows LIVE / CACHED / ERROR + last updated.
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isMobile = matchMedia('(max-width:800px)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchT(url, ms = 10000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r; }
  finally { clearTimeout(t); }
}
const cache = {
  get: k => { try { return JSON.parse(localStorage.getItem('gp:' + k)); } catch { return null; } },
  set: (k, data) => { try { localStorage.setItem('gp:' + k, JSON.stringify({ t: Date.now(), data })); } catch {} },
};
function tag(id, state, src, t, extra = '') {
  const el = $(id); const label = { live: 'LIVE', cached: 'CACHED', error: 'ERROR', demo: 'DEMO', ref: 'REFERENCE' }[state];
  el.className = 'tag ' + state;
  el.textContent = `${label}${src ? ' · ' + src : ''}${t ? ' · updated ' + hhmm(t) : ''}${extra ? ' · ' + extra : ''}`;
}

// ---- Regions ----
const regionOf = (lat, lng) => lng < -30 ? 'Americas' : lng < 60 && lat > 35 ? 'Europe' : lng < 60 ? 'Africa & Middle East' : 'Asia-Pacific';
let REGION = 'All', FOCUS = null;

// ---- Exchanges (local hours, Mon–Fri, lunch breaks, a few known 2026 holidays — approximate) ----
const XMAS = ['2026-12-25', '2026-01-01'];
const EXCHANGES = [
  { id: 'us', ex: 'NYSE / NASDAQ', idx: 'S&P 500 · Nasdaq 100', tz: 'America/New_York', o: '09:30', c: '16:00', lat: 40.71, lng: -74.01, demo: 5800, hol: ['2026-11-26', ...XMAS] },
  { id: 'ca', ex: 'TSX', idx: 'S&P/TSX', tz: 'America/Toronto', o: '09:30', c: '16:00', lat: 43.65, lng: -79.38, demo: 24500, hol: XMAS },
  { id: 'br', ex: 'B3', idx: 'Ibovespa', tz: 'America/Sao_Paulo', o: '10:00', c: '17:00', lat: -23.55, lng: -46.63, demo: 130000, hol: XMAS },
  { id: 'uk', ex: 'LSE', idx: 'FTSE 100', tz: 'Europe/London', o: '08:00', c: '16:30', lat: 51.51, lng: -0.09, demo: 8200, hol: [...XMAS, '2026-12-28'] },
  { id: 'de', ex: 'Xetra', idx: 'DAX', tz: 'Europe/Berlin', o: '09:00', c: '17:30', lat: 50.11, lng: 8.68, demo: 19200, hol: [...XMAS, '2026-12-24', '2026-12-31'] },
  { id: 'fr', ex: 'Euronext Paris', idx: 'CAC 40', tz: 'Europe/Paris', o: '09:00', c: '17:30', lat: 48.87, lng: 2.34, demo: 7500, hol: XMAS },
  { id: 'in', ex: 'NSE / BSE', idx: 'Nifty 50', tz: 'Asia/Kolkata', o: '09:15', c: '15:30', lat: 19.07, lng: 72.88, demo: 24500, hol: ['2026-12-25'] },
  { id: 'cn', ex: 'SSE', idx: 'Shanghai Comp.', tz: 'Asia/Shanghai', o: '09:30', c: '15:00', lunch: ['11:30', '13:00'], lat: 31.23, lng: 121.47, demo: 3300, hol: ['2026-01-01'] },
  { id: 'hk', ex: 'HKEX', idx: 'Hang Seng', tz: 'Asia/Hong_Kong', o: '09:30', c: '16:00', lunch: ['12:00', '13:00'], lat: 22.28, lng: 114.16, demo: 20000, hol: [...XMAS, '2026-12-26'] },
  { id: 'jp', ex: 'TSE', idx: 'Nikkei 225', tz: 'Asia/Tokyo', o: '09:00', c: '15:30', lunch: ['11:30', '12:30'], lat: 35.68, lng: 139.77, demo: 38500, hol: ['2026-01-01', '2026-12-31'] },
  { id: 'au', ex: 'ASX', idx: 'ASX 200', tz: 'Australia/Sydney', o: '10:00', c: '16:00', lat: -33.87, lng: 151.21, demo: 8200, hol: [...XMAS, '2026-12-28'] },
].map(e => ({ ...e, region: regionOf(e.lat, e.lng), kind: 'exchange' }));
function status(e, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: e.tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'closed';
  if (e.hol.includes(`${p.year}-${p.month}-${p.day}`)) return 'holiday';
  const m = +p.hour * 60 + +p.minute, t = s => +s.slice(0, 2) * 60 + +s.slice(3);
  if (m < t(e.o) || m >= t(e.c)) return 'closed';
  if (e.lunch && m >= t(e.lunch[0]) && m < t(e.lunch[1])) return 'lunch';
  return 'open';
}

// ---- Conflict hotspots: static reference fallback ----
const HOTSPOTS = [
  { name: 'Ukraine – Russia war', lat: 48.5, lng: 35.0, q: 'Ukraine' }, { name: 'Gaza / Israel', lat: 31.4, lng: 34.4, q: 'Gaza' },
  { name: 'Sudan civil war', lat: 15.5, lng: 32.5, q: 'Sudan' }, { name: 'Myanmar conflict', lat: 21.0, lng: 96.0, q: 'Myanmar' },
  { name: 'DR Congo (east)', lat: -1.7, lng: 29.2, q: 'Congo' }, { name: 'Sahel insurgency', lat: 14.0, lng: 1.0, q: 'Sahel' },
  { name: 'Yemen / Red Sea', lat: 15.4, lng: 44.2, q: 'Yemen' }, { name: 'Haiti gang crisis', lat: 18.5, lng: -72.3, q: 'Haiti' },
].map(h => ({ ...h, label: h.name, region: regionOf(h.lat, h.lng), kind: 'war', ref: true }));
let conflictPts = HOTSPOTS;

const spark = (arr, up) => {
  if (!arr || arr.length < 2) return '';
  const min = Math.min(...arr), max = Math.max(...arr), w = 100, h = 30;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${up ? '#22c55e' : '#f43f5e'}" stroke-width="1.5" points="${pts}"/></svg>`;
};
const demoWalk = (seed, base) => { let v = base, s = seed; return Array.from({ length: 24 }, () => { s = (s * 9301 + 49297) % 233280; v *= 1 + (s / 233280 - 0.5) * 0.01; return v; }); };

// ---- Stocks ----
const ST_LABEL = { open: '● OPEN', closed: '○ CLOSED', lunch: '◐ LUNCH BREAK', holiday: '✕ HOLIDAY' };
let lastStockSig = '', stockLive = {};
async function loadStocks(force) {
  const key = (window.GP_CONFIG || {}).FINNHUB_KEY;
  const proxy = { us: 'SPY', ca: 'EWC', br: 'EWZ', uk: 'EWU', de: 'EWG', fr: 'EWQ', in: 'INDA', cn: 'MCHI', hk: 'EWH', jp: 'EWJ', au: 'EWA' };
  if (key) await Promise.all(EXCHANGES.map(async e => {
    try { const j = await (await fetchT(`https://finnhub.io/api/v1/quote?symbol=${proxy[e.id]}&token=${encodeURIComponent(key)}`)).json(); if (j && j.c) stockLive[e.id] = { ...j, sym: proxy[e.id] }; } catch {}
  }));
  const live = Object.keys(stockLive).length > 0;
  const list = EXCHANGES.filter(e => REGION === 'All' || e.region === REGION);
  const sig = REGION + list.map(e => status(e)).join() + live;
  if (!force && !live && sig === lastStockSig) return;   // demo: only re-render when status changes
  lastStockSig = sig;
  live ? tag('stockTag', 'live', 'ETF proxies via Finnhub', Date.now()) : tag('stockTag', 'demo', 'prices', 0, 'status is real');
  $('stocks').innerHTML = list.map(e => {
    const s = status(e), q = stockLive[e.id];
    let price, chg, sp = '';
    if (q) { price = q.c; chg = q.dp; }   // no sparkline in live mode (quote fields aren't a time series)
    else { const series = demoWalk(e.id.charCodeAt(0) + e.id.charCodeAt(1), e.demo); price = series.at(-1); chg = (price / series[0] - 1) * 100; sp = spark(series, chg >= 0); }
    return `<div class="tile" id="card-${e.id}" tabindex="0"><div class="n">${q ? esc(q.sym) + ' · ' : ''}${esc(e.idx)} · ${esc(e.ex)}</div>
      <div class="p">${fmt(price)}</div><div class="${chg >= 0 ? 'up' : 'dn'}">${chg >= 0 ? '▲' : '▼'} ${fmt(chg)}%${q ? '' : ' <small>(demo)</small>'}</div>${sp}
      <div class="st ${s}" title="Approximate: computed from regular hours; only a few holidays are included.">${ST_LABEL[s]} · ${e.o}–${e.c} local (approx.)</div></div>`;
  }).join('') || '<p class="empty">No exchanges in this region.</p>';
}

// ---- Crypto: CoinGecko → CoinPaprika fallback → localStorage cache ----
let CUR = localStorage.getItem('gp:cur') || 'usd';
async function cryptoCoinGecko() {
  const r = await fetchT(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${CUR}&order=market_cap_desc&per_page=12&page=1&sparkline=true&price_change_percentage=24h`);
  return (await r.json()).map(c => ({ sym: c.symbol.toUpperCase(), name: c.name, img: c.image, price: c.current_price, ch: c.price_change_percentage_24h || 0, sp: (c.sparkline_in_7d?.price || []).filter((_, i) => i % 4 === 0) }));
}
async function cryptoPaprika() {
  const q = CUR.toUpperCase();
  const r = await fetchT(`https://api.coinpaprika.com/v1/tickers?limit=12&quotes=${q}`);
  return (await r.json()).map(c => ({ sym: c.symbol, name: c.name, img: '', price: c.quotes[q].price, ch: c.quotes[q].percent_change_24h || 0, sp: [] }));
}
function renderCrypto(coins) {
  const sym = CUR === 'inr' ? '₹' : '$', d = p => (p < 1 ? 4 : 2);
  $('crypto').innerHTML = coins.map(c => `<div class="tile"><div class="n">${c.img && safeUrl(c.img) ? `<img src="${esc(safeUrl(c.img))}" width="14" height="14" alt="">` : ''} ${esc(c.sym)} · ${esc(c.name)}</div>
    <div class="p">${sym}${fmt(c.price, d(c.price))}</div><div class="${c.ch >= 0 ? 'up' : 'dn'}">${c.ch >= 0 ? '▲' : '▼'} ${fmt(c.ch)}% 24h</div>${spark(c.sp, c.ch >= 0)}</div>`).join('');
  $('ticker').innerHTML = [...coins, ...coins].map(c => `<span>${esc(c.sym)} ${sym}${fmt(c.price, d(c.price))} <b class="${c.ch >= 0 ? 'up' : 'dn'}">${c.ch >= 0 ? '▲' : '▼'}${fmt(c.ch)}%</b></span>`).join('');
}
async function loadCrypto() {
  for (const [src, fn] of [['CoinGecko', cryptoCoinGecko], ['CoinPaprika', cryptoPaprika]]) {
    try { const coins = await fn(); if (!coins.length) throw 0; cache.set('crypto-' + CUR, { src, coins }); renderCrypto(coins); tag('cryptoTag', 'live', src, Date.now()); return; } catch {}
  }
  const c = cache.get('crypto-' + CUR);
  if (c) { renderCrypto(c.data.coins); tag('cryptoTag', 'cached', c.data.src, c.t, 'retrying'); }
  else { tag('cryptoTag', 'error', '', 0, 'retrying in 60s'); $('crypto').innerHTML = '<p class="empty">Crypto sources unreachable. <button onclick="loadCrypto()">Retry now</button></p>'; }
}

// ---- GDELT (shared queue: ≥6s between calls, backoff on 429) ----
let gdeltNext = 0;
async function gdelt(url, tagId) {
  for (let i = 0; i < 3; i++) {
    const wait = gdeltNext - Date.now(); if (wait > 0) await sleep(wait);
    gdeltNext = Date.now() + 6000;
    try { return await (await fetchT(url, 12000)).json(); }
    catch (e) { if (e.status === 429 && tagId) tag(tagId, 'error', 'GDELT', 0, 'rate limited, retrying'); gdeltNext = Date.now() + 6000 * 2 ** (i + 1); }
  }
  throw new Error('gdelt failed');
}
let newsArts = [];
async function loadNews() {
  const q = encodeURIComponent('(war OR conflict OR airstrike OR ceasefire OR military) sourcelang:english');
  try {
    const j = await gdelt(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=50&sort=datedesc&timespan=1d`, 'newsTag');
    newsArts = (j.articles || []).filter(a => safeUrl(a.url));
    if (!newsArts.length) throw 0;
    cache.set('news', newsArts); tag('newsTag', 'live', 'GDELT', Date.now());
  } catch {
    const c = cache.get('news');
    if (c) { newsArts = c.data; tag('newsTag', 'cached', 'GDELT', c.t, 'retrying'); }
    else { newsArts = []; tag('newsTag', 'error', 'GDELT', 0, 'showing reference hotspots'); }
  }
  renderNews();
}
function renderNews() {
  let arts = newsArts;
  if (FOCUS) { const words = (FOCUS.q || FOCUS.label || '').toLowerCase().split(/[\s/–-]+/).filter(w => w.length > 3); arts = arts.filter(a => words.some(w => a.title.toLowerCase().includes(w))); }
  $('newsFilter').innerHTML = FOCUS ? `Filtered: <b>${esc(FOCUS.label)}</b> <button onclick="setFocus(null)">Clear</button>` : '';
  if (arts.length) $('news').innerHTML = arts.slice(0, 30).map(a => `<a class="item" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.title)}<small>${esc(a.domain)} · ${esc(a.sourcecountry || '')}</small></a>`).join('');
  else if (!newsArts.length) $('news').innerHTML = HOTSPOTS.map(h => `<div class="item">${esc(h.name)}<small>Static reference hotspot (not live news)</small></div>`).join('');
  else $('news').innerHTML = '<p class="empty">No recent headlines match this marker.</p>';
}
async function loadConflictGeo() {
  try {
    const q = encodeURIComponent('(airstrike OR shelling OR clashes OR "armed conflict")');
    const j = await gdelt(`https://api.gdeltproject.org/api/v2/geo/geo?query=${q}&format=GeoJSON&timespan=1d&maxpoints=40`);
    const f = (j.features || []).filter(x => x.geometry?.type === 'Point');
    if (!f.length) throw 0;
    conflictPts = f.map(x => { const [lng, lat] = x.geometry.coordinates; const name = String(x.properties?.name || 'Conflict report'); return { lat, lng, label: name + ' (GDELT, 24h)', q: name.split(',')[0], region: regionOf(lat, lng), kind: 'war', count: x.properties?.count }; });
    $('legWar').textContent = 'Conflict (live GDELT)';
  } catch { conflictPts = HOTSPOTS; }
  updateGlobe();
}

// ---- Disasters (GDACS) ----
let disasterPts = [];
const ICON = { EQ: '🫨', TC: '🌀', FL: '🌊', VO: '🌋', WF: '🔥', DR: '☀️' };
function renderDisasters(f) {
  f = f.filter(x => REGION === 'All' || !x.geometry || regionOf(x.geometry.coordinates[1], x.geometry.coordinates[0]) === REGION);
  $('disasters').innerHTML = f.length ? f.slice(0, 30).map(x => {
    const p = x.properties, link = safeUrl(p.url?.report) || (p.eventid ? `https://www.gdacs.org/report.aspx?eventid=${encodeURIComponent(p.eventid)}&eventtype=${encodeURIComponent(p.eventtype)}` : '');
    const inner = `<span aria-hidden="true">${ICON[p.eventtype] || '⚠️'}</span> ${esc(p.name)} <b>${esc(p.alertlevel)}</b><small>${esc(p.country || '')} · since ${esc((p.fromdate || '').slice(0, 10))}</small>`;
    return link ? `<a class="item dis" href="${esc(link)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="item dis">${inner}</div>`;
  }).join('') : '<p class="empty">No Orange/Red disaster alerts right now.</p>';
}
let disasterRaw = [];
async function loadDisasters() {
  try {
    const j = await (await fetchT('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=Orange;Red')).json();
    disasterRaw = (j.features || []).sort((a, b) => (b.properties.fromdate || '').localeCompare(a.properties.fromdate || ''));
    cache.set('gdacs', disasterRaw); tag('gdacsTag', 'live', 'GDACS', Date.now());
  } catch {
    const c = cache.get('gdacs');
    if (c) { disasterRaw = c.data; tag('gdacsTag', 'cached', 'GDACS', c.t, 'retrying'); }
    else { disasterRaw = []; tag('gdacsTag', 'error', 'GDACS', 0, 'retrying in 10 min'); }
  }
  if (!disasterRaw.length && $('gdacsTag').classList.contains('error')) $('disasters').innerHTML = '<p class="empty">Could not reach GDACS. <button onclick="loadDisasters()">Retry now</button></p>';
  else renderDisasters(disasterRaw);
  disasterPts = disasterRaw.slice(0, 40).filter(x => x.geometry?.type === 'Point').map(x => ({ lat: x.geometry.coordinates[1], lng: x.geometry.coordinates[0], label: x.properties.name, q: x.properties.country, region: regionOf(x.geometry.coordinates[1], x.geometry.coordinates[0]), kind: 'dis', p: x.properties }));
  updateGlobe();
}

// ---- Globe ----
let globe, rotating = !reduceMotion;
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
function initGlobe() {
  const el = $('globe');
  if (!window.Globe || !webglOK()) {
    el.innerHTML = `<div class="fallback"><img src="https://cdn.jsdelivr.net/npm/three-globe@2.41.12/example/img/earth-night.jpg" alt="World map at night"><p>${!window.Globe ? 'The 3D globe library failed to load.' : 'Your browser has WebGL turned off, so the 3D globe cannot run.'} All data panels below still work.</p></div>`;
    $('rotateBtn').hidden = true; return;
  }
  const H = () => el.clientHeight || (isMobile ? 340 : 520), W = () => el.clientWidth || innerWidth - 60;
  globe = Globe()(el)
    .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.41.12/example/img/earth-night.jpg')
    .backgroundColor('rgba(0,0,0,0)').atmosphereColor('#22d3ee').atmosphereAltitude(0.2)
    .width(W()).height(H())
    .ringColor(d => t => d.color.replace('1)', `${1 - t})`)).ringMaxRadius(d => d.r).ringPropagationSpeed(2).ringRepeatPeriod(d => d.period)
    .pointAltitude(0.01).pointRadius(0.4).pointColor(d => d.solid).pointLabel(d => `<b>${esc(d.label)}</b>`)
    .onPointClick(d => setFocus(d));
  if (!isMobile) globe.bumpImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.41.12/example/img/earth-topology.png');
  const ctl = globe.controls(); ctl.autoRotate = rotating; ctl.autoRotateSpeed = 0.6;
  el.addEventListener('pointerenter', () => ctl.autoRotate = false);
  el.addEventListener('pointerleave', () => ctl.autoRotate = rotating);
  globe.pointOfView({ lat: 20, lng: 60, altitude: 2.2 });
  new ResizeObserver(() => globe.width(W()).height(H())).observe(el);
  updateGlobe();
}
function toggleRotate() {
  rotating = !rotating; if (globe) globe.controls().autoRotate = rotating;
  $('rotateBtn').textContent = rotating ? '⏸ Pause rotation' : '▶ Rotate'; $('rotateBtn').setAttribute('aria-pressed', String(!rotating));
}
function updateGlobe() {
  if (!globe) return;
  const C = { open: ['rgba(34,211,238,1)', '#22d3ee'], lunch: ['rgba(34,211,238,1)', '#67e8f9'], closed: ['rgba(100,116,139,1)', '#64748b'], holiday: ['rgba(100,116,139,1)', '#64748b'], war: ['rgba(244,63,94,1)', '#f43f5e'], dis: ['rgba(245,158,11,1)', '#f59e0b'] };
  const pts = [
    ...EXCHANGES.map(e => { const s = status(e); return { ...e, label: `${e.ex} — ${ST_LABEL[s].slice(2)}`, st: s }; }),
    ...conflictPts.map(h => ({ ...h, label: h.ref ? h.name + ' (reference)' : h.label })),
    ...disasterPts,
  ].filter(p => REGION === 'All' || p.region === REGION)
   .map(p => { const k = p.kind === 'exchange' ? p.st : p.kind; return { ...p, color: C[k][0], solid: C[k][1], r: p.kind === 'war' ? 5 : k === 'open' ? 4 : 2.5, period: k === 'open' || p.kind !== 'exchange' ? 1200 : 3000, ring: k !== 'closed' && k !== 'holiday' }; });
  let rings = reduceMotion ? [] : pts.filter(p => p.ring);
  if (isMobile) rings = rings.filter(p => p.kind === 'exchange').concat(rings.filter(p => p.kind !== 'exchange').slice(0, 8));
  globe.pointsData(pts).ringsData(rings);
}

// ---- Focus / details panel ----
function setFocus(d) {
  FOCUS = d;
  document.querySelectorAll('.tile.hl,.item.hl').forEach(x => x.classList.remove('hl'));
  const panel = $('details');
  if (!d) { panel.hidden = true; renderNews(); return; }
  let body = '';
  if (d.kind === 'exchange') { const s = status(d); body = `<p>${esc(d.idx)}</p><p>Status: <b>${ST_LABEL[s]}</b> (approx.)</p><p>Hours: ${d.o}–${d.c} ${esc(d.tz)}${d.lunch ? ` · lunch ${d.lunch[0]}–${d.lunch[1]}` : ''}</p>`; }
  else if (d.kind === 'dis') { const p = d.p || {}; body = `<p>${esc(p.description || '')}</p><p>Alert: <b>${esc(p.alertlevel)}</b> · ${esc(p.country || '')}</p><p>Since ${esc((p.fromdate || '').slice(0, 10))}</p>`; }
  else body = `<p>${d.ref ? 'Reference hotspot (static list, not live).' : 'Location mentioned in conflict reporting over the last 24h (GDELT).'}</p>${d.count ? `<p>Mentions: ${esc(d.count)}</p>` : ''}`;
  panel.innerHTML = `<button class="close" onclick="setFocus(null)" aria-label="Close details">✕</button><h3>${esc(d.label)}</h3>${body}<p class="mut">News below is filtered to this marker.</p>`;
  panel.hidden = false;
  const card = d.kind === 'exchange' ? $('card-' + d.id) : null;
  if (card) { card.classList.add('hl'); card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }
  renderNews();
  if (d.kind === 'dis') [...document.querySelectorAll('#disasters .item')].find(x => x.textContent.includes(d.label))?.classList.add('hl');
}

// ---- Controls ----
let UTC = false;
function tick() { const n = new Date(); $('clock').textContent = UTC ? n.toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' UTC' : n.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + (Intl.DateTimeFormat().resolvedOptions().timeZone); }
$('tzBtn').onclick = () => { UTC = !UTC; $('tzBtn').textContent = UTC ? 'Show local' : 'Show UTC'; tick(); };
$('rotateBtn').onclick = toggleRotate;
$('curBtn').onclick = () => { CUR = CUR === 'usd' ? 'inr' : 'usd'; localStorage.setItem('gp:cur', CUR); $('curBtn').textContent = CUR === 'usd' ? '₹ Show INR' : '$ Show USD'; loadCrypto(); };
$('curBtn').textContent = CUR === 'usd' ? '₹ Show INR' : '$ Show USD';
$('region').onchange = e => { REGION = e.target.value; loadStocks(true); renderDisasters(disasterRaw); updateGlobe(); };
if (reduceMotion) { rotating = false; $('rotateBtn').textContent = '▶ Rotate'; }

// ---- Boot ----
tick(); setInterval(tick, 1000);
initGlobe(); loadStocks(true); loadCrypto(); loadDisasters();
loadNews().then(loadConflictGeo);
setInterval(loadCrypto, 60000); setInterval(() => { loadStocks(); updateGlobe(); }, 60000);
setInterval(() => loadNews().then(loadConflictGeo), 10 * 60000); setInterval(loadDisasters, 10 * 60000);
