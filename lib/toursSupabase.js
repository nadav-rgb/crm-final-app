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
