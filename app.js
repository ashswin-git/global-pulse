// Global Pulse — Phase 1. All data sources are keyless unless noted.
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- Exchanges: real trading hours (local time, Mon–Fri; holidays & lunch breaks not modelled) ----
// demo = static illustrative level, proxy = ETF symbol used when a Finnhub key is configured
const EXCHANGES = [
  { ex: 'NYSE / NASDAQ', idx: 'S&P 500', tz: 'America/New_York', o: '09:30', c: '16:00', lat: 40.71, lng: -74.01, demo: 5800, proxy: 'SPY' },
  { ex: 'NASDAQ', idx: 'Nasdaq 100', tz: 'America/New_York', o: '09:30', c: '16:00', lat: 40.76, lng: -73.98, demo: 20500, proxy: 'QQQ' },
  { ex: 'TSX', idx: 'S&P/TSX', tz: 'America/Toronto', o: '09:30', c: '16:00', lat: 43.65, lng: -79.38, demo: 24500, proxy: 'EWC' },
  { ex: 'B3', idx: 'Ibovespa', tz: 'America/Sao_Paulo', o: '10:00', c: '17:00', lat: -23.55, lng: -46.63, demo: 130000, proxy: 'EWZ' },
  { ex: 'LSE', idx: 'FTSE 100', tz: 'Europe/London', o: '08:00', c: '16:30', lat: 51.51, lng: -0.09, demo: 8200, proxy: 'EWU' },
  { ex: 'Xetra', idx: 'DAX', tz: 'Europe/Berlin', o: '09:00', c: '17:30', lat: 50.11, lng: 8.68, demo: 19200, proxy: 'EWG' },
  { ex: 'Euronext', idx: 'CAC 40', tz: 'Europe/Paris', o: '09:00', c: '17:30', lat: 48.87, lng: 2.34, demo: 7500, proxy: 'EWQ' },
  { ex: 'NSE / BSE', idx: 'Nifty 50', tz: 'Asia/Kolkata', o: '09:15', c: '15:30', lat: 19.07, lng: 72.88, demo: 24500, proxy: 'INDA' },
  { ex: 'SSE', idx: 'Shanghai Comp.', tz: 'Asia/Shanghai', o: '09:30', c: '15:00', lat: 31.23, lng: 121.47, demo: 3300, proxy: 'MCHI' },
  { ex: 'HKEX', idx: 'Hang Seng', tz: 'Asia/Hong_Kong', o: '09:30', c: '16:00', lat: 22.28, lng: 114.16, demo: 20000, proxy: 'EWH' },
  { ex: 'TSE', idx: 'Nikkei 225', tz: 'Asia/Tokyo', o: '09:00', c: '15:30', lat: 35.68, lng: 139.77, demo: 38500, proxy: 'EWJ' },
  { ex: 'ASX', idx: 'ASX 200', tz: 'Australia/Sydney', o: '10:00', c: '16:00', lat: -33.87, lng: 151.21, demo: 8200, proxy: 'EWA' },
];
function isOpen(e, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: e.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const m = +p.hour * 60 + +p.minute, t = s => +s.slice(0, 2) * 60 + +s.slice(3);
  return m >= t(e.o) && m < t(e.c);
}

// ---- Conflict hotspots: static reference list (NOT live) ----
const HOTSPOTS = [
  { name: 'Ukraine – Russia war', lat: 48.5, lng: 35.0 }, { name: 'Gaza / Israel', lat: 31.4, lng: 34.4 },
  { name: 'Sudan civil war', lat: 15.5, lng: 32.5 }, { name: 'Myanmar conflict', lat: 21.0, lng: 96.0 },
  { name: 'DR Congo (east)', lat: -1.7, lng: 29.2 }, { name: 'Sahel insurgency', lat: 14.0, lng: 1.0 },
  { name: 'Yemen / Red Sea', lat: 15.4, lng: 44.2 }, { name: 'Haiti gang crisis', lat: 18.5, lng: -72.3 },
];

const spark = (arr, up) => {
  if (!arr || arr.length < 2) return '';
  const min = Math.min(...arr), max = Math.max(...arr), w = 100, h = 30;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${up ? '#22c55e' : '#f43f5e'}" stroke-width="1.5" points="${pts}"/></svg>`;
};
// deterministic pseudo-random walk for DEMO sparklines only
const demoWalk = (seed, base) => { let v = base, s = seed; return Array.from({ length: 24 }, () => { s = (s * 9301 + 49297) % 233280; v *= 1 + (s / 233280 - 0.5) * 0.01; return v; }); };

// ---- Stocks ----
async function loadStocks() {
  const key = (window.GP_CONFIG || {}).FINNHUB_KEY;
  let live = {};
  if (key) {
    await Promise.all(EXCHANGES.map(async e => {
      try { const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${e.proxy}&token=${encodeURIComponent(key)}`); const j = await r.json(); if (j && j.c) live[e.proxy] = j; } catch {}
    }));
  }
  const isLive = Object.keys(live).length > 0;
  $('stockTag').textContent = isLive ? 'LIVE · ETF proxies via Finnhub' : 'DEMO PRICES · status is real';
  $('stockTag').className = 'tag' + (isLive ? ' live' : '');
  $('stocks').innerHTML = EXCHANGES.map((e, i) => {
    const open = isOpen(e), q = live[e.proxy];
    let price, chg, series;
    if (q) { price = q.c; chg = q.dp; series = [q.pc, q.o, q.l, q.h, q.c]; }
    else { series = demoWalk(i + 7, e.demo); price = series.at(-1); chg = (price / series[0] - 1) * 100; }
    return `<div class="tile"><div class="n">${q ? e.proxy + ' (' + esc(e.idx) + ')' : esc(e.idx)} · ${esc(e.ex)}</div>
      <div class="p">${fmt(price)}</div><div class="${chg >= 0 ? 'up' : 'dn'}">${chg >= 0 ? '▲' : '▼'} ${fmt(chg)}%${q ? '' : ' <small>(demo)</small>'}</div>
      ${spark(series, chg >= 0)}<div class="st ${open ? 'open' : 'closed'}">${open ? '● OPEN' : '○ CLOSED'} · ${e.o}–${e.c} local</div></div>`;
  }).join('');
}

// ---- Crypto (CoinGecko, keyless) ----
async function loadCrypto() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1&sparkline=true&price_change_percentage=24h');
    if (!r.ok) throw new Error(r.status);
    const coins = await r.json();
    $('crypto').innerHTML = coins.map(c => {
      const ch = c.price_change_percentage_24h || 0, sp = (c.sparkline_in_7d?.price || []).filter((_, i) => i % 4 === 0);
      return `<div class="tile"><div class="n"><img src="${esc(c.image)}" width="14" alt=""> ${esc(c.symbol.toUpperCase())} · ${esc(c.name)}</div>
        <div class="p">$${fmt(c.current_price, c.current_price < 1 ? 4 : 2)}</div><div class="${ch >= 0 ? 'up' : 'dn'}">${ch >= 0 ? '▲' : '▼'} ${fmt(ch)}% 24h</div>${spark(sp, ch >= 0)}</div>`;
    }).join('');
    $('ticker').innerHTML = [...coins, ...coins].map(c => { const ch = c.price_change_percentage_24h || 0; return `<span>${esc(c.symbol.toUpperCase())} $${fmt(c.current_price, c.current_price < 1 ? 4 : 2)} <b class="${ch >= 0 ? 'up' : 'dn'}">${ch >= 0 ? '▲' : '▼'}${fmt(ch)}%</b></span>`; }).join('');
    $('cryptoTag').textContent = 'LIVE · ' + new Date().toLocaleTimeString(); $('cryptoTag').className = 'tag live';
  } catch (e) {
    $('cryptoTag').textContent = 'UNAVAILABLE (rate limit?)'; $('cryptoTag').className = 'tag';
    if (!$('crypto').innerHTML) $('crypto').innerHTML = '<p>CoinGecko did not respond. Retrying in 60s.</p>';
  }
}

// ---- Conflict news (GDELT DOC 2.0, keyless) ----
async function loadNews() {
  const q = encodeURIComponent('(war OR conflict OR airstrike OR ceasefire OR military) sourcelang:english');
  try {
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=25&sort=datedesc&timespan=1d`);
    const arts = (await r.json()).articles || [];
    if (!arts.length) throw new Error('empty');
    $('news').innerHTML = arts.map(a => `<a class="item" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}<small>${esc(a.domain)} · ${esc(a.sourcecountry || '')}</small></a>`).join('');
    $('newsTag').textContent = 'LIVE · GDELT'; $('newsTag').className = 'tag live';
  } catch {
    $('newsTag').textContent = 'GDELT busy · showing static hotspots';
    $('news').innerHTML = HOTSPOTS.map(h => `<div class="item">${esc(h.name)}<small>Static reference hotspot (not live news)</small></div>`).join('');
  }
}

// ---- Disasters (GDACS, keyless, has coordinates) ----
let disasterPts = [];
async function loadDisasters() {
  try {
    const r = await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=Orange;Red');
    const f = (await r.json()).features || [];
    const icon = { EQ: '🌋', TC: '🌀', FL: '🌊', VO: '🌋', WF: '🔥', DR: '☀️' };
    f.sort((a, b) => b.properties.fromdate.localeCompare(a.properties.fromdate));
    $('disasters').innerHTML = f.slice(0, 30).map(x => { const p = x.properties; return `<a class="item dis" href="${esc(p.url?.report)}" target="_blank" rel="noopener">${icon[p.eventtype] || '⚠️'} ${esc(p.name)} <b>${esc(p.alertlevel)}</b><small>${esc(p.country || '')} · since ${esc(p.fromdate.slice(0, 10))}</small></a>`; }).join('');
    disasterPts = f.slice(0, 40).filter(x => x.geometry?.type === 'Point').map(x => ({ lat: x.geometry.coordinates[1], lng: x.geometry.coordinates[0], label: x.properties.name, kind: 'dis' }));
    $('gdacsTag').textContent = 'LIVE · GDACS'; $('gdacsTag').className = 'tag live';
  } catch { $('gdacsTag').textContent = 'UNAVAILABLE'; }
  updateGlobe();
}

// ---- Globe ----
let globe;
function initGlobe() {
  const el = $('globe');
  if (!window.Globe) { el.innerHTML = '<p style="padding:20px">Globe library failed to load.</p>'; return; }
  globe = Globe()(el)
    .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
    .bumpImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png')
    .backgroundColor('rgba(0,0,0,0)').atmosphereColor('#22d3ee').atmosphereAltitude(0.2)
    .width(el.clientWidth).height(el.clientHeight)
    .ringColor(d => t => d.color.replace('1)', `${1 - t})`)).ringMaxRadius(d => d.r).ringPropagationSpeed(2).ringRepeatPeriod(d => d.period)
    .pointAltitude(0.01).pointRadius(0.35).pointColor(d => d.solid).pointLabel(d => `<b>${esc(d.label)}</b>`);
  globe.controls().autoRotate = true; globe.controls().autoRotateSpeed = 0.6;
  globe.pointOfView({ lat: 20, lng: 60, altitude: 2.2 });
  addEventListener('resize', () => globe.width(el.clientWidth).height(el.clientHeight));
  updateGlobe();
}
function updateGlobe() {
  if (!globe) return;
  const C = { open: ['rgba(34,211,238,1)', '#22d3ee'], closed: ['rgba(100,116,139,1)', '#64748b'], war: ['rgba(244,63,94,1)', '#f43f5e'], dis: ['rgba(245,158,11,1)', '#f59e0b'] };
  const pts = [
    ...EXCHANGES.map(e => { const k = isOpen(e) ? 'open' : 'closed'; return { ...e, label: `${e.ex} — ${k.toUpperCase()}`, kind: k }; }),
    ...HOTSPOTS.map(h => ({ ...h, label: h.name + ' (reference)', kind: 'war' })),
    ...disasterPts,
  ].map(p => ({ ...p, color: C[p.kind][0], solid: C[p.kind][1], r: p.kind === 'war' ? 5 : p.kind === 'open' ? 4 : 2.5, period: p.kind === 'closed' ? 3000 : 1200 }));
  globe.pointsData(pts).ringsData(pts.filter(p => p.kind !== 'closed'));
}

// ---- Boot ----
setInterval(() => $('clock').textContent = new Date().toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (your time)', 1000);
initGlobe(); loadStocks(); loadCrypto(); loadDisasters();
setTimeout(loadNews, 800); // GDELT allows ~1 request / 5s
setInterval(loadCrypto, 60000); setInterval(() => { loadStocks(); updateGlobe(); }, 60000);
setInterval(loadNews, 5 * 60000); setInterval(loadDisasters, 10 * 60000);
