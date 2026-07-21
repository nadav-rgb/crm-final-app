// pages/api/push/status.js — האם *המכשיר הזה* רשום בשרת לקבלת Push.
//
// למה זה נחוץ: getPushStatus() בדק עד היום רק את מצב הדפדפן (permission + getSubscription),
// והציג "✅ התראות פעילות במכשיר זה" גם כשהמנוי מעולם לא הגיע לשרת. זה מה שקרה בפועל
// (2026-07-21): בטלפון הופיע וי ירוק, בעוד שהשורה היחידה ב-push_subscriptions הייתה של
// המחשב — כך שכל ההתראות נשלחו למחשב והטלפון לא קיבל דבר, בלי שום חיווי על התקלה.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile?.activist_code) return res.status(403).json({ error: 'No profile' });

  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('activist_id')
    .eq('activist_id', String(auth.profile.activist_code))
    .eq('subscription->>endpoint', String(endpoint));

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ registered: (data || []).length > 0 });
}
