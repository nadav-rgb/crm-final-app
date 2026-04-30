// lib/meetingHousesStorage.js
// שכבת דמו מקומית לבתי מפגש.
// בעתיד אפשר להחליף את הפונקציות כאן בקריאה ל-Google Sheets / Google Forms / API,
// בלי לשנות את מבנה העמודים.

import mockMeetingHouses from '../mocks/mockMeetingHouses';
import mockExternalMeetingHouses from '../mocks/mockExternalMeetingHouses';

const STORAGE_KEY = 'crm_meeting_houses_demo_v1';

function isLocalHouse(house) {
  return ['manual-demo', 'external-demo'].includes(house?.source);
}

export function normalizeMeetingHouse(raw = {}) {
  const meetings = Array.from({ length: 4 }).map((_, index) => {
    const existing = raw.meetings?.[index] || {};
    return {
      meetingNumber: index + 1,
      date: existing.date || '',
      startTime: existing.startTime || '',
    };
  });

  return {
    id: raw.id,
    settlement: raw.settlement || raw.city || '',
    city: raw.city || raw.settlement || '',
    houseNumber: raw.houseNumber || '',
    hostName: raw.hostName || '',
    facilitatorName: raw.facilitatorName || '',
    startDate: raw.startDate || meetings[0]?.date || '',
    status: raw.status || 'פתוח לשיבוץ',
    meetings,
    assignedActivists: Array.isArray(raw.assignedActivists) ? raw.assignedActivists : [],
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

  const updatedHouse = normalizeMeetingHouse({ ...current, assignedActivists, source: current.source || 'manual-demo' });
  const updated = [...all.filter(h => String(h.id) !== String(id)), updatedHouse];
  const onlyLocal = updated.filter(isLocalHouse);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(onlyLocal));
  return updatedHouse;
}


export function mapExternalMeetingHouse(raw = {}) {
  return normalizeMeetingHouse({
    ...raw,
    id: raw.id || `external-${raw.externalId || raw.houseNumber || Date.now()}`,
    city: raw.city || raw.settlement || '',
    settlement: raw.settlement || raw.city || '',
    source: 'external-demo',
    externalId: raw.externalId || null,
    createdAt: new Date().toISOString(),
  });
}

export function importExternalMeetingHousesDemo() {
  if (typeof window === 'undefined') return [];

  const current = getMeetingHouses();
  const imported = mockExternalMeetingHouses.map(mapExternalMeetingHouse);
  const importedIds = new Set(imported.map(h => String(h.id)));

  const merged = [
    ...current.filter(h => !importedIds.has(String(h.id))),
    ...imported,
  ];

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.filter(isLocalHouse)));
  return imported;
}
