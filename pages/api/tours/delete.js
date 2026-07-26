// pages/api/tours/delete.js — מחיקה לצמיתות של סיור שנוצר בטעות/כפול.
//
// מחיקה, בניגוד לביטול, משאירה חורים: contacts.tour_id הוא text בלי foreign key
// (migrations/0012), אז לקוח מקושר היה נשאר מצביע על סיור שלא קיים; ו-payments סופר
// 750₪ למדריך לכל סיור completed, אז מחיקת סיור שהתקיים משנה שכר למפרע.
// לכן שני שערים חוסמים כאן, וההודעה מפנה ל"בטל סיור" במקום.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import { notifyRecipients } from '../../../lib/notifyRecipients';
import { getTourAudience } from '../../../lib/tourAudience';
import { formatDateHe } from '../../../lib/formatDate';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { tourId } = req.body || {};
  if (!tourId) return res.status(400).json({ error: 'Missing tourId' });

  const admin = getSupabaseAdmin();
  const id = String(tourId);

  const { data: tour, error: readErr } = await admin
    .from('tours').select('*').eq('id', id).single();
  if (readErr || !tour) return res.status(404).json({ error: 'Tour not found' });

  // שער 1 — סיור שהתקיים/דווח הוא נתון ארגוני, וגם בסיס לשכר המדריך
  if (tour.report || tour.status === 'completed') {
    return res.status(409).json({
      error: 'has_report',
      message: 'לסיור הזה כבר הוגש דיווח והוא נספר בשכר המדריך. אפשר לבטל אותו, לא למחוק.',
    });
  }

  // שער 2 — לקוחות שהגיעו דרך הסיור יישארו מצביעים לשום מקום
  const { count, error: countErr } = await admin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('tour_id', id);
  if (countErr) return res.status(500).json({ error: countErr.message });
  if ((count ?? 0) > 0) {
    return res.status(409).json({
      error: 'linked_contacts',
      count,
      message: `${count} לקוחות מקושרים לסיור הזה ויישארו בלי שיוך. אפשר לבטל אותו, לא למחוק.`,
    });
  }

  // הקהל נקרא לפני המחיקה — אחרי זה אין ממה לגזור אותו
  const editorCode = auth.profile?.activist_code != null ? Number(auth.profile.activist_code) : null;
  const { recipients } = await getTourAudience(admin, tour, { exclude: [editorCode] });
  const where = `סיור ${tour.tour_number} ב${tour.settlement} בתאריך ${formatDateHe(tour.date)}`;

  const { error: delErr } = await admin.from('tours').delete().eq('id', id);
  if (delErr) return res.status(500).json({ error: delErr.message });

  // מי שקיבל "שובצת לסיור" חייב לדעת שהוא בוטל — אחרת הסיור נעלם לו מהמסך בלי הסבר
  const notified = await notifyRecipients(admin, recipients, {
    title: 'סיור בוטל',
    body: `${where} בוטל והוסר מהמערכת.`,
    url: '/tours',
    type: 'assignment',
    priority: 'high',
    clientId: c => `tour_deleted_${id}_${c}`,
  });

  return res.status(200).json({ deleted: true, tourId: id, notified });
}
