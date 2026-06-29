const CACHE = 'bfc-v3';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/']))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co') || e.request.url.includes('firebaseio.com')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', e => {
  let payload = { title: 'Brain Fight Club', body: 'Новое уведомление' };
  try { payload = { ...payload, ...e.data.json() }; } catch(_) {}

  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body:  payload.body,
      icon:  '/icon-192.svg',
      badge: '/icon-192.svg',
      tag:   payload.tag || 'bfc-push',
      data:  { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const win = list.find(c => c.url.includes(self.location.origin));
      return win ? win.focus() : self.clients.openWindow(url);
    })
  );
});
