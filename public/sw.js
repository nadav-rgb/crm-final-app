// public/sw.js — Service Worker: receives push notifications and shows them

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json?.() || {}; } catch { data = {}; }

  event.waitUntil(
    self.registration.showNotification('מקרבים', {
      body: 'יש עדכון חדש במערכת',
      // אין icon בכוונה: /favicon.ico לא קיים ב-public/, והפניה לאייקון שמחזיר 404
      // עלולה להפיל את showNotification בחלק מגרסאות אנדרואיד. ברירת המחדל של הדפדפן תקינה.
      dir: 'rtl',
      lang: 'he',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: data.urgent || false,
      data: { url: data.url || '/notifications' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target;
  try {
    target = new URL(event.notification.data?.url || '/notifications', self.location.origin);
    if (target.origin !== self.location.origin || !target.pathname.startsWith('/') || target.pathname.startsWith('//')) {
      target = new URL('/notifications', self.location.origin);
    }
  } catch {
    target = new URL('/notifications', self.location.origin);
  }
  const safeUrl = `${target.pathname}${target.search}${target.hash}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // חלון שכבר עומד על היעד — רק למקד.
      for (const client of list) {
        if (new URL(client.url).pathname === target.pathname && 'focus' in client) return client.focus();
      }
      // חלון פתוח בעמוד אחר — לנווט אותו ליעד ולמקד. קודם נפתח כאן חלון *נוסף*,
      // ואז המשתמש נשאר עם שני עותקים של האפליקציה במקום לקפוץ למקום הנכון.
      const open = list.find((c) => 'navigate' in c);
      if (open) return open.navigate(safeUrl).then((c) => (c || open).focus()).catch(() => clients.openWindow(safeUrl));
      return clients.openWindow(safeUrl);
    })
  );
});
