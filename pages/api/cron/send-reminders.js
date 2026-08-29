// pages/api/cron/send-reminders.js — Vercel Cron: runs every minute.
// 1) קובע תזכורות למפגשי היום בצד השרת (ensureRemindersForDate) — בלי תלות בפתיחת דף.
// 2) שולח את התזכורות שהגיע זמנן (web-push לכל המכשירים + FCM לאפליקציה).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';
import { sendWebPushToActivist } from '../../../lib/webPushSend';
import { ensureRemindersForDate, israelToday } from '../../../lib/meetingReminderScheduler';
import { requireCronAuth } from '../../../lib/security/external-data.mjs';

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
    .select('*')
    .eq('sent', false)
    .lte('remind_at', new Date().toISOString());

  if (error) return res.status(500).json({ error: error.message });
  if (!reminders?.length) return res.status(200).json({ sent: 0, scheduled });

  let sent = 0;

  for (const reminder of reminders) {
    const targetId = reminder.type === 'coordinator'
      ? reminder.coordinator_id
      : reminder.activist_id;

    const msg = MESSAGES[reminder.type];
    const payload = { ...msg, url: '/base-meetings' };

    // שורת פעמון בנוסף ל-Push: Push שנדחה/נמחק מהמסך לא משאיר שום זכר באפליקציה,
    // ואז תזכורת שהוחמצה נעלמת. client_id דטרמיניסטי — הרצה חוזרת לא מכפילה.
    const { error: bellErr } = await supabase.from('notifications').upsert({
      recipient_id: String(targetId),
      client_id: `reminder__${reminder.id}`,
      type: reminder.type === 'coordinator' ? 'missing_report' : 'base_report_reminder',
      title: msg.title,
      body: msg.body,
      url: '/base-meetings',
      priority: 'high',
    }, { onConflict: 'client_id' });
    if (bellErr) console.error('send-reminders bell upsert failed:', bellErr.message);

    const web = await sendWebPushToActivist(supabase, targetId, payload);
    sent += web.sent;

    // FCM נייטיב לאפליקציה (no-op אם לא מוגדר FCM_SERVICE_ACCOUNT)
    const fcm = await sendFcmToActivist(supabase, targetId, payload);
    sent += fcm.sent || 0;

    await supabase
      .from('meeting_reminders')
      .update({ sent: true })
      .eq('id', reminder.id);
  }

  return res.status(200).json({ sent, scheduled });
}
