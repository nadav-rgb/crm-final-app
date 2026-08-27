// Browser adapter for the meeting-house BFF. It never creates a Supabase client,
// reads a provider token, or falls back to local PII storage.

export function mapRowToHouse(row = {}) {
  return {
    id: row.id,
    settlement: row.settlement || '',
    city: row.city || row.settlement || '',
    houseNumber: row.house_number || '',
    hostName: row.host_name || '',
    facilitatorName: row.facilitator_name || '',
    status: row.status || 'upcoming',
    meetings: Array.isArray(row.meetings) ? row.meetings : [],
    assignedUserIds: Array.isArray(row.assigned_user_ids) ? row.assigned_user_ids : [],
    assignedActivists: Array.isArray(row.assigned_user_ids) ? row.assigned_user_ids : [],
    source: 'bff',
    createdAt: row.created_at,
    project_id: row.project_id ?? null,
  };
}

export function mapHouseToRow(house = {}) {
  return {
    ...(house.id !== undefined ? { id: house.id } : {}),
    houseNumber: house.houseNumber || '',
    settlement: house.settlement || '',
    city: house.city || house.settlement || '',
    hostName: house.hostName || '',
    facilitatorName: house.facilitatorName || '',
    assignedUserIds: Array.isArray(house.assignedUserIds)
      ? house.assignedUserIds
      : (Array.isArray(house.assignedActivists) ? house.assignedActivists : []),
    meetings: Array.isArray(house.meetings) ? house.meetings : [],
  };
}

export async function fetchMeetingHousesFromSupabase(apiFetch) {
  const result = await apiFetch('/api/meeting-houses', { method: 'GET' });
  return Array.isArray(result.houses) ? result.houses.map(mapRowToHouse) : [];
}

export async function upsertMeetingHouseApi(apiFetch, house) {
  const result = await apiFetch('/api/meeting-houses/upsert', {
    method: 'POST', body: mapHouseToRow(house),
  });
  return result.house ? mapRowToHouse(result.house) : null;
}

export async function updateAssignmentsApi(apiFetch, houseId, assignedUserIds) {
  const result = await apiFetch('/api/meeting-houses/assign', {
    method: 'POST', body: { houseId, assignedUserIds: assignedUserIds || [] },
  });
  return result.house ? mapRowToHouse(result.house) : null;
}

export async function sendAssignmentPushApi(apiFetch, { houseId }) {
  return apiFetch('/api/push/send', {
    method: 'POST', body: { eventType: 'meeting_house_assigned', resourceId: houseId },
  });
}
