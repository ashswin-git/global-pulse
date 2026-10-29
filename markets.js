// Global Pulse Markets — TradingView embeddable widgets (free, keyless). Charts/data © TradingView.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mobile = matchMedia('(max-width:800px)').matches;
const TV = 'https://s3.tradingview.com/external-embedding/embed-widget-';

// Curated suggestions (TradingView EXCHANGE:SYMBOL). Indian stocks use BSE: — NSE is not licensed for free widgets.
const SYMBOLS = [
  ['NASDAQ:AAPL', 'Apple', 'US'], ['NASDAQ:MSFT', 'Microsoft', 'US'], ['NASDAQ:NVDA', 'NVIDIA', 'US'], ['NASDAQ:GOOGL', 'Alphabet (Google)', 'US'],
  ['NASDAQ:AMZN', 'Amazon', 'US'], ['NASDAQ:META', 'Meta Platforms', 'US'], ['NASDAQ:TSLA', 'Tesla', 'US'], ['NASDAQ:NFLX', 'Netflix', 'US'],
  ['NASDAQ:AMD', 'AMD', 'US'], ['NYSE:JPM', 'JPMorgan Chase', 'US'], ['NYSE:V', 'Visa', 'US'], ['NYSE:WMT', 'Walmart', 'US'], ['NYSE:KO', 'Coca-Cola', 'US'],
  ['NYSE:BRK.B', 'Berkshire Hathaway', 'US'], ['NYSE:DIS', 'Disney', 'US'], ['NYSE:INFY', 'Infosys ADR', 'US'], ['NYSE:HDB', 'HDFC Bank ADR', 'US'],
  ['BSE:RELIANCE', 'Reliance Industries', 'India'], ['BSE:TCS', 'Tata Consultancy Services', 'India'], ['BSE:INFY', 'Infosys', 'India'],
  ['BSE:HDFCBANK', 'HDFC Bank', 'India'], ['BSE:ICICIBANK', 'ICICI Bank', 'India'], ['BSE:SBIN', 'State Bank of India', 'India'],
  ['BSE:BHARTIARTL', 'Bharti Airtel', 'India'], ['BSE:ITC', 'ITC', 'India'], ['BSE:LT', 'Larsen & Toubro', 'India'], ['BSE:WIPRO', 'Wipro', 'India'],
  ['BSE:TATAMOTORS', 'Tata Motors', 'India'], ['BSE:TATASTEEL', 'Tata Steel', 'India'], ['BSE:ADANIENT', 'Adani Enterprises', 'India'],
  ['BSE:HINDUNILVR', 'Hindustan Unilever', 'India'], ['BSE:MARUTI', 'Maruti Suzuki', 'India'], ['BSE:BAJFINANCE', 'Bajaj Finance', 'India'],
  ['BSE:ZOMATO', 'Zomato (Eternal)', 'India'], ['BSE:PAYTM', 'Paytm', 'India'], ['BSE:SENSEX', 'BSE Sensex', 'Index'],
  ['SP:SPX', 'S&P 500', 'Index'], ['NASDAQ:NDX', 'Nasdaq 100', 'Index'], ['DJ:DJI', 'Dow Jones', 'Index'], ['TVC:NI225', 'Nikkei 225', 'Index'],
  ['TVC:UKX', 'FTSE 100', 'Index'], ['XETR:DAX', 'DAX', 'Index'], ['TVC:HSI', 'Hang Seng', 'Index'], ['FOREXCOM:NSXUSD', 'Nasdaq (CFD)', 'Index'],
  ['XETR:SAP', 'SAP', 'Germany'], ['LSE:SHEL', 'Shell', 'UK'], ['TSE:7203', 'Toyota', 'Japan'], ['HKEX:700', 'Tencent', 'Hong Kong'],
  ['BINANCE:BTCUSDT', 'Bitcoin', 'Crypto'], ['BINANCE:ETHUSDT', 'Ethereum', 'Crypto'], ['BINANCE:SOLUSDT', 'Solana', 'Crypto'],
  ['BINANCE:XRPUSDT', 'XRP', 'Crypto'], ['BINANCE:DOGEUSDT', 'Dogecoin', 'Crypto'], ['FX_IDC:USDINR', 'US Dollar / Rupee', 'Forex'],
  ['TVC:GOLD', 'Gold', 'Commodity'], ['TVC:USOIL', 'Crude Oil (WTI)', 'Commodity'],
];
const QUICK = ['NASDAQ:AAPL', 'NASDAQ:NVDA', 'NASDAQ:TSLA', 'BSE:RELIANCE', 'BSE:TCS', 'BSE:SENSEX', 'SP:SPX', 'BINANCE:BTCUSDT', 'TVC:GOLD'];

const store = {
  get(k, def) { try { const v = JSON.parse(localStorage.getItem('gp:' + k)); return v ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('gp:' + k, JSON.stringify(v)); } catch {} },
};
const norm = s => { s = String(s || '').toUpperCase().trim().slice(0, 30); return s.startsWith('NSE:') ? 'BSE:' + s.slice(4) : s; };
const VALID = /^[A-Z0-9.:_!-]{1,30}$/i;

function widget(id, name, cfg) {
  const host = $(id); host.innerHTML = '';
  const c = document.createElement('div'); c.className = 'tradingview-widget-container'; c.style.height = '100%';
  const w = document.createElement('div'); w.className = 'tradingview-widget-container__widget'; w.style.height = '100%';
  const s = document.createElement('script'); s.src = TV + name + '.js'; s.async = true;
  s.textContent = JSON.stringify({ colorTheme: 'dark', isTransparent: true, locale: 'en', width: '100%', height: '100%', ...cfg });
  s.onerror = () => host.innerHTML = '<p class="note" style="padding:12px">TradingView widget failed to load (blocked by an ad-blocker or offline).</p>';
  c.append(w, s); host.append(c);
  setTimeout(() => { if (host.contains(c) && !c.querySelector('iframe')) host.insertAdjacentHTML('beforeend', '<p class="note" style="padding:12px">Widget still not loaded after 8s. An ad-blocker or network filter may be blocking TradingView (s3.tradingview.com).</p>'); }, 8000);
}

let SYM = norm(new URLSearchParams(location.search).get('s') || store.get('sym', '') || 'NASDAQ:AAPL'); if (!VALID.test(SYM)) SYM = 'NASDAQ:AAPL';
let RANGE = '12M', STYLE = '1', MKT = 'america';
const watch = () => { const l = store.get('watch', ['NASDAQ:AAPL', 'BSE:RELIANCE', 'BINANCE:BTCUSDT']); return Array.isArray(l) ? l.filter(x => typeof x === 'string' && VALID.test(x)).slice(0, 30) : []; };
const saveWatch = l => store.set('watch', l.slice(0, 30));

function loadChart() {
  widget('w-chart', 'advanced-chart', { symbol: SYM, theme: 'dark', backgroundColor: 'rgba(11,18,32,0.6)', range: RANGE, interval: RANGE === '1D' ? '5' : RANGE === '5D' ? '30' : 'D', style: STYLE, timezone: 'Asia/Kolkata', allow_symbol_change: true, hide_side_toolbar: mobile, withdateranges: true, autosize: true, studies: mobile ? [] : ['STD;Volume'] });
}
function loadSymbol(sym, push = true) {
  SYM = norm(sym); if (!VALID.test(SYM)) return; store.set('sym', SYM);
  if (push) history.replaceState(null, '', '?s=' + encodeURIComponent(SYM));
  document.title = SYM + ' — Global Pulse';
  widget('w-info', 'symbol-info', { symbol: SYM, height: mobile ? 220 : 180 });
  loadChart();
  widget('w-fund', 'financials', { symbol: SYM, displayMode: 'regular' });
  widget('w-prof', 'symbol-profile', { symbol: SYM });
  widget('w-ta', 'technical-analysis', { symbol: SYM, interval: '1D', showIntervalTabs: true, displayMode: 'single' });
  widget('w-news', 'timeline', { feedMode: 'symbol', symbol: SYM, displayMode: 'regular' });
  renderStar(); marketStatus();
}
function renderStar() { const on = watch().includes(SYM); $('starBtn').textContent = on ? '★ In watchlist' : '☆ Add to watchlist'; $('starBtn').setAttribute('aria-pressed', on); }
function renderWatch() {
  const list = watch();
  $('watch').innerHTML = (list.length ? '<span class="note">Open / remove:</span> ' : '') + list.map(s => `<span><button data-s="${esc(s)}">${esc(s)}</button><button class="rm" data-rm="${esc(s)}" aria-label="Remove ${esc(s)}">✕</button></span>`).join('') || '<span class="note">Empty — tap ☆ on any symbol.</span>';
  if (list.length) widget('w-watch', 'market-quotes', { symbolsGroups: [{ name: 'Watchlist', symbols: list.map(s => ({ name: s })) }], showSymbolLogo: true, height: Math.min(80 + list.length * 46, 460) });
  else $('w-watch').innerHTML = '';
}
$('starBtn').onclick = () => { let l = watch(); l = l.includes(SYM) ? l.filter(x => x !== SYM) : [...l, SYM]; saveWatch(l); renderStar(); renderWatch(); };
$('watch').onclick = e => { const s = e.target.dataset.s, rm = e.target.dataset.rm; if (s) { loadSymbol(s); scrollTo({ top: 0, behavior: 'smooth' }); } if (rm) { saveWatch(watch().filter(x => x !== rm)); renderWatch(); renderStar(); } };

// ---- Search with suggestions + keyboard nav ----
let sel = -1, hits = [];
function suggest() {
  const t = $('q').value.trim().toLowerCase();
  hits = t ? SYMBOLS.filter(([s, n]) => s.toLowerCase().includes(t) || n.toLowerCase().includes(t)).slice(0, 8) : [];
  if (t && VALID.test(t) && !hits.some(h => h[0].toLowerCase() === t)) { const n = norm(t); hits.push([n, n.includes(':') ? 'Open this TradingView symbol' : 'Open ticker (add BSE: for India)', 'Any']); }
  sel = -1; $('sugg').hidden = !hits.length;
  $('sugg').innerHTML = hits.map(([s, n, m], i) => `<li role="option" id="o${i}" data-s="${esc(s)}"><span><b>${esc(n)}</b> <small>${esc(s)}</small></span><small>${esc(m)}</small></li>`).join('');
}
function pick(s) { $('sugg').hidden = true; $('q').value = ''; $('q').blur(); loadSymbol(s); }
$('q').addEventListener('input', suggest);
$('q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; [...$('sugg').children].forEach((li, i) => li.setAttribute('aria-selected', i === sel)); $('sugg').children[sel]?.scrollIntoView({ block: 'nearest' }); $('q').setAttribute('aria-activedescendant', 'o' + sel); }
  if (e.key === 'Escape') $('sugg').hidden = true;
});
$('sugg').onclick = e => { const li = e.target.closest('li'); if (li) pick(li.dataset.s); };
$('searchForm').onsubmit = e => { e.preventDefault(); if (hits.length) pick(hits[sel >= 0 ? sel : 0][0]); };
document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); } });
document.addEventListener('click', e => { if (!e.target.closest('#searchForm')) $('sugg').hidden = true; });
$('quick').innerHTML = QUICK.map(s => `<button data-s="${s}">${esc(SYMBOLS.find(x => x[0] === s)?.[1] || s)}</button>`).join('');
$('quick').onclick = e => e.target.dataset.s && loadSymbol(e.target.dataset.s);

// ---- Timeframe / style / movers ----
document.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); RANGE = b.dataset.r; loadChart(); });
$('style').onchange = e => { STYLE = e.target.value; loadChart(); };
function loadMovers() {
  if (MKT === 'heat') widget('w-movers', 'stock-heatmap', { dataSource: 'SPX500', blockSize: 'market_cap_basic', blockColor: 'change', grouping: 'sector', hasTopBar: false, isZoomEnabled: true });
  else if (MKT === 'crypto') widget('w-movers', 'crypto-coins-heatmap', { dataSource: 'Crypto', blockSize: 'market_cap_calc', blockColor: 'change', hasTopBar: false, isZoomEnabled: true });
  else widget('w-movers', 'hotlists', { exchange: { america: 'US', india: 'BSE', uk: 'LSE', japan: 'TSE' }[MKT] || 'US', dateRange: '1D', showChart: true, showSymbolLogo: true });
}
document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); MKT = b.dataset.m; loadMovers(); });

// ---- Boot ----
widget('tape', 'ticker-tape', { symbols: ['SP:SPX', 'NASDAQ:NDX', 'BSE:SENSEX', 'TVC:NI225', 'TVC:UKX', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'TVC:GOLD', 'TVC:USOIL', 'FX_IDC:USDINR'].map(s => ({ proName: s })), displayMode: 'adaptive', showSymbolLogo: true, height: 46 });
widget('w-over', 'market-overview', { dateRange: '12M', showChart: true, showSymbolLogo: true, tabs: [
  { title: 'Indices', symbols: [{ s: 'SP:SPX' }, { s: 'NASDAQ:NDX' }, { s: 'DJ:DJI' }, { s: 'BSE:SENSEX' }, { s: 'TVC:NI225' }, { s: 'TVC:UKX' }, { s: 'XETR:DAX' }] },
  { title: 'Crypto', symbols: [{ s: 'BINANCE:BTCUSDT' }, { s: 'BINANCE:ETHUSDT' }, { s: 'BINANCE:SOLUSDT' }, { s: 'BINANCE:XRPUSDT' }] },
  { title: 'Commodities & FX', symbols: [{ s: 'TVC:GOLD' }, { s: 'TVC:SILVER' }, { s: 'TVC:USOIL' }, { s: 'FX_IDC:USDINR' }, { s: 'FX:EURUSD' }] }] });
loadSymbol(SYM, false); renderWatch(); loadMovers();

// ---- Market open/closed label (regular hours, Mon–Fri; holidays not counted) ----
const HOURS = { NASDAQ: ['America/New_York', 570, 960], NYSE: ['America/New_York', 570, 960], AMEX: ['America/New_York', 570, 960], SP: ['America/New_York', 570, 960], DJ: ['America/New_York', 570, 960],
  BSE: ['Asia/Kolkata', 555, 930], LSE: ['Europe/London', 480, 990], TVC: null, XETR: ['Europe/Berlin', 540, 1050], TSE: ['Asia/Tokyo', 540, 930], HKEX: ['Asia/Hong_Kong', 570, 960] };
function marketStatus() {
  const ex = SYM.split(':')[0], el = $('mktStatus');
  if (/BINANCE|COINBASE|BITSTAMP|KRAKEN|CRYPTO/.test(ex)) { el.textContent = '● 24/7 market'; el.className = 'mkt open'; return; }
  const h = HOURS[ex]; if (!h) { el.textContent = ''; return; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: h[0], weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const m = +p.hour * 60 + +p.minute, open = !['Sat', 'Sun'].includes(p.weekday) && m >= h[1] && m < h[2];
  el.textContent = (open ? '● Market open' : '○ Market closed') + ' (approx., holidays not counted)'; el.className = 'mkt ' + (open ? 'open' : 'closed');
}
setInterval(marketStatus, 60000);

// ---- Mobile tabs for detail sections ----
const DET = [['w-fund', 'Stats'], ['w-prof', 'Profile'], ['w-ta', 'Technicals'], ['w-news', 'News']];
function mobileTabs() {
  const bar = $('detTabs'); if (!mobile) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = DET.map(([id, t], i) => `<button role="tab" data-t="${id}" aria-selected="${i === 0}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('');
  const show = id => { DET.forEach(([d]) => $(d).closest('section').hidden = d !== id); bar.querySelectorAll('button').forEach(b => { const on = b.dataset.t === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); };
  bar.onclick = e => e.target.dataset.t && show(e.target.dataset.t); show('w-fund');
}
mobileTabs();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
