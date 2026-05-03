// lib/baseMeetingUtils.js
// מחבר בין בתי מפגש לבין דיווחי מפגשי בסיס.
// כרגע זה דמו מקומי, אבל המבנה בנוי כך שבעתיד אפשר להזין בתי מפגש מ-Google Sheets / Forms
// והפעילים יקבלו אוטומטית 4 משימות דיווח לכל בית מפגש שאליו שובצו.

export function createBaseMeetingId(houseId, activistId, meetingNumber) {
  return `house_${houseId}_activist_${activistId}_meeting_${meetingNumber}`;
}

function normalizeExistingReports(reports = []) {
  const map = new Map();
  reports.forEach(report => {
    if (!report || report.id === undefined || report.id === null) return;
    map.set(String(report.id), report);
  });
  return map;
}

export function buildBaseMeetingsFromHouses({ houses = [], activists = [], existingReports = [] }) {
  const existingById = normalizeExistingReports(existingReports);
  const generatedIds = new Set();
  const generated = [];

  houses.forEach(house => {
    const assignedActivists = Array.isArray(house.assignedActivists) ? house.assignedActivists : [];
    const meetings = Array.isArray(house.meetings) && house.meetings.length
      ? house.meetings
      : [1, 2, 3, 4].map(meetingNumber => ({ meetingNumber, date: '', startTime: '' }));

    assignedActivists.forEach(activistId => {
      const activist = activists.find(a => Number(a.id) === Number(activistId));

      meetings.forEach((meeting, index) => {
        const meetingNumber = Number(meeting.meetingNumber || index + 1);
        const id = createBaseMeetingId(house.id, activistId, meetingNumber);
        generatedIds.add(String(id));

        const base = {
          id,
          house_id: house.id,
          activist_id: Number(activistId),
          meeting_place_number: house.houseNumber,
          meeting_place_city: house.settlement || house.city || '',
          host_name: house.hostName || '',
          facilitator_name: house.facilitatorName || '',
          activist_name: activist?.name || '',
          meeting_number: meetingNumber,
          date: meeting.date || '',
          start_time: meeting.startTime || '',
          answers: null,
          ai_summary: null,
          ai_status: null,
          raw_text: null,
          created_from_voice: false,
          reminderStage: 0,
          submitted: false,
          submitted_at: null,
          source: 'meeting-house',
        };

        generated.push({ ...base, ...(existingById.get(String(id)) || {}) });
      });
    });
  });

  // שומר גם דיווחי דמו ישנים שאינם קשורים לבית מפגש חדש, כדי לא לשבור מידע קיים.
  const legacyReports = existingReports.filter(report => !generatedIds.has(String(report.id)));

  return [...generated, ...legacyReports].sort((a, b) => {
    const dateA = a.date || '9999-12-31';
    const dateB = b.date || '9999-12-31';
    return dateA.localeCompare(dateB) || Number(a.meeting_number || 0) - Number(b.meeting_number || 0);
  });
}

export function getMeetingSeriesReports({ houseId, reports = [] }) {
  return reports
    .filter(report => String(report.house_id) === String(houseId))
    .sort((a, b) => Number(a.meeting_number || 0) - Number(b.meeting_number || 0));
}
