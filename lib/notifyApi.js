// lib/notifyApi.js — עטיפות דקות לקריאת endpoints ההתראות בצד-שרת מהדפדפן.
// כל התראה ל*משתמש אחר* חייבת לעבור כאן ולא דרך createDemoNotification: רק לשרת יש admin key
// (לעקיפת RLS) ומפתחות VAPID/FCM, ולכן רק הוא יכול באמת להגיע לטלפון/מחשב של הנמען.
// כולן fire-and-forget: כשל התראה לא אמור להפיל את הפעולה העסקית שכבר נשמרה.
import { authHeader } from './apiAuth';

async function post(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`notify ${url} failed:`, res.status);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn(`notify ${url} skipped:`, err?.message || err);
    return null;
  }
}

// kind: 'summary' (סיכום AI של דיווח קשר) | 'payment' (דיווח מזכה-תשלום).
// amount רלוונטי ל-payment בלבד, ולתצוגה בלבד.
export function notifyInteractionApi({ interactionId, kind, amount = null }) {
  return post('/api/interactions/notify', { interactionId, kind, amount });
}

// דיווח מפגש בסיס הוגש → ניהול הפרויקט.
export function notifyBaseMeetingReportApi(reportId) {
  return post('/api/base-meetings/notify', { reportId });
}
