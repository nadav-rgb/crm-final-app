// pages/api/contacts/check-duplicate.js
// בדיקת לקוח כפול לפי טלפון+פרויקט, לפני יצירת לקוח "מחוץ לבתי המפגש/לסיורים" (בונוס 250₪).
// חייב לרוץ בצד שרת עם service role: הקליינט (פעיל) לא רואה יותר לקוחות של פעילים אחרים (בידוד נתונים),
// אז לא יכול לזהות כפילות בעצמו — אבל צריך למנוע בונוס כפול על אותו לקוח שכבר קיים אצל פעיל אחר.
// מחזיר רק true/false — לא חושף שם/פעיל אחראי של הרשומה הקיימת (לא לדלוף מידע של פעיל אחר).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { phone, projectId } = req.body || {};
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 7 || !projectId) return res.status(200).json({ duplicate: false });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('contacts')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .like('phone', `%${digits.slice(-8)}%`)
    .limit(1);

  if (error) return res.status(200).json({ duplicate: false }); // fail-open — לא לחסום יצירת לקוח בגלל תקלת בדיקה
  return res.status(200).json({ duplicate: Array.isArray(data) && data.length > 0 });
}
