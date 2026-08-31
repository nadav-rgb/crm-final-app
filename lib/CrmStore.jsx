// lib/CrmStore.jsx
import { createContext, useCallback, useContext, useState, useEffect, useMemo } from 'react';
import { deriveMitzvotBonuses } from './paymentCalc';
import { BASE_MEETING_QUESTIONS } from '../data/base-meeting-questions';
import { hydrateNotificationsFromSupabase } from './notificationDemo';
import { fetchToursFromSupabase } from './toursSupabase';
import { useAuth } from './AuthStore';

const CrmContext = createContext(null);

// העמודות הקיימות בטבלת interactions ב-Supabase — סינון לפני כתיבה (משמיט mitzvot_level וכו')
const INTERACTION_COLUMNS = [
  'type', 'quality', 'date', 'time', 'duration_minutes', 'outcome', 'notes',
  'description', 'ai_summary', 'next_action', 'next_action_date',
];

function mapBaseReport(report) {
  return {
    id: report.id, project_id: report.projectId, house_id: report.houseId,
    activist_id: report.activistCode, meeting_number: report.meetingNumber,
    meeting_place_number: report.meetingPlaceNumber, meeting_place_city: report.meetingPlaceCity,
    host_name: report.hostName, facilitator_name: report.facilitatorName,
    activist_name: report.activistName, date: report.date, start_time: report.startTime,
    structured_answers: report.structuredAnswers, answers: report.answers,
    participant_count: report.participantCount, ai_summary: report.aiSummary,
    submitted: report.submitted, submitted_at: report.submittedAt,
  };
}

async function insertInteractionViaApi(apiFetch, interaction) {
  try {
    const result = await apiFetch(`/api/contacts/${encodeURIComponent(interaction.contact_id)}/interactions`, {
      method: 'POST',
      body: {
        date: interaction.date,
        time: interaction.time || '00:00',
        type: interaction.type,
        quality: interaction.quality || undefined,
        durationMinutes: interaction.duration_minutes ?? 0,
        outcome: interaction.outcome || undefined,
        notes: interaction.notes || undefined,
        description: interaction.description || undefined,
        aiSummary: interaction.ai_summary || undefined,
        nextAction: interaction.next_action ?? undefined,
        nextActionDate: interaction.next_action_date ?? undefined,
        participants: interaction.participants && !Array.isArray(interaction.participants)
          ? interaction.participants
          : undefined,
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
  if (row.age !== undefined) {
    const ageNum = Number(row.age);
    row.age = Number.isFinite(ageNum) && row.age !== '' && row.age !== null ? ageNum : null;
  }
  // נרמול רק שדות שנשלחו; PATCH מצומצם אינו מאפס שדות אחרים.
  for (const field of ['last_interaction_date', 'next_action_date', 'joined_at']) {
    if (row[field] !== undefined) row[field] = safeDate(row[field]);
  }
  return row;
}

const CONTACT_API_FIELDS = Object.freeze({
  name: 'name', phone: 'phone', city: 'city', area: 'area', depth: 'depth',
  profession: 'profession', age: 'age', gender: 'gender', high_potential: 'highPotential',
  days_since_last_contact: 'daysSinceLastContact', last_interaction_date: 'lastInteractionDate',
  next_action: 'nextAction', next_action_date: 'nextActionDate', source: 'source',
  joined_at: 'joinedAt', notes: 'notes', how_met: 'howMet', mitzvot: 'mitzvot',
  mitzvot_history: 'mitzvotHistory', is_graduate: 'isGraduate', referred_by: 'referredBy',
  meeting_place_city: 'meetingPlaceCity', meeting_place_number: 'meetingPlaceNumber',
  meetingHouseCity: 'meetingHouseCity', meetingHouseNumber: 'meetingHouseNumber',
  meetingHouseKey: 'meetingHouseKey', tour_id: 'tourId',
});

function contactApiBody(contact, { includeProject = false } = {}) {
  const row = toContactRow(contact);
  const body = {};
  for (const [legacyField, apiField] of Object.entries(CONTACT_API_FIELDS)) {
    if (row[legacyField] !== undefined) body[apiField] = row[legacyField];
  }
  if (includeProject && row.project_id !== undefined) body.projectId = Number(row.project_id);
  return body;
}

function contactDtoToLegacyRow(contact) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone ?? null,
    city: contact.city ?? '',
    area: contact.area ?? '',
    depth: contact.depth ?? '',
    profession: contact.profession ?? '',
    age: contact.age ?? null,
    gender: contact.gender ?? null,
    high_potential: Boolean(contact.highPotential),
    days_since_last_contact: Number(contact.daysSinceLastContact ?? 0),
    last_interaction_date: contact.lastInteractionDate ?? null,
    next_action: contact.nextAction ?? null,
    next_action_date: contact.nextActionAt ?? null,
    source: contact.source ?? null,
    joined_at: contact.joinedAt ?? null,
    notes: contact.notes ?? '',
    how_met: contact.howMet ?? '',
    mitzvot: contact.mitzvot ?? {},
    mitzvot_history: contact.mitzvotHistory ?? [],
    is_graduate: Boolean(contact.isGraduate),
    referred_by: contact.referredBy ?? null,
    meeting_place_city: contact.meetingPlaceCity ?? '',
    meeting_place_number: contact.meetingPlaceNumber ?? '',
    meetingHouseCity: contact.meetingHouseCity ?? '',
    meetingHouseNumber: contact.meetingHouseNumber ?? '',
    meetingHouseKey: contact.meetingHouseKey ?? '',
    tour_id: contact.tourId ?? null,
    is_active: contact.status !== 'inactive',
    assigned_user_id: contact.assignedUserId,
    activist_id: contact.activistCode,
    project_id: contact.projectId,
  };
}

async function insertContactViaApi(apiFetch, contact) {
  try {
    const result = await apiFetch('/api/contacts', {
      method: 'POST',
      body: contactApiBody(contact, { includeProject: true }),
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
    const details = await Promise.all((result.contacts || []).map((contact) => (
      apiFetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: 'GET' })
    )));
    const data = details.map(({ contact }) => contactDtoToLegacyRow(contact));
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// מחזירה { error } — הקורא (updateMitzvot) חייב לדעת אם השמירה נחתה לפני שהוא מציג
// "עודכן בהצלחה" ולפני שהוא מפעיל התראה שקוראת את השורה מה-DB.
async function updateContactFieldsViaApi(apiFetch, contactId, fields) {
  const allowed = contactApiBody(fields);
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
  const messages = [];
  const [baseMeetings, setBaseMeetings] = useState([]); // דיווחי מפגשי בסיס — מקור האמת: Supabase
  const [expenses,     setExpenses]     = useState([]); // דיווחי הוצאות — מקור האמת: Supabase (זורם לדשבורד+תשלומים)
  const [tours,        setTours]        = useState([]); // סיורים (נעים להכיר) — לשכר מדריך בדשבורד+תשלומים
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [paymentConfigError, setPaymentConfigError] = useState('');
  const [dataLoadErrors, setDataLoadErrors] = useState({});

  const markDataLoaded = useCallback((resource) => {
    setDataLoadErrors((previous) => {
      if (!previous[resource]) return previous;
      const next = { ...previous };
      delete next[resource];
      return next;
    });
  }, []);
  const markDataUnavailable = useCallback((resource) => {
    setDataLoadErrors((previous) => ({ ...previous, [resource]: true }));
  }, []);

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

  const { currentUser, authLoading, apiFetch, activeProject } = useAuth();

  // טעינת קונפיג השכר דרך ה-BFF; אין קריאת business data ישירה מהדפדפן.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setPaymentConfig(null); setPaymentConfigError(''); return; }
    let active = true;
    setPaymentConfig(null);
    setPaymentConfigError('');
    apiFetch('/api/payments/config', { method: 'GET' })
      .then(result => { if (active) setPaymentConfig(result.config); })
      .catch(() => { if (active) setPaymentConfigError('תצורת התשלום אינה זמינה כרגע.'); });
    return () => { active = false; };
  }, [currentUser, authLoading, apiFetch]);

  // טעינת לקוחות מ-Supabase — רק אחרי שההתחברות מוכנה ויש משתמש,
  // כדי שה-select לא יצא כאנונימי (קריטי כשיופעל RLS). אותה תבנית כמו base_meeting_reports.
  // מסונן לפי בעלות (activist_id) / חברות-פרויקט — בידוד נתונים בין פעילים (הגנה בצד לקוח, בנוסף ל-RLS).
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setContacts([]); markDataLoaded('contacts'); return; }
    let active = true;
    (async () => {
      const { data, error } = await loadContactsFromApi(apiFetch, currentUser);
      if (!active) return;
      if (error) { setContacts([]); markDataUnavailable('contacts'); return; }
      setContacts(data);
      markDataLoaded('contacts');
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, apiFetch, markDataLoaded, markDataUnavailable]);

  // טעינת התראות דרך ה-BFF בלבד; אין PII ב-localStorage ואין CRUD ישיר מהדפדפן.
  useEffect(() => {
    if (authLoading || !currentUser) return;
    hydrateNotificationsFromSupabase(currentUser, apiFetch);
  }, [currentUser, authLoading, apiFetch]);

  // directory מוקרן דרך ה-BFF בלבד; השרת קובע project scope ושדות מותרים לפי role.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setActivists([]); markDataLoaded('directory'); return; }
    let active = true;
    (async () => {
      const projectId = activeProject?.id ?? currentUser.project_id;
      if (!projectId) { setActivists([]); markDataLoaded('directory'); return; }
      let data;
      try {
        const result = await apiFetch(`/api/memberships?projectId=${encodeURIComponent(projectId)}`, { method: 'GET' });
        data = result.profiles;
      } catch {
        if (active) {
          setActivists([]);
          markDataUnavailable('directory');
        }
        return;
      }
      if (!active) return;
      if (Array.isArray(data)) {
        setActivists(data.map(a => ({
          userId:     a.userId,
          id:         a.activistCode ?? a.userId,
          name:       a.name,
          role:       a.role ?? (a.userId === currentUser.userId ? currentUser.role : null),
          project_id: Number(projectId),
          project_ids: [Number(projectId)],
          status:     'active',
        })));
        markDataLoaded('directory');
      }
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, activeProject, apiFetch, markDataLoaded, markDataUnavailable]);

  // טעינת דיווחי הוצאות דרך ה-BFF; השרת ו-RLS קובעים owner/project scope.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setExpenses([]); markDataLoaded('expenses'); return; }
    let active = true;
    (async () => {
      let data = [];
      let error = null;
      try {
        const result = await apiFetch('/api/expenses', { method: 'GET' });
        data = (result.expenses || []).map((item) => ({
          id: item.id, activist_id: item.activistCode ?? item.userId, actor_user_id: item.userId,
          project_id: item.projectId, date: item.occurredOn, amount: item.amount,
          description: item.description,
        }));
      } catch (caught) { error = caught; }
      if (!active) return;
      if (error) { setExpenses([]); markDataUnavailable('expenses'); return; }
      if (Array.isArray(data)) setExpenses(data);
      markDataLoaded('expenses');
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, apiFetch, markDataLoaded, markDataUnavailable]);

  // טעינת סיורים — לחישוב שכר מדריך (750₪ לסיור שהתקיים עם מדריך-פעיל). פעילות משותפת בפרויקט — מסונן לפי פרויקט בלבד.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setTours([]); markDataLoaded('tours'); return; }
    let active = true;
    (async () => {
      let data;
      let error = null;
      try { data = await fetchToursFromSupabase(apiFetch); } catch (caught) { error = caught; }
      if (!active) return;
      if (error) { setTours([]); markDataUnavailable('tours'); return; }
      if (Array.isArray(data)) setTours(data);
      markDataLoaded('tours');
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, apiFetch, markDataLoaded, markDataUnavailable]);

  // טעינת דיווחי קשר מ-Supabase — אותה תבנית: רק אחרי auth מוכן ויש משתמש. מסונן לפי בעלות.
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { setInteractions([]); markDataLoaded('interactions'); return; }
    let active = true;
    (async () => {
      const requests = contacts.map(contact => apiFetch(`/api/contacts/${encodeURIComponent(contact.id)}/interactions`, { method: 'GET' }));
      const settled = await Promise.allSettled(requests);
      if (!active) return;
      if (settled.some(result => result.status === 'rejected')) {
        setInteractions([]);
        markDataUnavailable('interactions');
        return;
      }
      const data = settled.flatMap((result, index) => (result.value.interactions || []).map(interaction => ({
        id: interaction.id,
        contact_id: interaction.contactId,
        activist_id: interaction.activistCode,
        project_id: contacts[index]?.project_id ?? null,
        date: interaction.date ?? interaction.occurredAt?.slice(0, 10),
        time: interaction.time ?? interaction.occurredAt?.slice(11, 16),
        type: interaction.type,
        quality: interaction.quality,
        duration_minutes: interaction.durationMinutes,
        outcome: interaction.outcome,
        notes: interaction.notes,
        description: interaction.description,
        ai_summary: interaction.aiSummary,
        next_action: interaction.nextAction,
        next_action_date: interaction.nextActionDate,
        participants: interaction.participants,
      })));
      setInteractions(data);
      markDataLoaded('interactions');
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, contacts, apiFetch, markDataLoaded, markDataUnavailable]);

  // טעינת דיווחי מפגשי בסיס מ-Supabase — רק אחרי שההתחברות מוכנה ויש משתמש,
  // כדי שה-select לא יצא כאנונימי (קריטי כשיופעל RLS). מסונן לפי בעלות.
  useEffect(() => {
    if (authLoading) return;                       // ממתינים לשחזור session
    if (!currentUser) { setBaseMeetings([]); markDataLoaded('baseMeetings'); return; } // אין משתמש — מאפסים
    let active = true;
    (async () => {
      let data;
      let error = null;
      try {
        const result = await apiFetch('/api/base-meetings', { method: 'GET' });
        data = (result.reports ?? []).map(mapBaseReport);
      } catch (caught) { error = caught; }
      if (!active) return;
      if (error) { setBaseMeetings([]); markDataUnavailable('baseMeetings'); return; }
      if (Array.isArray(data)) setBaseMeetings(data);
      markDataLoaded('baseMeetings');
    })();
    return () => { active = false; };
  }, [currentUser, authLoading, apiFetch, markDataLoaded, markDataUnavailable]);

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
    const savedInteraction = insertResult.data;
    const savedInteractionRow = {
      ...newInteraction,
      id: savedInteraction.id,
      activist_id: savedInteraction.activistCode ?? newInteraction.activist_id,
      date: savedInteraction.date ?? newInteraction.date,
      time: savedInteraction.time ?? newInteraction.time,
      duration_minutes: savedInteraction.durationMinutes ?? newInteraction.duration_minutes,
      outcome: savedInteraction.outcome ?? newInteraction.outcome,
      description: savedInteraction.description ?? newInteraction.description,
      ai_summary: savedInteraction.aiSummary ?? newInteraction.ai_summary,
      next_action: savedInteraction.nextAction ?? newInteraction.next_action,
      next_action_date: savedInteraction.nextActionDate ?? newInteraction.next_action_date,
      participants: savedInteraction.participants ?? newInteraction.participants,
    };
    setInteractions(prev => prev.map(row => row.id === newInteraction.id ? savedInteractionRow : row));

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

    return { data: savedInteractionRow, error: null };
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
      id:           Date.now() + idx + 1,
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
    const body = {
      ...(row.type !== undefined ? { type: row.type } : {}),
      ...(row.quality !== undefined ? { quality: row.quality } : {}),
      ...(row.date !== undefined ? { date: row.date } : {}),
      ...(row.time !== undefined ? { time: row.time } : {}),
      ...(row.duration_minutes !== undefined ? { durationMinutes: row.duration_minutes } : {}),
      ...(row.outcome !== undefined ? { outcome: row.outcome } : {}),
      ...(row.notes !== undefined ? { notes: row.notes } : {}),
      ...(row.description !== undefined ? { description: row.description } : {}),
      ...(row.ai_summary !== undefined ? { aiSummary: row.ai_summary } : {}),
      ...(row.next_action !== undefined ? { nextAction: row.next_action } : {}),
      ...(row.next_action_date !== undefined ? { nextActionDate: row.next_action_date } : {}),
    };
    let error = null;
    try { await apiFetch(`/api/interactions/${encodeURIComponent(interactionId)}`, { method: 'PATCH', body }); }
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
    const insertResult = await insertContactViaApi(apiFetch, newContact);
    const { error } = insertResult;

    if (error) {
      return { error };
    }

    const savedContact = insertResult.data;
    const savedContactRow = contactDtoToLegacyRow(savedContact);
    setContacts(prev => [savedContactRow, ...prev]);

    // בונוס "הבאת משתתף חדש" נגזר אוטומטית מ-source/referred_by של הלקוח (ראה newParticipantBonuses לעיל).

    return { data: savedContactRow, error: null };
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
    let data;
    let error = null;
    try {
      const result = await apiFetch('/api/expenses', {
        method: 'POST', body: { occurredOn: date, amount, description },
      });
      const item = result.expense;
      data = {
        id: item.id, activist_id: item.activistCode ?? item.userId, actor_user_id: item.userId,
        project_id: item.projectId, date: item.occurredOn, amount: item.amount,
        description: item.description,
      };
    } catch (caught) { error = caught; }
    if (error) { console.error('Failed to insert expense', error); return { error }; }
    setExpenses(prev => [data, ...prev]);
    return { error: null };
  }

  async function deleteExpense(expenseId) {
    let error = null;
    try { await apiFetch(`/api/expenses/${encodeURIComponent(expenseId)}`, { method: 'DELETE', body: {} }); }
    catch (caught) { error = caught; }
    if (error) { console.error('Failed to delete expense', error); return { error }; }
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
    try {
      const result = await apiFetch('/api/base-meetings', {
        method: 'POST',
        body: {
          id: String(meetingId), houseId: meetingData.house_id,
          meetingNumber: Number(meetingData.meeting_number), date: meetingData.date,
          startTime: meetingData.start_time || '', structuredAnswers: meetingData.structured_answers,
          answers, participantCount: Number(meetingData.participant_count) || 0,
        },
      });
      const saved = mapBaseReport(result.report);
      setBaseMeetings(prev => {
        const exists = prev.some(m => String(m.id) === String(meetingId));
        return exists ? prev.map(m => String(m.id) === String(meetingId) ? saved : m) : [saved, ...prev];
      });
      return { error: null };
    } catch (error) {
      return { error };
    }
  }

  // עדכון ממוקד של דוח קיים (למשל ai_summary אחרי שליחה). update ולא upsert בכוונה —
  // אם ה-insert המקורי נכשל, זה no-op שקט במקום ליצור שורה חלקית.
  async function updateBaseMeetingReport(reportId, fields) {
    const existing = baseMeetings.find(report => String(report.id) === String(reportId));
    if (!existing) return { error: new Error('Report is unavailable') };
    try {
      const result = await apiFetch('/api/base-meetings', {
        method: 'PATCH',
        body: {
          id: String(reportId),
          structuredAnswers: fields.structured_answers ?? existing.structured_answers ?? {},
          answers: fields.answers ?? existing.answers ?? '',
          participantCount: Number(fields.participant_count ?? existing.participant_count) || 0,
        },
      });
      const saved = mapBaseReport(result.report);
      setBaseMeetings(prev => prev.map(report => String(report.id) === String(reportId) ? saved : report));
      return { error: null };
    } catch (error) {
      return { error };
    }
  }

  return (
    <CrmContext.Provider value={{
      contacts, interactions, activists, messages, baseMeetings, BASE_MEETING_QUESTIONS,
      mitzvotBonuses, newParticipantBonuses, paymentConfig, paymentConfigError, expenses, tours,
      addInteraction, addParticipantInteractions, updateInteraction, deleteInteraction, addContact, updateContact, deleteContact, updateMitzvot, addExpense, deleteExpense, submitBaseMeeting, updateBaseMeetingReport,
      PROJECT_NAMES,
    }}>
      {Object.keys(dataLoadErrors).length > 0 && (
        <div role="alert" style={{ position:'fixed', zIndex:10000, top:12, left:12, right:12, maxWidth:560, margin:'0 auto', padding:'10px 14px', borderRadius:10, background:'#fff1f1', color:'#a63230', boxShadow:'0 3px 14px rgba(0,0,0,0.16)', fontSize:13, fontWeight:700, textAlign:'center' }}>
          חלק מהנתונים אינם זמינים כרגע. לא נטענו נתוני דמו במקום המידע המאומת.
        </div>
      )}
      {children}
    </CrmContext.Provider>
  );
}

export function useCrm() {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error('useCrm must be used inside <CrmProvider>');
  return ctx;
}
