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

  // העליות מהשמירה האחרונה: כל השורות שנרשמו בתאריך האחרון שבהיסטוריה.
  const history = Array.isArray(contact.mitzvot_history) ? contact.mitzvot_history : [];
  const rises = history.filter(h => h?.mitzva && Number(h.to ?? 0) > Number(h.from ?? 0));
  if (rises.length === 0) return res.status(200).json({ notified: [], reason: 'no rise' });
  const lastDate = rises[rises.length - 1].date;
  const latest = rises.filter(h => h.date === lastDate);

  const projectId   = Number(contact.project_id) || 1;
  const activistName = auth.profile.name || 'פעיל';
  const list = latest.map(h => `${h.mitzva} ${h.from}→${h.to}`).join(', ');
  const url  = `/contact/${contact.id}`;
  // clientId דטרמיניסטי לפי לקוח+תאריך — שמירה נוספת באותו יום מעדכנת את אותה שורה
  // במקום ליצור התראה שנייה (upsert onConflict: client_id ב-notifyRecipients).
  const stamp = `${contact.id}__${lastDate}`;

  const managers = await getProjectManagers(supabase, projectId, { excludeCode: callerCode });
  const notified = await notifyRecipients(supabase, managers, {
    title: `📈 התקדמות בסרגל המצוות — ${contact.name}`,
    body:  `${activistName} עדכן: ${list}.`,
    url,
    type: 'mitzvot_progress',
    priority: 'normal',
    clientId: (code) => `mitzvot__${stamp}__${code}`,
  });

  // הפעיל עצמו — פעמון **ו-Push**. זה המסלול היחיד שמגיע למכשיר שלו.
  const self = await notifyRecipients(supabase, [{ activist_code: callerCode, name: activistName }], {
    title: '✨ עליה בסרגל המצוות נרשמה',
    body:  `${contact.name}: ${list}. הבונוס ייכנס לדוח התשלומים.`,
    url: '/my-dashboard',
    type: 'mitzvot_progress',
    priority: 'high',
    clientId: () => `mitzvot_self__${stamp}`,
  });

  return res.status(200).json({ notified: [...notified, ...self] });
}
