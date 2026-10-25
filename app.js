// Velocímetro Alerta — toda a lógica do app.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = {
    gate: $('gate'), gateErr: $('gateErr'), btnStart: $('btnStart'),
    sign: $('sign'), roadName: $('roadName'), roadMeta: $('roadMeta'),
    banner: $('banner'), bannerIcon: $('bannerIcon'), bannerText: $('bannerText'), bannerDist: $('bannerDist'),
    ahead: $('ahead'), aheadSign: $('aheadSign'), aheadText: $('aheadText'), aheadDist: $('aheadDist'),
    speed: $('speed'), status: $('status'),
    btnMinus: $('btnMinus'), btnPlus: $('btnPlus'), btnAuto: $('btnAuto'),
    btnSound: $('btnSound'), btnSoundOn: $('btnSoundOn'), btnVoice: $('btnVoice'), btnVoice2: $('btnVoice2'), btnStats: $('btnStats'), btnSettings: $('btnSettings'),
    btnTest: $('btnTest'), btnRadar: $('btnRadar'), btnAhead: $('btnAhead'), btnHud: $('btnHud'), btnHudExit: $('btnHudExit'), nightInfo: $('nightInfo'),
    btnDlHere: $('btnDlHere'), btnSaveHome: $('btnSaveHome'), btnSaveWork: $('btnSaveWork'), btnDlHome: $('btnDlHome'), btnDlWork: $('btnDlWork'), dlStatus: $('dlStatus'),
    btnInstall: $('btnInstall'), installHint: $('installHint'), btnRefreshMap: $('btnRefreshMap'), lnkOsm: $('lnkOsm'), mapInfo: $('mapInfo'),
    btnClearFixes: $('btnClearFixes'), fixInfo: $('fixInfo'),
    sndBtns: Array.from(document.querySelectorAll('[data-sound]')),
    tolBtns: Array.from(document.querySelectorAll('[data-tol]')),
    warnBtns: Array.from(document.querySelectorAll('[data-warn]')),
    dimBtns: Array.from(document.querySelectorAll('[data-dim]')),
    gpsDot: $('gpsDot'), gpsText: $('gpsText'), accText: $('accText'), tripMini: $('tripMini'),
    scrim: $('scrim'), sheetSettings: $('sheetSettings'), sheetStats: $('sheetStats'),
    btnCloseSettings: $('btnCloseSettings'), btnCloseStats: $('btnCloseStats'), btnResetTrip: $('btnResetTrip'),
    btnMapCur: $('btnMapCur'), btnGpxCur: $('btnGpxCur'), btnCsvCur: $('btnCsvCur'), trips: $('trips'), tripsHint: $('tripsHint'),
    stDist: $('stDist'), stTime: $('stTime'), stAvg: $('stAvg'), stMax: $('stMax'), stOver: $('stOver'), stOverTime: $('stOverTime'), stSince: $('stSince'),
    mapView: $('mapView'), mapTitle: $('mapTitle'), btnMapClose: $('btnMapClose'),
  };

  // ---------- Estado ----------
  const S = {
    speedKmh: 0,
    lastPos: null,          // {lat, lon, t, acc}
    lastFix: 0,
    heading: null,          // graus 0–360, direção do movimento
    stale: false,
    autoLimit: null, autoSource: 'none', autoRoad: '', autoWayId: null, autoCond: false,
    manualLimit: null,      // limite temporário quando não há via identificada
    soundOn: true, soundType: 'sirene', voiceOn: true, radarOn: true, aheadOn: true,
    dimMode: 'off',         // 'off' | 'on' | 'night'
    dim: false, hud: false,
    tolMode: 'none',        // 'none' | 'br' | 'k5' | 'p10'
    warnMargin: 5,
    muteUntil: 0,
    state: 'ok',
    wakeLock: null,
    lastAnnouncedLimit: null,
    places: {},             // {casa:{lat,lon}, trabalho:{lat,lon}}
  };

  // Limites padrão (CTB) quando a via não tem maxspeed no OSM — marcados como estimados
  const DEFAULTS = {
    motorway: 110, motorway_link: 60,
    trunk: 80, trunk_link: 60,
    primary: 60, primary_link: 40,
    secondary: 50, secondary_link: 40,
    tertiary: 40, tertiary_link: 40,
    unclassified: 40, residential: 30, living_street: 30, service: 20,
  };
  const HW_NAMES = { motorway: 'Rodovia', trunk: 'Rodovia', primary: 'Via principal', secondary: 'Via secundária', tertiary: 'Via coletora', residential: 'Rua residencial', living_street: 'Rua residencial', service: 'Via de serviço', unclassified: 'Via sem nome' };

  function toleranceFor(limit) {
    if (limit == null) return 0;
    switch (S.tolMode) {
      case 'br': return limit <= 100 ? 7 : Math.round(limit * 0.07);
      case 'k5': return 5;
      case 'p10': return Math.round(limit * 0.10);
      default: return 0;
    }
  }
  const muted = () => Date.now() < S.muteUntil;

  // ---------- Áudio ----------
  let ctx = null, beepTimer = null;
  function unlockAudio() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0.0001; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }
  let master = null;
  function out() {
    if (!ctx) return null;
    if (!master) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.1;
      master = ctx.createGain(); master.gain.value = 1.0;
      master.connect(comp); comp.connect(ctx.destination);
    }
    return master;
  }
  const canSound = () => S.soundOn && ctx && !muted();
  function beep(freq = 880, dur = 0.18, vol = 0.6) {
    if (!canSound()) return;
    try {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g); g.connect(out());
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (e) {}
  }
  function siren(dur = 0.55) {
    if (!canSound()) return;
    try {
      const t = ctx.currentTime, g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.0, t + 0.03);
      g.gain.setValueAtTime(1.0, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(out());
      for (const [type, f0, f1] of [['sawtooth', 700, 1500], ['square', 1400, 3000]]) {
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
        o.frequency.exponentialRampToValueAtTime(f0, t + dur);
        o.connect(g); o.start(t); o.stop(t + dur);
      }
    } catch (e) {}
  }
  function horn(dur = 0.6) {
    if (!canSound()) return;
    try {
      const t = ctx.currentTime, g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.0, t + 0.02);
      g.gain.setValueAtTime(1.0, t + dur - 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(out());
      for (const [type, f] of [['sawtooth', 220], ['sawtooth', 277], ['square', 440]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
        o.connect(g); o.start(t); o.stop(t + dur);
      }
    } catch (e) {}
  }
  function beeps() {
    beep(1400, 0.12, 1.0); setTimeout(() => beep(1400, 0.12, 1.0), 160); setTimeout(() => beep(1400, 0.12, 1.0), 320);
  }
  const SOUNDS = {
    sirene: { play: () => siren(0.55), every: 700 },
    bipe:   { play: beeps,              every: 900 },
    buzina: { play: () => horn(0.6),    every: 1000 },
  };
  function playAlert() { (SOUNDS[S.soundType] || SOUNDS.sirene).play(); if (!muted()) { try { navigator.vibrate && navigator.vibrate([250, 100, 250]); } catch (e) {} } }
  function startAlarm() {
    if (beepTimer) return;
    playAlert();
    beepTimer = setInterval(playAlert, (SOUNDS[S.soundType] || SOUNDS.sirene).every);
  }
  function stopAlarm() { if (beepTimer) { clearInterval(beepTimer); beepTimer = null; } }
  function chime() { beep(1046, 0.12, 0.9); setTimeout(() => beep(1318, 0.16, 0.9), 140); if (!muted()) { try { navigator.vibrate && navigator.vibrate(120); } catch (e) {} } }

  // ---------- Voz ----------
  function say(text, { force = false } = {}) {
    if ((!S.voiceOn || muted()) && !force) return;
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR'; u.rate = 1.05; u.volume = 1;
      const v = speechSynthesis.getVoices().find(v => /pt[-_]BR/i.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function primeVoice() { try { if ('speechSynthesis' in window) { speechSynthesis.getVoices(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {} }

  // ---------- Wake lock ----------
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator) {
        S.wakeLock = await navigator.wakeLock.request('screen');
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible') { try { S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
        });
      }
    } catch (e) {}
  }

  // ---------- Geometria ----------
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) {
    const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const angleDiff = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  function destination(p, brg, dist) {
    const d = dist / R, b = toRad(brg), p1 = toRad(p.lat), l1 = toRad(p.lon);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * 180 / Math.PI, lon: l2 * 180 / Math.PI };
  }
  // distância ponto→segmento em metros (projeção equiretangular local) e posição ao longo do segmento (0..1)
  function projSegment(p, a, b) {
    const kx = Math.cos(toRad(p.lat)) * 111320, ky = 110540;
    const px = (p.lon - a.lon) * kx, py = (p.lat - a.lat) * ky;
    const bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky;
    const l2 = bx * bx + by * by;
    let t = l2 ? (px * bx + py * by) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const dx = px - t * bx, dy = py - t * by;
    return { d: Math.sqrt(dx * dx + dy * dy), t, len: Math.sqrt(l2) };
  }
  const P = g => ({ lat: g[0], lon: g[1] });

  // ---------- Sol (para o escurecer automático à noite) ----------
  function sunTimes(lat, lon, date = new Date()) {
    // Algoritmo NOAA simplificado; retorna {rise, set} em Date (hoje, hora local). Null perto dos polos.
    const rad = Math.PI / 180;
    const dayMs = 86400000;
    const J1970 = 2440588, J2000 = 2451545;
    const toJulian = d => d.valueOf() / dayMs - 0.5 + J1970;
    const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
    const d = toJulian(date) - J2000;
    const lw = rad * -lon, phi = rad * lat;
    const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    const ds = 0.0009 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const Jtransit = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
    const h = rad * -0.833;
    const cosw = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosw < -1 || cosw > 1) return null;
    const w = Math.acos(cosw);
    const Jset = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const Jrise = Jtransit - (Jset - Jtransit);
    return { rise: fromJulian(Jrise), set: fromJulian(Jset) };
  }
  function isNight(pos) {
    if (!pos) { const h = new Date().getHours(); return h >= 18 || h < 6; }
    const st = sunTimes(pos.lat, pos.lon);
    if (!st) return false;
    const now = Date.now();
    return now < st.rise.valueOf() - 15 * 60000 || now > st.set.valueOf() + 15 * 60000;
  }

  // ---------- Banco local (IndexedDB) para áreas do mapa e trajetos ----------
  const DB = {
    db: null, mem: { areas: new Map(), meta: new Map(), tracks: new Map() },
    async open() {
      if (this.db || !('indexedDB' in window)) return this.db;
      try {
        this.db = await new Promise((res, rej) => {
          const r = indexedDB.open('velocimetro', 1);
          r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('areas'); d.createObjectStore('meta'); d.createObjectStore('tracks'); };
          r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
      } catch (e) { this.db = null; }
      return this.db;
    },
    tx(store, mode, fn) {
      return new Promise((res, rej) => {
        if (!this.db) return res(fn(null));
        try {
          const t = this.db.transaction(store, mode); const req = fn(t.objectStore(store));
          if (req && 'onsuccess' in req) { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }
          else { t.oncomplete = () => res(req); t.onerror = () => rej(t.error); }
        } catch (e) { rej(e); }
      });
    },
    async get(store, key) { if (!this.db) return this.mem[store].get(key); try { return await this.tx(store, 'readonly', s => s.get(key)); } catch (e) { return undefined; } },
    async put(store, key, val) { if (!this.db) { this.mem[store].set(key, val); return; } try { await this.tx(store, 'readwrite', s => s.put(val, key)); } catch (e) {} },
    async del(store, key) { if (!this.db) { this.mem[store].delete(key); return; } try { await this.tx(store, 'readwrite', s => s.delete(key)); } catch (e) {} },
    async all(store) {
      if (!this.db) return Array.from(this.mem[store].entries()).map(([k, v]) => ({ k, v }));
      try { const keys = await this.tx(store, 'readonly', s => s.getAllKeys()); const vals = await this.tx(store, 'readonly', s => s.getAll()); return keys.map((k, i) => ({ k, v: vals[i] })); } catch (e) { return []; }
    },
  };

  // ---------- Overpass: carrega uma ÁREA inteira (vias + radares + lombadas) e guarda no celular ----------
  // Só servidores com cobertura mundial (overpass.osm.ch cobre apenas a Suíça e respondia "vazio" para o Brasil)
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  const AREA = { rCity: 1200, rFast: 2500, rDownload: 1500, margin: 450, maxAge: 14 * 86400e3, maxCached: 60 };
  const HW_RE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$';
  // Para a área grande, deixa de fora "service" (estacionamentos, entradas de garagem): são milhares de vias
  // sem limite em cidade grande e deixavam a resposta enorme e lenta.
  const HW_RE_AREA = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$';
  let epIndex = 0, fetching = false, fetchStart = 0, lastErr = '', lastFetchFail = 0, areaFails = 0, checkingCache = false;
  let area = null;        // {k, lat, lon, r, t, ways:[{i,h,n,m,f,b,c,o,g:[[lat,lon],...]}], nodes:[{i,k,lat,lon,m,n}]}
  let prevArea = null;    // área anterior, ainda usada até a nova cobrir a posição
  let areaIdx = [];       // metadados das áreas guardadas [{k, lat, lon, r, t}]
  let mapStatus = '';

  function parseMaxspeed(v) {
    if (!v) return null;
    const m = String(v).match(/(\d+(?:\.\d+)?)\s*(mph)?/i);
    if (!m) return null;
    let n = parseFloat(m[1]); if (m[2]) n = n * 1.609;
    return Math.round(n);
  }
  function compact(elements) {
    const ways = [], nodes = [];
    for (const e of elements) {
      const t = e.tags || {};
      if (e.type === 'way' && e.geometry && e.geometry.length > 1) {
        const ow = t.oneway === 'yes' || t.oneway === '1' || t.highway === 'motorway' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0;
        const w = {
          i: e.id, h: t.highway, n: t.name || t.ref || '',
          m: parseMaxspeed(t.maxspeed), f: parseMaxspeed(t['maxspeed:forward']), b: parseMaxspeed(t['maxspeed:backward']),
          o: ow, g: e.geometry.map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5)]),
        };
        if (t['maxspeed:conditional']) w.c = t['maxspeed:conditional'];
        ways.push(w);
      } else if (e.type === 'node' && e.lat != null) {
        const k = t.highway === 'speed_camera' ? 'cam' : t.traffic_calming ? 'calm' : null;
        if (k) nodes.push({ i: e.id, k, lat: +e.lat.toFixed(5), lon: +e.lon.toFixed(5), m: parseMaxspeed(t.maxspeed), n: t.name || '' });
      }
    }
    return { ways, nodes };
  }

  // onStatus(texto) é chamado a cada tentativa, para a tela mostrar o que está acontecendo.
  // mustHaveWays: a área grande nunca pode vir vazia (toda área de 1 km numa cidade tem ruas);
  // se vier, é servidor sem cobertura ou resposta cortada, então tenta o próximo.
  async function overpass(q, { timeoutMs = 20000, maxTries = ENDPOINTS.length, onStatus = null, mustHaveWays = false } = {}) {
    const errs = [];
    for (let i = 0; i < maxTries; i++) {
      const idx = (epIndex + i) % ENDPOINTS.length, url = ENDPOINTS[idx];
      const host = url.replace(/^https?:\/\//, '').split('/')[0].split('.')[0];
      const ctrl = new AbortController();
      // O tempo limite vale para a resposta INTEIRA (cabeçalho + corpo). Antes, o timer era cancelado
      // assim que o servidor começava a responder, e um corpo que parava no meio deixava o app
      // preso em "carregando mapa…" para sempre.
      const to = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        if (onStatus) onStatus(`servidor ${i + 1}/${maxTries} (${host})`);
        const r = await fetch(url + '?data=' + encodeURIComponent(q), { signal: ctrl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!r.ok) {
          if (r.status === 429) { const ra = parseInt(r.headers.get('Retry-After') || '0', 10); if (ra > 0) lastFetchFail = Date.now() + Math.min(ra, 120) * 1000 - 8000; }
          throw new Error('HTTP ' + r.status);
        }
        const txt = await r.text();
        let j;
        try { j = JSON.parse(txt); } catch (e) { throw new Error('resposta inválida'); }
        const els = j.elements || [];
        if (j.remark && !els.length) throw new Error('limite do servidor');
        if (mustHaveWays && !els.some(e => e.type === 'way')) throw new Error('resposta vazia');
        epIndex = idx;
        lastErr = '';
        return els;
      } catch (e) {
        errs.push(host + ': ' + (e.name === 'AbortError' ? 'tempo esgotado' : (e.message || 'falha de rede')));
        if (i < maxTries - 1) await new Promise(r2 => setTimeout(r2, 3000));
      } finally { clearTimeout(to); }
    }
    epIndex = (epIndex + maxTries) % ENDPOINTS.length; // na próxima tentativa, começa por outros servidores
    lastErr = errs.join(' · ');
    throw new Error('overpass');
  }
  function areaQuery(c, r) {
    const at = `${r},${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    return `[out:json][timeout:20];(way(around:${at})["highway"~"${HW_RE_AREA}"];node(around:${at})["highway"="speed_camera"];node(around:${at})["traffic_calming"~"^(bump|hump|table|cushion|yes|rumble_strip|choker)$"];);out tags geom;`;
  }
  // Consulta rápida só da via onde estou (raio 60 m): responde em ~1 s e mostra o limite enquanto a área grande carrega
  let quickBusy = false, quickStart = 0, lastQuick = 0, quickFails = 0;
  async function quickLookup(pos) {
    // Nunca em paralelo com o download da área: dois pedidos ao mesmo tempo do mesmo celular
    // são o que faz o servidor responder "HTTP 429" (pedidos demais).
    if (quickBusy || fetching) return;
    const wait = Math.min(6000 * Math.pow(2, quickFails), 120000);   // 6 s, 12 s, 24 s… até 2 min
    if (Date.now() - lastQuick < wait) return;
    quickBusy = true; quickStart = Date.now(); lastQuick = Date.now();
    try {
      const q = `[out:json][timeout:8];way(around:60,${pos.lat.toFixed(5)},${pos.lon.toFixed(5)})["highway"~"${HW_RE}"];out tags geom;`;
      const els = await overpass(q, { timeoutMs: 9000, maxTries: 2 });
      quickFails = 0;
      const a = Object.assign({ k: 'q', lat: pos.lat, lon: pos.lon, r: 60, t: Date.now() }, compact(els));
      if (!area || area.k === 'q') { area = a; if (!mapStatus.startsWith('serviço')) mapStatus = 'via consultada · carregando mapa da área…'; }
      updateLimit(pos); render();
    } catch (e) {
      quickFails++;
      if (!area) { mapStatus = 'serviço de mapas indisponível — ' + lastErr; render(); }
    } finally { quickBusy = false; }
  }
  async function fetchArea(c, r, onStatus) {
    const els = await overpass(areaQuery(c, r), { timeoutMs: 25000, maxTries: ENDPOINTS.length, onStatus, mustHaveWays: true });
    const a = Object.assign({ k: 'a:' + [c.lat.toFixed(4), c.lon.toFixed(4), r, Date.now()].join(','), lat: c.lat, lon: c.lon, r, t: Date.now() }, compact(els));
    await cachePut(a);
    return a;
  }
  // Cão de guarda: se uma consulta ficar presa (celular dormiu, rede sumiu no meio), libera a trava
  // para o app tentar de novo em vez de ficar em "carregando mapa…" para sempre.
  function watchdog() {
    const now = Date.now();
    if (fetching && now - fetchStart > 90000) { fetching = false; lastFetchFail = now; mapStatus = 'mapa demorou demais — tentando de novo'; render(); }
    if (quickBusy && now - quickStart > 35000) quickBusy = false;
    if (checkingCache && now - fetchStart > 20000) checkingCache = false;
  }

  // Cache de áreas (IndexedDB; cai para memória se não houver)
  async function cacheLoadIndex() { areaIdx = (await DB.all('meta')).map(x => x.v).sort((a, b) => b.t - a.t); }
  async function cacheFind(pos, { force = false } = {}) {
    const now = Date.now();
    for (const c of areaIdx) {
      if (!force && now - c.t > AREA.maxAge) continue;
      if (haversine(pos, c) < c.r - AREA.margin) {
        const a = await DB.get('areas', c.k);
        // Área guardada sem nenhuma via (vinda de um servidor sem cobertura) não serve: apaga e segue
        if (a && a.ways && !a.ways.length) { await DB.del('areas', c.k); await DB.del('meta', c.k); areaIdx = areaIdx.filter(x => x.k !== c.k); continue; }
        if (a && a.ways) return Object.assign(a, c);
      }
    }
    return null;
  }
  async function cachePut(a) {
    while (areaIdx.length >= AREA.maxCached) { const old = areaIdx.pop(); await DB.del('areas', old.k); await DB.del('meta', old.k); }
    const meta = { k: a.k, lat: a.lat, lon: a.lon, r: a.r, t: a.t };
    await DB.put('areas', a.k, { ways: a.ways, nodes: a.nodes });
    await DB.put('meta', a.k, meta);
    areaIdx.unshift(meta);
  }
  async function cacheDropCovering(pos) {
    for (const c of areaIdx.slice()) if (haversine(pos, c) < c.r) { await DB.del('areas', c.k); await DB.del('meta', c.k); }
    areaIdx = areaIdx.filter(c => haversine(pos, c) >= c.r);
  }

  function setArea(a, from) {
    if (area && area !== a) prevArea = area;
    area = a;
    mapStatus = from === 'cache' ? 'mapa em cache' : from === 'cache-old' ? 'mapa em cache (antigo)' : 'mapa atualizado';
  }

  async function ensureArea(pos, { force = false } = {}) {
    const now = Date.now();
    const covered = area && haversine(pos, area) < area.r - AREA.margin;
    if (covered && !force) return;
    if (!force) {
      if (checkingCache) return;
      checkingCache = true;
      try { const c = await cacheFind(pos); if (c && (!area || c.k !== area.k)) { setArea(c, 'cache'); render(); return; } }
      finally { checkingCache = false; }
    }
    if (fetching || quickBusy) return;
    const wait = Math.min(8000 * Math.pow(2, areaFails), 180000);   // 8 s, 16 s, 32 s… até 3 min entre tentativas
    if (!force && now - lastFetchFail < wait) return;
    fetching = true; fetchStart = now;
    // Centro um pouco à frente do carro, para cobrir mais do caminho que vem
    const r = S.speedKmh > 70 ? AREA.rFast : AREA.rCity;
    const c = (S.heading != null && S.speedKmh > 15) ? destination(pos, S.heading, r * 0.35) : { lat: pos.lat, lon: pos.lon };
    const onStatus = txt => { if (!area || area.k === 'q') { mapStatus = 'carregando mapa… ' + txt; render(); } };
    try {
      if (!area) { mapStatus = 'carregando mapa…'; render(); }
      if (force) await cacheDropCovering(pos);
      const a = await fetchArea(c, r, onStatus);
      areaFails = 0;
      setArea(a, 'net'); render();
    } catch (e) {
      lastFetchFail = Date.now(); areaFails++;
      if (!area || area.k === 'q') {
        const old = await cacheFind(pos, { force: true });
        if (old) setArea(old, 'cache-old');
        else mapStatus = 'mapa da área indisponível — ' + (lastErr || 'tentando de novo');
      } else mapStatus = 'sem internet — usando mapa em cache';
      render();
    } finally { fetching = false; }
  }

  // Download antecipado: 7 áreas (centro + 6 em volta) cobrindo ~4 km de raio
  let downloading = false;
  async function downloadAround(center, label) {
    if (downloading) return;
    downloading = true;
    const r = AREA.rDownload, step = r * 1.6;
    const centers = [center]; for (let b = 0; b < 360; b += 60) centers.push(destination(center, b, step));
    let ok = 0;
    for (let i = 0; i < centers.length; i++) {
      el.dlStatus.textContent = `Baixando ${label}: área ${i + 1} de ${centers.length}…`;
      const c = centers[i];
      const have = areaIdx.find(a => haversine(c, a) < 200 && a.r >= r && Date.now() - a.t < AREA.maxAge);
      if (have) { ok++; continue; }
      try { await fetchArea(c, r); ok++; } catch (e) { el.dlStatus.textContent = `Falhou na área ${i + 1}: ${lastErr}`; }
      await new Promise(r2 => setTimeout(r2, 1500));
    }
    el.dlStatus.textContent = `${label}: ${ok} de ${centers.length} áreas guardadas no celular (valem por 14 dias).`;
    downloading = false; renderMapInfo();
  }

  // ---------- Radares oficiais (arquivo radares-sp.json) ----------
  let radarGrid = null, radarCount = 0;
  const gkey = (lat, lon) => Math.floor(lat / 0.01) + ',' + Math.floor(lon / 0.01);
  async function loadRadars() {
    try {
      const r = await fetch('./radares-sp.json'); if (!r.ok) return;
      const j = await r.json();
      radarGrid = new Map();
      for (const [lat, lon, m, kind, dir] of j.radares) {
        const k = gkey(lat, lon); if (!radarGrid.has(k)) radarGrid.set(k, []);
        radarGrid.get(k).push({ i: 'r' + lat + ',' + lon, k: kind === 1 ? 'red' : kind === 2 ? 'sec' : 'cam', lat, lon, m: m || null, dir: dir >= 0 ? dir : null, off: true });
      }
      radarCount = j.radares.length;
    } catch (e) {}
  }
  function radarsNear(pos) {
    if (!radarGrid) return [];
    const out = [], la = Math.floor(pos.lat / 0.01), lo = Math.floor(pos.lon / 0.01);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = radarGrid.get((la + a) + ',' + (lo + b)); if (l) out.push(...l); }
    return out;
  }

  // ---------- Limites por horário (maxspeed:conditional) ----------
  const DAYS = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
  function conditionalLimit(expr, now = new Date()) {
    if (!expr) return null;
    const dow = (now.getDay() + 6) % 7, mins = now.getHours() * 60 + now.getMinutes();
    for (const part of String(expr).split(';')) {
      const m = part.match(/^\s*([\d.]+)\s*(?:mph)?\s*@\s*\(?\s*([^)]*)\)?\s*$/i);
      if (!m) continue;
      const lim = parseMaxspeed(m[1]); const cond = m[2].trim();
      if (!lim || !cond) continue;
      // dias: "Mo-Fr", "Sa,Su", "Mo"; horários: "07:00-19:00", "06:00-08:00,16:00-19:00"
      const dayTok = cond.match(/\b(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?)*/);
      let dayOk = true;
      if (dayTok) {
        dayOk = false;
        for (const rng of dayTok[0].split(',')) {
          const [a, b] = rng.split('-'); const da = DAYS[a], db = DAYS[b || a];
          if (da <= db ? (dow >= da && dow <= db) : (dow >= da || dow <= db)) dayOk = true;
        }
      }
      if (!dayOk) continue;
      const times = Array.from(cond.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g));
      if (!times.length) { if (/\b(wet|rain|snow|school|PH)\b/i.test(cond)) continue; return lim; }
      for (const t of times) {
        const a = +t[1] * 60 + +t[2], b = +t[3] * 60 + +t[4];
        if (a <= b ? (mins >= a && mins <= b) : (mins >= a || mins <= b)) return lim;
      }
    }
    return null;
  }

  // ---------- Correções de limite por via (ficam salvas) ----------
  let fixes = {};
  function loadFixes() { try { fixes = JSON.parse(localStorage.getItem('velocimetro-fix') || '{}'); } catch (e) { fixes = {}; } }
  function saveFixes() { try { localStorage.setItem('velocimetro-fix', JSON.stringify(fixes)); } catch (e) {} }

  // Limite de uma via para quem passa nela num certo sentido (diff = ângulo entre meu rumo e o desenho da via)
  function wayLimit(w, diff) {
    if (fixes[w.i]) return { limit: fixes[w.i], source: 'fixed', cond: false };
    const cl = conditionalLimit(w.c);
    if (cl) return { limit: cl, source: 'osm', cond: true };
    let ms = w.m;
    if (diff != null) ms = (diff < 90 ? (w.f ?? w.m) : (w.b ?? w.m));
    if (!ms) ms = w.m || w.f || w.b;
    if (ms) return { limit: ms, source: 'osm', cond: false };
    if (DEFAULTS[w.h]) return { limit: DEFAULTS[w.h], source: 'estimated', cond: false };
    return { limit: null, source: 'none', cond: false };
  }

  // ---------- Qual via estou? (distância + rumo) ----------
  function matchWay(pos) {
    const lists = [area, prevArea].filter(Boolean);
    let best = null, bestScore = Infinity, bestDiff = null, bestD = Infinity, bestSeg = -1, bestT = 0;
    const H = S.heading;
    for (const a of lists) for (const w of a.ways) {
      const g = w.g;
      for (let i = 1; i < g.length; i++) {
        const A = P(g[i - 1]), B = P(g[i]);
        const pr = projSegment(pos, A, B);
        if (pr.d > 70) continue;
        let score = pr.d, diff = null;
        if (H != null) {
          diff = angleDiff(H, bearing(A, B));               // 0..180 em relação ao sentido do desenho da via
          const und = Math.min(diff, 180 - diff);          // 0..90 ignorando sentido
          score += und * 0.6;                              // paralela errada custa até 54 m
          if (w.o === 1 && diff > 120) score += 80;        // mão única no contrafluxo: quase certo que não é essa
          if (w.o === -1 && diff < 60) score += 80;
        }
        if (w.i === S.autoWayId) score -= 10;              // histerese: não trocar de via por pouco
        if (score < bestScore) { bestScore = score; best = w; bestDiff = diff; bestD = pr.d; bestSeg = i; bestT = pr.t; }
      }
    }
    return best ? { w: best, diff: bestDiff, d: bestD, seg: bestSeg, t: bestT } : null;
  }

  let lastMatch = null;
  function updateLimit(pos) {
    if (!pos) return;
    const m = matchWay(pos);
    lastMatch = m;
    if (!m) {
      if (area) { S.autoRoad = 'Nenhuma via próxima'; S.autoLimit = null; S.autoSource = 'none'; S.autoWayId = null; S.autoCond = false; }
      return;
    }
    const w = m.w;
    S.autoWayId = w.i;
    S.autoRoad = w.n || HW_NAMES[w.h] || 'Via sem nome';
    const L = wayLimit(w, m.diff);
    S.autoLimit = L.limit; S.autoSource = L.source; S.autoCond = L.cond;
  }

  // ---------- O limite vai mudar à frente? ----------
  let aheadInfo = null;
  const aheadAnnounced = new Map();
  function lookAhead(pos) {
    aheadInfo = null;
    if (!S.aheadOn || !lastMatch || lastMatch.diff == null || S.speedKmh < 10) return;
    const lists = [area, prevArea].filter(Boolean);
    const all = []; for (const a of lists) all.push(...a.ways);
    let w = lastMatch.w, diff = lastMatch.diff;
    const cur = wayLimit(w, diff).limit; if (cur == null) return;
    let fwd = diff < 90, g = w.g;
    // distância do ponto projetado até o fim da via no sentido em que ando
    let dist = 0;
    if (fwd) { const pr = projSegment(pos, P(g[lastMatch.seg - 1]), P(g[lastMatch.seg])); dist += pr.len * (1 - pr.t); for (let i = lastMatch.seg + 1; i < g.length; i++) dist += haversine(P(g[i - 1]), P(g[i])); }
    else { const pr = projSegment(pos, P(g[lastMatch.seg - 1]), P(g[lastMatch.seg])); dist += pr.len * pr.t; for (let i = lastMatch.seg - 1; i >= 1; i--) dist += haversine(P(g[i - 1]), P(g[i])); }
    const seen = new Set([w.i]);
    for (let hop = 0; hop < 5 && dist < 900; hop++) {
      const end = fwd ? P(g[g.length - 1]) : P(g[0]);
      const endBrg = fwd ? bearing(P(g[g.length - 2]), end) : bearing(P(g[1]), P(g[0]));
      let next = null, nextFwd = true, nextScore = Infinity;
      for (const c of all) {
        if (seen.has(c.i)) continue;
        const cg = c.g;
        const atStart = haversine(end, P(cg[0])) < 3, atEnd = haversine(end, P(cg[cg.length - 1])) < 3;
        if (!atStart && !atEnd) continue;
        const f = atStart; // entro pelo começo → ando no sentido do desenho
        if (c.o === 1 && !f) continue; if (c.o === -1 && f) continue;
        const b = f ? bearing(P(cg[0]), P(cg[1])) : bearing(P(cg[cg.length - 1]), P(cg[cg.length - 2]));
        const turn = angleDiff(endBrg, b); if (turn > 50) continue;
        const score = turn + (c.n === w.n ? -20 : 0);
        if (score < nextScore) { nextScore = score; next = c; nextFwd = f; }
      }
      if (!next) return;
      const nl = wayLimit(next, nextFwd ? 0 : 180).limit;
      if (nl != null && nl !== cur) {
        aheadInfo = { limit: nl, dist, name: next.n || '', lower: nl < cur, key: w.i + '>' + next.i };
        if (nl < cur && dist <= 260 && !aheadAnnounced.has(aheadInfo.key)) {
          aheadAnnounced.set(aheadInfo.key, Date.now());
          beep(660, 0.12, 0.7);
          say(`Limite muda para ${nl} em ${Math.round(dist / 50) * 50} metros`);
        }
        return;
      }
      seen.add(next.i);
      for (let i = 1; i < next.g.length; i++) dist += haversine(P(next.g[i - 1]), P(next.g[i]));
      w = next; g = next.g; fwd = nextFwd;
    }
    const now = Date.now(); for (const [k, t] of aheadAnnounced) if (now - t > 120000) aheadAnnounced.delete(k);
  }

  // ---------- Radares e lombadas à frente ----------
  const announced = new Map(); // id → quando avisou
  let hazard = null;
  function checkHazards(pos) {
    hazard = null;
    if (!S.radarOn || S.heading == null || S.speedKmh < 8) return;
    const cands = radarsNear(pos);
    const lists = [area, prevArea].filter(Boolean);
    for (const a of lists) for (const n of a.nodes) {
      // radar do OSM que já está na base oficial (a menos de 40 m) não conta duas vezes
      if (n.k === 'cam' && cands.some(c => haversine(c, n) < 40)) continue;
      cands.push(n);
    }
    let best = null;
    for (const n of cands) {
      const d = haversine(pos, n); if (d > 500 || d < 8) continue;
      const diff = angleDiff(S.heading, bearing(pos, n)); if (diff > 45) continue;      // tem que estar à frente
      if (d * Math.sin(toRad(diff)) > 35) continue;                                    // e no meu caminho, não numa rua ao lado
      if (n.dir != null && angleDiff(S.heading, n.dir) > 75) continue;                 // radar que fiscaliza o outro sentido
      if (!best || d < best.d) best = { n, d };
    }
    if (!best) return;
    hazard = best;
    const now = Date.now();
    for (const [k, t] of announced) if (now - t > 90000) announced.delete(k);
    if (best.d <= 320 && !announced.has(best.n.i)) {
      announced.set(best.n.i, now);
      chime();
      const n = best.n, dtxt = `${Math.round(best.d / 10) * 10} metros`;
      if (n.k === 'calm') say('Lombada à frente');
      else if (n.k === 'red') say(`Radar de avanço de sinal a ${dtxt}`);
      else say(`Radar a ${dtxt}` + (n.m ? `, limite ${n.m}` : ''));
    }
  }

  // ---------- Viagem (estatísticas, trajeto, histórico) ----------
  const T = { dist: 0, movingMs: 0, max: 0, overCount: 0, overMs: 0, start: Date.now(), last: Date.now(), overSince: null };
  let track = [];            // [[t, lat, lon, kmh, limit, over]]
  let trackDirty = false, lastTrackPt = null;
  let history = [];          // [{start, end, dist, movingMs, max, overCount, overMs}]
  function loadTrip() {
    try { Object.assign(T, JSON.parse(localStorage.getItem('velocimetro-trip') || '{}')); } catch (e) {}
    try { history = JSON.parse(localStorage.getItem('velocimetro-trips') || '[]'); } catch (e) { history = []; }
    T.overSince = null;
    // Parado há mais de 2 h com viagem relevante: guarda como anterior e começa outra
    if (T.last && Date.now() - T.last > 2 * 3600e3 && T.dist > 300) archiveTrip();
  }
  function saveTrip() { T.last = Date.now(); try { localStorage.setItem('velocimetro-trip', JSON.stringify({ dist: T.dist, movingMs: T.movingMs, max: T.max, overCount: T.overCount, overMs: T.overMs, start: T.start, last: T.last })); } catch (e) {} if (trackDirty) { trackDirty = false; DB.put('tracks', T.start, track); } }
  function archiveTrip() {
    if (T.dist > 100) {
      history.unshift({ start: T.start, end: T.last || Date.now(), dist: T.dist, movingMs: T.movingMs, max: T.max, overCount: T.overCount, overMs: T.overMs });
      while (history.length > 40) { const old = history.pop(); DB.del('tracks', old.start); }
      try { localStorage.setItem('velocimetro-trips', JSON.stringify(history)); } catch (e) {}
      if (track.length) DB.put('tracks', T.start, track);
    } else DB.del('tracks', T.start);
    T.dist = 0; T.movingMs = 0; T.max = 0; T.overCount = 0; T.overMs = 0; T.start = Date.now(); T.overSince = S.state === 'danger' ? Date.now() : null;
    track = []; lastTrackPt = null; trackDirty = false; saveTrip();
  }
  function tripUpdate(prev, pos, kmh) {
    if (!prev || prev.acc > 40 || pos.acc > 40) return;
    const dt = pos.t - prev.t; if (dt <= 0 || dt > 10000) return;
    if (kmh > 3) { T.dist += haversine(prev, pos); T.movingMs += dt; }
    if (kmh > T.max && pos.acc <= 25) T.max = kmh;
  }
  function recordPoint(pos, kmh, limit, over) {
    if (pos.acc > 35) return;
    if (lastTrackPt && haversine(lastTrackPt, pos) < 20 && pos.t - lastTrackPt.t < 5000 && !over) return;
    if (kmh < 3 && lastTrackPt && pos.t - lastTrackPt.t < 60000) return;
    track.push([Math.round(pos.t), +pos.lat.toFixed(5), +pos.lon.toFixed(5), Math.round(kmh), limit ?? 0, over ? 1 : 0]);
    if (track.length > 30000) track.splice(0, 5000);
    lastTrackPt = pos; trackDirty = true;
  }
  const fmtMin = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m}<small>min</small>` : `${Math.floor(m / 60)}<small>h</small>${String(m % 60).padStart(2, '0')}<small>min</small>`; };
  const fmtKm = m => (m / 1000).toFixed(1).replace('.', ',');
  const fmtWhen = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  function renderTrip() {
    const overMs = T.overMs + (T.overSince ? Date.now() - T.overSince : 0);
    const avg = T.movingMs > 0 ? T.dist / (T.movingMs / 1000) * 3.6 : 0;
    el.stDist.innerHTML = `${fmtKm(T.dist)}<small>km</small>`;
    el.stTime.innerHTML = fmtMin(T.movingMs);
    el.stAvg.innerHTML = `${Math.round(avg)}<small>km/h</small>`;
    el.stMax.innerHTML = `${Math.round(T.max)}<small>km/h</small>`;
    el.stOver.innerHTML = `${T.overCount}<small>×</small>`;
    el.stOverTime.innerHTML = fmtMin(overMs);
    el.stSince.textContent = 'Desde ' + fmtWhen(T.start);
    el.tripMini.textContent = `máx ${Math.round(T.max)} · ${fmtKm(T.dist)} km`;
    el.trips.innerHTML = '';
    for (const h of history.slice(0, 20)) {
      const d = document.createElement('div'); d.className = 'trip';
      d.innerHTML = `<div class="sum"><div>${fmtKm(h.dist)} km · ${Math.round(h.movingMs / 60000)} min · máx ${Math.round(h.max)} · ${h.overCount}× acima</div><div class="when">${fmtWhen(h.start)}</div></div>`;
      const bm = document.createElement('button'); bm.textContent = '🗺️'; bm.addEventListener('click', () => openMap(h.start, `Viagem de ${fmtWhen(h.start)}`));
      const bg = document.createElement('button'); bg.textContent = 'GPX'; bg.addEventListener('click', () => exportTrip(h.start, 'gpx'));
      const bc = document.createElement('button'); bc.textContent = 'CSV'; bc.addEventListener('click', () => exportTrip(h.start, 'csv'));
      d.append(bm, bg, bc); el.trips.appendChild(d);
    }
    el.tripsHint.textContent = history.length ? 'Uma viagem termina sozinha depois de 2 h parado, ou em "Encerrar e zerar".' : 'Nenhuma viagem anterior ainda. Uma viagem termina sozinha depois de 2 h parado, ou em "Encerrar e zerar".';
  }
  setInterval(saveTrip, 30000);

  // Exportar GPX / CSV
  async function getTrack(start) { return start === T.start ? track : ((await DB.get('tracks', start)) || []); }
  function download(name, mime, text) {
    try {
      const blob = new Blob([text], { type: mime }); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    } catch (e) { alert('Não consegui gerar o arquivo neste navegador.'); }
  }
  async function exportTrip(start, fmt) {
    const pts = await getTrack(start);
    if (!pts.length) { alert('Esta viagem não tem trajeto gravado.'); return; }
    const stamp = new Date(start).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (fmt === 'csv') {
      const lines = ['data_hora,lat,lon,velocidade_kmh,limite_kmh,acima_do_limite'];
      for (const p of pts) lines.push(`${new Date(p[0]).toISOString()},${p[1]},${p[2]},${p[3]},${p[4] || ''},${p[5]}`);
      download(`viagem-${stamp}.csv`, 'text/csv', lines.join('\n'));
    } else {
      const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      let x = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Velocímetro Alerta" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc('Viagem ' + fmtWhen(start))}</name><trkseg>\n`;
      for (const p of pts) x += `<trkpt lat="${p[1]}" lon="${p[2]}"><time>${new Date(p[0]).toISOString()}</time><extensions><speed>${p[3]}</speed><limit>${p[4] || ''}</limit><over>${p[5]}</over></extensions></trkpt>\n`;
      x += '</trkseg></trk>\n</gpx>\n';
      download(`viagem-${stamp}.gpx`, 'application/gpx+xml', x);
    }
  }

  // Mapa da viagem (Leaflet carregado só quando abre)
  let leafletReady = null, map = null, mapLayer = null;
  function loadLeaflet() {
    if (leafletReady) return leafletReady;
    leafletReady = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = res; s.onerror = () => { leafletReady = null; rej(new Error('leaflet')); }; document.head.appendChild(s);
    });
    return leafletReady;
  }
  async function openMap(start, title) {
    const pts = await getTrack(start);
    if (!pts.length) { alert('Esta viagem não tem trajeto gravado.'); return; }
    el.mapTitle.textContent = title; el.mapView.hidden = false;
    try { await loadLeaflet(); } catch (e) { el.mapView.hidden = true; alert('Sem internet para carregar o mapa.'); return; }
    if (!map) {
      map = L.map('map', { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    }
    if (mapLayer) mapLayer.remove();
    mapLayer = L.layerGroup().addTo(map);
    const line = pts.map(p => [p[1], p[2]]);
    L.polyline(line, { color: '#2b7de9', weight: 5, opacity: .9 }).addTo(mapLayer);
    // trechos acima do limite em vermelho
    let run = [];
    const flush = () => { if (run.length > 1) L.polyline(run, { color: '#e5322d', weight: 7, opacity: .95 }).addTo(mapLayer); run = []; };
    for (const p of pts) { if (p[5]) run.push([p[1], p[2]]); else flush(); } flush();
    for (const p of pts) if (p[5]) L.circleMarker([p[1], p[2]], { radius: 4, color: '#e5322d', fillColor: '#e5322d', fillOpacity: .9, weight: 1 }).bindPopup(`${p[3]} km/h (limite ${p[4] || '?'}) — ${new Date(p[0]).toLocaleTimeString('pt-BR')}`).addTo(mapLayer);
    L.circleMarker(line[0], { radius: 7, color: '#fff', fillColor: '#2ecc71', fillOpacity: 1 }).bindPopup('Início').addTo(mapLayer);
    L.circleMarker(line[line.length - 1], { radius: 7, color: '#fff', fillColor: '#f5c518', fillOpacity: 1 }).bindPopup('Fim').addTo(mapLayer);
    setTimeout(() => { map.invalidateSize(); map.fitBounds(L.latLngBounds(line), { padding: [24, 24] }); }, 60);
  }
  el.btnMapClose.addEventListener('click', () => { el.mapView.hidden = true; });

  // ---------- Render ----------
  function effectiveLimit() {
    if (S.autoWayId == null && S.manualLimit != null) return { limit: S.manualLimit, source: 'manual', cond: false };
    return { limit: S.autoLimit, source: S.autoSource, cond: S.autoCond };
  }
  function render() {
    const { limit, source, cond } = effectiveLimit();
    el.speed.textContent = Math.round(S.speedKmh);
    el.roadName.textContent = S.autoRoad || (area ? 'Procurando via…' : 'Carregando mapa…');

    el.sign.classList.toggle('estimated', source === 'estimated');
    el.sign.classList.toggle('manual', source === 'manual');
    el.sign.classList.toggle('fixed', source === 'fixed');
    el.sign.classList.toggle('conditional', !!cond);
    el.sign.classList.toggle('unknown', limit == null);
    el.sign.textContent = limit == null ? '—' : limit;
    el.btnAuto.hidden = !(source === 'manual' || source === 'fixed');

    const srcTxt = source === 'manual' ? 'limite definido por você'
      : source === 'fixed' ? 'limite corrigido por você (fica salvo para esta via)'
      : source === 'osm' ? (cond ? 'limite por horário (OpenStreetMap)' : 'limite oficial (OpenStreetMap)')
      : source === 'estimated' ? 'sem placa no mapa — estimado pelo tipo da via'
      : area ? 'sem dado de limite para esta via' : '';
    el.roadMeta.textContent = [srcTxt, mapStatus].filter(Boolean).join(' · ');

    // Aviso de voz quando o limite da via muda
    if (source !== 'manual' && limit != null && limit !== S.lastAnnouncedLimit && S.lastPos && !S.stale) {
      if (S.lastAnnouncedLimit != null) say(`Limite ${limit}`);
      S.lastAnnouncedLimit = limit;
    }

    let state = 'ok', msg = '';
    const tol = toleranceFor(limit);
    if (S.stale) { msg = 'GPS sem atualização — procurando sinal…'; }
    else if (limit != null) {
      const alertAt = limit + tol, warnAt = alertAt - S.warnMargin;
      if (S.speedKmh > alertAt) { state = 'danger'; msg = `ACIMA DO LIMITE: +${Math.round(S.speedKmh - limit)} km/h`; }
      else if (S.speedKmh >= warnAt) { state = 'warn'; msg = tol ? `Atenção: perto do limite (alerta a ${alertAt})` : 'Atenção: perto do limite'; }
      else msg = tol ? `Dentro do limite (${limit}, alerta a ${alertAt} km/h)` : `Dentro do limite (${limit} km/h)`;
    } else {
      msg = S.lastPos ? 'Sem limite conhecido para esta via' : 'Aguardando sinal do GPS…';
    }
    if (muted() && state !== 'ok') msg += ' · silenciado';
    el.status.textContent = msg;
    if (state !== S.state) {
      S.state = state;
      document.body.classList.toggle('state-warn', state === 'warn');
      document.body.classList.toggle('state-danger', state === 'danger');
      if (state === 'danger') { startAlarm(); T.overCount++; T.overSince = Date.now(); say('Acima do limite'); }
      else { stopAlarm(); if (T.overSince) { T.overMs += Date.now() - T.overSince; T.overSince = null; } }
      if (state === 'warn') { beep(880, 0.15, 0.9); setTimeout(() => beep(880, 0.15, 0.9), 200); }
    }

    // Radar / lombada
    if (hazard) {
      const n = hazard.n;
      el.banner.hidden = false;
      el.bannerIcon.textContent = n.k === 'calm' ? '⚠️' : n.k === 'red' ? '🚦' : '📷';
      el.bannerText.textContent = n.k === 'calm' ? 'Lombada' : n.k === 'red' ? 'Radar de sinal' : n.k === 'sec' ? ('Radar de trecho' + (n.m ? ` · ${n.m} km/h` : '')) : ('Radar' + (n.m ? ` · ${n.m} km/h` : ''));
      el.bannerDist.textContent = `${Math.round(hazard.d / 10) * 10} m`;
      el.banner.classList.toggle('hot', n.k !== 'calm' && n.m != null && S.speedKmh > n.m + toleranceFor(n.m));
    } else el.banner.hidden = true;

    // Limite muda à frente
    if (aheadInfo) {
      el.ahead.hidden = false;
      el.aheadSign.textContent = aheadInfo.limit;
      el.aheadText.textContent = aheadInfo.lower ? 'Limite cai à frente' : 'Limite sobe à frente';
      el.aheadDist.textContent = `${Math.round(aheadInfo.dist / 10) * 10} m`;
    } else el.ahead.hidden = true;

    document.body.classList.toggle('stale', S.stale);
    renderMute();
  }
  function renderMute() {
    const m = muted();
    if (m) { el.btnSound.textContent = String(Math.ceil((S.muteUntil - Date.now()) / 1000)); el.btnSound.classList.add('muted'); }
    else { el.btnSound.textContent = S.soundOn ? '🔔' : '🔕'; el.btnSound.classList.remove('muted'); }
    el.btnSound.classList.toggle('off', !S.soundOn && !m);
  }

  // ---------- GPS ----------
  function onPosition(p) {
    const c = p.coords;
    const pos = { lat: c.latitude, lon: c.longitude, t: p.timestamp || Date.now(), acc: c.accuracy || 999 };
    const prev = S.lastPos;
    S.lastFix = Date.now(); S.stale = false;

    // Velocidade: usa a do chip de GPS; se não vier, calcula pela distância. Leituras ruins não mexem na velocidade.
    let kmh = null;
    if (c.speed != null && !isNaN(c.speed) && c.speed >= 0) kmh = c.speed * 3.6;
    else if (prev) { const dt = (pos.t - prev.t) / 1000; if (dt > 0.5) kmh = haversine(prev, pos) / dt * 3.6; }
    if (kmh != null && pos.acc <= 35) {
      if (kmh < 3) kmh = 0;
      S.speedKmh = (S.speedKmh === 0 && kmh > 0) ? kmh : S.speedKmh * 0.45 + kmh * 0.55;   // média móvel suave
      if (S.speedKmh < 1) S.speedKmh = 0;
      tripUpdate(prev, pos, kmh);
    }

    // Rumo: do chip quando andando; senão, pela última posição
    if (c.heading != null && !isNaN(c.heading) && kmh != null && kmh > 7) S.heading = c.heading;
    else if (prev && pos.acc <= 35 && haversine(prev, pos) > 10 && S.speedKmh > 5) S.heading = bearing(prev, pos);

    S.lastPos = pos;
    el.gpsDot.className = 'dot ' + (pos.acc <= 25 ? 'on' : pos.acc <= 60 ? '' : 'bad');
    el.gpsText.textContent = pos.acc <= 25 ? 'GPS bom' : pos.acc <= 60 ? 'GPS regular' : 'GPS fraco';
    el.accText.textContent = `±${Math.round(pos.acc)} m`;

    ensureArea(pos);
    if (!area || (area.k === 'q' && haversine(pos, area) > 45)) quickLookup(pos);
    updateLimit(pos);
    lookAhead(pos);
    checkHazards(pos);
    render();
    const { limit } = effectiveLimit();
    recordPoint(pos, S.speedKmh, limit, S.state === 'danger');
    el.lnkOsm.href = `https://www.openstreetmap.org/edit#map=19/${pos.lat.toFixed(5)}/${pos.lon.toFixed(5)}`;
  }
  function onError(e) {
    el.gpsDot.className = 'dot bad';
    el.gpsText.textContent = e.code === 1 ? 'Localização negada' : 'Sem sinal de GPS';
    if (e.code === 1) { el.gateErr.hidden = false; el.gateErr.textContent = 'Permissão de localização negada. Libere nas configurações do navegador e recarregue.'; el.gate.hidden = false; }
  }
  // Relógio de 1 s: sinal parado, contagem do silêncio, escurecer à noite
  let lastNightCheck = 0;
  setInterval(() => {
    watchdog();
    if (S.lastFix && !S.stale && Date.now() - S.lastFix > 6000) { S.stale = true; render(); }
    if (T.overSince) renderTrip();
    if (S.muteUntil) { renderMute(); if (!muted()) { S.muteUntil = 0; if (S.state === 'danger') { stopAlarm(); startAlarm(); } render(); } }
    if (Date.now() - lastNightCheck > 60000) { lastNightCheck = Date.now(); applyDim(); }
  }, 1000);

  function start() {
    if (!('geolocation' in navigator)) { el.gateErr.hidden = false; el.gateErr.textContent = 'Este navegador não oferece geolocalização.'; return; }
    if (!window.isSecureContext) { el.gateErr.hidden = false; el.gateErr.textContent = 'Abra esta página por HTTPS para o GPS funcionar.'; }
    unlockAudio(); primeVoice(); keepAwake();
    el.gate.hidden = true;
    navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  }

  // ---------- Painéis ----------
  function openSheet(sh) { el.scrim.hidden = false; sh.classList.add('open'); if (sh === el.sheetStats) renderTrip(); if (sh === el.sheetSettings) { renderMapInfo(); renderFixInfo(); renderPlaces(); } }
  function closeSheets() { el.scrim.hidden = true; el.sheetSettings.classList.remove('open'); el.sheetStats.classList.remove('open'); }
  function renderMapInfo() {
    const n = areaIdx.length;
    el.mapInfo.textContent = (area ? `Área atual: ${area.ways.length} vias, ${area.nodes.length} radares/lombadas do OSM, raio ${area.r} m. ` : 'Nenhuma área carregada ainda. ') + `${n} área${n === 1 ? '' : 's'} guardada${n === 1 ? '' : 's'} no celular. Radares oficiais carregados: ${radarCount}.` + (lastErr ? ` Último erro do mapa: ${lastErr}` : '');
  }
  function renderFixInfo() { const n = Object.keys(fixes).length; el.fixInfo.textContent = n ? `${n} via${n === 1 ? '' : 's'} com limite corrigido por você.` : 'Use − e + na tela principal: a correção fica salva para a via em que você está.'; }
  function renderPlaces() {
    el.btnDlHome.hidden = !S.places.casa; el.btnDlWork.hidden = !S.places.trabalho;
    el.btnSaveHome.textContent = S.places.casa ? '📍 Casa salva (tocar para trocar)' : '📍 Salvar aqui como Casa';
    el.btnSaveWork.textContent = S.places.trabalho ? '📍 Trabalho salvo (tocar para trocar)' : '📍 Salvar aqui como Trabalho';
    if (S.lastPos) { const st = sunTimes(S.lastPos.lat, S.lastPos.lon); if (st) el.nightInfo.textContent = `Hoje: nasce ${st.rise.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}, põe ${st.set.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`; }
  }
  el.btnSettings.addEventListener('click', () => openSheet(el.sheetSettings));
  el.btnStats.addEventListener('click', () => openSheet(el.sheetStats));
  el.btnCloseSettings.addEventListener('click', closeSheets);
  el.btnCloseStats.addEventListener('click', closeSheets);
  el.scrim.addEventListener('click', closeSheets);
  el.btnResetTrip.addEventListener('click', () => { if (confirm('Encerrar a viagem atual e começar outra?')) { archiveTrip(); renderTrip(); } });
  el.btnMapCur.addEventListener('click', () => openMap(T.start, 'Viagem atual'));
  el.btnGpxCur.addEventListener('click', () => exportTrip(T.start, 'gpx'));
  el.btnCsvCur.addEventListener('click', () => exportTrip(T.start, 'csv'));
  el.btnRefreshMap.addEventListener('click', () => { if (S.lastPos) { areaFails = 0; quickFails = 0; lastFetchFail = 0; ensureArea(S.lastPos, { force: true }); closeSheets(); } });
  el.btnClearFixes.addEventListener('click', () => { if (confirm('Apagar todas as suas correções de limite?')) { fixes = {}; saveFixes(); renderFixInfo(); if (S.lastPos) updateLimit(S.lastPos); render(); } });
  el.btnDlHere.addEventListener('click', () => { if (S.lastPos) downloadAround(S.lastPos, 'aqui'); else el.dlStatus.textContent = 'Ainda sem posição do GPS.'; });
  el.btnSaveHome.addEventListener('click', () => { if (S.lastPos) { S.places.casa = { lat: S.lastPos.lat, lon: S.lastPos.lon }; savePrefs(); renderPlaces(); } });
  el.btnSaveWork.addEventListener('click', () => { if (S.lastPos) { S.places.trabalho = { lat: S.lastPos.lat, lon: S.lastPos.lon }; savePrefs(); renderPlaces(); } });
  el.btnDlHome.addEventListener('click', () => S.places.casa && downloadAround(S.places.casa, 'Casa'));
  el.btnDlWork.addEventListener('click', () => S.places.trabalho && downloadAround(S.places.trabalho, 'Trabalho'));

  // ---------- Controles ----------
  el.btnStart.addEventListener('click', start);
  function adjust(delta) {
    const l = effectiveLimit().limit ?? 50;
    const nl = Math.max(10, Math.min(130, l + delta));
    if (S.autoWayId != null) { fixes[S.autoWayId] = nl; saveFixes(); updateLimit(S.lastPos); }
    else S.manualLimit = nl;
    S.lastAnnouncedLimit = nl; // não anunciar por voz a cada toque
    render();
  }
  el.btnMinus.addEventListener('click', () => adjust(-10));
  el.btnPlus.addEventListener('click', () => adjust(10));
  el.btnAuto.addEventListener('click', () => { if (S.autoWayId != null) { delete fixes[S.autoWayId]; saveFixes(); updateLimit(S.lastPos); } S.manualLimit = null; render(); });
  // 🔔: toque = silencia 1 min; segurar = liga/desliga o som
  let holdTimer = null, held = false;
  el.btnSound.addEventListener('pointerdown', () => { held = false; holdTimer = setTimeout(() => { held = true; toggleSound(); }, 600); });
  const endHold = () => { clearTimeout(holdTimer); };
  el.btnSound.addEventListener('contextmenu', e => e.preventDefault());
  el.btnSound.addEventListener('pointerup', endHold); el.btnSound.addEventListener('pointercancel', endHold); el.btnSound.addEventListener('pointerleave', endHold);
  el.btnSound.addEventListener('click', () => {
    if (held) { held = false; return; }
    if (muted()) S.muteUntil = 0; else { S.muteUntil = Date.now() + 60000; stopAlarm(); try { speechSynthesis.cancel(); } catch (e) {} }
    if (!muted() && S.state === 'danger') startAlarm();
    render();
  });
  function toggleSound() { S.soundOn = !S.soundOn; savePrefs(); renderPrefs(); if (!S.soundOn) stopAlarm(); else if (S.state === 'danger') startAlarm(); try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} }
  el.btnSoundOn.addEventListener('click', toggleSound);
  const toggleVoice = () => { S.voiceOn = !S.voiceOn; savePrefs(); renderPrefs(); if (S.voiceOn) say('Avisos por voz ligados'); else { try { speechSynthesis.cancel(); } catch (e) {} } };
  el.btnVoice.addEventListener('click', toggleVoice);
  el.btnVoice2.addEventListener('click', toggleVoice);
  el.btnTest.addEventListener('click', () => { unlockAudio(); S.muteUntil = 0; playAlert(); setTimeout(playAlert, (SOUNDS[S.soundType] || SOUNDS.sirene).every); });
  // No modo escuro, um toque na tela mostra tudo por alguns segundos
  let peekTimer = null;
  document.getElementById('app').addEventListener('pointerdown', () => {
    if (!S.dim) return;
    document.body.classList.add('peek'); clearTimeout(peekTimer);
    peekTimer = setTimeout(() => document.body.classList.remove('peek'), 4000);
  });
  // HUD
  function setHud(on) { S.hud = on; document.body.classList.toggle('hud', on); el.btnHudExit.hidden = !on; if (on) closeSheets(); }
  el.btnHud.addEventListener('click', () => setHud(true));
  el.btnHudExit.addEventListener('click', () => setHud(false));

  // ---------- Preferências (ficam salvas no celular) ----------
  function applyDim() {
    S.dim = S.dimMode === 'on' || (S.dimMode === 'night' && isNight(S.lastPos));
    document.body.classList.toggle('dim', S.dim);
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('velocimetro-prefs') || '{}');
      if (SOUNDS[p.soundType]) S.soundType = p.soundType;
      if (['off', 'on', 'night'].includes(p.dimMode)) S.dimMode = p.dimMode; else if (p.dim) S.dimMode = 'on';
      if (p.soundOn != null) S.soundOn = !!p.soundOn;
      if (p.voiceOn != null) S.voiceOn = !!p.voiceOn;
      if (p.radarOn != null) S.radarOn = !!p.radarOn;
      if (p.aheadOn != null) S.aheadOn = !!p.aheadOn;
      if (['none', 'br', 'k5', 'p10'].includes(p.tolMode)) S.tolMode = p.tolMode;
      if ([3, 5, 10].includes(p.warnMargin)) S.warnMargin = p.warnMargin;
      if (p.places && typeof p.places === 'object') S.places = p.places;
    } catch (e) {}
  }
  function savePrefs() { try { localStorage.setItem('velocimetro-prefs', JSON.stringify({ soundType: S.soundType, dimMode: S.dimMode, soundOn: S.soundOn, voiceOn: S.voiceOn, radarOn: S.radarOn, aheadOn: S.aheadOn, tolMode: S.tolMode, warnMargin: S.warnMargin, places: S.places })); } catch (e) {} }
  function renderPrefs() {
    el.sndBtns.forEach(b => b.classList.toggle('on', b.dataset.sound === S.soundType));
    el.tolBtns.forEach(b => b.classList.toggle('on', b.dataset.tol === S.tolMode));
    el.warnBtns.forEach(b => b.classList.toggle('on', +b.dataset.warn === S.warnMargin));
    el.dimBtns.forEach(b => b.classList.toggle('on', b.dataset.dim === S.dimMode));
    el.btnRadar.classList.toggle('on', S.radarOn);
    el.btnRadar.textContent = S.radarOn ? '📷 Radares e lombadas: ligado' : '📷 Avisar radares e lombadas';
    el.btnAhead.classList.toggle('on', S.aheadOn);
    el.btnAhead.textContent = S.aheadOn ? '⬇️ Aviso de limite à frente: ligado' : '⬇️ Avisar quando o limite vai cair';
    el.btnVoice2.classList.toggle('on', S.voiceOn);
    el.btnVoice2.textContent = S.voiceOn ? '🗣️ Avisos por voz: ligado' : '🗣️ Avisos por voz';
    el.btnSoundOn.classList.toggle('on', S.soundOn);
    el.btnSoundOn.textContent = S.soundOn ? '🔔 Som do alerta: ligado' : '🔕 Som do alerta: desligado';
    el.btnVoice.classList.toggle('off', !S.voiceOn);
    renderMute();
    applyDim();
    if (!S.radarOn) { hazard = null; el.banner.hidden = true; }
    if (!S.aheadOn) { aheadInfo = null; el.ahead.hidden = true; }
  }
  el.sndBtns.forEach(b => b.addEventListener('click', () => {
    S.soundType = b.dataset.sound; savePrefs(); renderPrefs();
    unlockAudio(); playAlert();
    if (beepTimer) { stopAlarm(); startAlarm(); }
  }));
  el.tolBtns.forEach(b => b.addEventListener('click', () => { S.tolMode = b.dataset.tol; savePrefs(); renderPrefs(); render(); }));
  el.warnBtns.forEach(b => b.addEventListener('click', () => { S.warnMargin = +b.dataset.warn; savePrefs(); renderPrefs(); render(); }));
  el.dimBtns.forEach(b => b.addEventListener('click', () => { S.dimMode = b.dataset.dim; savePrefs(); renderPrefs(); }));
  el.btnRadar.addEventListener('click', () => { S.radarOn = !S.radarOn; savePrefs(); renderPrefs(); });
  el.btnAhead.addEventListener('click', () => { S.aheadOn = !S.aheadOn; savePrefs(); renderPrefs(); });
  loadPrefs(); loadFixes(); renderPrefs(); loadTrip(); renderTrip();

  // ---------- Instalar como app (PWA) ----------
  let installEvt = null;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!standalone) el.btnInstall.hidden = false; });
  el.btnInstall.addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; el.btnInstall.hidden = true; });
  if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    el.installHint.hidden = false;
    el.installHint.textContent = 'Para instalar no iPhone: toque em Compartilhar (quadrado com seta) e depois em "Adicionar à Tela de Início". Abre em tela cheia, como um app.';
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && el.gate.hidden === false) location.reload(); hadController = true; });
    });
  }

  // ---------- Início ----------
  (async () => { await DB.open(); await cacheLoadIndex(); await loadRadars(); if (S.lastPos) ensureArea(S.lastPos); render(); })();
  render();
})();
