// lib/toursSupabase.js — שכבת נתונים לסיורים ("נעים להכיר").
// קריאות: ישירות מהקליינט (RLS מתיר SELECT למחובר). כתיבות: דרך API מאומת (admin key).
// אותה ארכיטקטורה כמו meetingHousesSupabase.
import { getSupabaseClient } from './supabaseClient';

export function mapRowToTour(row = {}) {
  return {
    id:                row.id,
    tourNumber:        row.tour_number || '',
    settlement:        row.settlement || '',
    date:              row.date || null,
    startTime:         row.start_time || '',
    guideName:         row.guide_name || '',
    guideActivistId:   row.guide_activist_id ?? null,
    hostActivistId:    row.host_activist_id ?? null,
    assignedActivists: Array.isArray(row.assigned_activists) ? row.assigned_activists : [],
    status:            row.status || 'upcoming',
    notes:             row.notes || '',
    project_id:        row.project_id ?? 2,
    report:            row.report ?? null,
    reportedBy:        row.reported_by ?? null,
    reportedAt:        row.reported_at ?? null,
    createdAt:         row.created_at,
  };
}

export function mapTourToRow(tour = {}) {
  return {
    id:                 String(tour.id),
    tour_number:        tour.tourNumber || '',
    settlement:         tour.settlement || '',
    date:               tour.date || null,
    start_time:         tour.startTime || '',
    guide_name:         tour.guideName || '',
    guide_activist_id:  tour.guideActivistId ?? null,
    host_activist_id:   tour.hostActivistId ?? null,
    assigned_activists: Array.isArray(tour.assignedActivists) ? tour.assignedActivists : [],
    status:             tour.status || 'upcoming',
    notes:              tour.notes || '',
    project_id:         tour.project_id ?? 2,
  };
}

async function authHeader() {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchToursFromSupabase() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('tours').select('*').order('date', { ascending: true });
  if (error) { console.error('Failed to load tours', error); return []; }
  return Array.isArray(data) ? data.map(mapRowToTour) : [];
}

export async function upsertTourApi(tour) {
  const res = await fetch('/api/tours/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ tour: mapTourToRow(tour) }),
  });
  if (!res.ok) { console.error('upsertTourApi failed', res.status, await res.text().catch(() => '')); return null; }
  const { tour: saved } = await res.json();
  return saved ? mapRowToTour(saved) : null;
}

// עריכת פרטי סיור קיים (תיקון טעות). בניגוד ל-upsert, השרת משווה לשורה הישנה ושולח
// לנוגעים בדבר התראה עם *מה* השתנה. לא נוגע בשיבוצים, בסטטוס ובדיווח שכבר הוגש.
// מחזיר { tour, changes, notified } או null בכישלון.
export async function updateTourApi(tour) {
  const res = await fetch('/api/tours/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ tour: mapTourToRow(tour) }),
  });
  if (!res.ok) { console.error('updateTourApi failed', res.status, await res.text().catch(() => '')); return null; }
  const { tour: saved, changes, notified } = await res.json();
  if (!saved) return null;
  return { tour: mapRowToTour(saved), changes: changes || [], notified: notified || [] };
}

// הגשת דיווח מובנה אחרי סיור — מסמן את הסיור כ"התקיים". מחזיר את הסיור המעודכן או null.
export async function submitTourReportApi(tourId, report) {
  const res = await fetch('/api/tours/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ tourId: String(tourId), report }),
  });
  if (!res.ok) { console.error('submitTourReportApi failed', res.status, await res.text().catch(() => '')); return null; }
  const { tour: saved } = await res.json();
  return saved ? mapRowToTour(saved) : null;
}

// שולח התראות (פעמון + push) על סיור חדש לכל הנמענים — בצד השרת (admin, עוקף RLS).
// מחליף את יצירת ההתראות בצד-לקוח שנכשלה עבור נמענים שאינם יוצר הסיור. מחזיר סיכום או null.
export async function notifyTourCreatedApi(tourId) {
  try {
    const res = await fetch('/api/tours/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ tourId: String(tourId) }),
    });
    if (!res.ok) { console.error('notifyTourCreatedApi failed', res.status, await res.text().catch(() => '')); return null; }
    return await res.json();
  } catch (err) {
    console.error('notifyTourCreatedApi error', err);
    return null;
  }
}

export async function updateTourAssignmentsApi(tourId, assignedActivists) {
  const res = await fetch('/api/tours/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ tourId: String(tourId), assignedActivists: assignedActivists || [] }),
  });
  if (!res.ok) { console.error('updateTourAssignmentsApi failed', res.status, await res.text().catch(() => '')); return null; }
  const { tour: saved } = await res.json();
  return saved ? mapRowToTour(saved) : null;
}
