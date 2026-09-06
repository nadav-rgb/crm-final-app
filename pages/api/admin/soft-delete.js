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

  return res.status(400).json({ error: 'activist entity not yet supported' }); // Task 3
}
