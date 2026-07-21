// lib/pushClient.js — client-side push notification registration
import { authHeader } from './apiAuth';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// מצב ההתראות במכשיר הנוכחי — לדף ההתראות (חיווי + כפתור הפעלה).
// permission: 'granted' | 'denied' | 'default'
// subscribed:      יש מנוי push בדפדפן הזה (מצב מקומי)
// serverRegistered: השרת מכיר את המנוי הזה ויכול לשלוח אליו בפועל (מצב אמיתי)
// שני אלה יכולים להיות שונים! מנוי מקומי שלא נשמר בשרת = "נראה פעיל" אבל לא מקבל כלום.
export async function getPushStatus() {
  if (typeof window === 'undefined') return { supported: false, isIOS: false, standalone: false };
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return { supported: false, isIOS, standalone };

  let subscribed = false;
  let serverRegistered = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    subscribed = Boolean(sub);

    if (sub) {
      // אימות מול השרת — זו הבדיקה שבאמת קובעת אם התראות יגיעו למכשיר הזה.
      const res = await fetch('/api/push/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      if (res.ok) serverRegistered = Boolean((await res.json()).registered);
    }
  } catch { /* כשל רשת — serverRegistered נשאר false, והמשתמש יתבקש להפעיל מחדש */ }

  return { supported: true, permission: Notification.permission, subscribed, serverRegistered, isIOS, standalone };
}

export async function registerPushSubscription(activistId) {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    });

    // חובה לבדוק את התשובה: אם השמירה בשרת נכשלה, לדפדפן עדיין יש מנוי תקין מקומית
    // (getSubscription יחזיר אותו) — ואז המשתמש רואה "התראות פעילות" בזמן שהשרת בכלל
    // לא יודע על המכשיר ולא ישלח אליו כלום. בדיוק זה קרה לטלפון ב-2026-07-21.
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ activistId: String(activistId), subscription: sub.toJSON() }),
    });
    if (!res.ok) {
      console.error('Push subscription not saved on server:', res.status, await res.text().catch(() => ''));
      return null;
    }

    return sub;
  } catch (err) {
    console.error('Push registration failed:', err);
    return null;
  }
}
