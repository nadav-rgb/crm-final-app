// data/messages.js — הודעות מערכת

const messages = [
  {
    id: 1,
    from_role: 'ceo',
    from_name: 'ישראל ישראלי',
    project_id: null, // null = כל הפרויקטים
    title: 'ברוכים הבאים למערכת מקרבים!',
    body: 'אנחנו שמחים שאתם כאן. המערכת תעזור לנו לעקוב אחרי הקשרים שלנו ולצמוח יחד. בהצלחה לכולם!',
    date: '2026-04-28',
    pinned: true,
  },
  {
    id: 2,
    from_role: 'head',
    from_name: 'מיכל כהן',
    project_id: 1, // איילת השחר בלבד
    title: 'עדכון חשוב לפעילי איילת השחר',
    body: 'בשבוע הקרוב נקיים כינוס פעילים. אנא וודאו שדיווחתם על כל הקשרים שלכם לפני יום חמישי.',
    date: '2026-04-27',
    pinned: false,
  },
];

module.exports = messages;
