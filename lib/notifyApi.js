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

// The event is intentionally opaque: the server derives recipients and generic content from
// the persisted interaction. Display amounts are never accepted by the strict route schema.
export function notifyInteractionApi(apiFetch, { interactionId, kind }) {
  return post(apiFetch, '/api/interactions/notify', { interactionId, kind });
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
