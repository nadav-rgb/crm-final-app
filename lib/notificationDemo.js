// lib/notificationDemo.js
// שכבת דמו להתראות בתוך המערכת.
// אין כאן Push אמיתי, SMS, WhatsApp או backend. המטרה היא להראות לארגון את הזרימה העתידית.

import { getMeetingHouses } from './meetingHousesStorage';
import users from '../data/users';
import { getSupabaseClient } from './supabaseClient';

const STORAGE_KEY = 'crm_notifications_demo_v1';
// סט מזהי "נקרא" נפרד — מכבד גם התראות generated/דמו שאין להן רשומה ב-localStorage/Supabase.
// getNotificationsForUser מכבד אותו; מסונכרן cross-device דרך טבלת notification_reads.
const READ_STORAGE_KEY = 'crm_notifications_read_v1';

function loadReadIds() {
  if (typeof window === 'undefined') return new Set();
  try {
    const saved = JSON.parse(window.localStorage.getItem(READ_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(set) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch (err) {
    console.warn('Could not save notification read-ids', err);
  }
}

// מוסיף מזהי-נקרא לסט המקומי. מחזיר את הסט המעודכן.
function addReadIds(ids) {
  const set = loadReadIds();
  ids.filter(Boolean).forEach(id => set.add(String(id)));
  saveReadIds(set);
  return set;
}

// כתיבת מצב "נקרא" ל-Supabase (cross-device) — fire-and-forget. עובד גם להתראות generated.
function writeReadsToSupabase(ids, recipientId) {
  if (recipientId === null || recipientId === undefined) return;
  const rows = ids.filter(Boolean).map(id => ({ recipient_id: String(recipientId), client_id: String(id) }));
  if (rows.length === 0) return;
  try {
    const supabase = getSupabaseClient();
    supabase.from('notification_reads').upsert(rows, { onConflict: 'recipient_id,client_id' })
      .then(({ error }) => { if (error) console.warn('notification_reads upsert failed', error.message); });
  } catch (err) {
    console.warn('notification_reads write skipped', err);
  }
}

// ── שכבת Supabase להתראות מתמשכות (cross-device) ──────────────────────────
// ההתראות הנוצרות באירוע אמת (תשלום, דיווח, שיבוץ) נכתבות גם ל-Supabase ומסונכרנות
// חזרה ל-localStorage בטעינה. ההצגה נשארת סינכרונית (קוראת localStorage). dedup לפי client_id.

function toSupabaseRow(n) {
  return {
    client_id:    n.id,
    recipient_id: String(n.user_id),
    type:         n.type || 'system',
    title:        n.title || 'התראה',
    body:         n.body || '',
    url:          n.link || null,
    priority:     n.priority || 'normal',
    read:         Boolean(n.read),
    created_at:   n.created_at || new Date().toISOString(),
  };
}

function fromSupabaseRow(r) {
  return normalizeNotification({
    id:         r.client_id || r.id,
    type:       r.type,
    title:      r.title,
    body:       r.body,
    user_id:    r.recipient_id != null ? Number(r.recipient_id) : null,
    priority:   r.priority,
    created_at: r.created_at,
    link:       r.url || null,
    read:       Boolean(r.read),
  });
}

// כתיבה ל-Supabase — fire-and-forget, לא חוסם את ה-UI. רק להתראות פרטיות (user_id מוגדר).
function writeNotificationToSupabase(n) {
  if (n.user_id === null || n.user_id === undefined) return;
  try {
    const supabase = getSupabaseClient();
    supabase.from('notifications').upsert(toSupabaseRow(n), { onConflict: 'client_id' })
      .then(({ error }) => { if (error) console.warn('notification supabase upsert failed', error.message); });
  } catch (err) {
    console.warn('notification supabase write skipped', err);
  }
}

// סנכרון התראות המשתמש מ-Supabase → localStorage (cross-device). נקרא בטעינת האפליקציה.
export async function hydrateNotificationsFromSupabase(currentUser) {
  if (typeof window === 'undefined' || !currentUser?.id) return;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', String(currentUser.id))
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) { console.warn('notification hydrate failed', error.message); return; }
    const remote = (data || []).map(fromSupabaseRow);
    const local  = loadManualNotifications();
    // מיזוג לפי id; read=true גובר (אם סומן כנקרא באחד המקורות).
    const byId = new Map();
    [...local, ...remote].forEach(n => {
      const existing = byId.get(n.id);
      byId.set(n.id, existing ? { ...existing, ...n, read: existing.read || n.read } : n);
    });
    saveManualNotifications(Array.from(byId.values()));

    // סנכרון סט "נקרא" cross-device — כולל התראות generated (שאין להן רשומה ב-notifications).
    try {
      const { data: reads } = await supabase
        .from('notification_reads')
        .select('client_id')
        .eq('recipient_id', String(currentUser.id))
        .limit(1000);
      if (Array.isArray(reads) && reads.length) {
        addReadIds(reads.map(r => r.client_id));
      }
    } catch (e) { console.warn('notification_reads hydrate skipped', e); }
  } catch (err) {
    console.warn('notification hydrate skipped', err);
  }
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function notificationId(parts) {
  return parts.filter(Boolean).join('__');
}

function normalizeNotification(raw = {}) {
  return {
    id: raw.id || notificationId(['demo', Date.now(), Math.random().toString(36).slice(2)]),
    type: raw.type || 'system',
    title: raw.title || 'התראה',
    body: raw.body || '',
    user_id: raw.user_id ?? null,
    project_id: raw.project_id ?? null,
    role: raw.role || null,
    priority: raw.priority || 'normal',
    created_at: raw.created_at || new Date().toISOString(),
    link: raw.link || null,
    read: Boolean(raw.read),
    demo: raw.demo !== false,
  };
}

function loadManualNotifications() {
  if (typeof window === 'undefined') return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    // Remove stale notifications that still point to /base-meetings
    const valid = saved.filter(n => n.link !== '/base-meetings');
    if (valid.length !== saved.length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    }
    return valid.map(normalizeNotification);
  } catch (err) {
    console.warn('Could not read demo notifications', err);
    return [];
  }
}

function saveManualNotifications(notifications) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.map(normalizeNotification)));
}

function generateAssignmentNotifications(currentUser) {
  const houses = getMeetingHouses();
  const items = [];

  houses.forEach(house => {
    const firstMeeting = house.meetings?.[0];
    const firstDate = firstMeeting?.date || house.startDate;
    const firstTime = firstMeeting?.startTime || '';

    (house.assignedActivists || []).forEach(activistId => {
      items.push(normalizeNotification({
        id: notificationId(['assignment', house.id, activistId]),
        type: 'assignment',
        title: 'שובצת לבית מפגש',
        body: `שובצת לבית מפגש ${house.houseNumber} ב${house.settlement || house.city}. המפגש הראשון: ${firstDate || 'טרם נקבע'} ${firstTime ? `בשעה ${firstTime}` : ''}.`,
        user_id: activistId,
        project_id: 2,
        priority: 'high',
        created_at: `${todayISO()}T09:00:00.000Z`,
        link: `/meeting-houses/${house.id}`,
      }));
    });
  });

  // בדמו, מנהל/רכז רואה גם התראה מערכתית על פתיחת בית מפגש חדש.
  if (currentUser?.role === 'ceo' || (['head', 'finance'].includes(currentUser?.role) && currentUser?.project_id === 2)) {
    houses.slice(0, 3).forEach(house => {
      items.push(normalizeNotification({
        id: notificationId(['manager-house-opened', house.id, currentUser.id]),
        type: 'house_opened',
        title: 'בית מפגש חדש ממתין לשיבוץ',
        body: `בית מפגש ${house.houseNumber} ב${house.settlement || house.city} זמין לשיבוץ פעיל ולעדכון מעקב.`,
        user_id: currentUser.id,
        project_id: 2,
        priority: 'normal',
        created_at: `${todayISO()}T08:00:00.000Z`,
        link: `/meeting-houses/${house.id}`,
      }));
    });
  }

  return items;
}

function generateReminderNotifications(currentUser, baseMeetings = []) {
  const items = [];

  // פעיל רואה תזכורת דמו עבור מפגשי בסיס שלא דווחו.
  baseMeetings
    .filter(m => m.activist_id === currentUser?.id && !m.submitted)
    .slice(0, 3)
    .forEach(meeting => {
      items.push(normalizeNotification({
        id: notificationId(['base-report-reminder', meeting.id, currentUser.id]),
        type: 'base_report_reminder',
        title: 'תזכורת למילוי דיווח מפגש בסיס',
        body: `טרם מולא דיווח עבור בית מפגש ${meeting.meeting_place_number}, מפגש ${meeting.meeting_number}. בדמו: התראה בשעה 23:00, 10:00 ו-11:30.`,
        user_id: currentUser.id,
        project_id: 2,
        priority: 'high',
        created_at: `${addDays(todayISO(), -1)}T21:00:00.000Z`,
        link: '/base-meetings',
      }));
    });

  // מנהל/רכז רואה התראות דמו על פעילים שלא דיווחו.
  if (currentUser?.role === 'ceo' || (['head', 'finance'].includes(currentUser?.role) && currentUser?.project_id === 2)) {
    baseMeetings
      .filter(m => !m.submitted)
      .slice(0, 4)
      .forEach(meeting => {
        items.push(normalizeNotification({
          id: notificationId(['manager-missing-report', meeting.id, currentUser.id]),
          type: 'missing_report',
          title: 'פעיל לא מילא דיווח בזמן',
          body: `${meeting.activist_name} טרם מילא דיווח עבור בית מפגש ${meeting.meeting_place_number}, מפגש ${meeting.meeting_number}.`,
          user_id: currentUser.id,
          project_id: 2,
          priority: 'high',
          created_at: `${todayISO()}T12:00:00.000Z`,
          link: '/base-meetings',
        }));
      });
  }

  return items;
}

function generateDemoNotifications(currentUser, baseMeetings = []) {
  if (!currentUser) return [];
  return [
    ...generateAssignmentNotifications(currentUser),
    ...generateReminderNotifications(currentUser, baseMeetings),
    normalizeNotification({
      id: notificationId(['system-demo', currentUser.id]),
      type: 'system',
      title: 'התראות מערכת בדמו',
      body: 'בשלב זה ההתראות מוצגות בתוך המערכת בלבד. בעתיד ניתן לחבר Push אמיתי לדפדפן ולאפליקציה.',
      user_id: currentUser.id,
      project_id: currentUser.project_id ?? null,
      priority: 'normal',
      created_at: `${todayISO()}T07:30:00.000Z`,
      link: '/notifications',
    }),
  ];
}

export function getNotificationsForUser(currentUser, baseMeetings = []) {
  const generated = generateDemoNotifications(currentUser, baseMeetings);
  const manual = loadManualNotifications();
  const all = [...manual, ...generated];

  const relevant = all.filter(n => {
    if (!currentUser) return false;
    // Notifications with an explicit user_id are private — show only to that user
    if (n.user_id !== null) return Number(n.user_id) === Number(currentUser.id);
    // Broadcast notifications (no user_id) — match by role or project
    if (n.role && n.role === currentUser.role) return true;
    if (n.project_id && currentUser.project_id && Number(n.project_id) === Number(currentUser.project_id)) return true;
    return false;
  });

  // סט "נקרא" מקומי — מכבד generated/דמו (אין להם read flag משלהם) וגם manual.
  const readIds = loadReadIds();
  const byId = new Map();
  relevant.forEach(n => {
    const norm = normalizeNotification(n);
    byId.set(n.id, { ...norm, read: norm.read || readIds.has(String(norm.id)) });
  });

  return Array.from(byId.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// סימון התראה בודדת כנקראה. עובד לכל סוג התראה (manual + generated/דמו):
// 1) מזהה נכנס לסט read-ids המקומי (getNotificationsForUser מכבד אותו).
// 2) אם קיימת רשומת manual — מסמן גם את ה-flag שלה (תאימות לאחור).
// 3) cross-device: כתיבה ל-notification_reads (וגם עדכון notifications.read אם יש רשומה).
export function markNotificationAsRead(id, currentUser) {
  if (!id) return;
  addReadIds([id]);

  const manual = loadManualNotifications();
  if (manual.some(n => String(n.id) === String(id))) {
    saveManualNotifications(manual.map(n => String(n.id) === String(id) ? { ...n, read: true } : n));
  }

  const recipientId = currentUser?.id ?? null;
  writeReadsToSupabase([id], recipientId);

  // עדכון notifications.read אם קיימת רשומה (manual שנכתבה ל-Supabase) — fire-and-forget
  try {
    const supabase = getSupabaseClient();
    supabase.from('notifications').update({ read: true }).eq('client_id', String(id))
      .then(({ error }) => { if (error) console.warn('notification read sync failed', error.message); });
  } catch (err) { /* offline / no client — נשאר ב-localStorage */ }
}

// סימון רשימת התראות כנקראות בבת אחת ("סמן הכל כנקרא").
export function markAllNotificationsAsRead(notifications = [], currentUser) {
  const ids = notifications.map(n => n.id).filter(Boolean);
  if (ids.length === 0) return;
  addReadIds(ids);

  const idSet = new Set(ids.map(String));
  const manual = loadManualNotifications();
  if (manual.some(n => idSet.has(String(n.id)))) {
    saveManualNotifications(manual.map(n => idSet.has(String(n.id)) ? { ...n, read: true } : n));
  }

  const recipientId = currentUser?.id ?? null;
  writeReadsToSupabase(ids, recipientId);

  try {
    const supabase = getSupabaseClient();
    supabase.from('notifications').update({ read: true }).in('client_id', ids.map(String))
      .then(({ error }) => { if (error) console.warn('notification read-all sync failed', error.message); });
  } catch (err) { /* offline */ }
}

export function createDemoNotification(notification) {
  const manual = loadManualNotifications();
  const item = normalizeNotification(notification);
  saveManualNotifications([item, ...manual.filter(n => n.id !== item.id)]);
  writeNotificationToSupabase(item); // cross-device — fire-and-forget
  return item;
}


export function getAchdutNotificationManagers() {
  return users.filter(user => (
    user.role === 'ceo' ||
    ((user.role === 'head' || user.role === 'finance') && Number(user.project_id) === 2)
  ));
}

export function createPaymentInteractionNotifications({ interaction, contact, activist, paymentResult }) {
  if (!interaction || !contact || !activist) return [];

  const amountText = paymentResult?.payable && paymentResult?.amount > 0
    ? `${paymentResult.amount} ₪`
    : 'לא מזכה בתשלום';

  const created = [];

  created.push(createDemoNotification({
    id: notificationId(['paid-interaction-activist', interaction.id, activist.id]),
    type: paymentResult?.payable ? 'paid_interaction' : 'interaction_saved',
    title: paymentResult?.payable ? 'הדיווח נכנס לדוח התשלומים' : 'הדיווח נשמר',
    body: paymentResult?.payable
      ? `הקשר עם ${contact.name} נשמר ונכנס לדוח התשלומים בסך ${amountText}.`
      : `הקשר עם ${contact.name} נשמר. ${paymentResult?.reason ? `סיבה לאי־זכאות: ${paymentResult.reason}.` : ''}`,
    user_id: activist.id,
    project_id: 2,
    priority: paymentResult?.payable ? 'high' : 'normal',
    created_at: new Date().toISOString(),
    link: `/contact/${contact.id}`,
  }));

  if (paymentResult?.payable && paymentResult?.amount > 0) {
    getAchdutNotificationManagers().forEach(manager => {
      created.push(createDemoNotification({
        id: notificationId(['paid-interaction-manager', interaction.id, manager.id]),
        type: 'paid_interaction_manager',
        title: 'דיווח מזכה נכנס לדוח התשלומים',
        body: `${activist.name} דיווח קשר מזכה עם ${contact.name}: ${amountText}.`,
        user_id: manager.id,
        project_id: 2,
        priority: 'high',
        created_at: new Date().toISOString(),
        link: '/payments',
      }));
    });
  }

  return created;
}

export function createBaseMeetingSubmittedNotifications({ meeting, activistName }) {
  if (!meeting) return [];
  return getAchdutNotificationManagers().map(manager => createDemoNotification({
    id: notificationId(['base-meeting-submitted-manager', meeting.id, manager.id, Date.now()]),
    type: 'base_meeting_submitted',
    title: 'דיווח מפגש בסיס התקבל',
    body: `${activistName || meeting.activist_name || 'פעיל'} מילא דיווח עבור בית מפגש ${meeting.meeting_place_number}, מפגש ${meeting.meeting_number}.`,
    user_id: manager.id,
    project_id: 2,
    priority: 'normal',
    created_at: new Date().toISOString(),
    link: '/base-meetings',
  }));
}

export function getNotificationTypeLabel(type) {
  const labels = {
    assignment: 'שיבוץ',
    base_report_reminder: 'דיווח',
    missing_report: 'חריגה',
    house_opened: 'בית מפגש',
    system: 'מערכת',
    paid_interaction: 'תשלום',
    paid_interaction_manager: 'תשלום',
    interaction_saved: 'קשר',
    base_meeting_submitted: 'דיווח',
  };
  return labels[type] || 'התראה';
}
