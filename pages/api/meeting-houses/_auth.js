// pages/api/meeting-houses/_auth.js
// אימות הקורא: מאמת JWT של Supabase ומחזיר את הפרופיל + role.
// משמש את endpoints הכתיבה של בתי מפגש כדי לעקוף RLS בבטחה (בלי לשנות RLS).

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

const WRITE_ROLES = ['coord', 'head', 'ceo'];

// מחזיר { ok, status, error, user, profile }. role נבדק מול WRITE_ROLES.
export async function requireWriteRole(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return { ok: false, status: 401, error: 'Missing auth token' };

  const admin = getSupabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, status: 401, error: 'Invalid token' };

  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('role, project_id, project_ids, activist_code, name')
    .eq('id', userData.user.id)
    .single();
  if (profErr || !profile) return { ok: false, status: 403, error: 'No profile' };
  if (!WRITE_ROLES.includes(profile.role)) {
    return { ok: false, status: 403, error: 'Insufficient role' };
  }

  return { ok: true, user: userData.user, profile };
}

// אימות קל: דורש רק משתמש מחובר (JWT תקף), בלי בדיקת role.
// מתאים ל-endpoints שגם פעיל רגיל קורא להם (תזכורות, סיכום AI, רישום push).
// מחזיר { ok, status, error, user, profile }.
export async function requireAuth(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return { ok: false, status: 401, error: 'Missing auth token' };

  const admin = getSupabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, status: 401, error: 'Invalid token' };

  const { data: profile } = await admin
    .from('profiles')
    .select('role, project_id, activist_code, name')
    .eq('id', userData.user.id)
    .single();

  return { ok: true, user: userData.user, profile: profile || null };
}
