# Global Pulse intel-layer sources

Built 2026-11-21T05:12:29Z. Every file in this folder is a slim, static extract of an open dataset.
Do not add datasets that cannot be redistributed (for example TeleGeography's cable GeoJSON,
which requires a separate data licence).

| File | Layer | Source | Licence | Filter |
|---|---|---|---|---|
| `cables.json` | Undersea internet cables | OpenStreetMap named submarine communication cables | ODbL 1.0 | Named communication/fibre submarine ways; simplified |
| `nuclear.json` | Nuclear power plants | WRI Global Power Plant Database v1.3.0 | CC BY 4.0 | `primary_fuel = Nuclear` |
| `power.json` | Major power plants | WRI Global Power Plant Database v1.3.0 | CC BY 4.0 | `capacity_mw >= 1000`, excluding nuclear |
| `crypto-exchanges.json` | Crypto exchanges (map) | Wikidata | CC0 | Crypto-exchange items with HQ/item coordinates |
| `tech.json` | Data centers, tech hubs, AI labs | Wikidata | CC0 | Notable items; see file `meta.filter` |
| `bases.json` | Military bases | NTAD Military Bases (US DoD, via USDOT/BTS) + Wikidata | Public domain + CC0 | Operational public NTAD sites + notable Wikidata bases |
| `ports.json` | Major ports | Natural Earth 10m ports | Public domain | `scalerank <= 5` |
| `pipelines.json` | Oil & gas pipelines | OpenStreetMap named oil/gas pipelines | ODbL 1.0 | Relations + independent ways ≥ 250 km; simplified |
| `chokepoints.json` | Strategic chokepoints | EIA World Oil Transit Chokepoints + Wikidata coordinates | Public domain + CC0 | EIA list plus 4 clearly labelled extras |

Live (not stored here): CoinGecko / CoinPaprika prices, GDELT conflict points, GDACS, USGS quakes, NASA EONET.

Rebuild: `python3 scripts/build-intel.py` (expects raw extracts in `/tmp/gp-intel/` as produced by the documented curl/Overpass steps).

| `cameras.json` | Live public cameras | TfL JamCams (OGL / Powered by TfL Open Data), Caltrans CWWP2, Fintraffic Digitraffic (CC BY 4.0), Delaware DOT TMC | Official public traffic / road-weather cameras only; stills or official streams. Windy skipped (API key required). Private CCTV excluded. |
