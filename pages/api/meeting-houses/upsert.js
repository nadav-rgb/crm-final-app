// pages/api/meeting-houses/upsert.js
// יצירה/עדכון של בית מפגש שלם ב-Supabase. כתיבה עם מפתח admin (עוקף RLS)
// רק אחרי אימות שהקורא הוא coord/head/ceo.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from './_auth';

const COLUMNS = [
  'id', 'house_number', 'settlement', 'city', 'host_name', 'facilitator_name',
  'project_id', 'status', 'assigned_activists', 'meetings', 'source',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { house } = req.body || {};
  if (!house || !house.id) return res.status(400).json({ error: 'Missing house.id' });

  // סינון לעמודות מותרות בלבד
  const row = {};
  COLUMNS.forEach(k => { if (house[k] !== undefined) row[k] = house[k]; });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('meeting_houses')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ house: data });
}
