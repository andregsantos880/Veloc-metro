// Service worker: deixa o app abrir sem internet e atualiza sozinho quando há versão nova.
const VERSION = 'velocimetro-v9';
const TILES = 'velocimetro-tiles';   // blocos do mapa local (tiles/sp); o app apaga este cache quando o mapa é regerado
const SHELL = ['./', './index.html', './app.js', './manifest.json', './radares-sp.json', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Consultas de mapa (Overpass) e tiles do mapa da viagem vão sempre direto para a rede.
  if (url.pathname.includes('/interpreter') || url.hostname.includes('overpass') || url.hostname.endsWith('tile.openstreetmap.org')) return;

  if (url.origin === location.origin) {
    if (url.pathname.includes('/tiles/') && !url.pathname.endsWith('index.json')) {
      // Blocos do mapa local: usa o que já está no celular; senão baixa e guarda (valem até o mapa ser regerado).
      e.respondWith(
        caches.open(TILES).then(async c => {
          const cached = await c.match(req);
          if (cached) return cached;
          const res = await fetch(req);
          if (res && res.ok) c.put(req, res.clone());
          return res;
        })
      );
      return;
    }
    // Arquivos do app: tenta a rede (para pegar atualização) e cai no cache se estiver offline.
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'unpkg.com') {
    // Fontes e Leaflet: usa o cache e atualiza por trás.
    e.respondWith(
      caches.open(VERSION).then(async c => {
        const cached = await c.match(req);
        const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || net;
      })
    );
  }
});
