// pages/api/base-meetings/notify.js — התראת "דיווח מפגש בסיס הוגש", בצד השרת (service role → עוקף RLS).
// למה בשרת: שליחת Push אמיתי (טלפון/מחשב) חייבת admin key + VAPID/FCM secrets — לא זמינים בדפדפן.
// עד היום lib/notificationDemo.js כתב רק שורת notifications (פעמון באפליקציה) מהדפדפן — בלי Push בפועל,
// ולכן רכז שלא היה פתוח על המערכת באותו רגע לא קיבל שום התראה בפועל לטלפון/מחשב.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile?.activist_code) return res.status(403).json({ error: 'No profile' });

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
  const recipients = await getProjectManagers(supabase, projectId, { excludeCode: reporterCode });

  const reporterName = auth.profile.name || report.activist_name || 'פעיל';
  const baseBody = `${reporterName} מילא דיווח עבור בית מפגש ${report.meeting_place_number}, מפגש ${report.meeting_number}.`;

  const notified = await notifyRecipients(supabase, recipients, {
    title: 'דיווח מפגש בסיס הוגש',
    body: report.ai_summary ? `${baseBody}\n\nסיכום:\n${report.ai_summary}` : baseBody,
    url: report.house_id ? `/meeting-houses/${report.house_id}` : '/base-meetings',
    type: 'base_meeting_submitted',
    priority: 'normal',
    clientId: (code) => `base_meeting_report__${report.id}__${code}`,
  });

  return res.status(200).json({ notified });
}
