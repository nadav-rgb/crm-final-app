// scripts/verify-activity-report.cjs — בדיקות דוח הפעילות לפי סוג (lib/activityByTypeExcel.js).
// שימוש: node scripts/verify-activity-report.cjs
// שלב 1 (בקובץ הזה): נתונים סינתטיים בלבד, כמו scripts/verify-payment-order.cjs.
const { calcMonthlyPayment, DEFAULTS } = require('../lib/paymentCalc.js');
const { deriveActivityByType } = require('../lib/activityByTypeExcel.js');

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

const contacts = [
  { id: 1, name: 'יוסי כהן' }, { id: 2, name: 'דנה לוי' }, { id: 3, name: 'רון גל' },
];
const AUG = { year: 2026, month: 7 }; // month 0-indexed, אוגוסט = 7

// ────────────────────────────────────────────────────────────────────────────
// תרחיש הדוגמה שנדב סיפק (ניר קובי אוגוסט לפי סוג פעילות.xlsx), מצומצם.
// ────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'טלפוני', quality: 'ידידותי', duration_minutes: 20, date: '2026-08-01' },
    { activist_id: 7, project_id: 1, id: 2, contact_id: 1, type: 'טלפוני', quality: 'תורני',    duration_minutes: 20, date: '2026-08-02' },
    { activist_id: 7, project_id: 1, id: 3, contact_id: 2, type: 'טלפוני', quality: 'תורני',    duration_minutes: 20, date: '2026-08-03' },
    { activist_id: 7, project_id: 1, id: 4, contact_id: 3, type: 'וידאו',  quality: 'תורני',    duration_minutes: 30, date: '2026-08-04' },
    { activist_id: 7, project_id: 1, id: 5, contact_id: 1, type: 'טלפוני', quality: 'תורני',    duration_minutes: 5,  date: '2026-08-05' }, // לא זוכה — פחות מ-15 ד'
  ];
  const report = calcMonthlyPayment(7, rows, contacts, [], [], DEFAULTS, new Set(), AUG);
  const data = deriveActivityByType(report, 0, 0);

  check('8 שורות סוג, בסדר קבוע', data.typeRows.map(r => r.label), [
    'טלפוני ידידותי', 'טלפוני תורני', 'זום ידידותי', 'זום תורני',
    'פרונטלי ידידותי', 'פרונטלי תורני', 'פרונטלי רב משתתפים', 'אירוח שבת',
  ]);
  check('טלפוני ידידותי: 1 מפגש, תעריף 0, סה"כ 0',
    data.typeRows[0], { label: 'טלפוני ידידותי', count: 1, rate: 0, total: 0 });
  check('טלפוני תורני: 2 מפגשים (השלישי לא זוכה), תעריף 150, סה"כ 300',
    data.typeRows[1], { label: 'טלפוני תורני', count: 2, rate: 150, total: 300 });
  check('זום תורני מוצג בתווית "זום", לא "וידאו"',
    data.typeRows[3], { label: 'זום תורני', count: 1, rate: 200, total: 200 });
  check('פרונטלי רב משתתפים: 0 מפגשים, תעריף מוצג, סה"כ 0',
    data.typeRows[6], { label: 'פרונטלי רב משתתפים', count: 0, rate: 300, total: 0 });
  check('meetingsTotal = סכום כל שורות הסוג', data.meetingsTotal, 0 + 300 + 200);
  check('grandTotal = meetingsTotal כשאין בונוסים/הוצאות', data.grandTotal, data.meetingsTotal);
  check('מפגש שלא זוכה מופיע ב-unpaidByReason', data.unpaidByReason, [{ reason: 'פחות מ-15 דקות', count: 1 }]);
  check('detailByType["טלפוני תורני"] כולל שם + סכום + הערת-משך',
    data.detailByType['טלפוני תורני'],
    [{ name: 'יוסי כהן', amount: 150, note: "20 ד'" }, { name: 'דנה לוי', amount: 150, note: "20 ד'" }]);
  check('detailByType["פרונטלי רב משתתפים"] ריק כשאין מפגשים', data.detailByType['פרונטלי רב משתתפים'], []);
}

// ────────────────────────────────────────────────────────────────────────────
// קיבוץ תוספות: כמות=1 → פירוט=desc; כמות>1 → פירוט=שמות מחוברים ב-" + ".
// בונוס-לימוד-4 ובונוס-לימוד-6 מתמזגים לקטגוריה אחת "בונוס לימוד".
// ────────────────────────────────────────────────────────────────────────────
{
  const report = {
    breakdown: [
      { type: 'בונוס-לימוד-4', contactId: 1, contactName: 'יוסי כהן', amount: 600, desc: '4 מפגשי לימוד עם אותו אדם' },
      { type: 'בונוס-חדש', contactId: 2, contactName: 'אבנט קליינר', amount: 250, desc: 'הביא משתתף חדש דרך אבנט קליינר' },
      { type: 'בונוס-חדש', contactId: 3, contactName: 'אייל קוגן', amount: 250, desc: 'הביא משתתף חדש דרך אייל קוגן' },
    ],
    unpaid: [],
  };
  const data = deriveActivityByType(report, 356, 0);
  check('3 שורות תוספות: לימוד, חדש, הוצאות (בלי סיורים — guidePay=0)',
    data.bonusRows.map(r => r.label), ['בונוס לימוד', 'בונוס משתתף חדש']);
  check('בונוס לימוד: כמות 1, פירוט = desc',
    data.bonusRows[0], { label: 'בונוס לימוד', count: 1, detail: '4 מפגשי לימוד עם אותו אדם', amount: 600 });
  check('בונוס משתתף חדש: כמות 2, פירוט = שמות מחוברים',
    data.bonusRows[1], { label: 'בונוס משתתף חדש', count: 2, detail: 'אבנט קליינר + אייל קוגן', amount: 500 });
  check('שורת הוצאות מופיעה כש-expensesTotal > 0',
    data.expensesRow, { label: 'החזר הוצאות', amount: 356 });
  check('אין שורת הדרכת-סיורים כש-guidePay = 0', data.guideRow, null);
  check('grandTotal = meetingsTotal(0) + לימוד(600) + חדש(500) + הוצאות(356)',
    data.grandTotal, 600 + 500 + 356);
}

// ────────────────────────────────────────────────────────────────────────────
// unpaidByReason מקבץ כמה סיבות שונות בנפרד, לא מציג רק את הראשונה.
// ────────────────────────────────────────────────────────────────────────────
{
  const report = {
    breakdown: [],
    unpaid: [
      { contactId: 1, contactName: 'א', date: '2026-08-01', reason: 'פחות מ-15 דקות', duration_minutes: 5, interactionType: 'טלפוני', quality: 'תורני' },
      { contactId: 1, contactName: 'א', date: '2026-08-02', reason: 'פחות מ-15 דקות', duration_minutes: 5, interactionType: 'טלפוני', quality: 'תורני' },
      { contactId: 2, contactName: 'ב', date: '2026-08-03', reason: 'חרגת ממגבלת לקוח', duration_minutes: 60, interactionType: 'פרונטלי', quality: 'תורני' },
    ],
  };
  const data = deriveActivityByType(report, 0, 0);
  check('unpaidCount סופר את כולם', data.unpaidCount, 3);
  check('unpaidByReason: שתי סיבות שונות, כל אחת עם המספר שלה',
    data.unpaidByReason, [{ reason: 'פחות מ-15 דקות', count: 2 }, { reason: 'חרגת ממגבלת לקוח', count: 1 }]);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
