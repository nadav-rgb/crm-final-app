// pages/api/base-meetings/notify.js — התראת "דיווח מפגש בסיס הוגש", בצד השרת (service role → עוקף RLS).
// למה בשרת: שליחת Push אמיתי (טלפון/מחשב) חייבת admin key + VAPID/FCM secrets — לא זמינים בדפדפן.
// עד היום lib/notificationDemo.js כתב רק שורת notifications (פעמון באפליקציה) מהדפדפן — בלי Push בפועל,
// ולכן רכז שלא היה פתוח על המערכת באותו רגע לא קיבל שום התראה בפועל לטלפון/מחשב.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { sendWebPushToActivist } from '../../../lib/webPushSend';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile) return res.status(403).json({ error: 'No profile' });

  const { reportId } = req.body || {};
  if (!reportId) return res.status(400).json({ error: 'Missing reportId' });

  const supabase = getSupabaseAdmin();
  const { data: report, error: rErr } = await supabase
    .from('base_meeting_reports')
    .select('*')
    .eq('id', String(reportId))
    .single();
  if (rErr || !report) return res.status(404).json({ error: 'Report not found' });

  const reporterCode = Number(auth.profile.activist_code);
  const projectId = Number(report.project_id) || 1;

  // נמענים: מנכ"ל, או רכז/ראש/כספים החברים בפרויקט של המפגש — למעט המדווח עצמו.
  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select('activist_code, name, role, project_id, project_ids')
    .in('role', ['ceo', 'coord', 'head', 'finance'])
    .not('activist_code', 'is', null);
  if (pErr) return res.status(500).json({ error: pErr.message });

  const memberOfProject = (p) => {
    const ids = Array.isArray(p.project_ids) && p.project_ids.length
      ? p.project_ids
      : (p.project_id != null ? [p.project_id] : []);
    return ids.map(Number).includes(projectId);
  };
  const recipients = (profs || []).filter(
    (p) => Number(p.activist_code) !== reporterCode && (p.role === 'ceo' || memberOfProject(p))
  );

  if (recipients.length === 0) return res.status(200).json({ notified: [] });

  const reporterName = auth.profile.name || report.activist_name || 'פעיל';
  const title = 'דיווח מפגש בסיס הוגש';
  const baseBody = `${reporterName} מילא דיווח עבור בית מפגש ${report.meeting_place_number}, מפגש ${report.meeting_number}.`;
  const body = report.ai_summary ? `${baseBody}\n\nסיכום:\n${report.ai_summary}` : baseBody;
  const url = report.house_id ? `/meeting-houses/${report.house_id}` : '/base-meetings';

  const { error: insErr } = await supabase.from('notifications').upsert(
    recipients.map((r) => ({
      recipient_id: String(r.activist_code),
      client_id: `base_meeting_report__${report.id}__${r.activist_code}`,
      type: 'base_meeting_submitted',
      title,
      body,
      url,
      priority: 'normal',
    })),
    { onConflict: 'client_id' }
  );
  if (insErr) console.error('base-meetings notify: notifications upsert failed:', insErr.message);

  const results = [];
  await Promise.all(
    recipients.map(async (r) => {
      let push = 0;
      try {
        const [web, fcm] = await Promise.all([
          sendWebPushToActivist(supabase, String(r.activist_code), { title, body, url }),
          sendFcmToActivist(supabase, r.activist_code, { title, body, url }),
        ]);
        push = (web?.sent || 0) + (fcm?.sent || 0);
      } catch (e) { console.error('base-meetings notify: push failed for', r.activist_code, e.message); }
      results.push({ id: r.activist_code, push });
    })
  );

  return res.status(200).json({ notified: results });
}
