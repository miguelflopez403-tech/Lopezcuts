// Lopezcuts owner app: shows booking notifications on this phone.
// Lives at the site root so it can cover /owner (the page has no trailing slash).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Lopezcuts', {
    body: m.body || '',
    tag: m.tag || undefined,
    icon: '/assets/img/icon-512.png',
    badge: '/assets/img/favicon-64.png',
    data: { url: new URL(m.url || '/owner', self.location.origin).href },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(self.registration.scope)) { await w.focus(); try { await w.navigate(url); } catch { } return; }
    await self.clients.openWindow(url);
  })());
});
