// pages/api/interactions/manage.js — עריכה/מחיקה של קשר על ידי רכז/ראש-פרויקט/מנכ"ל,
// כולל התראה cross-user לפעיל בעל הקשר. אותה תבנית authorization+admin-client כמו
// pages/api/tours/delete.js — לא נוגעים ב-RLS (interactions_update/delete ב-0013 נשארות
// activist+ceo בלבד; המסלול הזה מוסיף coord/head דרך admin client, לא דרך RLS. הגנה כפולה:
// גם אם יש באג כאן, ניסיון לעקוף את ה-API ולפנות ישירות ל-Supabase עדיין ייחסם ב-RLS).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import { notifyRecipients } from '../../../lib/notifyRecipients';

// שדות שקריאות אמיתיות שולחות ל-updateInteraction (lib/CrmStore.jsx) עבור coord/head —
// שני מקורות: טופס העריכה (pages/contact/[id].jsx saveEditInteraction) וכתיבת סיכום-AI
// (pages/contact/add-interaction/[id].jsx, אחרי summarizeInteractionText — updateInteraction(id,
// { ai_summary })). whitelist מונע כתיבה לשדות שהלקוח לא אמור לגעת בהם (activist_id, project_id
// וכו'); כל שדה חדש שקורא אמיתי צריך לכתוב חייב להתווסף כאן במפורש — אחרת הוא מסונן בשקט
// (ר' הגנת "No editable fields" למטה, שהופכת מקרה כזה בעתיד לכשל גלוי במקום no-op שקט).
const EDITABLE_FIELDS = ['type', 'quality', 'duration_minutes', 'date', 'outcome', 'description', 'notes', 'ai_summary', 'next_action', 'next_action_date'];

function projectIdsOf(profile) {
  if (Array.isArray(profile.project_ids) && profile.project_ids.length > 0) return profile.project_ids.map(Number);
  return profile.project_id ? [Number(profile.project_id)] : [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { action, interactionId, fields } = req.body || {};
  if (!interactionId) return res.status(400).json({ error: 'Missing interactionId' });
  if (!['update', 'delete'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const admin = getSupabaseAdmin();
  const { data: interaction, error: readErr } = await admin
    .from('interactions')
    .select('id, contact_id, contact_name, activist_id, project_id, date')
    .eq('id', interactionId)
    .single();
  if (readErr || !interaction) return res.status(404).json({ error: 'Interaction not found' });

  // הרשאה: מנכ"ל תמיד; רכז/ראש רק בפרויקט של הקשר (requireWriteRole כבר סינן ל-coord/head/ceo).
  const isCeo = auth.profile.role === 'ceo';
  if (!isCeo && !projectIdsOf(auth.profile).includes(Number(interaction.project_id))) {
    return res.status(403).json({ error: 'הקשר הזה לא בפרויקט שלך' });
  }

  // שם בעל-הקשר, לצורך ההתראה. activist_directory הוא ה-view הקריא-בלבד הרגיל של פעילים.
  const { data: owner } = await admin
    .from('activist_directory')
    .select('name')
    .eq('activist_code', interaction.activist_id)
    .single();
  const ownerName = owner?.name;
  const url = interaction.contact_id ? `/contact/${interaction.contact_id}` : '/contacts';
  const actorName = auth.profile.name || (auth.profile.role === 'head' ? 'ראש הפרויקט' : 'הרכז');
  const shouldNotify = ownerName && Number(interaction.activist_id) !== Number(auth.profile.activist_code);

  if (action === 'update') {
    if (!fields || typeof fields !== 'object') return res.status(400).json({ error: 'Missing fields' });
    const row = {};
    EDITABLE_FIELDS.forEach(key => { if (fields[key] !== undefined) row[key] = fields[key]; });
    // שומר מפני no-op שקט: אם כל השדות שנשלחו סוננו (לא ב-whitelist), admin.update({}) של
    // PostgREST "מצליח" בלי לשנות כלום — הקורא (updateInteraction) לא מבחין בין הצלחה
    // אמיתית לכשל שקט הזה. עדיף כשל גלוי כאן, שיחשוף מיד קורא עתידי ששולח שדה לא-רשום.
    if (Object.keys(row).length === 0) return res.status(400).json({ error: 'No editable fields provided' });
    const { error: writeErr } = await admin.from('interactions').update(row).eq('id', interactionId);
    if (writeErr) return res.status(500).json({ error: writeErr.message });

    if (shouldNotify) {
      await notifyRecipients(admin, [{ activist_code: interaction.activist_id, name: ownerName }], {
        title: 'קשר שלך עודכן',
        body: `${actorName} עדכן קשר שלך עם ${interaction.contact_name || 'לקוח'}.`,
        url, type: 'interaction_managed_edit', priority: 'high',
        clientId: code => `interaction_managed_edit__${interactionId}__${code}`,
      });
    }
    return res.status(200).json({ error: null });
  }

  // action === 'delete'
  const { error: delErr } = await admin.from('interactions').delete().eq('id', interactionId);
  if (delErr) return res.status(500).json({ error: delErr.message });

  if (shouldNotify) {
    await notifyRecipients(admin, [{ activist_code: interaction.activist_id, name: ownerName }], {
      title: 'קשר שלך נמחק',
      body: `${actorName} מחק קשר שלך עם ${interaction.contact_name || 'לקוח'} מתאריך ${interaction.date}.`,
      url, type: 'interaction_managed_delete', priority: 'high',
      clientId: code => `interaction_managed_delete__${interactionId}__${code}`,
    });
  }
  return res.status(200).json({ error: null });
}