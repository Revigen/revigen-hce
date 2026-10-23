/* Service worker mínimo de Revigen HCE.
   - App shell en caché (íconos, manifest); index.html siempre network-first para que los deploys nuevos se vean.
   - Supabase, CDN y fuentes no pasan por acá: los datos clínicos siempre vienen de la red.
   - Fuera de alcance (pendiente): modo offline de datos. Sin red solo se ve la última versión de la app. */
const CACHE = 'revigen-shell-v1';
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate' || u.pathname === '/' || u.pathname === '/index.html') {
    e.respondWith(fetch(r)
      .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put('/', cp)); return res; })
      .catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
