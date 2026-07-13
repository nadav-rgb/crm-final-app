// pages/api/push/send.js — שולח התראה מיידית לפעיל בודד. מאומת coord/head/ceo.
// שימושים: push בעת שיבוץ לבית מפגש, והודעה יזומה מרכז/מנכ"ל (כפתור "שלח התראה").
// bell:true — כותב גם שורת notifications כך שההודעה מופיעה בפעמון בכל המכשירים,
// גם אם לפעיל אין מנוי push. (בשיבוץ לא מעבירים bell — לפעמון יש כבר התראת שיבוץ משלו.)
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';
import { sendWebPushToActivist } from '../../../lib/webPushSend';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { activistId, title, body, url, bell } = req.body || {};
  if (!activistId || !title || !body) {
    return res.status(400).json({ error: 'Missing activistId/title/body' });
  }

  const supabase = getSupabaseAdmin();

  // פעמון (cross-device, לא תלוי במנוי push) — לפי בקשה מפורשת בלבד
  if (bell) {
    const { error: bellErr } = await supabase.from('notifications').insert({
      recipient_id: String(activistId),
      client_id: `manual__${activistId}__${Date.now()}`,
      type: 'message',
      title,
      body: `${body}${auth.profile?.name ? ` (מאת: ${auth.profile.name})` : ''}`,
      url: url || null,
      priority: 'high',
    });
    if (bellErr) console.error('push/send bell insert failed:', bellErr.message);
  }

  // web-push לכל מכשירי הפעיל
  const web = await sendWebPushToActivist(supabase, String(activistId), {
    title, body, url: url || '/',
  });

  // FCM נייטיב לאפליקציית Capacitor (no-op אם FCM_SERVICE_ACCOUNT לא מוגדר)
  const fcm = await sendFcmToActivist(supabase, activistId, { title, body, url });

  return res.status(200).json({
    sent: web.sent + (fcm.sent || 0),
    web: web.sent,
    fcm: fcm.sent || 0,
    devices: web.devices,
  });
}
