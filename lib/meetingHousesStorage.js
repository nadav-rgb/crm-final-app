// lib/meetingHousesStorage.js
import mockMeetingHouses from '../mocks/mockMeetingHouses';

const STORAGE_KEY = 'crm_meeting_houses_demo_v1';

function isLocalHouse(house) {
  return ['manual-demo', 'external-demo'].includes(house?.source);
}

function deriveHouseStatus(meetings) {
  const all = meetings || [];
  if (all.length === 0) return 'upcoming';
  const completedCount = all.filter(m => m.completed).length;
  if (completedCount === 0) return 'upcoming';
  if (completedCount >= 4 && all[3]?.completed) {
    const fourthDate = all[3]?.date;
    if (fourthDate) {
      const daysSince = (Date.now() - new Date(fourthDate + 'T12:00:00').getTime()) / 86400000;
      if (daysSince >= 7) return 'completed';
    }
    // All 4 done but fewer than 7 days since the 4th meeting — still active
    return 'active';
  }
  return 'active';
}

export function normalizeMeetingHouse(raw = {}) {
  const meetings = Array.from({ length: 4 }).map((_, index) => {
    const existing = raw.meetings?.[index] || {};
    return {
      meetingNumber: index + 1,
      index: index + 1,
      date: existing.date || '',
      startTime: existing.startTime || '',
      completed: Boolean(existing.completed),
      notes: existing.notes || '',
      summary: existing.summary || '',
    };
  });

  const status = deriveHouseStatus(meetings);

  return {
    id: raw.id,
    settlement: raw.settlement || raw.city || '',
    city: raw.city || raw.settlement || '',
    houseNumber: raw.houseNumber || '',
    meetingHouseNumber: raw.houseNumber || '',
    meetingHouseCity: raw.settlement || raw.city || '',
    hostName: raw.hostName || '',
    facilitatorName: raw.facilitatorName || '',
    startDate: raw.startDate || meetings[0]?.date || '',
    status,
    meetings,
    assignedActivists: Array.isArray(raw.assignedActivists) ? raw.assignedActivists : [],
    assignedActivistId: Array.isArray(raw.assignedActivists) ? (raw.assignedActivists[0] ?? null) : null,
    source: raw.source || 'manual-demo',
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

export function getMeetingHouses() {
  const base = mockMeetingHouses.map(normalizeMeetingHouse);

  if (typeof window === 'undefined') return base;

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    const normalizedSaved = Array.isArray(saved) ? saved.map(normalizeMeetingHouse) : [];
    const savedIds = new Set(normalizedSaved.map(h => String(h.id)));
    return [...base.filter(h => !savedIds.has(String(h.id))), ...normalizedSaved];
  } catch (err) {
    console.warn('Could not read meeting houses from localStorage', err);
    return base;
  }
}

export function getMeetingHouseById(id) {
  return getMeetingHouses().find(h => String(h.id) === String(id));
}

export function saveManualMeetingHouse(house) {
  if (typeof window === 'undefined') return null;

  const all = getMeetingHouses();
  const newHouse = normalizeMeetingHouse({
    ...house,
    id: house.id || Date.now(),
    source: 'manual-demo',
    createdAt: new Date().toISOString(),
  });

  const updated = [...all.filter(h => String(h.id) !== String(newHouse.id)), newHouse];
  const onlyLocal = updated.filter(isLocalHouse);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(onlyLocal));
  return newHouse;
}

export function updateMeetingHouseAssignments(id, assignedActivists) {
  if (typeof window === 'undefined') return null;

  const all = getMeetingHouses();
  const current = all.find(h => String(h.id) === String(id));
  if (!current) return null;

  const updatedHouse = normalizeMeetingHouse({ ...current, assignedActivists, source: 'manual-demo' });
  const updated = [...all.filter(h => String(h.id) !== String(id)), updatedHouse];
  const onlyLocal = updated.filter(isLocalHouse);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(onlyLocal));
  return updatedHouse;
}

export function updateMeetingCompletion(id, meetingIndex, { completed, notes }) {
  if (typeof window === 'undefined') return null;

  const all = getMeetingHouses();
  const current = all.find(h => String(h.id) === String(id));
  if (!current) return null;

  const updatedMeetings = current.meetings.map((m, idx) =>
    idx === meetingIndex - 1
      ? { ...m, completed, notes: notes !== undefined ? notes : m.notes }
      : m
  );

  const updatedHouse = normalizeMeetingHouse({
    ...current,
    meetings: updatedMeetings,
    source: 'manual-demo',
  });

  const updated = [...all.filter(h => String(h.id) !== String(id)), updatedHouse];
  const onlyLocal = updated.filter(isLocalHouse);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(onlyLocal));
  return updatedHouse;
}

