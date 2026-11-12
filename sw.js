/* Service worker — hors-ligne + rappels de versement */
importScripts('payouts.js');

const SHELL = 'dividendes-shell-v64';
const DATA = 'dividendes-data';
const FILES = ['./', 'index.html', 'styles.css', 'config.js', 'payouts.js', 'ledger.js', 'dividends.js', 'sync.js', 'pdf.js', 'engine.js', 'market.js', 'vault.js', 'cloud.js', 'ui.js', 'notify.js', 'pages.js', 'dashboard.js', 'forms.js', 'analysis.js', 'history.js', 'check.js', 'refresh.js', 'settings.js', 'app.js', 'manifest.json', 'logo.svg', 'icon-192.png', 'icon-512.png'];

/* Installation ATOMIQUE : tous les fichiers de la version ou rien (si l'un échoue, l'ancienne version reste en place, complète). */
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Les fichiers de l'application sont servis depuis UNE SEULE version (le cache de cette version) : jamais de mélange entre fichiers de versions différentes,
   même avec un mauvais réseau. Une nouvelle version s'installe d'un bloc (sw.js change) puis remplace l'ancienne. sw.js lui-même et tout ce qui n'est pas
   dans la liste passent par le réseau. */
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || /\/sw\.js$/.test(url.pathname)) return;
  const key = url.origin + url.pathname;
  e.respondWith(
    caches.open(SHELL).then((c) => c.match(key).then((hit) => hit || (req.mode === 'navigate' ? c.match(new URL('index.html', self.registration.scope).href) : undefined)))
      .then((hit) => hit || fetch(req).catch(() => caches.match('index.html')))
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
