// pages/api/cron/send-reminders.js — Vercel Cron: runs every minute, sends due push notifications
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';
import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_MAILTO,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const MESSAGES = {
  activist_1: {
    title: '📋 נא למלא דיווח על המפגש',
    body: 'המפגש הסתיים — מלא את הדיווח הקצר כדי לשמור על הרצף',
  },
  activist_2: {
    title: '⏰ תזכורת: דיווח ממתין',
    body: 'עדיין לא מילאת את הדיווח על המפגש. לחץ למילוי',
  },
  activist_3: {
    title: '⚠️ תזכורת אחרונה — דיווח דחוף',
    body: 'זו התזכורת האחרונה. עד 12:00 יש למלא את הדיווח',
  },
  coordinator: {
    title: '🚨 פעיל לא מילא דיווח',
    body: 'פעיל לא הגיש דיווח עד 12:00. נדרשת התערבות ישירה',
    urgent: true,
  },
};

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const supabase = getSupabaseAdmin();

  const { data: reminders, error } = await supabase
    .from('meeting_reminders')
    .select('*')
    .eq('sent', false)
    .lte('remind_at', new Date().toISOString());

  if (error) return res.status(500).json({ error: error.message });
  if (!reminders?.length) return res.status(200).json({ sent: 0 });

  let sent = 0;

  for (const reminder of reminders) {
    const targetId = reminder.type === 'coordinator'
      ? reminder.coordinator_id
      : reminder.activist_id;

    const msg = MESSAGES[reminder.type];

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('activist_id', targetId);

    if (subs?.length) {
      for (const { subscription } of subs) {
        try {
          await webpush.sendNotification(
            subscription,
            JSON.stringify({ ...msg, url: '/base-meetings' })
          );
          sent++;
        } catch (e) {
          // Subscription expired — remove it
          if (e.statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('activist_id', targetId);
          }
        }
      }
    }

    // FCM נייטיב לאפליקציה (no-op אם לא מוגדר FCM_SERVICE_ACCOUNT)
    const fcm = await sendFcmToActivist(supabase, targetId, { ...msg, url: '/base-meetings' });
    sent += fcm.sent || 0;

    await supabase
      .from('meeting_reminders')
      .update({ sent: true })
      .eq('id', reminder.id);
  }

  return res.status(200).json({ sent });
}
