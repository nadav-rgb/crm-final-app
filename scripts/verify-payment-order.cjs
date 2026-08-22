// scripts/verify-payment-order.cjs — בדיקות מנוע התשלום: סדר הקצאת המכסה + בונוס מצוות.
// שימוש: node scripts/verify-payment-order.cjs
// אין framework בדיקות בפרויקט — זה סקריפט node עצמאי, בדפוס scripts/verify-*.cjs.
// עובד על נתונים סינתטיים בלבד: לא נוגע ב-Supabase ולא דורש .env.local.
const { calcMonthlyPayment, DEFAULTS } = require('../lib/paymentCalc.js');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'} — ${name}`);
  if (!ok) {
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

const contacts = [{ id: 1, name: 'א' }, { id: 2, name: 'ב' }, { id: 3, name: 'ג' }];
const JULY = { year: 2026, month: 6 }; // month 0-indexed

// ────────────────────────────────────────────────────────────────────────────
// דיווח #5 (אלעזר באום, 2026-07-31) — המכסה נאכלה לפי תאריך, ולכן מפגש ידידותי
// בתחילת החודש "תפס מקום" למפגש תורני בסופו והפעיל הפסיד את ההפרש.
// ────────────────────────────────────────────────────────────────────────────
{
  // מכסה מוקטנת ל-2 פרונטליים, כדי שהתקרה תיבלם בבדיקה קטנה.
  const cfg = { ...DEFAULTS, MONTHLY_CAPS: { phone: 25, frontal: 2, multi: 6 } };
  const base = { activist_id: 7, project_id: 1, type: 'פרונטלי', duration_minutes: 60 };
  const interactions = [
    { ...base, id: 1, contact_id: 1, quality: 'ידידותי', date: '2026-07-02' },
    { ...base, id: 2, contact_id: 2, quality: 'ידידותי', date: '2026-07-03' },
    { ...base, id: 3, contact_id: 3, quality: 'תורני',   date: '2026-07-28' },
  ];
  const r = calcMonthlyPayment(7, interactions, contacts, [], [], cfg, new Set(), JULY);
  check('#5 התורני נכנס למכסה לפני הידידותי', r.total, 300 + 250);
  check('#5 הידידותי הזול הוא זה שנדחק החוצה', r.unpaid.map(u => u.contactId), [2]);
}

// ────────────────────────────────────────────────────────────────────────────
// דיווח #3 (מוטי גלעד, 2026-08-02) — בונוס מצוות שולם על כל רמה, גם כשהעליה
// נרשמה בשמירה אחת. חוזה הגזירה כאן חייב להיות זהה ל-lib/CrmStore.jsx.
// ────────────────────────────────────────────────────────────────────────────
function deriveMitzvotBonuses(contact) {
  if (!contact.activist_id || !Array.isArray(contact.mitzvot_history)) return [];
  return contact.mitzvot_history
    .filter(h => h && h.mitzva && Number(h.to ?? 0) > Number(h.from ?? 0))
    .map(h => ({ activist_id: contact.activist_id, contact_id: contact.id, contactName: contact.name }));
}
{
  const jumper = {
    id: 9, name: 'קופץ', activist_id: 7,
    mitzvot_history: [{ mitzva: 'ציצית', from: 0, to: 2, date: '2026-07-05' }],
  };
  check('#3 קפיצה של 2 רמות = בונוס אחד', deriveMitzvotBonuses(jumper).length, 1);

  const baseline = {
    id: 10, name: 'תיעוד מצב', activist_id: 7,
    mitzvot_history: [
      { mitzva: 'שבת',   from: 0, to: 3, date: '2026-07-30' },
      { mitzva: 'כיפה',  from: 0, to: 2, date: '2026-07-30' },
      { mitzva: 'לימוד', from: 0, to: 4, date: '2026-07-30' },
    ],
  };
  check('#3 שלוש מצוות בשמירה אחת = שלושה בונוסים (לא תשעה)', deriveMitzvotBonuses(baseline).length, 3);

  // ירידה/אי-שינוי לא מזכים כלל.
  const noRise = {
    id: 11, name: 'ללא שינוי', activist_id: 7,
    mitzvot_history: [{ mitzva: 'שבת', from: 2, to: 2, date: '2026-07-30' }, { mitzva: 'כיפה', from: 3, to: 1, date: '2026-07-30' }],
  };
  check('#3 ירידה או אי-שינוי אינם מזכים', deriveMitzvotBonuses(noRise).length, 0);
}

// ────────────────────────────────────────────────────────────────────────────
// דיווחים #12/#14/#15 — תוקנו ב-236319c. הבדיקות כאן מוודאות שהתיקון עומד גם
// אחרי שינוי סדר ההקצאה, ולא מסתמכות על הודעת ה-commit.
// ────────────────────────────────────────────────────────────────────────────
{
  // #14 (אלעזר באום, 22.7) — מפגש רב-משתתפים לא נספר במכסת הפרונטליים.
  const capCfg = { ...DEFAULTS, MONTHLY_CAPS: { phone: 25, frontal: 1, multi: 6 } };
  const rows = [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-02' },
    { activist_id: 7, project_id: 1, id: 2, contact_id: 2, type: 'פרונטלי', quality: 'תורני',      duration_minutes: 60, date: '2026-07-03' },
  ];
  check('#14 רב-משתתפים לא אוכל ממכסת הפרונטליים',
    calcMonthlyPayment(7, rows, contacts, [], [], capCfg, new Set(), JULY).total, 300 + 300);

  // #12 (נחמיה גרטש, 26.7) — תקרת שיחות מול לקוח רגיל = 10, לא 4.
  check('#12 תקרת שיחות ללקוח רגיל = 10', DEFAULTS.PER_CONTACT_CAPS.regular.phone, 10);

  // #15 (מוטי גלעד, 21.7) — 6 מפגשים פרונטליים מול אותו לקוח מזכים, השביעי לא.
  const sameContact = Array.from({ length: 7 }, (_, k) => ({
    activist_id: 7, project_id: 1, id: 10 + k, contact_id: 1, type: 'פרונטלי', quality: 'תורני',
    duration_minutes: 60, date: `2026-07-${String(k + 1).padStart(2, '0')}`,
  }));
  const same = calcMonthlyPayment(7, sameContact, contacts, [], [], DEFAULTS, new Set(), JULY);
  // 6×300 על המפגשים + 850 בונוס-לימוד-6 (LEARNING_BONUS[6]) שנפתח בדיוק במפגש השישי.
  check('#15 6 מפגשים מזכים מול אותו לקוח, השביעי לא', [same.total, same.unpaid.length], [6 * 300 + 850, 1]);
}

// ────────────────────────────────────────────────────────────────────────────
// דיווחים #8/#10/#11 — שורה נגזרת ממפגש רב-משתתפים לא מזכה ולא אוכלת מכסה.
// ────────────────────────────────────────────────────────────────────────────
{
  const meetingId = 500;
  const rows = [
    { activist_id: 7, project_id: 1, id: meetingId, contact_id: 1, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }] } },
    { activist_id: 7, project_id: 1, id: meetingId + 1, contact_id: 2, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }], derived_from: meetingId } },
    { activist_id: 7, project_id: 1, id: meetingId + 2, contact_id: 3, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }], derived_from: meetingId } },
  ];
  const r = calcMonthlyPayment(7, rows, contacts, [], [], DEFAULTS, new Set(), JULY);
  check('#10/#11 מפגש רב-משתתפים עם 3 לקוחות = תשלום אחד', r.total, 300);
  check('#10/#11 השורות הנגזרות לא מופיעות כ"לא זוכה"', r.unpaid.length, 0);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
