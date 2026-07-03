// pages/api/tours/upsert.js
// יצירה/עדכון של סיור ("נעים להכיר") ב-Supabase. כתיבה עם מפתח admin (עוקף RLS)
// רק אחרי אימות שהקורא הוא coord/head/ceo — אותה תבנית כמו בתי מפגש.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';

const COLUMNS = [
  'id', 'tour_number', 'settlement', 'date', 'start_time',
  'guide_name', 'guide_activist_id', 'host_activist_id',
  'assigned_activists', 'status', 'notes', 'project_id',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { tour } = req.body || {};
  if (!tour || !tour.id) return res.status(400).json({ error: 'Missing tour.id' });

  const row = {};
  COLUMNS.forEach(k => { if (tour[k] !== undefined) row[k] = tour[k]; });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('tours')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ tour: data });
}
