// lib/nativePush.js — רישום FCM נייטיב באפליקציית Capacitor בלבד.
// בדפדפן זה no-op (שם פועל ה-web-push דרך lib/pushClient.js).
import { Capacitor } from '@capacitor/core';
import Router from 'next/router';

let initialized = false;
// דגל נפרד ממש בכוונה: initialized מתאפס כשההרשאה נדחית (וגם ע"י enableNativePush),
// ואז initNativePush רץ שוב ומוסיף מאזינים נוספים. למאזין הניווט זה אומר שתי קפיצות
// על לחיצה אחת. הדגל הזה מבטיח שהוא נרשם פעם אחת לכל חיי הדף.
let navListenerAttached = false;

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

export async function initNativePush(apiFetch) {
  if (!isNativeApp()) return;
  if (typeof apiFetch !== 'function') return;
  if (initialized) return;
  initialized = true;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // שולחים את ה-token לשרת לאחסון בטבלת fcm_tokens.
    await PushNotifications.addListener('registration', async (token) => {
      try {
        await apiFetch('/api/push/register-fcm', {
          method: 'POST',
          body: {
            token: token.value,
            platform: 'android',
          },
        });
      } catch (e) {
        console.error('register-fcm failed:', e);
      }
    });

    await PushNotifications.addListener('registrationError', (e) => {
      console.error('FCM registration error:', e);
    });

    // לחיצה על Push גנרי → מרכז ההתראות; פרטי המשאב נטענים רק אחרי אימות.
    // בלי המאזין הזה הלחיצה רק מביאה את ה-WebView לחזית, והמשתמש נוחת במסך הבית —
    // גם כשהכתובת המדויקת (/contact/12, /meeting-houses/3) כבר נשלחה מהשרת.
    // קפסיטור שומר את האירוע עד שנרשם מאזין (notifyListeners עם retainUntilConsumed),
    // ולכן גם פתיחה מאפליקציה סגורה לגמרי מגיעה לכאן — אחרי שה-WebView והראוטר עלו.
    if (!navListenerAttached) {
      navListenerAttached = true;
      await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const value = notification?.data?.url;
        if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return;
        const target = new URL(value, window.location.origin);
        if (target.origin !== window.location.origin) return;
        const url = `${target.pathname}${target.search}${target.hash}`;
        Router.push(url).catch(() => window.location.assign(url));
      });
    }

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
export async function enableNativePush(apiFetch) {
  initialized = false;
  return initNativePush(apiFetch);
}
