// pages/api/reminders/cancel.js — cancels pending reminders when report is submitted
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { meetingId, activistId } = req.body;
  if (!meetingId || !activistId) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('meeting_reminders')
    .update({ sent: true })
    .eq('meeting_id', meetingId)
    .eq('activist_id', activistId)
    .eq('sent', false);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
