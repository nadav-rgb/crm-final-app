// pages/api/push/subscribe.js — saves push subscription to Supabase
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { activistId, subscription } = req.body;
  if (!activistId || !subscription) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  // פעיל רשאי לרשום רק את עצמו (activistId חייב להתאים ל-activist_code בפרופיל).
  if (!auth.profile || String(auth.profile.activist_code) !== String(activistId)) {
    return res.status(403).json({ error: 'activistId mismatch' });
  }

  const supabase = getSupabaseAdmin();

  // Replace any existing subscription for this activist (new device/browser)
  await supabase.from('push_subscriptions').delete().eq('activist_id', activistId);

  const { error } = await supabase.from('push_subscriptions').insert({
    activist_id: activistId,
    subscription,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
