// mocks/mockMeetingHouses.js
const mockMeetingHouses = [
  {
    id: 1,
    houseNumber: 'AJ-101',
    settlement: 'ירושלים',
    city: 'ירושלים',
    hostName: 'משפחת כהן',
    facilitatorName: 'הרב יעקב לוי',
    meetings: [
      { meetingNumber: 1, date: '2026-04-10', startTime: '20:30', completed: true,  notes: 'מפגש ראשון. 6 משתתפים. נושא השבת עלה ועורר עניין רב.' },
      { meetingNumber: 2, date: '2026-04-17', startTime: '20:30', completed: true,  notes: 'שיחה על כשרות. אחד המשתתפים שאל לגבי מניין ותפילה.' },
      { meetingNumber: 3, date: '2026-05-10', startTime: '20:30', completed: false, notes: '' },
      { meetingNumber: 4, date: '2026-05-17', startTime: '20:30', completed: false, notes: '' },
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
    meetings: [
      { meetingNumber: 1, date: '2026-05-15', startTime: '21:00', completed: false, notes: '' },
      { meetingNumber: 2, date: '2026-05-22', startTime: '21:00', completed: false, notes: '' },
      { meetingNumber: 3, date: '2026-05-29', startTime: '21:00', completed: false, notes: '' },
      { meetingNumber: 4, date: '2026-06-05', startTime: '21:00', completed: false, notes: '' },
    ],
    assignedActivists: [22, 23],
    source: 'mock',
  },
  {
    id: 3,
    houseNumber: 'AJ-103',
    settlement: 'חיפה',
    city: 'חיפה',
    hostName: 'משפחת לוי',
    facilitatorName: 'הרב אהרן כץ',
    meetings: [
      { meetingNumber: 1, date: '2026-03-15', startTime: '20:00', completed: true, notes: 'מפגש ראשון מצוין. השתתפו 8 אנשים. נושא השבת עלה בשיחה. עניין רב ופתיחות.' },
      { meetingNumber: 2, date: '2026-03-22', startTime: '20:00', completed: true, notes: 'המשכנו בנושא כשרות ולמוד תורה. שני משתתפים התחייבו להתחיל. אמון גדל.' },
      { meetingNumber: 3, date: '2026-03-29', startTime: '20:00', completed: true, notes: 'שיחה עמוקה על תפילה ומניין. כולם השתתפו בחברותא קצרה. קשר חם מאוד.' },
      { meetingNumber: 4, date: '2026-04-05', startTime: '20:00', completed: true, notes: 'מפגש מסכם מרגש. קידוש משותף. מספר משתתפים ביקשו להמשיך בקשר ולהיפגש שוב.' },
    ],
    assignedActivists: [23],
    source: 'mock',
  },
  {
    id: 4,
    houseNumber: 'AJ-104',
    settlement: 'בני ברק',
    city: 'בני ברק',
    hostName: 'משפחת רייטן',
    facilitatorName: 'הרב מנחם גולד',
    meetings: [
      { meetingNumber: 1, date: '2026-05-20', startTime: '20:30', completed: false, notes: '' },
      { meetingNumber: 2, date: '2026-05-27', startTime: '20:30', completed: false, notes: '' },
      { meetingNumber: 3, date: '2026-06-03', startTime: '20:30', completed: false, notes: '' },
      { meetingNumber: 4, date: '2026-06-10', startTime: '20:30', completed: false, notes: '' },
    ],
    assignedActivists: [11],
    source: 'mock',
  },
];

module.exports = mockMeetingHouses;
