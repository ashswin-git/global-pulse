// Fetches open data feeds into data/*.json (run by GitHub Actions cron). Node 20+, no dependencies.
// GDELT asks for ≤1 request / 5s, so we wait 7s between GDELT calls.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'global-pulse-data-bot (+https://github.com/ashswin-git/global-pulse)' };
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45000) });
      const txt = await r.text();
      if (r.ok) { try { return JSON.parse(txt); } catch { throw new Error('non-JSON: ' + txt.slice(0, 120)); } }
      throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 120));
    } catch (e) { console.warn(url.slice(0, 90), '→', e.message); if (i < tries - 1) await sleep(10000 * (i + 1)); else throw e; }
  }
}
await mkdir('data', { recursive: true });
const meta = { updated: new Date().toISOString(), sources: {} };
async function job(name, fn) {
  try { const d = await fn(); await writeFile(`data/${name}.json`, JSON.stringify(d)); meta.sources[name] = { ok: true, n: d.items?.length ?? d.features?.length ?? 0, t: meta.updated }; }
  catch (e) {
    let prev = null; try { prev = JSON.parse(await readFile('data/meta.json', 'utf8')).sources[name]; } catch {}
    meta.sources[name] = { ok: false, error: String(e.message).slice(0, 200), t: prev?.t || null }; // keep previous file
  }
}
const G = 'https://api.gdeltproject.org/api/v2/doc/doc?';
const CONFLICT = '(war OR conflict OR airstrike OR shelling OR ceasefire OR military OR clashes OR militants)';
await job('news', async () => {
  const j = await get(G + new URLSearchParams({ query: CONFLICT + ' sourcelang:english', mode: 'artlist', format: 'json', maxrecords: '250', sort: 'datedesc', timespan: '7d' }));
  const items = (j.articles || []).filter(a => /^https?:/.test(a.url)).map(a => ({ url: a.url, title: a.title, domain: a.domain, sourcecountry: a.sourcecountry, seendate: a.seendate }));
  if (!items.length) throw new Error('empty');
  return { items };
});
await sleep(7000);
await job('points', async () => {
  const j = await get(G + new URLSearchParams({ query: CONFLICT, mode: 'pointdata', format: 'geojson', timespan: '7d' }));
  const features = (j.features || []).filter(f => f.geometry?.type === 'Point').slice(0, 1500).map(f => ({
    type: 'Feature', geometry: f.geometry,
    properties: { name: f.properties?.name, count: f.properties?.count, url: f.properties?.url || f.properties?.shareimage && undefined, html: undefined, date: f.properties?.date || f.properties?.urlpubtimedate || null } }));
  if (!features.length) throw new Error('empty');
  return { type: 'FeatureCollection', features };
});
await job('gdacs', async () => {
  const j = await get('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&alertlevel=Orange;Red');
  return { type: 'FeatureCollection', features: (j.features || []).filter(f => f.geometry?.type === 'Point').map(f => ({ type: 'Feature', geometry: f.geometry, properties: (({ eventtype, eventid, name, description, alertlevel, country, fromdate, todate, url }) => ({ eventtype, eventid, name, description, alertlevel, country, fromdate, todate, url }))(f.properties || {}) })) };
});
await job('quakes', async () => {
  const j = await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
  return { type: 'FeatureCollection', features: (j.features || []).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url, tsunami: f.properties.tsunami } })) };
});
await job('eonet', async () => {
  const j = await get('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7&limit=300');
  const features = [];
  for (const e of j.events || []) { const g = (e.geometry || []).filter(g => g.type === 'Point').at(-1); if (g) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: g.coordinates }, properties: { title: e.title, cat: e.categories?.[0]?.title, date: g.date, url: e.sources?.[0]?.url || e.link } }); }
  return { type: 'FeatureCollection', features };
});
await writeFile('data/meta.json', JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta.sources));
