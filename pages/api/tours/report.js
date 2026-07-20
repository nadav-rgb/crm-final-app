// pages/api/tours/report.js
// הגשת דיווח מובנה אחרי סיור. מסמן את הסיור כ"התקיים".
// מורשים: coord/head/ceo, או פעיל שקשור לסיור (משובץ / מארח / מדריך).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { sendWebPushToActivist } from '../../../lib/webPushSend';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';

const MANAGE_ROLES = ['coord', 'head', 'ceo'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile) return res.status(403).json({ error: 'No profile' });

  const { tourId, report } = req.body || {};
  if (!tourId) return res.status(400).json({ error: 'Missing tourId' });
  if (!report || typeof report !== 'object') return res.status(400).json({ error: 'Missing report' });

  const supabase = getSupabaseAdmin();
  const { data: tour, error: tErr } = await supabase.from('tours').select('*').eq('id', String(tourId)).single();
  if (tErr || !tour) return res.status(404).json({ error: 'Tour not found' });

  const code = Number(auth.profile.activist_code);
  const related = (tour.assigned_activists || []).some(a => Number(a) === code) ||
                  Number(tour.host_activist_id) === code ||
                  Number(tour.guide_activist_id) === code;
  if (!MANAGE_ROLES.includes(auth.profile.role) && !related) {
    return res.status(403).json({ error: 'לא ניתן לדווח על סיור שאינך משויך אליו' });
  }

  const { data, error } = await supabase
    .from('tours')
    .update({
      report,
      reported_by: code,
      reported_at: new Date().toISOString(),
      status: 'completed',
    })
    .eq('id', String(tourId))
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // התראת "דיווח סיור הוגש" לרכזי הפרויקט — צד-שרת עם admin key (עוקף RLS, לא תלוי
  // ב-user_id ולא במנוי push). await (סביבת serverless) — עבודה אחרי res עלולה להיקטל.
  await notifyCoordinatorsOfReport(supabase, { tour: data, reporter: auth.profile, reporterCode: code });

  return res.status(200).json({ tour: data });
}

// מאתר את רכזי הפרויקט (role='coord' החברים בפרויקט הסיור, למעט המדווח עצמו) וכותב להם
// שורת notifications + push. best-effort: כל כשל כאן נרשם ל-log בלבד ולא מפיל את שמירת הדיווח.
// שכפול תנאי הנמענים של ה-RPC app_notification_recipients (0015) — ה-RPC עצמו לא שמיש כאן,
// כי שומר-הסף שלו (security definer) קורא את ה-JWT של הקורא, ולמפתח service-role אין JWT.
async function notifyCoordinatorsOfReport(supabase, { tour, reporter, reporterCode }) {
  try {
    const projectId = Number(tour.project_id) || 2;
    const { data: profs, error } = await supabase
      .from('profiles')
      .select('activist_code, name, role, project_id, project_ids')
      .eq('role', 'coord')
      .not('activist_code', 'is', null);
    if (error) { console.error('tour report notify: profiles query failed:', error.message); return; }

    const memberOfProject = (p) => {
      const ids = Array.isArray(p.project_ids) && p.project_ids.length
        ? p.project_ids
        : (p.project_id != null ? [p.project_id] : []);
      return ids.map(Number).includes(projectId);
    };
    const recipients = (profs || []).filter(
      (p) => Number(p.activist_code) !== Number(reporterCode) && memberOfProject(p)
    );
    if (recipients.length === 0) return;

    const tourNumber = tour.tour_number || '';
    const settlement = tour.settlement || '';
    const reporterName = reporter?.name || 'פעיל';
    const title = 'דיווח סיור הוגש';
    const body = `${reporterName} הגיש דיווח על סיור ${tourNumber} ב${settlement} — הסיור סומן כהתקיים.`;

    const { error: insErr } = await supabase.from('notifications').upsert(
      recipients.map((r) => ({
        recipient_id: String(r.activist_code),
        client_id: `tour_report__${tour.id}__${r.activist_code}`,
        type: 'system',
        title,
        body,
        url: '/tours',
        priority: 'normal',
      })),
      { onConflict: 'client_id' }
    );
    if (insErr) console.error('tour report notify: notifications upsert failed:', insErr.message);

    // push best-effort (web + FCM) — no-op בטוח אם לרכז אין מנוי/טוקן
    await Promise.all(
      recipients.map((r) =>
        Promise.all([
          sendWebPushToActivist(supabase, String(r.activist_code), { title, body, url: '/tours' }),
          sendFcmToActivist(supabase, r.activist_code, { title, body, url: '/tours' }),
        ]).catch(() => {})
      )
    );
  } catch (err) {
    console.error('tour report notify failed:', err?.message || err);
  }
}
