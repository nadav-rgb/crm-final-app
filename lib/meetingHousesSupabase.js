// lib/meetingHousesSupabase.js
// שכבת נתונים ל-Supabase עבור בתי מפגש.
// קריאות: ישירות מהקליינט (RLS מתיר SELECT למשתמש מחובר).
// כתיבות: דרך API server-side מאומת (עוקף RLS עם מפתח admin) — בלי לשנות RLS.
//
// localStorage (lib/meetingHousesStorage.js) נשאר כ-fallback זמני בלבד עבור
// בתי מפגש דמו ישנים — לא כמקור אמת.

import { getSupabaseClient } from './supabaseClient';
import { normalizeMeetingHouse } from './meetingHousesStorage';

// ---- מיפוי עמודות DB <-> צורת האפליקציה ----

// שורת DB -> אובייקט בית מפגש בצורת האפליקציה (דרך normalizeMeetingHouse)
export function mapRowToHouse(row = {}) {
  return normalizeMeetingHouse({
    id:              row.id,
    settlement:      row.settlement || '',
    city:            row.city || row.settlement || '',
    houseNumber:     row.house_number || '',
    hostName:        row.host_name || '',
    facilitatorName: row.facilitator_name || '',
    status:          row.status || 'upcoming',
    meetings:        Array.isArray(row.meetings) ? row.meetings : [],
    assignedActivists: Array.isArray(row.assigned_activists) ? row.assigned_activists : [],
    source:          row.source || 'supabase',
    createdAt:       row.created_at,
    project_id:      row.project_id ?? null,
  });
}

// אובייקט בית מפגש בצורת האפליקציה -> שורת DB
export function mapHouseToRow(house = {}) {
  return {
    id:              String(house.id),
    house_number:    house.houseNumber || '',
    settlement:      house.settlement || '',
    city:            house.city || house.settlement || '',
    host_name:       house.hostName || '',
    facilitator_name: house.facilitatorName || '',
    project_id:      house.project_id ?? 1,
    status:          house.status || 'upcoming',
    assigned_activists: Array.isArray(house.assignedActivists) ? house.assignedActivists : [],
    meetings:        Array.isArray(house.meetings) ? house.meetings : [],
    source:          'supabase',
  };
}

// ---- קריאות (קליינט, RLS-friendly) ----

// מחזיר את כל בתי המפגש מ-Supabase בצורת האפליקציה. שגיאה -> מערך ריק.
export async function fetchMeetingHousesFromSupabase() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('meeting_houses').select('*');
  if (error) {
    console.error('Failed to load meeting houses from Supabase', error);
    return [];
  }
  return Array.isArray(data) ? data.map(mapRowToHouse) : [];
}

// ---- כתיבות (דרך API server-side מאומת) ----

async function authHeader() {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// יוצר/מעדכן בית מפגש שלם ב-Supabase. מחזיר את הבית המנורמל או null.
export async function upsertMeetingHouseApi(house) {
  const row = mapHouseToRow(house);
  const res = await fetch('/api/meeting-houses/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ house: row }),
  });
  if (!res.ok) {
    console.error('upsertMeetingHouseApi failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  const { house: saved } = await res.json();
  return saved ? mapRowToHouse(saved) : null;
}

// מעדכן את רשימת הפעילים המשובצים לבית מפגש. מחזיר את הבית המעודכן או null.
export async function updateAssignmentsApi(houseId, assignedActivists) {
  const res = await fetch('/api/meeting-houses/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ houseId: String(houseId), assignedActivists: assignedActivists || [] }),
  });
  if (!res.ok) {
    console.error('updateAssignmentsApi failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  const { house: saved } = await res.json();
  return saved ? mapRowToHouse(saved) : null;
}
