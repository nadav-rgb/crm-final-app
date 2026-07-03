// pages/api/tours/assign.js
// עדכון רשימת הפעילים המשובצים לסיור. כתיבה עם מפתח admin רק אחרי אימות coord/head/ceo.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { tourId, assignedActivists } = req.body || {};
  if (!tourId) return res.status(400).json({ error: 'Missing tourId' });
  if (!Array.isArray(assignedActivists)) return res.status(400).json({ error: 'assignedActivists must be an array' });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('tours')
    .update({ assigned_activists: assignedActivists })
    .eq('id', String(tourId))
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Tour not found' });
  return res.status(200).json({ tour: data });
}
