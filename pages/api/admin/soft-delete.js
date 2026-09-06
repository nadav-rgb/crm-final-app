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

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
function purgeEligible(deletedAt) {
  if (!deletedAt) return false;
  return Date.now() - new Date(deletedAt).getTime() >= NINETY_DAYS_MS;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { entity, action, id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (!['contact', 'activist'].includes(entity)) return res.status(400).json({ error: 'Invalid entity' });
  if (!['delete', 'restore', 'purge'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const admin = getSupabaseAdmin();

  if (entity === 'contact') {
    const { data: contact, error: readErr } = await admin.from('contacts').select('id, project_id, deleted_at').eq('id', id).maybeSingle();
    // readErr אמיתי (למשל עמודת deleted_at לא קיימת עדיין — המיגרציה לא רצה) חייב להיות
    // מוצג כ-500 עם ההודעה האמיתית, לא להיבלע כ"לא נמצא" (404) שמטעה לחשוב שזו בעיית מזהה.
    if (readErr) return res.status(500).json({ error: readErr.message });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const accessErr = await assertProjectAccess(admin, auth, contact.project_id);
    if (accessErr) return res.status(accessErr.status).json({ error: accessErr.error });

    if (action === 'purge') {
      if (!purgeEligible(contact.deleted_at)) return res.status(409).json({ error: 'עדיין לא עברו 90 יום מהמחיקה' });
      // מחיקה סופית ובלתי הפיכה — רישום מי ביצע, כדי שלא תהיה אפס תיעוד על פעולה כזו.
      console.log(`[soft-delete] PURGE contact id=${id} by activist_code=${auth.profile.activist_code} (${auth.profile.name}, role=${auth.profile.role})`);
      const { error } = await admin.from('contacts').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ error: null });
    }

    if (action === 'delete') {
      const { error } = await admin.from('contacts').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      // שחזור לקוח בודד חייב גם לנקות deleted_via_activist_id — אחרת הלקוח נשאר "מסומן" כאילו
      // נמחק כתוצאת-לוואי ממחיקת פעיל מסוים, וקסקייד-הטיהור של אותו פעיל (בעוד 90 יום) ימחק
      // אותו לצמיתות שוב למרות שהוא שוחזר במפורש. ר' גם המסנן is_active=false בקסקייד למטה — הגנה כפולה.
      const { error } = await admin.from('contacts').update({ is_active: true, deleted_at: null, deleted_via_activist_id: null }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ error: null });
  }

  // entity === 'activist' — id הוא activist_code (int), לא profiles.id (uuid).
  const { data: activist, error: readErr } = await admin.from('profiles').select('id, role, project_id, project_ids, deleted_at').eq('activist_code', id).maybeSingle();
  // readErr אמיתי (למשל עמודת deleted_at לא קיימת עדיין — המיגרציה לא רצה) חייב להיות מוצג
  // כ-500 עם ההודעה האמיתית, לא להיבלע כ"לא נמצא" (404) שמטעה לחשוב שזו בעיית מזהה.
  if (readErr) return res.status(500).json({ error: readErr.message });
  if (!activist) return res.status(404).json({ error: 'Activist not found' });

  // הגנה: אפשר לנהל (למחוק/לשחזר/לטהר) רק משתמש שהתפקיד שלו activist. בלי הבדיקה הזו רכז
  // יכול "למחוק" רכז/ראש-פרויקט אחר, ובעוד 90 יום למחוק אותו לצמיתות כולל חשבון ה-Auth האמיתי
  // שלו. מנכ"ל מוגן היום רק במקרה (אין לו project_id אז בדיקת שיתוף-הפרויקט למטה תמיד נכשלת) —
  // זו לא הגנה אמיתית, ולכן יש כאן בדיקה מפורשת ולא-מקרית.
  if (activist.role !== 'activist') {
    return res.status(403).json({ error: 'אפשר לנהל מחיקה/שחזור רק עבור משתמש בתפקיד פעיל' });
  }
  // הגנה: אי אפשר לבצע פעולה על עצמך דרך ה-endpoint הזה (מחיקה/שחזור/מחיקה-סופית עצמית).
  if (String(auth.profile.activist_code) === String(id)) {
    return res.status(403).json({ error: 'לא ניתן לבצע פעולה זו על החשבון שלך' });
  }

  const activistProjectIds = Array.isArray(activist.project_ids) && activist.project_ids.length > 0
    ? activist.project_ids : (activist.project_id ? [activist.project_id] : []);
  // מנכ"ל תמיד; רכז/ראש רק אם משתפים לפחות פרויקט אחד עם הפעיל.
  if (auth.profile.role !== 'ceo') {
    const callerIds = projectIdsOf(auth.profile);
    const shares = activistProjectIds.some(p => callerIds.includes(Number(p)));
    if (!shares) return res.status(403).json({ error: 'הפעיל הזה לא בפרויקט שלך' });
  }

  if (action === 'purge') {
    if (!purgeEligible(activist.deleted_at)) return res.status(409).json({ error: 'עדיין לא עברו 90 יום מהמחיקה' });
    // מחיקה סופית ובלתי הפיכה (פעיל + כל אנשי הקשר המקוסקדים שלו) — רישום מי ביצע, כדי שלא
    // תהיה אפס תיעוד על פעולה כזו.
    console.log(`[soft-delete] PURGE activist activist_code=${id} (cascading contacts) by activist_code=${auth.profile.activist_code} (${auth.profile.name}, role=${auth.profile.role})`);
    // מסנן is_active=false בנוסף ל-deleted_via_activist_id: לקוח שסומן ככזה שנמחק כתוצאת-לוואי
    // מהפעיל הזה, אבל שוחזר בנפרד בינתיים (שוב is_active=true), לא יימחק כאן לצמיתות — גם אם
    // ה-restore לא ניקה את הסימון מסיבה כלשהי (הגנה כפולה, ר' גם restore הבודד למעלה).
    const { error: contactsErr } = await admin.from('contacts').delete().eq('deleted_via_activist_id', id).eq('is_active', false);
    if (contactsErr) return res.status(500).json({ error: contactsErr.message });
    const { error: profErr } = await admin.from('profiles').delete().eq('activist_code', id);
    if (profErr) return res.status(500).json({ error: profErr.message });
    // deleteUser דורש את ה-Auth user id (uuid) — activist.id מה-select למעלה, לא את
    // ה-activist_code (id, פרמטר הבקשה). לא חוסם על כשל: הפרופיל כבר נמחק בהצלחה.
    const { error: authErr } = await admin.auth.admin.deleteUser(activist.id);
    if (authErr) console.error('Profile deleted but auth user deletion failed', authErr);
    return res.status(200).json({ error: null });
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
