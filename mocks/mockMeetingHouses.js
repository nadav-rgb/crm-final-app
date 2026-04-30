// mocks/mockMeetingHouses.js
// נתוני דמו בלבד.
// המבנה כאן מותאם לכך שבעתיד כל בית מפגש יגיע אוטומטית מ-Google Sheets / Google Forms / API.

const mockMeetingHouses = [
  {
    id: 1,
    houseNumber: 'AJ-101',
    settlement: 'ירושלים',
    city: 'ירושלים',
    hostName: 'משפחת כהן',
    facilitatorName: 'הרב יעקב לוי',
    status: 'פתוח לשיבוץ',
    meetings: [
      { meetingNumber: 1, date: '2026-05-10', startTime: '20:30' },
      { meetingNumber: 2, date: '2026-05-17', startTime: '20:30' },
      { meetingNumber: 3, date: '2026-05-24', startTime: '20:30' },
      { meetingNumber: 4, date: '2026-05-31', startTime: '20:30' },
    ],
    assignedActivists: [21],
    source: 'mock',
  },
  {
    id: 2,
    houseNumber: 'AJ-102',
    settlement: 'תל אביב',
    city: 'תל אביב',
    hostName: 'משפחת אברהם',
    facilitatorName: 'הרב שמואל ברק',
    status: 'בהכנה',
    meetings: [
      { meetingNumber: 1, date: '2026-05-15', startTime: '21:00' },
      { meetingNumber: 2, date: '2026-05-22', startTime: '21:00' },
      { meetingNumber: 3, date: '2026-05-29', startTime: '21:00' },
      { meetingNumber: 4, date: '2026-06-05', startTime: '21:00' },
    ],
    assignedActivists: [22, 23],
    source: 'mock',
  },
];

module.exports = mockMeetingHouses;
