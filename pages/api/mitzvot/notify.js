// pages/api/mitzvot/notify.js — התראה על עליה בסרגל המצוות, בצד-שרת (admin → Push אמיתי).
//
// למה בשרת: `createDemoNotification` בדפדפן כותב שורת פעמון בלבד — מפתחות VAPID/FCM
// קיימים רק בשרת (ראה CLAUDE.md, "התראות"). עד היום עדכון מצוות לא יצר שום התראה כלל
// (דיווח מוטי גלעד, 2026-08-02: "התקדמות במצוות שסומנו לא מופיע בהתראות").
//
// אבטחה — בדפוס api/interactions/notify: הלקוח שולח contactId בלבד, לא טקסט ולא נמענים.
// השרת קורא את הלקוח מה-DB, מוודא בעלות, ומרכיב את ההודעה מ-mitzvot_history בעצמו.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';
import CONFIG from '../../../data/config';

// ⚠️ mitzvot_history הוא JSONB שהפעיל כותב אליו בעצמו (updateMitzvot → contacts).
// בלי הרשימה הלבנה הזו, פעיל יכול לשתול טקסט חופשי ב-h.mitzva ולשגר אותו כ-Push
// לכל צוות הניהול ולמנכ"ל — בדיוק מה שהכלל "השרת מרכיב את ההודעה" נועד למנוע.
const KNOWN_MITZVOT = new Set([...CONFIG.mitzvotMale, ...CONFIG.mitzvotFemale]);
// תקרת אורך — שמירה אחת לגיטימית נוגעת לכל היותר בכל המצוות שברשימה.
const MAX_LISTED = KNOWN_MITZVOT.size;
// עליה ישנה לא מצדיקה התראה. חוסם גם קריאה ישירה ל-endpoint שמנסה לשגר מחדש
// התראה על היסטוריה בת חודשים.
const MAX_AGE_DAYS = 2;
const LEVELS = new Set(CONFIG.mitzvotLevels);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile?.activist_code) return res.status(403).json({ error: 'No profile' });

  const { contactId } = req.body || {};
  if (!contactId) return res.status(400).json({ error: 'Missing contactId' });

  const supabase = getSupabaseAdmin();
  const { data: contact, error } = await supabase
    .from('contacts')
    .select('id, name, activist_id, project_id, mitzvot_history')
    .eq('id', contactId)
    .single();
  if (error || !contact) return res.status(404).json({ error: 'Contact not found' });

  // רק בעל הלקוח (או מנכ"ל) מפעיל התראה עליו — מונע הצפה בשם פעיל אחר.
  const callerCode = Number(auth.profile.activist_code);
  if (Number(contact.activist_id) !== callerCode && auth.profile.role !== 'ceo') {
    return res.status(403).json({ error: 'לא ניתן לשלוח התראה על לקוח שאינו שלך' });
  }

  // העליות מהשמירה האחרונה. כל שדה שנכנס לטקסט ההתראה מאומת כאן — שם המצווה מול
  // הרשימה הלבנה, הרמות מול הסולם 0-4, והתאריך מול חלון של יומיים.
  const history = Array.isArray(contact.mitzvot_history) ? contact.mitzvot_history : [];
  const rises = history.filter(h =>
    h && KNOWN_MITZVOT.has(h.mitzva) &&
    LEVELS.has(Number(h.from ?? 0)) && LEVELS.has(Number(h.to ?? 0)) &&
    Number(h.to) > Number(h.from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(h.date || ''))
  );
  if (rises.length === 0) return res.status(200).json({ notified: [], reason: 'no valid rise' });

  // התאריך המאוחר ביותר בהיסטוריה — לא "האחרון במערך": סדר האיברים אינו מובטח.
  const lastDate = rises.reduce((max, h) => (h.date > max ? h.date : max), rises[0].date);
  const ageDays = Math.floor((Date.now() - Date.parse(`${lastDate}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(ageDays) || ageDays > MAX_AGE_DAYS) {
    return res.status(200).json({ notified: [], reason: 'rise too old' });
  }
  const latest = rises.filter(h => h.date === lastDate).slice(0, MAX_LISTED);

  const projectId   = Number(contact.project_id) || 1;
  const activistName = auth.profile.name || 'פעיל';
  // שם הלקוח הוא טקסט חופשי שהפעיל כתב. אין דרך להחליף אותו במשהו מאומת — הוא *הנושא*
  // של ההתראה — אבל כן אפשר לחסום ממנו לשמש כמטען ארוך. אותו סיכון קיים ב-contact_name
  // ב-api/interactions/notify.
  const contactName = String(contact.name || 'לקוח').slice(0, 60);
  const list = latest.map(h => `${h.mitzva} ${h.from}→${h.to}`).join(', ');
  const url  = `/contact/${contact.id}`;
  // clientId דטרמיניסטי לפי לקוח+תאריך — שמירה נוספת באותו יום מעדכנת את אותה שורה
  // במקום ליצור התראה שנייה (upsert onConflict: client_id ב-notifyRecipients).
  const stamp = `${contact.id}__${lastDate}`;

  const managers = await getProjectManagers(supabase, projectId, { excludeCode: callerCode });
  const notified = await notifyRecipients(supabase, managers, {
    title: `📈 התקדמות בסרגל המצוות — ${contactName}`,
    body:  `${activistName} עדכן: ${list}.`,
    url,
    type: 'mitzvot_progress',
    priority: 'normal',
    clientId: (code) => `mitzvot__${stamp}__${code}`,
  });

  // הפעיל עצמו — פעמון **ו-Push**. זה המסלול היחיד שמגיע למכשיר שלו.
  const self = await notifyRecipients(supabase, [{ activist_code: callerCode, name: activistName }], {
    title: '✨ עליה בסרגל המצוות נרשמה',
    body:  `${contactName}: ${list}. הבונוס ייכנס לדוח התשלומים.`,
    url: '/my-dashboard',
    type: 'mitzvot_progress',
    priority: 'high',
    clientId: () => `mitzvot_self__${stamp}`,
  });

  return res.status(200).json({ notified: [...notified, ...self] });
}
