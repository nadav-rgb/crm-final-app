// lib/nativePush.js — רישום FCM נייטיב באפליקציית Capacitor בלבד.
// בדפדפן זה no-op (שם פועל ה-web-push דרך lib/pushClient.js).
import { Capacitor } from '@capacitor/core';
import { authHeader } from './apiAuth';

let initialized = false;

// האם רצים באפליקציית Capacitor הנייטיבית (לא דפדפן/PWA) — נבדק גם ע"י דף ההתראות
// כדי להראות סטטוס/כפתור-הפעלה נכון, במקום ההודעה של web-push שלא רלוונטית כאן.
export function isNativeApp() {
  return typeof window !== 'undefined' && Boolean(Capacitor?.isNativePlatform?.());
}

// מצב הרשאת ההתראות הנייטיבית — לתצוגה בדף ההתראות.
export async function getNativePushPermission() {
  if (!isNativeApp()) return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    return perm.receive; // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
  } catch (e) {
    console.error('getNativePushPermission failed:', e);
    return 'denied';
  }
}

export async function initNativePush(activistId) {
  if (!isNativeApp()) return;
  if (!activistId) return;
  if (initialized) return;
  initialized = true;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // שולחים את ה-token לשרת לאחסון בטבלת fcm_tokens.
    await PushNotifications.addListener('registration', async (token) => {
      try {
        await fetch('/api/push/register-fcm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({
            activistId: String(activistId),
            token: token.value,
            platform: 'android',
          }),
        });
      } catch (e) {
        console.error('register-fcm failed:', e);
      }
    });

    await PushNotifications.addListener('registrationError', (e) => {
      console.error('FCM registration error:', e);
    });

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      initialized = false;
      return perm.receive;
    }

    await PushNotifications.register();
    return 'granted';
  } catch (e) {
    initialized = false;
    console.error('initNativePush failed:', e);
    return 'denied';
  }
}

// כפתור "הפעל התראות" בדף ההתראות — מאלץ ניסיון-הפעלה מחדש גם אם initNativePush
// כבר רץ בעבר (למשל המשתמש דחה בפעם הראשונה ועכשיו רוצה לנסות שוב).
export async function enableNativePush(activistId) {
  initialized = false;
  return initNativePush(activistId);
}
