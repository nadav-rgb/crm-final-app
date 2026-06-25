// pages/api/push/register-fcm.js — רישום FCM token של מכשיר אפליקציה לפעיל.
// מקביל ל-push/subscribe.js (web-push). מאומת: פעיל רושם רק את עצמו.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { activistId, token, platform } = req.body || {};
  if (!activistId || !token) {
    return res.status(400).json({ error: 'Missing activistId/token' });
  }

  // פעיל רשאי לרשום רק את עצמו (כמו ב-subscribe.js).
  if (!auth.profile || String(auth.profile.activist_code) !== String(activistId)) {
    return res.status(403).json({ error: 'activistId mismatch' });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('fcm_tokens')
    .upsert(
      {
        activist_id: String(activistId),
        token,
        platform: platform || 'android',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    );

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
