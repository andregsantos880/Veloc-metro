// Service worker: deixa o app abrir sem internet e atualiza sozinho quando há versão nova.
const VERSION = 'velocimetro-v3';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' && req.method !== 'POST') return;
  const url = new URL(req.url);

  // Consultas de mapa (Overpass) vão sempre direto para a rede; o app guarda o resultado por conta própria.
  if (url.pathname.includes('/interpreter') || url.hostname.includes('overpass')) return;
  if (req.method !== 'GET') return;

  if (url.origin === location.origin) {
    // Arquivos do app: tenta a rede (para pegar atualização) e cai no cache se estiver offline.
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Fontes: usa o cache e atualiza por trás.
    e.respondWith(
      caches.open(VERSION).then(async c => {
        const cached = await c.match(req);
        const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || net;
      })
    );
  }
});
