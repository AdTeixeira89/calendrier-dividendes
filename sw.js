/* Service worker — hors-ligne + rappels de versement */
importScripts('payouts.js');

const SHELL = 'dividendes-shell-v1';
const DATA = 'dividendes-data';
const FILES = ['./', 'index.html', 'app.js', 'payouts.js', 'manifest.json', 'logo.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (toujours la dernière version du code), cache en secours hors-ligne.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});

// Vérification en arrière-plan (Android / Chrome, app installée) — au mieux.
async function checkAndNotify() {
  const cache = await caches.open(DATA);
  const res = await cache.match('state.json');
  if (!res) return;
  const state = await res.json();
  if (!state.settings || !state.settings.notify) return;
  const plans = Payouts.notificationPlan(state, new Date());
  for (const p of plans) {
    await self.registration.showNotification(p.title, {
      body: p.body, tag: p.tag, icon: 'icon-192.png', badge: 'icon-192.png'
    });
    Payouts.markSent(state, p);
  }
  if (plans.length) await cache.put('state.json', new Response(JSON.stringify(state)));
}
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'payday-check') e.waitUntil(checkAndNotify());
});
