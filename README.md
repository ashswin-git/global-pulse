# 🌍 Global Pulse

**One animated screen for the whole world: stock exchanges, crypto, conflicts and disasters on a 3D globe.**

🔗 **Live:** https://ashswin-git.github.io/global-pulse/

![Global Pulse screenshot](docs/screenshot.png)

## ✨ Features
- **3D animated globe** (globe.gl / three.js): pulsing rings for open stock exchanges, conflict hotspots and live disaster alerts; auto-rotates, drag to explore.
- **Stock markets**: 12 major indices (S&P 500, Nasdaq, FTSE, DAX, Nifty 50, Nikkei, Hang Seng…). **Open/closed status computed live from real exchange hours** in each exchange's time zone.
- **Crypto**: top 12 coins by market cap, live prices, 24h change, 7-day sparklines and a scrolling ticker tape (refresh every 60s).
- **Conflict & war news**: latest English headlines from GDELT (last 24h).
- **Disasters & crises**: Orange/Red alerts (cyclones, earthquakes, floods, volcanoes, wildfires, droughts) from GDACS, also plotted on the globe.
- Dark glassmorphism UI, smooth entrance animations, fully responsive (mobile friendly).
- Zero build step, zero backend, zero required API keys.

## 📡 Data sources
| Section | Source | Status |
|---|---|---|
| Crypto | [CoinGecko](https://www.coingecko.com/en/api), fallback [CoinPaprika](https://api.coinpaprika.com) | ✅ Live, keyless, USD/INR, cached in localStorage |
| Disasters | [GDACS](https://www.gdacs.org) events API | ✅ Live, keyless |
| Conflict news | [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | ✅ Live, keyless (rate-limited to ~1 req / 5 s; falls back to a labelled static hotspot list) |
| Exchange open/closed | Computed in-browser from official trading hours | ✅ Real |
| Index prices | Built-in **DEMO** numbers (clearly labelled) | ⚠️ Demo unless you add a key |
| Conflict points on globe | GDELT GEO 2.0 (24h), fallback static reference list | ✅ Live when GDELT responds |

### Optional live stock prices
Get a free key at [finnhub.io](https://finnhub.io) and put it in `config.js`:
```js
window.GP_CONFIG = { FINNHUB_KEY: "your_key_here" };
```
With a key, tiles switch to **LIVE** quotes for country ETF proxies (SPY, QQQ, EWU, EWG, INDA, EWJ…). ⚠️ A key in a static site is visible to every visitor. **Use a free-tier key only — never a paid Finnhub key.**

Why demo? Keyless index sources were tested: Stooq's CSV endpoint does not allow browser (CORS) access, so live index prices need a key.

## 🛠 Stack
Plain HTML + CSS + vanilla JS · [globe.gl](https://github.com/vasturiano/globe.gl) via CDN · GitHub Pages.

## 🚀 Run locally
```bash
git clone https://github.com/ashswin-git/global-pulse
cd global-pulse
python3 -m http.server 8000   # open http://localhost:8000
```

## ✅ Phase 2 (done)
LIVE / CACHED / ERROR tags with last-updated time, localStorage caching, fetch timeouts and retries, GDELT backoff, CoinPaprika fallback, INR toggle, globe click → details panel + news filter, region filter, lunch breaks and some holidays, WebGL/CDN fallback, accessibility (skip link, focus styles, legend shapes, aria), local/UTC clock, OG/Twitter tags and favicon, reduced-motion support.

## 🗺 Roadmap
- Geo-located conflict events (GDELT GEO / ACLED) instead of the static hotspot list
- Full exchange holiday calendars
- Watchlist saved in localStorage, search, and alerts
- Fear & Greed / volatility widgets, PWA install

⚠️ Not financial advice. Demo data is always labelled as demo.
