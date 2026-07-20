// pages/api/tours/notify.js — התראות על סיור חדש, בצד השרת (service role → עוקף RLS).
// למה בשרת: כתיבת שורת notifications *לפעיל אחר* מהדפדפן נחסמת ב-RLS (רק self-insert עובר),
// ולכן עד היום רק יוצר הסיור קיבל שורה — המדריך/המשפחה המארחת/הרכזים לא. כאן admin כותב לכולם,
// וגם מחשב את רשימת הרכזים ישירות מ-profiles (בלי תלות ב-RPC/הקשר-המשתמש שהחזיר רשימה חלקית).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import { sendFcmToActivist } from '../../../lib/fcmAdmin';
import { sendWebPushToActivist } from '../../../lib/webPushSend';
import { formatDateHe } from '../../../lib/formatDate';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { tourId } = req.body || {};
  if (!tourId) return res.status(400).json({ error: 'Missing tourId' });

  const admin = getSupabaseAdmin();
  const { data: tour, error: te } = await admin.from('tours').select('*').eq('id', String(tourId)).single();
  if (te || !tour) return res.status(404).json({ error: 'Tour not found' });

  const projectId = tour.project_id ?? 2;
  const { data: profiles } = await admin
    .from('profiles')
    .select('activist_code, name, role, project_id, project_ids')
    .not('activist_code', 'is', null);
  const list = Array.isArray(profiles) ? profiles : [];
  const nameByCode = {};
  list.forEach(p => { nameByCode[p.activist_code] = p.name; });
  const inProject = p =>
    (Array.isArray(p.project_ids) && p.project_ids.includes(projectId)) || p.project_id === projectId;

  // נמענים: משפחה מארחת + מדריך(אם פעיל) + ניהול הפרויקט (מנכ"ל + רכז/ראש-פרויקט). dedup לפי code, עדיפות תפקיד-בסיור.
  const recip = new Map();
  const add = (id, label, kind) => {
    if (!id) return;
    const key = Number(id);
    if (!recip.has(key)) recip.set(key, { id: key, label, kind });
  };
  add(tour.host_activist_id, 'המשפחה המארחת', 'role');
  if (tour.guide_activist_id) add(tour.guide_activist_id, 'המדריך', 'role');
  list
    .filter(p => p.role === 'ceo' || (['coord', 'head'].includes(p.role) && inProject(p)))
    .forEach(p => add(p.activist_code, 'ניהול', 'manager'));

  const dateStr = formatDateHe(tour.date);
  const hostName = nameByCode[tour.host_activist_id] || '—';
  const results = [];

  for (const r of recip.values()) {
    const isRole = r.kind === 'role';
    const title = isRole ? 'שובצת לסיור' : 'סיור חדש נוצר';
    const body = isRole
      ? `נקבעת בתור ${r.label} בסיור ${tour.tour_number} ב${tour.settlement} בתאריך ${dateStr}.`
      : `נוצר סיור ${tour.tour_number} ב${tour.settlement} בתאריך ${dateStr}. מדריך: ${tour.guide_name || '—'}, משפחה מארחת: ${hostName}.`;

    // שורת פעמון (cross-device) — admin עוקף RLS, לכן מגיע גם לפעיל אחר
    const { error: insErr } = await admin.from('notifications').upsert({
      recipient_id: String(r.id),
      client_id: `tour_created_${tour.id}_${r.id}`,
      type: isRole ? 'assignment' : 'system',
      title,
      body,
      url: '/tours',
      priority: isRole ? 'high' : 'normal',
    }, { onConflict: 'client_id' });
    if (insErr) console.error('tours/notify insert failed for', r.id, insErr.message);

    // Push best-effort (no-op אם אין מנוי/טוקן)
    let push = 0;
    try {
      const web = await sendWebPushToActivist(admin, String(r.id), { title, body, url: '/tours' });
      const fcm = await sendFcmToActivist(admin, r.id, { title, body, url: '/tours' });
      push = (web?.sent || 0) + (fcm?.sent || 0);
    } catch (e) { console.error('tours/notify push failed for', r.id, e.message); }

    results.push({ id: r.id, name: nameByCode[r.id] || null, kind: r.kind, push });
  }

  return res.status(200).json({ notified: results });
}
