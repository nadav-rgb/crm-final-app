// lib/nativePush.js — רישום FCM נייטיב באפליקציית Capacitor בלבד.
// בדפדפן זה no-op (שם פועל ה-web-push דרך lib/pushClient.js).
import { Capacitor } from '@capacitor/core';
import { authHeader } from './apiAuth';

let initialized = false;

export async function initNativePush(activistId) {
  if (typeof window === 'undefined') return;
  if (!Capacitor?.isNativePlatform?.()) return;
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
      return;
    }

    await PushNotifications.register();
  } catch (e) {
    initialized = false;
    console.error('initNativePush failed:', e);
  }
}
