// pages/api/tours/update.js — עריכת פרטי סיור קיים + התראת "עודכנו הפרטים" לכל הנוגעים בדבר.
//
// למה endpoint נפרד ולא upsert.js: כדי לנסח *מה* השתנה צריך לקרוא את השורה הישנה לפני הכתיבה.
// אם הלקוח היה שולח את "לפני" — זה טקסט מהדפדפן, ואסור (ראה כלל האבטחה ב-CLAUDE.md).
// כאן השרת קורא לפני, כותב, ומרכיב את ההודעה בעצמו מהשוואת שתי השורות.
//
// מה *לא* נערך כאן במכוון: status, assigned_activists, report, project_id.
// תיקון טעות בפרטים לא אמור לדרוס שיבוצים או דיווח שכבר הוגש.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';
import { formatDateHe } from '../../../lib/formatDate';

const EDITABLE = [
  'tour_number', 'settlement', 'date', 'start_time',
  'guide_name', 'guide_activist_id', 'host_activist_id', 'notes',
];

// שדות שההשוואה עליהם ישירה (מדריך ומשפחה מארחת מטופלים בנפרד — הם זוג id+שם)
const PLAIN_FIELDS = [
  { col: 'tour_number', label: 'מספר סיור' },
  { col: 'settlement',  label: 'יישוב' },
  { col: 'date',        label: 'תאריך', fmt: v => (v ? formatDateHe(v) : '') },
  { col: 'start_time',  label: 'שעה' },
  { col: 'notes',       label: 'הערות' },
];

const norm = v => (v === null || v === undefined ? '' : String(v).trim());
const normDate = v => norm(v).slice(0, 10);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { tour } = req.body || {};
  if (!tour || !tour.id) return res.status(400).json({ error: 'Missing tour.id' });

  const admin = getSupabaseAdmin();
  const id = String(tour.id);

  // 1) המצב הישן — חייב להיקרא לפני הכתיבה
  const { data: before, error: readErr } = await admin
    .from('tours').select('*').eq('id', id).single();
  if (readErr || !before) return res.status(404).json({ error: 'Tour not found' });

  // 2) כתיבה — רק העמודות הניתנות לעריכה
  const patch = {};
  EDITABLE.forEach(k => { if (tour[k] !== undefined) patch[k] = tour[k]; });
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No editable fields' });

  const { data: after, error: writeErr } = await admin
    .from('tours').update(patch).eq('id', id).select().single();
  if (writeErr) return res.status(500).json({ error: writeErr.message });

  // 3) שמות פעילים לפי קוד — לניסוח ההודעה ולנמענים
  const { data: profiles } = await admin
    .from('profiles')
    .select('activist_code, name, role, project_id, project_ids')
    .not('activist_code', 'is', null);
  const list = Array.isArray(profiles) ? profiles : [];
  const nameByCode = {};
  list.forEach(p => { nameByCode[Number(p.activist_code)] = p.name; });
  const codeName = code => (code == null ? '' : (nameByCode[Number(code)] || `פעיל ${code}`));

  // מדריך: פעיל שלנו (id) או חיצוני (טקסט) — התצוגה היא מה שרואים בפועל
  const guideLabel = row => (row.guide_activist_id
    ? codeName(row.guide_activist_id)
    : norm(row.guide_name));

  // 4) מה השתנה
  const changes = [];
  PLAIN_FIELDS.forEach(({ col, label, fmt }) => {
    const cmp = col === 'date' ? normDate : norm;
    if (cmp(before[col]) === cmp(after[col])) return;
    const show = v => (fmt ? fmt(v) : norm(v)) || '(ריק)';
    changes.push({ label, from: show(before[col]), to: show(after[col]) });
  });
  if (guideLabel(before) !== guideLabel(after)) {
    changes.push({ label: 'מדריך', from: guideLabel(before) || '(ריק)', to: guideLabel(after) || '(ריק)' });
  }
  if (norm(before.host_activist_id) !== norm(after.host_activist_id)) {
    changes.push({
      label: 'משפחה מארחת',
      from: before.host_activist_id ? codeName(before.host_activist_id) : '(ריק)',
      to:   after.host_activist_id  ? codeName(after.host_activist_id)  : '(ריק)',
    });
  }

  if (changes.length === 0) {
    return res.status(200).json({ tour: after, changes: [], notified: [] });
  }

  // 5) נמענים — שלוש קבוצות, לפי מה שקרה להם אישית
  const editorCode = auth.profile?.activist_code != null ? Number(auth.profile.activist_code) : null;
  const projectId = after.project_id ?? 2;

  const roleBefore = new Map(); // code -> תפקיד קודם
  if (before.host_activist_id)  roleBefore.set(Number(before.host_activist_id), 'המשפחה המארחת');
  if (before.guide_activist_id) roleBefore.set(Number(before.guide_activist_id), 'המדריך');
  const roleAfter = new Map();
  if (after.host_activist_id)  roleAfter.set(Number(after.host_activist_id), 'המשפחה המארחת');
  if (after.guide_activist_id) roleAfter.set(Number(after.guide_activist_id), 'המדריך');

  const added   = [...roleAfter.keys()].filter(c => roleAfter.get(c) !== roleBefore.get(c));
  const dropped = [...roleBefore.keys()].filter(c => !roleAfter.has(c));

  const managers = await getProjectManagers(admin, projectId);
  const informed = new Set(); // מקבלים "עודכנו הפרטים"
  [...roleAfter.keys()].forEach(c => informed.add(c));
  (Array.isArray(after.assigned_activists) ? after.assigned_activists : []).forEach(c => informed.add(Number(c)));
  managers.forEach(m => informed.add(Number(m.activist_code)));
  // מי שהתפקיד שלו השתנה מקבל הודעה ייעודית במקום — וגם העורך עצמו לא מקבל התראה על פעולה שלו
  added.forEach(c => informed.delete(c));
  dropped.forEach(c => informed.delete(c));
  if (editorCode != null) informed.delete(editorCode);

  const dateStr = formatDateHe(after.date);
  const where = `סיור ${after.tour_number} ב${after.settlement} בתאריך ${dateStr}`;
  const diffText = changes.map(c => `${c.label} (${c.from} ← ${c.to})`).join(' · ');
  const tourUrl = `/tours?tour=${id}`;
  // חותמת לכל שמירה — כדי ששתי עריכות עוקבות לא ידרסו זו את שורת הפעמון של זו,
  // אבל ריצה חוזרת של אותה שמירה כן תתאחד (upsert לפי client_id).
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

  const toRecipients = codes => codes
    .filter(c => c != null && !Number.isNaN(Number(c)) && Number(c) !== editorCode)
    .map(c => ({ activist_code: Number(c), name: codeName(c) }));

  const notified = [];

  // א) מי שנכנס לתפקיד עכשיו
  for (const code of added) {
    if (Number(code) === editorCode) continue;
    const res1 = await notifyRecipients(admin, toRecipients([code]), {
      title: 'שובצת לסיור',
      body: `נקבעת בתור ${roleAfter.get(code)} ב${where}.`,
      url: tourUrl,
      type: 'assignment',
      priority: 'high',
      clientId: c => `tour_role_added_${id}_${stamp}_${c}`,
    });
    notified.push(...res1);
  }

  // ב) מי שהוצא מהתפקיד — חשוב, אחרת הוא מגיע לסיור שכבר לא שלו
  for (const code of dropped) {
    if (Number(code) === editorCode) continue;
    const res2 = await notifyRecipients(admin, toRecipients([code]), {
      title: 'שינוי בשיבוץ לסיור',
      body: `כבר אינך משובץ בתור ${roleBefore.get(code)} ב${where}.`,
      // במכוון לא tourUrl: הוא כבר לא משובץ, ולכן הסיור מסונן מהרשימה שלו
      // (visibleTours ב-pages/tours.jsx) — הפניה אליו הייתה נוחתת על כלום.
      url: '/tours',
      type: 'assignment',
      priority: 'high',
      clientId: c => `tour_role_dropped_${id}_${stamp}_${c}`,
    });
    notified.push(...res2);
  }

  // ג) כל השאר — מה בדיוק השתנה
  const informedList = toRecipients([...informed]);
  if (informedList.length > 0) {
    const res3 = await notifyRecipients(admin, informedList, {
      title: `עודכנו פרטי סיור ${after.tour_number}`,
      body: `${where}. שונה: ${diffText}.`,
      url: tourUrl,
      type: 'system',
      priority: 'high',
      clientId: c => `tour_updated_${id}_${stamp}_${c}`,
    });
    notified.push(...res3);
  }

  return res.status(200).json({ tour: after, changes, notified });
}
