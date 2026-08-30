// pages/api/cron/send-reminders.js — Vercel Cron: runs every minute.
// 1) קובע תזכורות למפגשי היום בצד השרת (ensureRemindersForDate) — בלי תלות בפתיחת דף.
// 2) שולח את התזכורות שהגיע זמנן (web-push לכל המכשירים + FCM לאפליקציה).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { ensureRemindersForDate, israelToday } from '../../../lib/meetingReminderScheduler';
import { requireCronAuth } from '../../../lib/security/external-data.mjs';
import { enqueueServiceNotificationEvent } from '../../../lib/security/notification-delivery.mjs';

export default async function handler(req, res) {
  try {
    requireCronAuth(req);
  } catch (error) {
    return res.status(error?.status ?? 401).json({ error: { code: error?.code ?? 'CRON_AUTH_DENIED', message: error?.publicMessage ?? 'Machine authentication is invalid' } });
  }

  const supabase = getSupabaseAdmin();

  // קביעת תזכורות למפגשי היום — כשל כאן לא מפיל את שליחת התזכורות שכבר קיימות.
  // ?date=YYYY-MM-DD (מוגן באותו CRON_SECRET) — הרצה ידנית לתאריך אחר, לתפעול ודיבוג.
  const dateOverride = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
  let scheduled = 0;
  try {
    const r = await ensureRemindersForDate(supabase, dateOverride || israelToday());
    scheduled = r.scheduled || 0;
    if (r.error) console.error('ensureRemindersForDate:', r.error);
  } catch (e) {
    console.error('ensureRemindersForDate failed:', e.message);
  }

  const { data: reminders, error } = await supabase
    .from('meeting_reminders')
    .select('id,type,recipient_user_id,remind_at,sent')
    .eq('sent', false)
    .lte('remind_at', new Date().toISOString());

  if (error) return res.status(500).json({ error: error.message });
  if (!reminders?.length) return res.status(200).json({ sent: 0, scheduled });

  let sent = 0;

  for (const reminder of reminders) {
    try {
      const delivery = await enqueueServiceNotificationEvent(supabase, {
        eventType: reminder.type === 'coordinator' ? 'missing_report' : 'base_report_reminder',
        resourceId: reminder.id,
      });
      sent += delivery.sent;
      await supabase.from('meeting_reminders').update({ sent: true }).eq('id', reminder.id);
    } catch {
      console.error('meeting reminder delivery failed');
    }
  }

  return res.status(200).json({ sent, scheduled });
}
