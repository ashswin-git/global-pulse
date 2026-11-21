// Shared UI: toasts, article modal, script loaders, sharp tiled globe helpers.
const GPUI = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => { try { const x = new URL(u, location.href); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
  const $ = id => document.getElementById(id);
  const loaded = {};

  const GLOBE_SRC = 'https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js';
  const GLOBE_SRI = 'sha384-1uolMBZ25k3zJcNwCLEv49+L+m2dZudqAzsoSAJfQTzDCSBxJzrMuZ2dkp/5JKiT';
  const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_CSS_SRI = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
  const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
  const LEAFLET_JS_SRI = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
  const CLUSTER_CSS = 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
  const CLUSTER_CSS_SRI = 'sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV';
  const CLUSTER_DEF = 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css';
  const CLUSTER_DEF_SRI = 'sha384-wgw+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS+Z9Y7nMu8yNjBKYC+';
  const CLUSTER_JS = 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';
  const CLUSTER_JS_SRI = 'sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr';
  const HLS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
  const HLS_SRI = 'sha384-9v3HcdYrO3D+OPDTjZ40RXocgE4GtXVCd3/mCS62JsM93JXgI1afJVuwjFvsu6ni';
  const TOPO_SRC = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js';
  const TOPO_SRI = 'sha384-Ukv1p/xTma6P4/2bY5KzWBw+ydSpXmhCMtyciIQVDJ1RmOxtCYNMF1uXT9T63H67';

  function loadScript(src, sri) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; }
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  function loadCSS(href, sri) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    if (sri) { l.integrity = sri; l.crossOrigin = 'anonymous'; }
    document.head.appendChild(l);
  }
  function loadGlobeLib() { return window.Globe ? Promise.resolve() : loadScript(GLOBE_SRC, GLOBE_SRI); }
  function loadLeaflet() {
    loadCSS(LEAFLET_CSS, LEAFLET_CSS_SRI);
    loadCSS(CLUSTER_CSS, CLUSTER_CSS_SRI);
    loadCSS(CLUSTER_DEF, CLUSTER_DEF_SRI);
    return window.L && L.markerClusterGroup ? Promise.resolve() : loadScript(LEAFLET_JS, LEAFLET_JS_SRI).then(() => loadScript(CLUSTER_JS, CLUSTER_JS_SRI));
  }
  function loadHls() { return (window.Hls || document.createElement('video').canPlayType('application/vnd.apple.mpegurl')) ? Promise.resolve() : loadScript(HLS_SRC, HLS_SRI); }
  function loadTopo() { return window.topojson ? Promise.resolve() : loadScript(TOPO_SRC, TOPO_SRI); }

  // Basemaps: Night (NASA Black Marble texture / GIBS tiles), Satellite (Esri), Dark.
  const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_DARK = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  const GIBS_NIGHT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
  const CREDIT = {
    night: 'Night lights: NASA Earth Observatory Black Marble 2016 (Suomi NPP / VIIRS) · NASA GIBS',
    sat: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    dark: 'Dark canvas: Esri World Dark Gray Base. Night lights available as the Night basemap (NASA Black Marble).',
  };
  const CREDIT_HTML = {
    night: 'Night lights: NASA Earth Observatory <a href="https://science.nasa.gov/earth/earth-observatory/earth-at-night/" target="_blank" rel="noopener">Black Marble</a> 2016 (Suomi NPP / VIIRS) · <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>',
    sat: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    dark: 'Tiles © Esri — World Dark Gray Base. Night lights: NASA Black Marble / GIBS',
  };

  function nightTextureUrl() {
    const wide = Math.max(innerWidth || 0, innerHeight || 0) * Math.min(2, window.devicePixelRatio || 1);
    return wide >= 1400 ? 'assets/black-marble-8k.jpg' : 'assets/black-marble-4k.jpg';
  }

  function globeTileUrl(x, y, l) {
    const z = Math.max(0, Math.min(l, 19));
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
  }

  function readBasemap(storeKey, fallback) {
    const q = new URLSearchParams(location.search).get('bm');
    if (q === 'satellite') return 'sat';
    if (q === 'night' || q === 'sat' || q === 'dark') return q;
    try { const s = localStorage.getItem(storeKey); if (s === 'night' || s === 'sat' || s === 'dark') return s; } catch {}
    const body = document.body;
    const def = (body && body.getAttribute('data-bm-default')) || fallback || 'night';
    return def === 'satellite' ? 'sat' : def;
  }
  function persistBasemap(storeKey, mode) {
    try { localStorage.setItem(storeKey, mode); } catch {}
  }
  function pageBasemapStore() { return (document.body && document.body.getAttribute('data-bm-store')) || 'gp:basemap'; }
  function pageBasemapDefault() { return (document.body && document.body.getAttribute('data-bm-default')) || 'night'; }
  function readPageBasemap() { return readBasemap(pageBasemapStore(), pageBasemapDefault()); }

  function basemapCredit(mode, extra) {
    const base = CREDIT[mode] || CREDIT.sat;
    return extra ? base + '. ' + extra : base;
  }
  function setMapCredit(mode, extra) {
    const el = $('mapCredit');
    if (!el) return;
    const more = extra ? ' ' + extra : '';
    el.innerHTML = (CREDIT_HTML[mode] || CREDIT_HTML.sat) + (more ? ' · ' + more : '');
  }

  function leafletBasemap(mode) {
    if (mode === 'night') {
      return L.tileLayer(GIBS_NIGHT, {
        attribution: CREDIT_HTML.night,
        maxZoom: 20, maxNativeZoom: 8, tileSize: 256,
      });
    }
    if (mode === 'dark') {
      return L.tileLayer(ESRI_DARK, {
        attribution: CREDIT_HTML.dark,
        maxZoom: 20, maxNativeZoom: 16,
      });
    }
    return L.tileLayer(ESRI_SAT, {
      attribution: CREDIT_HTML.sat,
      maxZoom: 20, maxNativeZoom: 19,
    });
  }
  function setLeafletBasemap(map, mode) {
    if (!map || !window.L) return;
    if (map._gpBase) { try { map.removeLayer(map._gpBase); } catch {} }
    const layer = leafletBasemap(mode);
    layer.addTo(map);
    if (layer.bringToBack) layer.bringToBack();
    map._gpBase = layer;
    setMapCredit(mode, map._gpCreditExtra || '');
    return layer;
  }

  function applyGlobeBasemap(globe, mode) {
    if (!globe) return;
    try { if (typeof globe.bumpImageUrl === 'function') globe.bumpImageUrl(null); } catch {}
    if (mode === 'night') {
      try { if (typeof globe.globeTileEngineUrl === 'function') globe.globeTileEngineUrl(null); } catch {}
      globe.globeImageUrl(nightTextureUrl());
      globe.atmosphereColor('#22d3ee').atmosphereAltitude(0.22);
    } else if (mode === 'dark') {
      try { if (typeof globe.globeTileEngineUrl === 'function') globe.globeTileEngineUrl(null); } catch {}
      globe.globeImageUrl('assets/earth-dark.jpg');
      globe.atmosphereColor('#22d3ee').atmosphereAltitude(0.2);
    } else {
      // Satellite: slippy Esri tiles that sharpen with zoom. Keep any prior night
      // texture off-screen so switching back is instant.
      if (typeof globe.globeTileEngineMaxLevel === 'function') globe.globeTileEngineMaxLevel(19);
      if (typeof globe.globeTileEngineUrl === 'function') globe.globeTileEngineUrl(globeTileUrl);
      try { globe.globeImageUrl(null); } catch {}
      globe.atmosphereColor('#22d3ee').atmosphereAltitude(0.16);
    }
    setMapCredit(mode);
    // Refresh anisotropy/mipmaps once the new texture or tiles land.
    setTimeout(() => { try { globe._gpPolish && globe._gpPolish(); } catch {} }, 400);
    setTimeout(() => { try { globe._gpPolish && globe._gpPolish(); } catch {} }, 1600);
  }

  function mountBasemapToggle(el, opts = {}) {
    const root = typeof el === 'string' ? $(el) : el;
    if (!root) return;
    const store = opts.store || pageBasemapStore();
    let mode = opts.value || readBasemap(store, opts.fallback || pageBasemapDefault());
    const items = [
      { id: 'night', label: '🌃 Night' },
      { id: 'sat', label: '🛰️ Satellite' },
      { id: 'dark', label: '🌑 Dark' },
    ];
    const paint = () => {
      root.classList.add('basemap-toggle');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', 'Basemap');
      root.innerHTML = items.map(it => `<button type="button" data-bm="${it.id}" class="${it.id === mode ? 'on' : ''}" aria-pressed="${it.id === mode}">${it.label}</button>`).join('');
    };
    const apply = next => {
      if (!next || next === mode) { paint(); return; }
      mode = next;
      persistBasemap(store, mode);
      paint();
      if (opts.onChange) opts.onChange(mode);
    };
    paint();
    root.onclick = e => {
      const btn = e.target.closest('button[data-bm]');
      if (btn) apply(btn.getAttribute('data-bm'));
    };
    return { get: () => mode, set: apply };
  }

  function tuneGlobe(globe) {
    if (!globe) return;
    try { if (typeof globe.bumpImageUrl === 'function') globe.bumpImageUrl(null); } catch {}

    const renderer = typeof globe.renderer === 'function' ? globe.renderer() : null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (renderer && renderer.setPixelRatio) renderer.setPixelRatio(dpr);

    const LIN_MIP = 1008, LIN = 1006; // THREE.LinearMipmapLinearFilter, LinearFilter
    const ani = renderer && renderer.capabilities ? (renderer.capabilities.getMaxAnisotropy() || 1) : 8;
    function polishTextures() {
      const scene = typeof globe.scene === 'function' ? globe.scene() : null;
      if (!scene || !scene.traverse) return;
      scene.traverse(obj => {
        const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
        for (const mat of mats) {
          if (!mat) continue;
          for (const key of ['map', 'bumpMap', 'emissiveMap', 'specularMap', 'alphaMap']) {
            const tex = mat[key];
            if (!tex || !tex.isTexture) continue;
            tex.anisotropy = ani;
            tex.generateMipmaps = true;
            tex.minFilter = LIN_MIP;
            tex.magFilter = LIN;
            tex.needsUpdate = true;
          }
        }
      });
    }
    globe._gpPolish = polishTextures;
    polishTextures();
    let n = 0;
    const iv = setInterval(() => { polishTextures(); if (++n >= 12) clearInterval(iv); }, 700);
    if (typeof globe.onZoom === 'function') {
      let t; globe.onZoom(() => { polishTextures(); clearTimeout(t); t = setTimeout(polishTextures, 400); });
    }

    let idleTimer, paused = false, wantRotate = !!(globe.controls() && globe.controls().autoRotate);
    function pause() {
      if (paused) return; paused = true;
      try { wantRotate = globe.controls().autoRotate; globe.controls().autoRotate = false; } catch {}
      try { if (typeof globe.pauseAnimation === 'function') globe.pauseAnimation(); } catch {}
    }
    function resume() {
      if (document.hidden) return;
      if (paused) {
        paused = false;
        try { if (typeof globe.resumeAnimation === 'function') globe.resumeAnimation(); } catch {}
        try { globe.controls().autoRotate = wantRotate; } catch {}
      }
      bumpIdle();
    }
    function bumpIdle() {
      clearTimeout(idleTimer);
      if (!document.hidden) idleTimer = setTimeout(pause, 25000);
    }
    document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());
    for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) document.addEventListener(ev, resume, { passive: true });
    bumpIdle();
  }

  function ensure() {
    if (!$('toasts')) {
      const t = document.createElement('div');
      t.id = 'toasts'; t.className = 'toasts'; t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    if (!$('articleModal')) {
      const m = document.createElement('div');
      m.id = 'articleModal'; m.className = 'art-modal'; m.hidden = true;
      m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'artTitle');
      m.innerHTML = `<div class="art-card glass">
        <button type="button" class="close" id="artClose" aria-label="Close article">✕</button>
        <h3 id="artTitle"></h3>
        <p class="art-meta" id="artMeta"></p>
        <p class="art-sum" id="artSum"></p>
        <a id="artOpen" class="art-open" target="_blank" rel="noopener">Open article →</a>
      </div>`;
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m) closeArticle(); });
      $('artClose').onclick = closeArticle;
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('articleModal').hidden) closeArticle(); });
    }
  }

  function toast(title, body, opts = {}) {
    ensure();
    const box = $('toasts');
    while (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status');
    const href = safeUrl(opts.href);
    el.innerHTML = `<button type="button" class="toast-x" aria-label="Dismiss">✕</button>
      <strong>${esc(title)}</strong>
      ${body ? `<p>${esc(body)}</p>` : ''}
      ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">Open →</a>` : ''}`;
    el.querySelector('.toast-x').onclick = () => el.remove();
    box.appendChild(el);
    const ms = opts.timeout == null ? 8000 : opts.timeout;
    if (ms > 0) setTimeout(() => el.remove(), ms);
    return el;
  }

  function openArticle(a = {}) {
    ensure();
    const url = safeUrl(a.url || a.href);
    $('artTitle').textContent = a.title || 'Article';
    const when = a.date || a.seendate || a.time;
    let whenTxt = '';
    if (when) { const d = new Date(when); if (!isNaN(+d)) whenTxt = d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    $('artMeta').textContent = [a.source || a.domain, a.country || a.sourcecountry, whenTxt].filter(Boolean).join(' · ');
    $('artSum').textContent = a.excerpt || a.summary || a.description || '';
    $('artSum').hidden = !$('artSum').textContent;
    const link = $('artOpen');
    if (url) { link.href = url; link.hidden = false; } else { link.removeAttribute('href'); link.hidden = true; }
    $('articleModal').hidden = false;
    $('artClose').focus();
  }
  function closeArticle() { const m = $('articleModal'); if (m) m.hidden = true; }

  function bindNewsClicks(root) {
    const el = typeof root === 'string' ? $(root) : root;
    if (!el || el.dataset.gpuiNews) return;
    el.dataset.gpuiNews = '1';
    el.addEventListener('click', e => {
      const a = e.target.closest('a.item, button.item[data-article]');
      if (!a) return;
      const href = a.getAttribute('href') || a.dataset.url;
      if (!href || href === '#') { e.preventDefault(); return; }
      e.preventDefault();
      const title = a.getAttribute('data-title') || (a.textContent || '').trim().split('\n')[0];
      openArticle({
        title, source: a.getAttribute('data-source') || '',
        date: a.getAttribute('data-date') || '',
        excerpt: a.getAttribute('data-excerpt') || (a.querySelector('.ex, small.ex') || {}).textContent || '',
        url: href,
      });
    });
  }

  function wirePanel(btnId = 'panelBtn', panelId = 'layerPanel', closeId = 'panelClose') {
    const btn = $(btnId), panel = $(panelId), close = $(closeId);
    if (!panel) return;
    const set = open => {
      panel.classList.toggle('open', open);
      document.body.classList.toggle('panel-open', open);
      if (btn) btn.setAttribute('aria-expanded', String(open));
    };
    if (btn) btn.onclick = () => set(!panel.classList.contains('open'));
    if (close) close.onclick = () => set(false);
    const search = $('layerSearch');
    if (search) search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      panel.querySelectorAll('.layer-row, .layers label').forEach(row => {
        row.hidden = q && !(row.textContent || '').toLowerCase().includes(q);
      });
      panel.querySelectorAll('.layer-group').forEach(g => {
        const rows = [...g.querySelectorAll('.layer-row, label')];
        g.hidden = rows.length > 0 && rows.every(r => r.hidden);
      });
    });
  }

  function wireIntelTabs() {
    const tabs = document.querySelectorAll('.intel-tab');
    if (!tabs.length) return;
    tabs.forEach(btn => btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.toggle('on', b === btn));
      document.querySelectorAll('.intel-pane').forEach(p => { p.hidden = p.id !== btn.dataset.pane; });
    }));
    const ib = $('intelBtn'), rail = $('intelRail');
    if (ib && rail) ib.onclick = () => {
      const open = !rail.classList.contains('open');
      rail.classList.toggle('open', open);
      ib.setAttribute('aria-expanded', String(open));
    };
    const ic = $('intelClose');
    if (ic && rail) ic.onclick = () => { rail.classList.remove('open'); if (ib) ib.setAttribute('aria-expanded', 'false'); };
  }

  // Camera media: HLS (hls.js), official MP4 loops, auto-refresh stills.
  let camTimer = 0, camHls = null;
  function stopCam() {
    clearInterval(camTimer); camTimer = 0;
    if (camHls) { try { camHls.destroy(); } catch {} camHls = null; }
  }
  function bust(u) { return u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(); }
  function camMediaKind(it) { return (it && (it.vid || it.stream || it.yt)) ? 'Video' : 'Snapshot'; }

  function mountCam(panel, it, label) {
    stopCam();
    const img = safeUrl(it.img), vid = safeUrl(it.vid), stream = safeUrl(it.stream), page = safeUrl(it.page), yt = it.yt || it.youtube;
    const kind = camMediaKind(it);
    const videoEl = panel.querySelector('#camVideo');
    const stillEl = panel.querySelector('#camStill');
    const ago = panel.querySelector('#camAgo');
    const mark = () => { if (ago) ago.textContent = 'Updated ' + new Date().toLocaleTimeString(); };

    if (yt && /^[\w-]{6,}$/.test(yt)) {
      return; // iframe already in HTML
    }
    if (stream && videoEl) {
      loadHls().then(() => {
        if (window.Hls && Hls.isSupported()) {
          camHls = new Hls({ maxBufferLength: 8, capLevelToPlayerSize: true });
          camHls.loadSource(stream);
          camHls.attachMedia(videoEl);
          camHls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = stream;
          videoEl.play().catch(() => {});
        }
        mark();
      }).catch(() => { if (page) videoEl.insertAdjacentHTML('afterend', '<p><a href="' + esc(page) + '" target="_blank" rel="noopener">Open official stream →</a></p>'); });
      return;
    }
    if (vid && videoEl) {
      const load = () => { videoEl.src = bust(vid); videoEl.play().catch(() => {}); mark(); };
      load();
      videoEl.loop = true;
      camTimer = setInterval(load, 30000);
      return;
    }
    if (img && stillEl) {
      const tick = () => { stillEl.src = bust(img); mark(); };
      tick();
      camTimer = setInterval(tick, 15000);
    }
  }

  return {
    boot: ensure, toast, openArticle, closeArticle, bindNewsClicks, wirePanel, wireIntelTabs,
    esc, safeUrl, loadGlobeLib, loadLeaflet, loadHls, loadTopo, tuneGlobe, globeTileUrl,
    applyGlobeBasemap, leafletBasemap, setLeafletBasemap,
    readBasemap, readPageBasemap, persistBasemap, mountBasemapToggle, basemapCredit, setMapCredit,
    nightTextureUrl,
    stopCam, mountCam, camMediaKind,
  };
})();
window.GPUI = GPUI;
