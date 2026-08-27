// lib/CrmStore.jsx
import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import _messages     from '../data/messages';
import { deriveMitzvotBonuses } from './paymentCalc';
import { BASE_MEETING_QUESTIONS } from '../data/base-meetings';
import { advanceReminderStageForReports } from './reminderSchedulerDemo';
import { hydrateNotificationsFromSupabase } from './notificationDemo';
import { loadPaymentConfig, DEFAULT_CONFIG } from './paymentConfig';
import { getSupabaseClient } from './supabaseClient';
import { useAuth } from './AuthStore';

// בידוד נתונים בין פעילים: פעיל רואה רק שורות ששייכות לו (activist_id), רכז/ראש-פרויקט/כספים
// רק שורות בפרויקטים שהם חברים בהם (project_ids), מנכ"ל רואה הכל. הגנת-הגנה בצד לקוח בנוסף ל-RLS.
function scopeQueryToUser(query, currentUser, { activistColumn = 'activist_id', projectColumn = 'project_id' } = {}) {
  if (!currentUser) return query;
  if (currentUser.role === 'ceo') return query;
  if (currentUser.role === 'activist') return query.eq(activistColumn, currentUser.id);
  const ids = Array.isArray(currentUser.project_ids) && currentUser.project_ids.length > 0
    ? currentUser.project_ids
    : (currentUser.project_id ? [currentUser.project_id] : []);
  return query.in(projectColumn, ids.length > 0 ? ids : [-1]);
}

const CrmContext = createContext(null);

const BASE_REPORTS_STORAGE_KEY = 'crm_base_meeting_reports_demo_v1';

// העמודות הקיימות בטבלת base_meeting_reports ב-Supabase — סינון לפני כתיבה
const REPORT_COLUMNS = [
  'id', 'activist_id', 'project_id', 'house_id', 'meeting_number',
  'meeting_place_number', 'meeting_place_city', 'host_name', 'facilitator_name',
  'activist_name', 'date', 'start_time', 'structured_answers', 'answers',
  'participant_count', 'ai_summary', 'submitted', 'submitted_at',
];

function toReportRow(report) {
  const row = {};
  REPORT_COLUMNS.forEach(key => {
    if (report[key] !== undefined) row[key] = report[key];
  });
  return row;
}

async function upsertReportsToSupabase(reports) {
  const rows = reports.map(toReportRow).filter(r => r.id !== undefined && r.id !== null);
  if (rows.length === 0) return { error: null };
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('base_meeting_reports')
    .upsert(rows, { onConflict: 'id' });
  if (error) console.error('Failed to upsert base meeting reports', error);
  return { error: error || null };
}

function persistBaseMeetings(nextReports) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BASE_REPORTS_STORAGE_KEY, JSON.stringify(nextReports));
  } catch (err) {
    console.warn('Could not save base meeting reports to localStorage', err);
  }
}


// העמודות הקיימות בטבלת interactions ב-Supabase — סינון לפני כתיבה (משמיט mitzvot_level וכו')
const INTERACTION_COLUMNS = [
  'id', 'contact_id', 'activist_id', 'project_id', 'contact_name', 'type', 'quality',
  'duration_minutes', 'outcome', 'date', 'time', 'notes', 'description', 'ai_summary',
  'next_action', 'next_action_date', 'participants',
];

function toInteractionRow(interaction) {
  const row = {};
  INTERACTION_COLUMNS.forEach(key => {
    if (interaction[key] !== undefined) row[key] = interaction[key];
  });
  return row;
}

async function insertInteractionViaApi(apiFetch, interaction) {
  try {
    const result = await apiFetch(`/api/contacts/${encodeURIComponent(interaction.contact_id)}/interactions`, {
      method: 'POST',
      body: {
        occurredAt: new Date(`${interaction.date}T${interaction.time || '00:00'}:00`).toISOString(),
        type: interaction.type,
        quality: interaction.quality || undefined,
        notes: interaction.notes || undefined,
        participantIds: Array.isArray(interaction.participants) ? interaction.participants : [],
      },
    });
    return { data: result.interaction, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// העמודות הקיימות בטבלת contacts ב-Supabase — סינון לפני כתיבה (משמיט מפתחות זרים מהטופס)
const CONTACT_COLUMNS = [
  'id', 'activist_id', 'project_id', 'name', 'phone', 'city', 'area', 'depth',
  'profession', 'age', 'gender', 'high_potential', 'days_since_last_contact',
  'last_interaction_date', 'next_action', 'next_action_date', 'source',
  'joined_at', 'notes', 'how_met', 'mitzvot', 'mitzvot_history', 'is_graduate',
  'referred_by', 'meeting_place_city', 'meeting_place_number', 'tour_id',
  'meetingHouseCity', 'meetingHouseNumber', 'meetingHouseKey',
];

// מנרמל ערך תאריך: YYYY-MM-DD → שומר, ריק/לא תקין → null
function safeDate(val) {
  if (!val || typeof val !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(val.trim()) ? val.trim() : null;
}

function toContactRow(contact) {
  const row = {};
  CONTACT_COLUMNS.forEach(key => {
    if (contact[key] !== undefined) row[key] = contact[key];
  });
  // ברירות מחדל בטוחות (מכסה עמודות NOT NULL שהטופס לא ממלא)
  const ageNum = Number(row.age);
  row.age            = Number.isFinite(ageNum) && row.age !== '' && row.age !== null ? ageNum : null;
  row.high_potential = row.high_potential ?? false;
  row.is_graduate    = row.is_graduate ?? false;
  row.area           = row.area ?? null;
  row.depth          = row.depth ?? null;
  row.source         = row.source ?? null;
  // נרמול שדות תאריך — string ריק גורם ל-"invalid input syntax for type date" ב-Postgres
  row.last_interaction_date = safeDate(row.last_interaction_date);
  row.next_action_date      = safeDate(row.next_action_date);
  row.joined_at             = safeDate(row.joined_at);
  return row;
}

async function insertContactViaApi(apiFetch, contact) {
  try {
    const result = await apiFetch('/api/contacts', {
      method: 'POST',
      body: { name: contact.name, phone: contact.phone || undefined, city: contact.city || undefined, notes: contact.notes || undefined },
    });
    return { data: result.contact, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// כתיבת השדות הנגזרים חזרה לטבלת contacts (אחרת הם נשארים מקומיים ונעלמים ב-reload)
async function loadContactsFromApi(apiFetch, currentUser) {
  try {
    const result = await apiFetch('/api/contacts', { method: 'GET' });
    const data = (result.contacts || []).map(contact => ({
      ...contact,
      assigned_user_id: contact.assignedUserId,
      activist_id: contact.assignedUserId,
      next_action_date: contact.nextActionAt,
      project_id: currentUser?.project_id ?? null,
    }));
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// מחזירה { error } — הקורא (updateMitzvot) חייב לדעת אם השמירה נחתה לפני שהוא מציג
// "עודכן בהצלחה" ולפני שהוא מפעיל התראה שקוראת את השורה מה-DB.
async function updateContactFieldsViaApi(apiFetch, contactId, fields) {
  const allowed = Object.fromEntries(Object.entries(fields).filter(([key]) => ['name', 'phone', 'city', 'notes'].includes(key)));
  if (Object.keys(allowed).length === 0) return { error: null };
  try {
    await apiFetch(`/api/contacts/${encodeURIComponent(contactId)}`, { method: 'PATCH', body: allowed });
    return { error: null };
  } catch (error) {
    return { error };
  }
}

const PROJECT_NAMES = { 1:'אחדות יהודית', 2:'נעים להכיר', 3:'שבת מכל הסיבות', 4:'נפש יהודי' };

export function CrmProvider({ children }) {
  const [contacts,     setContacts]     = useState([]); // מקור האמת: Supabase (קריאה בלבד)
  const [interactions, setInteractions] = useState([]); // מקור האמת: Supabase
  const [activists,    setActivists]    = useState([]); // מקור האמת: Supabase view activist_directory (קריאה בלבד)
  const [messages,     setMessages]     = useState(_messages);
  const [baseMeetings, setBaseMeetings] = useState([]); // דיווחי מפגשי בסיס — מקור האמת: Supabase
  const [expenses,     setExpenses]     = useState([]); // דיווחי הוצאות — מקור האמת: Supabase (זורם לדשבורד+תשלומים)
  const [tours,        setTours]        = useState([]); // סיורים (נעים להכיר) — לשכר מדריך בדשבורד+תשלומים
  const [paymentConfig, setPaymentConfig] = useState(DEFAULT_CONFIG); // תעריפים/יעדים/בונוסים מ-payment_config (DB)

  // בונוס "הבאת משתתף חדש" — נגזר מנתוני הלקוחות ולא מ-state (state התאפס בכל רענון
  // והבונוס מעולם לא שרד עד עמוד התשלומים). זכאות: לקוח שהגיע מחוץ לבתי המפגש
  // (source='external') או בהפניית לקוח קיים (referred_by). החודש = חודש ההצטרפות.
  const newParticipantBonuses = useMemo(() => contacts
    .filter(c => c.activist_id && c.joined_at && (c.source === 'external' || c.referred_by))
    .map(c => {
      const d = new Date(c.joined_at);
      return {
        activist_id: c.activist_id,
        contact_id:  c.id,
        contactName: c.name,
        date:        c.joined_at,
        month:       `${d.getFullYear()}-${d.getMonth()}`,
      };
    }), [contacts]);

  // בונוס-מצוות — נגזר מ-mitzvot_history הפרסיסטנטי (Supabase) של כל לקוח, לא מ-state זמני.
  // אותו דפוס בדיוק כמו newParticipantBonuses לעיל: מקור-אמת יחיד, נגזר-מחדש בכל טעינה —
  // לא ניתן "לצבור" בונוס כפול כי אין state שמצטבר, רק חישוב טהור מהנתון השמור.
  // הגזירה עצמה חיה ב-lib/paymentCalc.js (deriveMitzvotBonuses) כדי שסקריפטי האימות
  // יחשבו בדיוק אותו דבר — קודם היא הייתה משוכפלת בשלושה מקומות.
  const mitzvotBonuses = useMemo(() => deriveMitzvotBonuses(contacts), [contacts]);

  const { currentUser, authLoading, apiFetch } = useAuth();

  // טעינת קונפיג השכר מ-Supabase (No-Hard-Coding). fallback ל-DEFAULT_CONFIG בכשל.
  useEffect(() => {
    if (authLoading || !currentUser) return;
    let active = true;
    loadPaymentConfig().then(cfg => { if (active) setPaymentConfig(cfg); });
    return () => { active = false; };
  }, [currentUser, authLoading]);

  // טעינת לקוחות מ-Supabase — רק אחרי שההתחברות מוכנה ויש משתמש,
  // כדי שה-select לא יצא כאנונימי (קריטי כשיופעל RLS). אותה תבנית כמו base_meeting_reports.
  // מסונן לפי בעלות (activist_id) / חברות-פרויקט — בידוד נתונים בין פעילים (הגנה בצד לקוח, בנוסף ל-RLS).
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setContacts([]); return; }
    let active = true;
    (async () => {
      const { data, error } = await loadContactsFromApi(apiFetch, currentUser);
      if (!active) return;
      if (error) return;
      setContacts(data);
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, apiFetch]);

  // סנכרון התראות מ-Supabase ל-localStorage בכניסה (cross-device). fire-and-forget.
  useEffect(() => {
    if (authLoading || !currentUser) return;
    hydrateNotificationsFromSupabase(currentUser);
  }, [currentUser, authLoading]);

  // טעינת פעילים מ-Supabase view activist_directory — אותה תבנית auth-gated.
  // ברירות מחדל בטוחות: id מתוך activist_code, status='active' (ה-view לא חושף status).
  // פעיל רואה רק את עצמו (רק רכז/ראש-פרויקט/מנכ"ל רואים רשימת פעילים); רכז מוגבל לפרויקטים שלו.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setActivists([]); return; }
    let active = true;
    (async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('activist_directory')
        .select('activist_code, name, role, project_id, project_ids')
        .order('name');
      if (currentUser.role === 'activist') {
        query = query.eq('activist_code', currentUser.id);
      } else if (currentUser.role !== 'ceo') {
        const ids = Array.isArray(currentUser.project_ids) && currentUser.project_ids.length > 0
          ? currentUser.project_ids
          : (currentUser.project_id ? [currentUser.project_id] : []);
        query = query.overlaps('project_ids', ids.length > 0 ? ids : [-1]);
      }
      const { data, error } = await query;
      if (!active) return;
      if (error) { console.error('Failed to load activists', error); return; }
      if (Array.isArray(data)) {
        setActivists(data.map(a => ({
          id:         Number(a.activist_code),
          name:       a.name,
          role:       a.role,
          project_id: a.project_id,
          // חברות מלאה בפרויקטים (רב-פרויקטלי). fallback: הפרויקט הראשי בלבד.
          project_ids: Array.isArray(a.project_ids) && a.project_ids.length > 0
            ? a.project_ids.map(Number)
            : (a.project_id ? [Number(a.project_id)] : []),
          status:     'active',
        })));
      }
    })();
    return () => { active = false; };
  }, [currentUser, authLoading]);

  // טעינת דיווחי הוצאות — אותה תבנית auth-gated. זורמים ל"דשבורד שלי" ולעמוד התשלומים. מסונן לפי בעלות.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setExpenses([]); return; }
    let active = true;
    (async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from('expenses').select('*');
      query = scopeQueryToUser(query, currentUser);
      const { data, error } = await query;
      if (!active) return;
      if (error) { console.error('Failed to load expenses', error); return; }
      if (Array.isArray(data)) setExpenses(data);
    })();
    return () => { active = false; };
  }, [currentUser, authLoading]);

  // טעינת סיורים — לחישוב שכר מדריך (750₪ לסיור שהתקיים עם מדריך-פעיל). פעילות משותפת בפרויקט — מסונן לפי פרויקט בלבד.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setTours([]); return; }
    let active = true;
    (async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from('tours').select('*');
      if (currentUser.role !== 'ceo') {
        const ids = Array.isArray(currentUser.project_ids) && currentUser.project_ids.length > 0
          ? currentUser.project_ids
          : (currentUser.project_id ? [currentUser.project_id] : []);
        query = query.in('project_id', ids.length > 0 ? ids : [-1]);
      }
      const { data, error } = await query;
      if (!active) return;
      if (error) { console.error('Failed to load tours', error); return; }
      if (Array.isArray(data)) setTours(data);
    })();
    return () => { active = false; };
  }, [currentUser, authLoading]);

  // טעינת דיווחי קשר מ-Supabase — אותה תבנית: רק אחרי auth מוכן ויש משתמש. מסונן לפי בעלות.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setInteractions([]); return; }
    let active = true;
    (async () => {
      const requests = contacts.map(contact => apiFetch(`/api/contacts/${encodeURIComponent(contact.id)}/interactions`, { method: 'GET' }));
      const settled = await Promise.allSettled(requests);
      if (!active) return;
      if (settled.some(result => result.status === 'rejected')) return;
      const data = settled.flatMap(result => result.value.interactions || []).map(interaction => ({
        ...interaction,
        contact_id: interaction.contactId,
        date: interaction.occurredAt?.slice(0, 10),
        time: interaction.occurredAt?.slice(11, 16),
      }));
      setInteractions(data);
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, contacts, apiFetch]);

  // טעינת דיווחי מפגשי בסיס מ-Supabase — רק אחרי שההתחברות מוכנה ויש משתמש,
  // כדי שה-select לא יצא כאנונימי (קריטי כשיופעל RLS). מסונן לפי בעלות.
  useEffect(() => {
    if (authLoading) return;                       // ממתינים לשחזור session
    if (!currentUser) { setBaseMeetings([]); return; } // אין משתמש — מאפסים
    let active = true;
    (async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from('base_meeting_reports').select('*');
      query = scopeQueryToUser(query, currentUser);
      const { data, error } = await query;
      if (!active) return;
      if (error) { console.error('Failed to load base meeting reports', error); return; }
      if (Array.isArray(data)) setBaseMeetings(data);
    })();
    return () => { active = false; };
  }, [currentUser, authLoading]);

  // async ומחזירה { error }: הקורא צריך לדעת מתי השורה באמת נחתה ב-Supabase לפני שהוא מפעיל
  // התראות צד-שרת (api/interactions/notify קורא את השורה מה-DB — לפני ה-insert הוא יחזיר 404).
  // עדכוני ה-state נשארים סינכרוניים לפני ה-await, כך שה-UI לא מושהה.
  async function addInteraction({ id, contact_id, activist_id, type, quality, duration_minutes, outcome, date, time, notes, description, ai_summary, next_action, next_action_date, mitzvot_level, participants }) {
    const contact = contacts.find(c => c.id === contact_id);
    const newInteraction = {
      id:               id ?? Date.now(),
      contact_id,
      activist_id,
      type,
      quality:          quality ?? '',
      duration_minutes: duration_minutes ?? 0,
      outcome:          outcome ?? 'חיובי',
      date,
      time:             time ?? new Date().toTimeString().slice(0,5),
      notes:            notes ?? '',
      description:      description ?? '',
      ai_summary:       ai_summary ?? '',
      contact_name:     contact?.name ?? '',
      project_id:       contact?.project_id ?? null,
      next_action:      next_action ?? null,
      next_action_date: next_action_date ?? null,
      ...(mitzvot_level !== undefined && mitzvot_level !== null ? { mitzvot_level } : {}),
      // רק כשיש משתתפים — קשר רגיל לא שולח את המפתח (בטוח גם אם מיגרציה 0015 טרם רצה)
      ...(participants !== undefined && participants !== null ? { participants } : {}),
    };
    setInteractions(prev => [newInteraction, ...prev]);

    // כתיבה לענן — נמתנת (mitzvot_level מסונן ב-toInteractionRow). ה-state כבר עודכן למעלה,
    // אז ההמתנה לא מורגשת ב-UI אבל מאפשרת לקורא לחכות לשורה לפני הפעלת התראות.
    const insertResult = await insertInteractionViaApi(apiFetch, newInteraction);

    // גלגול-אחורה של העדכון האופטימי: בלעדיו קשר שלא נשמר נשאר על המסך ובמוני החודש
    // עד רענון, והפעיל רואה דיווח שלא קיים ב-DB.
    if (insertResult.error) {
      setInteractions(prev => prev.filter(i => i.id !== newInteraction.id));
      return insertResult;
    }

    const interactionDate = new Date(date);
    const today = new Date(); today.setHours(0,0,0,0);
    const diffDays = Math.max(0, Math.floor((today - interactionDate) / 86400000));

    setContacts(prev => prev.map(c => {
      if (c.id !== contact_id) return c;
      const updated = {
        ...c,
        days_since_last_contact: diffDays,
        last_interaction_date:   date,
        next_action:             next_action      !== undefined ? next_action      : c.next_action,
        next_action_date:        next_action_date !== undefined ? next_action_date : c.next_action_date,
      };
      if (mitzvot_level !== undefined && mitzvot_level !== null && mitzvot_level !== c.mitzvot_level) {
        updated.mitzvot_level = mitzvot_level;
      }
      return updated;
    }));

    // התמדה לענן של השדות הנגזרים (mitzvot_level מושמט — אין עמודה כזו ב-contacts)
    const contactFields = { days_since_last_contact: diffDays, last_interaction_date: date };
    if (next_action      !== undefined) contactFields.next_action      = next_action;
    if (next_action_date !== undefined) contactFields.next_action_date = next_action_date;
    updateContactFieldsViaApi(apiFetch, contact_id, contactFields);

    return insertResult;
  }

  // מפגש רב-משתתפים — כל לקוח שהשתתף מקבל שורת קשר משלו, אחרת הסטטוס שלו
  // ("ימים מאז קשר אחרון") ממשיך להידרדר ל"על סף ניתוק" למרות שהוא היה במפגש.
  // השורות הנגזרות נושאות participants.derived_from, ו-lib/paymentCalc.js מוציא אותן
  // מכל חישוב תשלום/תקרה — המפגש משולם פעם אחת בלבד, על השורה המקורית.
  async function addParticipantInteractions(base, participantIds) {
    const ids = [...new Set((participantIds || []).map(Number))]
      .filter(pid => Number.isFinite(pid) && pid !== Number(base.contact_id));
    if (ids.length === 0) return { error: null };

    // id = base.id + idx + 1 — base.id הוא Date.now(), אז המזהים הנגזרים ייחודיים וצמודים לו.
    const results = await Promise.all(ids.map((pid, idx) => addInteraction({
      ...base,
      id:           base.id + idx + 1,
      contact_id:   pid,
      participants: { ...(base.participants || {}), derived_from: base.id },
    })));
    return { error: results.find(r => r && r.error)?.error || null };
  }

  // עריכת קשר שכבר דווח (לפני כן לא הייתה שום דרך לתקן/למחוק דיווח קיים).
  async function updateInteraction(interactionId, fields) {
    if (!fields || Object.keys(fields).length === 0) return { error: null };
    const row = {};
    INTERACTION_COLUMNS.forEach(key => { if (fields[key] !== undefined) row[key] = fields[key]; });
    let error = null;
    try { await apiFetch(`/api/interactions/${encodeURIComponent(interactionId)}`, { method: 'PATCH', body: row }); }
    catch (caught) { error = caught; }
    if (error) { console.error('Failed to update interaction', error); return { error }; }
    setInteractions(prev => prev.map(i => i.id === interactionId ? { ...i, ...row } : i));
    return { error: null };
  }

  async function deleteInteraction(interactionId) {
    let error = null;
    try { await apiFetch(`/api/interactions/${encodeURIComponent(interactionId)}`, { method: 'DELETE' }); }
    catch (caught) { error = caught; }
    if (error) { console.error('Failed to delete interaction', error); return { error }; }
    setInteractions(prev => prev.filter(i => i.id !== interactionId));
    return { error: null };
  }

  async function addContact(contactData) {
    // random integer 100M–999M: בטוח ב-int4, רחוק מ-seed data (1001-9999), לא גולש כמו Date.now()
    const tempId = Math.floor(Math.random() * 900_000_000) + 100_000_000;
    const newContact = { ...contactData, id: tempId, mitzvot: contactData.mitzvot || {}, mitzvot_history: [] };
    const { error } = await insertContactViaApi(apiFetch, newContact);

    if (error) {
      return { error };
    }

    const syncResult = await loadContactsFromApi(apiFetch, currentUser);
    if (syncResult.error) {
      return { error: syncResult.error };
    }
    setContacts(syncResult.data);

    // בונוס "הבאת משתתף חדש" נגזר אוטומטית מ-source/referred_by של הלקוח (ראה newParticipantBonuses לעיל).

    return { data: syncResult.data };
  }

  // F1 — עריכת פרטי לקוח קיים. שומר ל-Supabase + עדכון optimistic.
  async function updateContact(contactId, fields) {
    if (!fields || Object.keys(fields).length === 0) return { error: null };
    const { error } = await updateContactFieldsViaApi(apiFetch, contactId, fields);
    if (error) { console.error('Failed to update contact', error); return { error }; }
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, ...fields } : c));
    return { error: null };
  }

  // הוצאות — נכתבות דרך ה-store ולא ישירות מהדף, כדי שהסכום לתשלום ב-/my-dashboard
  // וב-/payments יתעדכן מיד. קודם לכן pages/expenses.jsx החזיק state משלו, והמחיקה
  // לא הגיעה לחישוב עד רענון מלא של הדף (דיווח שירה שם טוב, 2026-07-30:
  // "כשמוחקים בדיווח הוצאות... הסכום לתשלום לא משתנה").
  async function addExpense({ date, amount, description }) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('expenses').insert({
      activist_id: currentUser?.id,
      project_id:  currentUser?.project_id ?? null,
      date, amount, description,
    }).select().single();
    if (error) { console.error('Failed to insert expense', error); return { error }; }
    setExpenses(prev => [data, ...prev]);
    return { error: null };
  }

  async function deleteExpense(expenseId) {
    const supabase = getSupabaseClient();
    // select() אחרי delete — RLS שחוסמת מחזירה 0 שורות **בלי** error, ואז המחיקה
    // נראית מוצלחת ולא קרה כלום. בלי הבדיקה הזו הכישלון שקט לגמרי.
    const { data, error } = await supabase.from('expenses').delete().eq('id', expenseId).select('id');
    if (error) { console.error('Failed to delete expense', error); return { error }; }
    if (!data || data.length === 0) return { error: new Error('ההוצאה לא נמחקה — אין הרשאה, או שכבר נמחקה') };
    setExpenses(prev => prev.filter(x => Number(x.id) !== Number(expenseId)));
    return { error: null };
  }

  // F1 — מחיקת לקוח (soft-delete: is_active=false). לא נמחק פיזית, מונע אובדן נתונים.
  async function deleteContact(contactId) {
    let error = null;
    try { await apiFetch(`/api/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' }); }
    catch (caught) { error = caught; }
    if (error) { console.error('Failed to delete contact', error); return { error }; }
    setContacts(prev => prev.filter(c => c.id !== contactId));
    return { error: null };
  }

  // עדכון סרגל מצוות — מזהה שינויים, שומר היסטוריה ל-Supabase (מקור-אמת יחיד לבונוס, ראה mitzvotBonuses לעיל).
  // תוקן: הגרסה הקודמת עדכנה רק state מקומי (setContacts) בלי לכתוב ל-DB — אחרי רענון/מכשיר אחר
  // הרמה חוזרת לישנה, וחזרה על אותה שמירה יוצרת בונוס כפול על אותה עליה ששולמה כבר.
  async function updateMitzvot(contactId, activistId, newMitzvot) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return { error: new Error('Contact not found') };
    const oldMitzvot = contact.mitzvot || {};
    const history     = [...(contact.mitzvot_history || [])];
    const now         = new Date().toISOString().split('T')[0];

    for (const [mitzva, newLevel] of Object.entries(newMitzvot)) {
      const oldLevel    = Number(oldMitzvot[mitzva] ?? 0);
      const newLevelNum = Number(newLevel);
      if (newLevelNum !== oldLevel) {
        history.push({ mitzva, from: oldLevel, to: newLevelNum, date: now });
      }
    }

    const fields = { mitzvot: newMitzvot, mitzvot_history: history };
    // ה-state מתעדכן רק אחרי כתיבה מוצלחת: אחרת המסך מראה רמה חדשה שלא קיימת ב-DB,
    // ושמירה חוזרת מייצרת שורת היסטוריה שנייה על אותה עליה — כלומר בונוס כפול.
    const { error } = await updateContactFieldsViaApi(apiFetch, contactId, fields);
    if (error) return { error };
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, ...fields } : c));
    return { error: null };
  }

  // async בכוונה: הקורא חייב לדעת שהדוח באמת נכתב ל-DB לפני שהוא ממשיך.
  // pages/api/base-meetings/notify מחפש את השורה לפי id ומחזיר 404 אם היא עוד לא שם,
  // ו-updateBaseMeetingReport (ai_summary) הוא update שקט — שניהם נכשלים בלי חיווי.
  async function submitBaseMeeting(meetingId, answers, meetingData = {}) {
    const submittedReport = {
      ...meetingData,
      id: meetingId,
      answers,
      submitted: true,
      submitted_at: new Date().toISOString().split('T')[0],
    };

    setBaseMeetings(prev => {
      const exists = prev.some(m => String(m.id) === String(meetingId));
      return exists
        ? prev.map(m => String(m.id) === String(meetingId) ? { ...m, ...submittedReport } : m)
        : [submittedReport, ...prev];
    });

    return upsertReportsToSupabase([submittedReport]);
  }

  // עדכון ממוקד של דוח קיים (למשל ai_summary אחרי שליחה). update ולא upsert בכוונה —
  // אם ה-insert המקורי נכשל, זה no-op שקט במקום ליצור שורה חלקית.
  async function updateBaseMeetingReport(reportId, fields) {
    if (!fields || Object.keys(fields).length === 0) return { error: null };
    const row = {};
    REPORT_COLUMNS.forEach(key => { if (fields[key] !== undefined) row[key] = fields[key]; });
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('base_meeting_reports').update(row).eq('id', reportId);
    if (error) { console.error('Failed to update base meeting report', error); return { error }; }
    setBaseMeetings(prev => prev.map(m => String(m.id) === String(reportId) ? { ...m, ...row } : m));
    return { error: null };
  }

  function upsertBaseMeetingReports(reports = []) {
    setBaseMeetings(prev => {
      const byId = new Map(prev.map(report => [String(report.id), report]));
      reports.forEach(report => {
        if (report && report.id !== undefined && report.id !== null) byId.set(String(report.id), report);
      });
      return Array.from(byId.values());
    });

    upsertReportsToSupabase(reports);
  }

  function advanceBaseMeetingReminders(predicate = () => true) {
    let resultSummary = { changedCount: 0, notificationsCount: 0 };
    setBaseMeetings(prev => {
      const result = advanceReminderStageForReports(prev, predicate);
      resultSummary = { changedCount: result.changedCount, notificationsCount: result.notificationsCount };
      persistBaseMeetings(result.reports);
      return result.reports;
    });
    return resultSummary;
  }

  function addMessage({ title, body, project_id, currentUser }) {
    setMessages(prev => [{
      id: Date.now(), from_role: currentUser.role, from_name: currentUser.name,
      project_id: project_id ?? null, title, body,
      date: new Date().toISOString().split('T')[0], pinned: false,
    }, ...prev]);
  }

  return (
    <CrmContext.Provider value={{
      contacts, interactions, activists, messages, baseMeetings, BASE_MEETING_QUESTIONS,
      mitzvotBonuses, newParticipantBonuses, paymentConfig, expenses, tours,
      addInteraction, addParticipantInteractions, updateInteraction, deleteInteraction, addContact, updateContact, deleteContact, updateMitzvot, addExpense, deleteExpense, addMessage, submitBaseMeeting, updateBaseMeetingReport, upsertBaseMeetingReports, advanceBaseMeetingReminders,
      PROJECT_NAMES,
    }}>
      {children}
    </CrmContext.Provider>
  );
}

export function useCrm() {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error('useCrm must be used inside <CrmProvider>');
  return ctx;
}
