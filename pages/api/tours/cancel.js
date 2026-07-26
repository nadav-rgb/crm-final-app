// pages/api/tours/cancel.js — ביטול סיור: status → 'cancelled', והתראה לכל הקהל.
//
// ביטול ולא מחיקה: הסיור נשאר בהיסטוריה, הלקוחות שהגיעו דרכו (contacts.tour_id) שומרים
// על הקישור, והדיווח לא נעלם. השכר מסתדר מעצמו — payments סופר רק status === 'completed'.
//
// אין מיגרציה: status הוא text בלי CHECK constraint (migrations/0011_tours.sql).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import { notifyRecipients } from '../../../lib/notifyRecipients';
import { getTourAudience } from '../../../lib/tourAudience';
import { formatDateHe } from '../../../lib/formatDate';

const REASON_MAX = 200;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { tourId, reason } = req.body || {};
  if (!tourId) return res.status(400).json({ error: 'Missing tourId' });

  const admin = getSupabaseAdmin();
  const id = String(tourId);

  const { data: tour, error: readErr } = await admin
    .from('tours').select('*').eq('id', id).single();
  if (readErr || !tour) return res.status(404).json({ error: 'Tour not found' });

  if (tour.status === 'cancelled') {
    return res.status(200).json({ tour, alreadyCancelled: true, notified: [] });
  }

  const { data: after, error: writeErr } = await admin
    .from('tours').update({ status: 'cancelled' }).eq('id', id).select().single();
  if (writeErr) return res.status(500).json({ error: writeErr.message });

  // הסיבה נכתבת ע"י רכז/מנהל ומשובצת להודעה שהשרת מרכיב — לא הודעה מהלקוח.
  const note = String(reason || '').trim().slice(0, REASON_MAX);

  const editorCode = auth.profile?.activist_code != null ? Number(auth.profile.activist_code) : null;
  const { recipients } = await getTourAudience(admin, after, { exclude: [editorCode] });

  const body = `סיור ${after.tour_number} ב${after.settlement} בתאריך ${formatDateHe(after.date)} בוטל`
    + (note ? `. סיבה: ${note}` : '.');

  const notified = await notifyRecipients(admin, recipients, {
    title: 'סיור בוטל',
    body,
    url: '/tours',
    type: 'assignment',
    priority: 'high',
    clientId: c => `tour_cancelled_${id}_${c}`,
  });

  return res.status(200).json({ tour: after, notified });
}
