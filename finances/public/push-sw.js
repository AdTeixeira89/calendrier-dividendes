// Chargé par le service worker généré (workbox importScripts) : affiche les
// notifications push envoyées par les Cloud Functions et ouvre la bonne page
// au toucher. Format du message : functions/src/shared/push.ts (PushPayload).

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const scope = self.registration.scope
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Monelya', {
      body: payload.body || '',
      tag: payload.tag,
      icon: new URL('pwa-192x192.png', scope).href,
      badge: new URL('pwa-64x64.png', scope).href,
      data: { url: new URL((payload.url || '/').replace(/^\//, ''), scope).href },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          return client.navigate(url).then((c) => (c || client).focus())
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
