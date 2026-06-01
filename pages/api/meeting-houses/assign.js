// pages/api/meeting-houses/assign.js
// עדכון רשימת הפעילים המשובצים לבית מפגש קיים ב-Supabase.
// כתיבה עם מפתח admin (עוקף RLS) רק אחרי אימות coord/head/ceo.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from './_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { houseId, assignedActivists } = req.body || {};
  if (!houseId) return res.status(400).json({ error: 'Missing houseId' });
  if (!Array.isArray(assignedActivists)) return res.status(400).json({ error: 'assignedActivists must be an array' });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('meeting_houses')
    .update({ assigned_activists: assignedActivists })
    .eq('id', String(houseId))
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Meeting house not found' });
  return res.status(200).json({ house: data });
}
