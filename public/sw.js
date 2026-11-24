// Lanterne — service worker : l'appli s'ouvre même sans réseau, les données restent fraîches
const VERSION = 'lanterne-v3';
const SHELL = ['/', '/styles.css', '/app.js', '/lib.js', '/core.js', '/views-agenda.js', '/views-form.js', '/views-other.js', '/views-territoire.js', '/views-guide.js', '/splash.js',
  '/manifest.webmanifest', '/icons/lanterne.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/ics/')) return;
  // Les « workers » (calcul de la carte) se chargent sans passer par le cache
  if (req.destination === 'worker' || req.destination === 'sharedworker' || url.pathname.includes('-worker')) return;

  // Données : réseau d'abord, copie de secours hors ligne
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/version' || !['/api/events', '/api/config', '/api/associations', '/api/tourisme'].some((p) => url.pathname.startsWith(p))) return;
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: 'Hors ligne.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  // Pages : réseau d'abord (mises à jour instantanées), sinon l'appli en cache
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // Polices, images, bibliothèques : cache d'abord (elles ne changent pas)
  if (/^\/(vendor|img|icons)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Code de l'appli : réseau d'abord, pour des mises à jour instantanées
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req)));
});
