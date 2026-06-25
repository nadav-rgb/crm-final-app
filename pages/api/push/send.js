// pages/api/push/send.js — שולח Web Push מיידי לפעיל בודד.
// משמש בעת שיבוץ פעיל לבית מפגש. מנצל את אותה תשתית של ה-cron הקיים
// (web-push + VAPID + טבלת push_subscriptions). מאומת coord/head/ceo.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_MAILTO,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { activistId, title, body, url } = req.body || {};
  if (!activistId || !title || !body) {
    return res.status(400).json({ error: 'Missing activistId/title/body' });
  }

  const supabase = getSupabaseAdmin();
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('activist_id', String(activistId));

  if (error) return res.status(500).json({ error: error.message });

  // הפעיל עדיין לא נרשם להתראות (לא נכנס לאפליקציה / לא אישר) — no-op בטוח.
  if (!subs?.length) return res.status(200).json({ sent: 0, reason: 'no_subscription' });

  let sent = 0;
  const payload = JSON.stringify({ title, body, url: url || '/' });
  for (const { subscription } of subs) {
    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('activist_id', String(activistId));
      }
    }
  }

  return res.status(200).json({ sent });
}
