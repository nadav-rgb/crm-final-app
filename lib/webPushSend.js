// lib/webPushSend.js — שליחת Web Push לכל מכשירי הפעיל (server-side בלבד).
// מרכז את הלוגיקה שהייתה משוכפלת ב-api/push/send וב-2 ה-crons:
// - שולח לכל המכשירים הרשומים של הפעיל (תמיכה בריבוי מכשירים).
// - מנוי מת (410/404) נמחק נקודתית לפי endpoint — לא כל מכשירי המשתמש.
// - מסיר את _meta (פרטי מכשיר לדיבוג) לפני השליחה בפועל.
import webpush from 'web-push';
import { toPushPayload } from './security/push-payload.mjs';

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  vapidConfigured = true;
}

// מחזיר { sent, devices } — devices = כמה מכשירים רשומים היו לפני הניקוי.
export async function sendWebPushToUser(supabase, userId, { priority } = {}) {
  ensureVapid();

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId);
  if (error || !subs?.length) return { sent: 0, devices: 0 };

  const payload = JSON.stringify(toPushPayload({ priority }));
  let sent = 0;

  for (const { subscription } of subs) {
    const { _meta, ...sub } = subscription || {};
    if (!sub.endpoint) continue;
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        await supabase.from('push_subscriptions')
          .delete()
          .eq('subscription->>endpoint', sub.endpoint);
      }
    }
  }

  return { sent, devices: subs.length };
}
