// pages/api/cron/next-action-reminders.js — Vercel Cron
// כשמגיע תאריך "הפעולה הבאה" שפעיל קבע לעצמו על איש קשר — שולח לו תזכורת:
//   1) רושם שורת notifications (מופיעה בפעמון, cross-device, עם read-state)
//   2) שולח push (web-push + FCM)
// Dedup דרך client_id ייחודי (כולל את התאריך) — אם הפעיל ישנה תאריך, תֵצֵא תזכורת חדשה.
// אין צורך בשינוי סכמה: משתמשים בטבלת notifications הקיימת.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';
import { sendWebPushToActivist } from '../../../lib/webPushSend';
import { requireCronAuth } from '../../../lib/security/external-data.mjs';

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
    .select('id, name, activist_id, next_action, next_action_date')
    .eq('is_active', true)
    .not('next_action', 'is', null)
    .not('next_action_date', 'is', null)
    .lte('next_action_date', today);

  if (error) return res.status(500).json({ error: error.message });
  if (!contacts?.length) return res.status(200).json({ sent: 0, processed: 0 });

  let sent = 0;
  let processed = 0;

  for (const c of contacts) {
    const targetId = String(c.activist_id);
    const clientId = `next_action__${c.id}__${c.next_action_date}`;
    const title = '📌 תזכורת: פעולה הבאה';
    const body = `${c.next_action} — ${c.name}`;
    const url = `/contact/${c.id}`;

    // Dedup + פעמון: ננסה לרשום שורת notifications. אם כבר קיימת (אותו contact+תאריך) —
    // ignoreDuplicates מחזיר ריק ⇒ כבר התרענו, מדלגים בלי לשלוח push שוב.
    const { data: inserted, error: insErr } = await supabase
      .from('notifications')
      .upsert(
        { recipient_id: targetId, type: 'next_action', title, body, url, priority: 'normal', client_id: clientId },
        { onConflict: 'client_id', ignoreDuplicates: true }
      )
      .select('id');

    if (insErr) { console.error('next-action notif insert:', insErr.message); continue; }
    if (!inserted?.length) continue; // כבר נשלח לתאריך הזה

    processed++;

    // web-push לכל מכשירי הפעיל (מנוי מת נמחק נקודתית בתוך ה-helper)
    const web = await sendWebPushToActivist(supabase, targetId, { title, body, url });
    sent += web.sent;

    // FCM (אפליקציית Capacitor) — no-op אם לא מוגדר
    const fcm = await sendFcmToActivist(supabase, targetId, { title, body, url });
    sent += fcm.sent || 0;
  }

  return res.status(200).json({ sent, processed });
}
