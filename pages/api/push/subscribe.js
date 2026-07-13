// pages/api/push/subscribe.js — saves push subscription to Supabase
// תומך בכמה מכשירים לכל משתמש: כל endpoint (מכשיר/דפדפן) הוא שורה נפרדת.
// רישום חוזר מאותו מכשיר מחליף רק את השורה של אותו endpoint — לא את שאר המכשירים.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { activistId, subscription } = req.body;
  if (!activistId || !subscription?.endpoint) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  // פעיל רשאי לרשום רק את עצמו (activistId חייב להתאים ל-activist_code בפרופיל).
  if (!auth.profile || String(auth.profile.activist_code) !== String(activistId)) {
    return res.status(403).json({ error: 'activistId mismatch' });
  }

  const supabase = getSupabaseAdmin();

  // פרטי מכשיר לדיבוג ("איזה מכשיר זה?") — נשמרים בתוך ה-jsonb; מוסרים לפני שליחה בפועל.
  const enriched = {
    ...subscription,
    _meta: {
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      registered_at: new Date().toISOString(),
      activist_name: auth.profile.name || '',
    },
  };

  // מחליף רק את הרשומה של המכשיר הזה (אותו endpoint) — אצל כל משתמש שהוא
  // (מכשיר שעבר בין משתמשים שייך למי שמחובר בו עכשיו).
  await supabase.from('push_subscriptions')
    .delete()
    .eq('subscription->>endpoint', subscription.endpoint);

  const { error } = await supabase.from('push_subscriptions').insert({
    activist_id: String(activistId),
    subscription: enriched,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
