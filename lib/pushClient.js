// lib/pushClient.js — client-side push notification registration
import { authHeader } from './apiAuth';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// מצב ההתראות במכשיר הנוכחי — לדף ההתראות (חיווי + כפתור הפעלה).
// permission: 'granted' | 'denied' | 'default'; subscribed: יש מנוי push פעיל בדפדפן זה.
export async function getPushStatus() {
  if (typeof window === 'undefined') return { supported: false, isIOS: false, standalone: false };
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return { supported: false, isIOS, standalone };

  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    subscribed = Boolean(sub);
  } catch { /* אין רישום — נשאר false */ }

  return { supported: true, permission: Notification.permission, subscribed, isIOS, standalone };
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

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ activistId: String(activistId), subscription: sub.toJSON() }),
    });

    return sub;
  } catch (err) {
    console.error('Push registration failed:', err);
    return null;
  }
}
