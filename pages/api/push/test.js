// pages/api/push/test.js — התראת ניסיון לעצמי. כל משתמש מחובר יכול לבדוק
// שההתראות באמת מגיעות למכשירים שלו (כפתור "שלח התראת ניסיון" בדף ההתראות).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';
import { sendWebPushToActivist } from '../../../lib/webPushSend';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile?.activist_code) return res.status(403).json({ error: 'No profile' });

  const activistId = String(auth.profile.activist_code);
  const supabase = getSupabaseAdmin();
  const payload = {
    title: '🔔 בדיקת התראות',
    body: 'ההתראות עובדות במכשיר הזה 👍',
    url: '/notifications',
  };

  const web = await sendWebPushToActivist(supabase, activistId, payload);
  const fcm = await sendFcmToActivist(supabase, activistId, payload);

  // כמה טוקנים של אפליקציה רשומים — כדי להבחין בין "אין מכשיר רשום" לבין
  // "יש מכשיר אבל השליחה נכשלה". בלי זה שני המצבים נראים זהים ("לא קיבלתי כלום").
  const { data: fcmRows } = await supabase
    .from('fcm_tokens').select('token').eq('activist_id', String(auth.profile.activist_code));

  // fcm.reason נזרק עד היום לפח — הוא בדיוק מה שמסביר למה האפליקציה לא מקבלת
  // ('fcm_not_configured' = חסר FCM_SERVICE_ACCOUNT בשרת; 'no_tokens' = אין מכשיר רשום).
  return res.status(200).json({
    sent: web.sent + (fcm.sent || 0),
    web: web.sent,
    fcm: fcm.sent || 0,
    devices: web.devices,
    webDevices: web.devices || 0,
    appDevices: (fcmRows || []).length,
    fcmReason: fcm.reason || null,
  });
}
