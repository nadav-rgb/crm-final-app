// Compatibility facade for legacy callers. Notification authority and persistence live in the
// opaque-session BFF; this module deliberately keeps no PII in browser persistence and performs
// no direct Supabase CRUD. Task 15 removes the remaining legacy call sites.

let apiClient = null;
let ownerUserId = null;
let visibleNotifications = [];

function normalizeNotification(raw = {}) {
  return {
    id: raw.id,
    type: raw.type || 'system',
    title: raw.title || 'התראה',
    body: raw.body || '',
    priority: raw.priority || 'normal',
    created_at: raw.createdAt || raw.created_at || null,
    link: raw.url || raw.link || null,
    read: Boolean(raw.read),
  };
}

function requireOwnedRuntime(currentUser) {
  if (!currentUser?.id || String(currentUser.id) !== ownerUserId) return [];
  return visibleNotifications;
}

export async function hydrateNotificationsFromSupabase(currentUser, apiFetch) {
  if (!currentUser?.id || typeof apiFetch !== 'function') {
    apiClient = null;
    ownerUserId = null;
    visibleNotifications = [];
    return [];
  }
  apiClient = apiFetch;
  ownerUserId = String(currentUser.id);
  try {
    const result = await apiFetch('/api/notifications', { method: 'GET' });
    visibleNotifications = (result.notifications || []).map(normalizeNotification);
  } catch {
    // Fail closed: stale data from a prior identity is never retained after a failed refresh.
    visibleNotifications = [];
  }
  return visibleNotifications;
}

export function getNotificationsForUser(currentUser) {
  return [...requireOwnedRuntime(currentUser)].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function markRead(ids, currentUser) {
  const owned = requireOwnedRuntime(currentUser);
  if (!apiClient || owned.length === 0) return;
  const ownedIds = new Set(owned.map((item) => String(item.id)));
  const safeIds = [...new Set(ids.map(String))].filter((id) => ownedIds.has(id));
  if (safeIds.length === 0) return;
  await apiClient('/api/notifications', { method: 'POST', body: { ids: safeIds } });
  visibleNotifications = visibleNotifications.map((item) => safeIds.includes(String(item.id)) ? { ...item, read: true } : item);
}

export function markNotificationAsRead(id, currentUser) {
  return id ? markRead([id], currentUser) : Promise.resolve();
}

export function markAllNotificationsAsRead(notifications = [], currentUser) {
  return markRead(notifications.map((item) => item.id).filter(Boolean), currentUser);
}

// Legacy browser-created notifications are intentionally disabled. Callers already invoke a
// server event route for authoritative notification creation, or are removed during Task 15.
export function createDemoNotification() { return null; }
export async function fetchNotificationRecipients() { return []; }
export function getAchdutNotificationManagers() { return []; }
export function createPaymentInteractionNotifications() { return []; }
export function createInteractionEditedNotification() { return null; }

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
    interaction_summary: 'סיכום',
    interaction_edited: 'עדכון תשלום',
    message: 'הודעה',
    next_action: 'תזכורת',
  };
  return labels[type] || 'התראה';
}
