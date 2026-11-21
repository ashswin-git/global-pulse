// Refresh official / explicitly public traffic & road-weather cameras into data/intel/cameras.json.
// Keyless sources only. Never include private or unprotected CCTV (Insecam, Shodan, etc.).
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const UA = { 'User-Agent': 'global-pulse-data-bot (+https://github.com/ashswin-git/global-pulse)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, extra = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...extra.headers }, signal: AbortSignal.timeout(extra.timeout || 45000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (extra.text) return await r.text();
      if (ct.includes('json') || extra.json !== false) return await r.json();
      return await r.text();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(4000 * (i + 1));
    }
  }
  throw last;
}

function slim(rec) {
  const out = { n: rec.n, lat: +(+rec.lat).toFixed(4), lng: +(+rec.lng).toFixed(4), src: rec.src };
  if (rec.c) out.c = rec.c;
  if (rec.img) out.img = rec.img;
  if (rec.vid) out.vid = rec.vid;
  if (rec.page) out.page = rec.page;
  if (rec.stream) out.stream = rec.stream;
  return out;
}
function valid(r) {
  return r && r.n && Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180 && (r.img || r.vid || r.stream || r.page);
}

const SOURCES = {
  tfl: {
    name: 'TfL JamCams (London)',
    url: 'https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service',
    license: 'Open Government Licence (UK). Contains OS data © Crown copyright. Powered by TfL Open Data.',
    terms: 'Attribution required: “Powered by TfL Open Data”. Snapshots and short clips are official TfL traffic cameras. Do not suggest they are private CCTV.',
  },
  caltrans: {
    name: 'Caltrans CWWP2 (California DOT)',
    url: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm',
    license: 'Public traffic-camera service from the California Department of Transportation. Attribution: Caltrans.',
    terms: 'Official highway CCTV provided as a public traveler-information service. Images update on the same URL. Not for identifying people.',
  },
  fintraffic: {
    name: 'Fintraffic Digitraffic weather cameras (Finland)',
    url: 'https://www.digitraffic.fi/en/road-traffic/weathercam/',
    license: 'Creative Commons Attribution 4.0 (CC BY 4.0). Attribution: Fintraffic / Digitraffic.',
    terms: 'Official road weather cameras. Image URL is the documented public preset still (weathercam.digitraffic.fi/{presetId}.jpg).',
  },
  deldot: {
    name: 'Delaware DOT Traffic Management Center',
    url: 'https://tmc.deldot.gov/',
    license: 'Public traveler-information service, Delaware Department of Transportation. Attribution: DelDOT.',
    terms: 'Official TMC cameras. This extract keeps live HLS stream links and the public TMC site when a still image is not published.',
  },
};

let previous = { items: [] };
try { previous = JSON.parse(await readFile('data/intel/cameras.json', 'utf8')); } catch {}

const collected = [];
const srcMeta = {};

async function job(id, fn) {
  try {
    const items = (await fn()).filter(valid).map(slim);
    collected.push(...items);
    srcMeta[id] = { ok: true, n: items.length, t: new Date().toISOString(), ...SOURCES[id] };
    console.log(id, 'ok', items.length);
  } catch (e) {
    const kept = (previous.items || []).filter(x => x.src === id);
    collected.push(...kept);
    srcMeta[id] = { ok: false, n: kept.length, error: String(e.message).slice(0, 200), t: previous.meta?.sources?.[id]?.t || null, ...SOURCES[id] };
    console.warn(id, 'failed, kept previous', kept.length, e.message);
  }
}

await job('tfl', async () => {
  const rows = await get('https://api.tfl.gov.uk/Place/Type/JamCam');
  const out = [];
  for (const p of rows || []) {
    const props = Object.fromEntries((p.additionalProperties || []).map(a => [a.key, a.value]));
    if (String(props.available) === 'false') continue;
    const id = String(p.id || '').replace(/^JamCams_/, '');
    out.push({
      n: p.commonName || 'TfL camera',
      lat: p.lat, lng: p.lon,
      c: 'London, UK',
      src: 'tfl',
      img: props.imageUrl || (id ? 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/' + id + '.jpg' : ''),
      vid: props.videoUrl || '',
      page: 'https://www.tfl.gov.uk/travel-information/traffic/cctv',
    });
  }
  return out;
});

await job('caltrans', async () => {
  const out = [];
  for (let d = 1; d <= 12; d++) {
    const id = String(d).padStart(2, '0');
    let j;
    try { j = await get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${id}.json`, { timeout: 60000 }); }
    catch (e) { console.warn('caltrans d' + d, e.message); await sleep(500); continue; }
    const rows = (j.data || []).map(x => x.cctv).filter(Boolean);
    const kept = [];
    for (const c of rows) {
      if (String(c.inService).toLowerCase() !== 'true') continue;
      const loc = c.location || {}, img = c.imageData?.static?.currentImageURL, stream = c.imageData?.streamingVideoURL;
      if (!img) continue;
      kept.push({
        n: loc.locationName || loc.nearbyPlace || 'Caltrans camera',
        lat: +loc.latitude, lng: +loc.longitude,
        c: [loc.nearbyPlace, loc.county ? loc.county + ' County' : '', 'California, USA'].filter(Boolean).join(', '),
        src: 'caltrans', img, stream: stream || '',
        page: 'https://cwwp2.dot.ca.gov/vm/iframemap.htm',
      });
    }
    // Keep a spread across each district so the file stays light.
    const step = Math.max(1, Math.ceil(kept.length / 25));
    out.push(...kept.filter((_, i) => i % step === 0).slice(0, 25));
    await sleep(300);
  }
  return out;
});

await job('fintraffic', async () => {
  const j = await get('https://tie.digitraffic.fi/api/weathercam/v1/stations', { headers: { 'Accept-Encoding': 'gzip' } });
  const feats = (j.features || []).filter(f => f.properties?.collectionStatus === 'GATHERING' && f.geometry?.coordinates);
  const step = Math.max(1, Math.ceil(feats.length / 120));
  const out = [];
  for (const f of feats.filter((_, i) => i % step === 0).slice(0, 120)) {
    const [lng, lat] = f.geometry.coordinates;
    const preset = (f.properties.presets || []).find(p => p.inCollection) || f.properties.presets?.[0];
    if (!preset?.id) continue;
    out.push({
      n: (f.properties.name || preset.id).replace(/^kt/i, 'Road '),
      lat, lng, c: 'Finland', src: 'fintraffic',
      img: 'https://weathercam.digitraffic.fi/' + preset.id + '.jpg',
      page: 'https://www.digitraffic.fi/en/road-traffic/weathercam/',
    });
  }
  return out;
});

await job('deldot', async () => {
  const j = await get('https://tmc.deldot.gov/json/videocamera.json');
  const rows = (j.videoCameras || []).filter(c => c.enabled && String(c.status || '').toLowerCase() !== 'unavailable');
  const step = Math.max(1, Math.ceil(rows.length / 80));
  return rows.filter((_, i) => i % step === 0).slice(0, 80).map(c => ({
    n: c.title || c.id, lat: c.lat, lng: c.lon,
    c: [c.county, 'Delaware, USA'].filter(Boolean).join(', '),
    src: 'deldot',
    stream: c.urls?.m3u8s || c.urls?.m3u8 || '',
    page: 'https://tmc.deldot.gov/',
  }));
});

await mkdir('data/intel', { recursive: true });
const items = collected;
const payload = {
  meta: {
    title: 'Live public cameras',
    retrieved: new Date().toISOString(),
    note: 'Official or explicitly public traffic and road-weather cameras only. Private, login-walled, or unprotected CCTV (Insecam, Shodan-style open cameras) are not included. Stills and short official clips are loaded in the browser on click; some agencies also publish an HLS stream. Windy Webcams was skipped because its API requires a secret key.',
    sources: srcMeta,
    attribution: Object.values(srcMeta).map(s => s.name).join(' · '),
  },
  n: items.length,
  items,
};
await writeFile('data/intel/cameras.json', JSON.stringify(payload));
console.log('cameras', items.length, 'bytes', JSON.stringify(payload).length);
