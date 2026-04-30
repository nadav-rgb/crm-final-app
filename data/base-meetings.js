// data/base-meetings.js — מפגשי בסיס
// כל בית מפגש מורכב מ-4 מפגשי בסיס

const BASE_MEETING_QUESTIONS = [
  'תאר את אווירת המפגש — כמה משתתפים היו, מה הרוח הכללית?',
  'מה היה הנושא המרכזי של המפגש?',
  'האם היו שאלות או תגובות מעניינות מהמשתתפים?',
  'מה הייתה ההשפעה הנראית לעין על המשתתפים?',
  'מה מתוכנן למפגש הבא?',
];

// דיווחי מפגשי בסיס לדוגמה
const baseMeetingReports = [
  {
    id: 1,
    activist_id: 21,
    meeting_place_number: '12',
    meeting_place_city: 'באר שבע',
    host_name: 'אברהם כהן',
    facilitator_name: 'רב יוסי לוי',
    activist_name: 'מיכל אברהם',
    meeting_number: 1,
    date: '2026-04-01',
    answers: 'המפגש הראשון היה מוצלח מאוד. השתתפו 8 אנשים. האווירה הייתה חמה ומקבלת. הנושא היה היכרות ומבוא לפרויקט. כולם הביעו עניין רב.',
    submitted: true,
    submitted_at: '2026-04-01',
  },
  {
    id: 2,
    activist_id: 21,
    meeting_place_number: '12',
    meeting_place_city: 'באר שבע',
    host_name: 'אברהם כהן',
    facilitator_name: 'רב יוסי לוי',
    activist_name: 'מיכל אברהם',
    meeting_number: 2,
    date: '2026-04-08',
    answers: 'המפגש השני — עיון בנושא שבת. 10 משתתפים. נשאלו שאלות מעמיקות. אחד המשתתפים הביע רצון להתחיל שמירת שבת.',
    submitted: true,
    submitted_at: '2026-04-08',
  },
  {
    id: 3,
    activist_id: 21,
    meeting_place_number: '12',
    meeting_place_city: 'באר שבע',
    host_name: 'אברהם כהן',
    facilitator_name: 'רב יוסי לוי',
    activist_name: 'מיכל אברהם',
    meeting_number: 3,
    date: '2026-04-15',
    answers: null,
    submitted: false,
    submitted_at: null,
  },
  {
    id: 4,
    activist_id: 21,
    meeting_place_number: '12',
    meeting_place_city: 'באר שבע',
    host_name: 'אברהם כהן',
    facilitator_name: 'רב יוסי לוי',
    activist_name: 'מיכל אברהם',
    meeting_number: 4,
    date: '2026-04-22',
    answers: null,
    submitted: false,
    submitted_at: null,
  },
];

module.exports = { baseMeetingReports, BASE_MEETING_QUESTIONS };
