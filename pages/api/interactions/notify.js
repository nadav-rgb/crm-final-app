// pages/api/interactions/notify.js — התראות cross-user על דיווח קשר, בצד-שרת (admin → עוקף RLS + Push אמיתי).
// מחליף את createInteractionSummaryNotifications / החלק-למנהלים של createPaymentInteractionNotifications
// ב-lib/notificationDemo.js, שכתבו שורת פעמון בלבד ומעולם לא שלחו Push לטלפון/מחשב.
//
// אבטחה: הלקוח שולח רק interactionId — *לא* טקסט ולא רשימת נמענים. השרת קורא את השורה מה-DB,
// מוודא שהקורא הוא בעל הקשר, ומרכיב את ההודעה בעצמו. כך פעיל לא יכול לשגר טקסט שרירותי לאף אחד.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';

// summary/payment → ניהול הפרויקט. self_payment → הפעיל עצמו, וזה המסלול היחיד
// שמגיע למכשיר שלו: השורה שהדפדפן כותב (createPaymentInteractionNotifications)
// היא פעמון בלבד (דיווח מוטי גלעד, 2026-07-23).
const KINDS = ['summary', 'payment', 'self_payment'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile?.activist_code) return res.status(403).json({ error: 'No profile' });

  const { interactionId, kind, amount } = req.body || {};
  if (!interactionId) return res.status(400).json({ error: 'Missing interactionId' });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind' });

  const supabase = getSupabaseAdmin();
  const { data: interaction, error: iErr } = await supabase
    .from('interactions')
    .select('id, contact_id, contact_name, activist_id, project_id, ai_summary')
    .eq('id', interactionId)
    .single();
  if (iErr || !interaction) return res.status(404).json({ error: 'Interaction not found' });

  // רק בעל הקשר (או מנכ"ל) מפעיל התראה עליו — מונע הצפה בשם פעיל אחר.
  const callerCode = Number(auth.profile.activist_code);
  if (Number(interaction.activist_id) !== callerCode && auth.profile.role !== 'ceo') {
    return res.status(403).json({ error: 'לא ניתן לשלוח התראה על קשר שאינו שלך' });
  }

  const projectId = Number(interaction.project_id) || 1;
  const activistName = auth.profile.name || 'פעיל';
  const contactName = interaction.contact_name || 'לקוח';
  const url = interaction.contact_id ? `/contact/${interaction.contact_id}` : '/contacts';

  let recipients, title, body, type, priority, clientId;

  if (kind === 'summary') {
    if (!interaction.ai_summary) return res.status(200).json({ notified: [], reason: 'no summary yet' });
    // סיכומי AI מיועדים לרכזים (החלטת מוצר: הפעיל לא רואה סיכום), אבל גם מנכ"ל/ראש-פרויקט
    // רוצים לדעת — לכן כל צוות הניהול של הפרויקט, לא coord בלבד כמו בגרסה הקודמת.
    recipients = await getProjectManagers(supabase, projectId, { excludeCode: callerCode });
    title = `סיכום חדש: דיווח של ${activistName} על ${contactName}`;
    body = interaction.ai_summary;
    type = 'interaction_summary';
    priority = 'normal';
    clientId = (code) => `interaction_summary__${interaction.id}__${code}`;
  } else if (kind === 'self_payment') {
    // הפעיל עצמו. הדפדפן כבר כתב שורת פעמון עם אותו client_id בדיוק
    // (notificationId(['paid-interaction-activist', id, activistId]) ב-lib/notificationDemo.js),
    // ולכן ה-upsert מאחד אותן — כאן מתווסף רק ה-Push שהדפדפן לא יכול לשלוח.
    // ⚠️ שינוי המחרוזת כאן בלי לשנות שם ייצור שתי שורות פעמון על אותו דיווח.
    //
    // מסלול "עצמי" בלבד: גם מנכ"ל לא יכול להפעיל אותו על קשר של פעיל אחר, כי אז ההתראה
    // הייתה נשלחת למנכ"ל בשם הפעיל. (החריג ב-403 שלמעלה מיועד למסלולים לניהול.)
    if (Number(interaction.activist_id) !== callerCode) {
      return res.status(403).json({ error: 'self_payment הוא רק על הקשר שלך' });
    }
    // amount מגיע מהלקוח ומשמש לתצוגה בלבד — דוח התשלומים מחושב עצמאית מטבלת
    // interactions, ולכן ערך שגוי כאן לא נוגע בכסף. ההתראה ממוענת לשולח עצמו.
    const numeric = Number(amount);
    if (!(Number.isFinite(numeric) && numeric > 0)) {
      // דיווח שלא זיכה — שורת הפעמון שהדפדפן כתב מפרטת גם את *סיבת* אי-הזכאות,
      // וכתיבה מכאן הייתה דורסת אותה בטקסט דל יותר. אין כאן חדשות שמצדיקות Push.
      return res.status(200).json({ notified: [], reason: 'not payable — bell row from client is richer' });
    }
    recipients = [{ activist_code: callerCode, name: activistName }];
    title = 'הדיווח נכנס לדוח התשלומים';
    body = `הקשר עם ${contactName} נשמר ונכנס לדוח התשלומים בסך ${numeric.toLocaleString()} ₪.`;
    type = 'paid_interaction';
    priority = 'high';
    clientId = () => `paid-interaction-activist__${interaction.id}__${callerCode}`;
  } else {
    // amount הוא לתצוגה בלבד — דוח התשלומים מחושב עצמאית מטבלת interactions, לכן ערך שגוי
    // כאן לא משפיע על כסף. עדיין מנרמלים למספר כדי לא להדפיס קלט חופשי בגוף ההתראה.
    const numeric = Number(amount);
    const amountText = Number.isFinite(numeric) && numeric > 0 ? `${numeric.toLocaleString()} ₪` : null;
    recipients = await getProjectManagers(supabase, projectId, { excludeCode: callerCode });
    title = 'דיווח מזכה נכנס לדוח התשלומים';
    body = `${activistName} דיווח קשר מזכה עם ${contactName}${amountText ? `: ${amountText}` : ''}.`;
    type = 'paid_interaction_manager';
    priority = 'high';
    clientId = (code) => `paid_interaction__${interaction.id}__${code}`;
  }

  const notified = await notifyRecipients(supabase, recipients, {
    title, body, url, type, priority, clientId,
  });

  return res.status(200).json({ notified });
}
