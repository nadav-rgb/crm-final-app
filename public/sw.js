// public/sw.js — Service Worker: receives push notifications and shows them

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || 'מקרבים', {
      body: data.body || '',
      icon: '/favicon.ico',
      dir: 'rtl',
      lang: 'he',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: data.urgent || false,
      data: { url: data.url || '/base-meetings' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/base-meetings';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
