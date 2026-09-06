// pages/api/admin/soft-delete.js — מחיקה-רכה/שחזור/מחיקה-סופית לפעילים ולקוחות,
// בהרשאת רכז/ראש-פרויקט/מנכ"ל. אותה תבנית requireWriteRole+admin-client כמו
// pages/api/interactions/manage.js — לא נוגעים ב-RLS.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';

function projectIdsOf(profile) {
  if (Array.isArray(profile.project_ids) && profile.project_ids.length > 0) return profile.project_ids.map(Number);
  return profile.project_id ? [Number(profile.project_id)] : [];
}

async function assertProjectAccess(admin, auth, projectId) {
  if (auth.profile.role === 'ceo') return null;
  if (!projectIdsOf(auth.profile).includes(Number(projectId))) {
    return { status: 403, error: 'הישות הזו לא בפרויקט שלך' };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { entity, action, id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (!['contact', 'activist'].includes(entity)) return res.status(400).json({ error: 'Invalid entity' });
  if (!['delete', 'restore'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const admin = getSupabaseAdmin();

  if (entity === 'contact') {
    const { data: contact, error: readErr } = await admin.from('contacts').select('id, project_id').eq('id', id).single();
    if (readErr || !contact) return res.status(404).json({ error: 'Contact not found' });
    const accessErr = await assertProjectAccess(admin, auth, contact.project_id);
    if (accessErr) return res.status(accessErr.status).json({ error: accessErr.error });

    if (action === 'delete') {
      const { error } = await admin.from('contacts').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      const { error } = await admin.from('contacts').update({ is_active: true, deleted_at: null }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ error: null });
  }

  // entity === 'activist' — id הוא activist_code (int), לא profiles.id (uuid).
  const { data: activist, error: readErr } = await admin.from('profiles').select('id, project_id, project_ids').eq('activist_code', id).single();
  if (readErr || !activist) return res.status(404).json({ error: 'Activist not found' });
  const activistProjectIds = Array.isArray(activist.project_ids) && activist.project_ids.length > 0
    ? activist.project_ids : (activist.project_id ? [activist.project_id] : []);
  // מנכ"ל תמיד; רכז/ראש רק אם משתפים לפחות פרויקט אחד עם הפעיל.
  if (auth.profile.role !== 'ceo') {
    const callerIds = projectIdsOf(auth.profile);
    const shares = activistProjectIds.some(p => callerIds.includes(Number(p)));
    if (!shares) return res.status(403).json({ error: 'הפעיל הזה לא בפרויקט שלך' });
  }

  if (action === 'delete') {
    const now = new Date().toISOString();
    const { error: profErr } = await admin.from('profiles').update({ is_active: false, deleted_at: now }).eq('activist_code', id);
    if (profErr) return res.status(500).json({ error: profErr.message });
    // cascade: רק לקוחות שהיו פעילים ברגע המחיקה — לא "מחייה" בטעות לקוח שהפעיל
    // עצמו כבר מחק קודם (ראה deleted_via_activist_id בהערת המיגרציה, Task 1).
    // deleted_via_activist_id מאוחסן גם הוא כ-activist_code, לעקביות עם contacts.activist_id.
    const { error: contactsErr } = await admin.from('contacts')
      .update({ is_active: false, deleted_at: now, deleted_via_activist_id: id })
      .eq('activist_id', id).eq('is_active', true);
    if (contactsErr) return res.status(500).json({ error: contactsErr.message });
  } else {
    const { error: profErr } = await admin.from('profiles').update({ is_active: true, deleted_at: null }).eq('activist_code', id);
    if (profErr) return res.status(500).json({ error: profErr.message });
    // שחזור הפוך מדויק: רק לקוחות שהוסתרו *כתוצאה* מהמחיקה הזו — לא נוגע בלקוח
    // שהפעיל מחק בעצמו בנפרד (ה-flag deleted_via_activist_id הוא ההבחנה).
    const { error: contactsErr } = await admin.from('contacts')
      .update({ is_active: true, deleted_at: null, deleted_via_activist_id: null })
      .eq('deleted_via_activist_id', id);
    if (contactsErr) return res.status(500).json({ error: contactsErr.message });
  }
  return res.status(200).json({ error: null });
}
