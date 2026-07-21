// pages/api/interactions/notify.js — התראות cross-user על דיווח קשר, בצד-שרת (admin → עוקף RLS + Push אמיתי).
// מחליף את createInteractionSummaryNotifications / החלק-למנהלים של createPaymentInteractionNotifications
// ב-lib/notificationDemo.js, שכתבו שורת פעמון בלבד ומעולם לא שלחו Push לטלפון/מחשב.
//
// אבטחה: הלקוח שולח רק interactionId — *לא* טקסט ולא רשימת נמענים. השרת קורא את השורה מה-DB,
// מוודא שהקורא הוא בעל הקשר, ומרכיב את ההודעה בעצמו. כך פעיל לא יכול לשגר טקסט שרירותי לאף אחד.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';

const KINDS = ['summary', 'payment'];

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
