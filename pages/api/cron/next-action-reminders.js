// pages/api/cron/next-action-reminders.js — Vercel Cron
// כשמגיע תאריך "הפעולה הבאה" שפעיל קבע לעצמו על איש קשר — שולח לו תזכורת:
//   1) רושם שורת notifications (מופיעה בפעמון, cross-device, עם read-state)
//   2) שולח push (web-push + FCM)
// Dedup דרך client_id ייחודי (כולל את התאריך) — אם הפעיל ישנה תאריך, תֵצֵא תזכורת חדשה.
// אין צורך בשינוי סכמה: משתמשים בטבלת notifications הקיימת.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireCronAuth } from '../../../lib/security/external-data.mjs';
import { enqueueServiceNotificationEvent } from '../../../lib/security/notification-delivery.mjs';

// "היום" + השעה לפי שעון ישראל (UTC+3).
function israelNow() {
  const il = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return { date: il.toISOString().slice(0, 10), hour: il.getUTCHours() };
}

export default async function handler(req, res) {
  try {
    requireCronAuth(req);
  } catch (error) {
    return res.status(error?.status ?? 401).json({ error: { code: error?.code ?? 'CRON_AUTH_DENIED', message: error?.publicMessage ?? 'Machine authentication is invalid' } });
  }

  const { date: today, hour } = israelNow();
  // שעות שקטות — שולחים 08:00–21:59 שעון ישראל בלבד.
  if (hour < 8 || hour >= 22) return res.status(200).json({ sent: 0, skipped: 'quiet_hours' });

  const supabase = getSupabaseAdmin();

  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id')
    .eq('is_active', true)
    .not('next_action', 'is', null)
    .not('next_action_date', 'is', null)
    .lte('next_action_date', today);

  if (error) return res.status(500).json({ error: error.message });
  if (!contacts?.length) return res.status(200).json({ sent: 0, processed: 0 });

  let sent = 0;
  let processed = 0;

  for (const c of contacts) {
    try {
      const delivery = await enqueueServiceNotificationEvent(supabase, {
        eventType: 'next_action_due', resourceId: c.id,
      });
      if (delivery.queued > 0) processed++;
      sent += delivery.sent;
    } catch {
      console.error('next-action notification delivery failed');
    }
  }

  return res.status(200).json({ sent, processed });
}
