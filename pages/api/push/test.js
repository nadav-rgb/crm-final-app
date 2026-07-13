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

  return res.status(200).json({
    sent: web.sent + (fcm.sent || 0),
    web: web.sent,
    fcm: fcm.sent || 0,
    devices: web.devices,
  });
}
