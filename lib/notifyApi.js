// lib/notifyApi.js — עטיפות דקות לקריאת endpoints ההתראות בצד-שרת מהדפדפן.
// כל התראה ל*משתמש אחר* חייבת לעבור כאן: השרת גוזר resource/project/recipient תחת RLS
// ומחזיק את מפתחות VAPID/FCM, ולכן הדפדפן לעולם אינו בוחר נמען או תוכן סמכותי.
// כולן fire-and-forget: כשל התראה לא אמור להפיל את הפעולה העסקית שכבר נשמרה.

async function post(apiFetch, url, payload) {
  if (typeof apiFetch !== 'function') return null;
  try {
    return await apiFetch(url, { method: 'POST', body: payload });
  } catch { return null; }
}

// kind: 'summary' (סיכום AI של דיווח קשר) | 'payment' (דיווח מזכה-תשלום).
// amount רלוונטי ל-payment בלבד, ולתצוגה בלבד.
export function notifyInteractionApi(apiFetch, { interactionId, kind, amount = null }) {
  return post(apiFetch, '/api/interactions/notify', { interactionId, kind, amount });
}

// דיווח מפגש בסיס הוגש → ניהול הפרויקט.
export function notifyBaseMeetingReportApi(apiFetch, reportId) {
  return post(apiFetch, '/api/base-meetings/notify', { reportId });
}

// עליה בסרגל המצוות → ניהול הפרויקט + הפעיל עצמו (פעמון ו-Push).
// השרת קורא את mitzvot_history מה-DB, אז יש לקרוא רק *אחרי* שהעדכון נשמר.
export function notifyMitzvotApi(apiFetch, contactId) {
  return post(apiFetch, '/api/mitzvot/notify', { contactId });
}
