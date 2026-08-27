// Browser adapter for tour BFF routes. Authentication is opaque-cookie + CSRF via apiFetch.
export function mapRowToTour(row = {}) {
  return {
    id: row.id,
    tourNumber: row.tourNumber ?? row.tour_number ?? row.title ?? '',
    settlement: row.settlement || '', date: row.date || null, startTime: row.startTime ?? row.start_time ?? '',
    guideName: row.guideName ?? row.guide_name ?? '',
    guideUserId: row.guideUserId ?? row.guide_user_id ?? null,
    hostUserId: row.hostUserId ?? row.host_user_id ?? null,
    assignedUserIds: row.assignedUserIds ?? row.assigned_user_ids ?? [],
    assignedActivists: row.assignedUserIds ?? row.assigned_user_ids ?? [],
    status: row.status || 'upcoming', notes: row.notes || '', project_id: row.projectId ?? row.project_id ?? null,
    report: row.report ?? null, reportedBy: row.reportedByUserId ?? null, reportedAt: row.reportedAt ?? null,
  };
}

function editable(tour = {}) {
  return {
    title: tour.tourNumber || tour.title || 'סיור',
    tourNumber: tour.tourNumber || undefined,
    settlement: tour.settlement || undefined,
    date: tour.date || undefined,
    startTime: tour.startTime || undefined,
    guideName: tour.guideName || undefined,
    notes: tour.notes || undefined,
  };
}

export async function fetchToursFromSupabase(apiFetch) {
  const result = await apiFetch('/api/tours/upsert', { method: 'GET' });
  return (result.tours || []).map(mapRowToTour);
}

export async function upsertTourApi(apiFetch, tour) {
  const result = await apiFetch('/api/tours/upsert', { method: 'POST', body: { ...editable(tour), id: tour.id } });
  return result.tour ? mapRowToTour(result.tour) : null;
}

export async function updateTourApi(apiFetch, tour) {
  const { title: _title, ...changes } = editable(tour);
  const result = await apiFetch('/api/tours/update', { method: 'POST', body: { tourId: tour.id, changes } });
  return result.tour ? { tour: mapRowToTour(result.tour), changes: result.changes || [], notified: result.notified || [] } : null;
}

export async function cancelTourApi(apiFetch, tourId, reason) {
  const result = await apiFetch('/api/tours/cancel', { method: 'POST', body: { tourId, reason: reason || undefined } });
  return result.tour ? { tour: mapRowToTour(result.tour), notified: result.notified || [] } : null;
}

export async function deleteTourApi(apiFetch, tourId) {
  try {
    const result = await apiFetch('/api/tours/delete', { method: 'POST', body: { tourId } });
    return { ok: Boolean(result.deleted), notified: [] };
  } catch (error) {
    return { ok: false, message: error.publicMessage || 'מחיקת הסיור נכשלה — נסה שוב' };
  }
}

export async function submitTourReportApi(apiFetch, tourId, report) {
  const safeReport = {
    notes: report.general_notes || report.notes || 'דיווח סיור',
    participantCount: Number(report.participant_count) || 0,
    outcome: report.group_progress || undefined,
  };
  const result = await apiFetch('/api/tours/report', { method: 'POST', body: { tourId, report: safeReport } });
  return result.tour ? mapRowToTour(result.tour) : null;
}

export async function notifyTourCreatedApi(apiFetch, tourId) {
  return apiFetch('/api/tours/notify', { method: 'POST', body: { tourId } });
}

export async function updateTourAssignmentsApi(apiFetch, tourId, assignedUserIds, options = {}) {
  const result = await apiFetch('/api/tours/assign', {
    method: 'POST', body: {
      tourId, assignedUserIds: assignedUserIds || [],
      guideUserId: options.guideUserId, hostUserId: options.hostUserId,
    },
  });
  return result.tour ? mapRowToTour(result.tour) : null;
}
