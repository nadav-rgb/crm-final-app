// mocks/mockExternalMeetingHouses.js
// סימולציה של נתונים שמגיעים מבחוץ: Google Sheets / Google Forms / קובץ שהפקידה ממלאת.
// בעתיד מחליפים רק את מקור הנתונים, ושומרים על אותו מבנה פנימי של בית מפגש.

const mockExternalMeetingHouses = [
  {
    externalId: 'sheet-row-501',
    houseNumber: 'AJ-201',
    settlement: 'נתניה',
    hostName: 'משפחת ישראלי',
    facilitatorName: 'הרב מנחם כהן',
    status: 'חדש מייבוא חיצוני',
    meetings: [
      { meetingNumber: 1, date: '2026-06-02', startTime: '20:00' },
      { meetingNumber: 2, date: '2026-06-09', startTime: '20:00' },
      { meetingNumber: 3, date: '2026-06-16', startTime: '20:00' },
      { meetingNumber: 4, date: '2026-06-23', startTime: '20:00' },
    ],
  },
  {
    externalId: 'sheet-row-502',
    houseNumber: 'AJ-202',
    settlement: 'חיפה',
    hostName: 'משפחת לוי',
    facilitatorName: 'הרב אהרן ברקוביץ',
    status: 'חדש מייבוא חיצוני',
    meetings: [
      { meetingNumber: 1, date: '2026-06-04', startTime: '20:30' },
      { meetingNumber: 2, date: '2026-06-11', startTime: '20:30' },
      { meetingNumber: 3, date: '2026-06-18', startTime: '20:30' },
      { meetingNumber: 4, date: '2026-06-25', startTime: '20:30' },
    ],
  },
];

module.exports = mockExternalMeetingHouses;
