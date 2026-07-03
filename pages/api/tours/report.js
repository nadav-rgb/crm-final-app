// pages/api/tours/report.js
// הגשת דיווח מובנה אחרי סיור. מסמן את הסיור כ"התקיים".
// מורשים: coord/head/ceo, או פעיל שקשור לסיור (משובץ / מארח / מדריך).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

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
  return res.status(200).json({ tour: data });
}
