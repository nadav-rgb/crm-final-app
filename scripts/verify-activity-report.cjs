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

// ────────────────────────────────────────────────────────────────────────────
// buildCombinedActivityWorkbook — לשונית "סיכום כללי" עם 2 פעילים מוערמים
// + סה"כ ארגוני, ואז לשונית מלאה לכל פעיל.
// ────────────────────────────────────────────────────────────────────────────
async function testCombinedWorkbook() {
  const { buildCombinedActivityWorkbook } = require('../lib/activityByTypeExcel.js');

  const reportA = calcMonthlyPayment(7, [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'טלפוני', quality: 'תורני', duration_minutes: 20, date: '2026-08-01' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);
  const reportB = calcMonthlyPayment(8, [
    { activist_id: 8, project_id: 1, id: 2, contact_id: 2, type: 'פרונטלי', quality: 'תורני', duration_minutes: 45, date: '2026-08-02' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);

  const activistsData = [
    { activistName: 'פעיל א', data: deriveActivityByType(reportA, 0, 0) },
    { activistName: 'פעיל ב', data: deriveActivityByType(reportB, 0, 0) },
  ];

  const wb = await buildCombinedActivityWorkbook(activistsData, 'אוגוסט', 2026);
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const outPath = path.join(os.tmpdir(), 'activity-report-combined-test.xlsx');
  await wb.xlsx.writeFile(outPath);

  const ExcelJS = (await import('exceljs')).default;
  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(outPath);

  check('3 לשוניות: סיכום כללי + 2 פעילים', back.worksheets.map(s => s.name),
    ['סיכום כללי', 'פעיל א', 'פעיל ב']);

  const overview = back.worksheets[0];
  // כותרת "פעיל א" בשורה 1, כותרת "פעיל ב" אמורה להופיע אחרי הבלוק שלו + 2 שורות ריקות.
  let firstActivistTitleRow = null, secondActivistTitleRow = null;
  overview.eachRow((row, rowNumber) => {
    const v = String(row.getCell(1).value || '');
    if (v.includes('פעיל א')) firstActivistTitleRow = rowNumber;
    if (v.includes('פעיל ב') && !v.includes('סה"כ')) secondActivistTitleRow = rowNumber;
  });
  check('שתי כותרות הפעילים קיימות בלשונית הראשונה',
    [Boolean(firstActivistTitleRow), Boolean(secondActivistTitleRow)], [true, true]);

  // שורת סה"כ ארגוני בסוף הלשונית
  let orgTotalRow = null;
  overview.eachRow((row, rowNumber) => {
    if (row.getCell(1).value === 'סה"כ ארגוני לפי סוג פעילות') orgTotalRow = rowNumber;
  });
  check('בלוק "סה"כ ארגוני לפי סוג פעילות" קיים בסוף הלשונית', Boolean(orgTotalRow), true);

  // לשונית "פעיל ב" מכילה את הפירוט המלא שלו (בדיוק כמו buildActivityWorkbook עצמאי)
  const sheetB = back.worksheets.find(s => s.name === 'פעיל ב');
  let sheetBHasDetail = false;
  sheetB.eachRow(row => { if (row.getCell(1).value === 'פירוט מלא — מסודר לפי סוג הפעילות') sheetBHasDetail = true; });
  check('לשונית פעיל ב כוללת את בלוק הפירוט המלא', sheetBHasDetail, true);

  console.log(failures === 0 ? '\nכל הבדיקות עברו (כולל buildCombinedActivityWorkbook).' : `\n${failures} בדיקות נכשלו.`);
  process.exit(failures === 0 ? 0 : 1);
}

// ────────────────────────────────────────────────────────────────────────────
// buildActivityWorkbook — נכתב ל-Node, נקרא בחזרה, מבנה + נוסחאות + RTL תקינים.
// ────────────────────────────────────────────────────────────────────────────
{
  const { buildActivityWorkbook } = require('../lib/activityByTypeExcel.js');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const report = calcMonthlyPayment(7, [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'טלפוני', quality: 'תורני', duration_minutes: 20, date: '2026-08-01' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);
  // מוסיפים בונוס ישירות ל-breakdown (כמו בתרחיש "קיבוץ תוספות" למעלה בקובץ) + הוצאות,
  // כדי ש-additions.length > 0 ותיבדק ענף "עם תוספות" של נוסחת "סה"כ לתשלום" — בדיוק
  // הענף שבו נמצאה (ותוקנה) ספירה כפולה של D{firstTypeRow} ב-lib/activityByTypeExcel.js
  // (ראה task-3-report.md). בלי תוספות, התרחיש בודק רק את הענף הפשוט בלי SUM כפולה.
  report.breakdown.push({ type: 'בונוס-חדש', contactId: 2, contactName: 'דנה לוי', amount: 250, desc: 'הביא משתתף חדש' });
  const data = deriveActivityByType(report, 300, 0); // expensesTotal=300 → גם שורת "החזר הוצאות"

  (async () => {
    const wb = await buildActivityWorkbook('בדיקה אוטומטית', 'אוגוסט', 2026, data);
    const outPath = path.join(os.tmpdir(), 'activity-report-single-test.xlsx');
    await wb.xlsx.writeFile(outPath);

    const ExcelJS = (await import('exceljs')).default;
    const back = new ExcelJS.Workbook();
    await back.xlsx.readFile(outPath);
    const ws = back.worksheets[0];

    check('שם הגיליון = שם הפעיל', ws?.name, 'בדיקה אוטומטית');
    check('הגיליון נשמר RTL', Boolean(ws?.views?.[0]?.rightToLeft), true);

    // מוצא את שורת "טלפוני תורני" בטבלת הסוגים ומוודא את הערכים שלה.
    let toraniRow = null;
    ws.eachRow(row => { if (row.getCell(1).value === 'טלפוני תורני') toraniRow = row; });
    check('שורת "טלפוני תורני" קיימת בגיליון', Boolean(toraniRow), true);
    if (toraniRow) {
      // תעריף 150 (לא 200): BASE_PRICES['טלפוני-תורני'] עודכן ב-2e1e30c (מיזוג
      // payment-rules-overhaul) אחרי שהמפרט נכתב — ראה תיקון המקביל למעלה בקובץ.
      check('טלפוני תורני: מספר מפגשים=1, תעריף=150, סה"כ=150',
        [toraniRow.getCell(2).value, toraniRow.getCell(3).value, toraniRow.getCell(4).value],
        [1, 150, 150]);
    }

    // שורת "סה"כ קשרים/מפגשים מזכים" חייבת להיות נוסחת SUM, לא ערך קפוא.
    let totalMeetingsRow = null;
    ws.eachRow(row => { if (row.getCell(1).value === 'סה"כ קשרים/מפגשים מזכים') totalMeetingsRow = row; });
    check('שורת סיכום מפגשים היא נוסחת SUM',
      Boolean(totalMeetingsRow?.getCell(4)?.value?.formula), true);

    // שורת "סה"כ לתשלום" — כאן בדיוק היה הבאג המקורי (ספירה כפולה של D{firstTypeRow}
    // כשיש תוספות). שתי בדיקות, לא רק Boolean(...formula) כמו למעלה:
    //   (א) צורת הנוסחה: "SUM(...)+SUM(...)" בדיוק — לא ערך/תא בודד לפני ה-SUM הראשון.
    //       הנוסחה הבאגית המקורית "D3+SUM(D3:D10)+SUM(D14:D15)" הייתה נכשלת בתבנית הזו
    //       כי היא לא מתחילה ב-SUM.
    //   (ב) חישוב ידני: קוראים את שני טווחי ה-SUM שהנוסחה מפנה אליהם מהתאים שבאמת
    //       נכתבו לקובץ (בדיוק כמו שאקסל היה מחשב), ומוודאים שהתוצאה שווה ל-data.grandTotal.
    //       exceljs לא מחשב נוסחאות בעצמו — קריאה חוזרת מחזירה רק את מחרוזת הנוסחה,
    //       ולכן זו הדרך היחידה לוודא בפועל שהיא מסתכמת נכון בלי אקסל אמיתי.
    let grandRow = null;
    ws.eachRow(row => { if (String(row.getCell(1).value || '').startsWith('סה"כ לתשלום')) grandRow = row; });
    check('שורת "סה"כ לתשלום" קיימת בגיליון', Boolean(grandRow), true);
    if (grandRow) {
      const grandFormula = grandRow.getCell(4).value?.formula || '';
      check('סה"כ לתשלום: הנוסחה בצורת SUM(...)+SUM(...) בדיוק — לא תא בודד לפני ה-SUM (הבאג שתוקן)',
        /^SUM\(D\d+:D\d+\)\+SUM\(D\d+:D\d+\)$/.test(grandFormula), true);

      let computed = 0;
      for (const [, from, to] of grandFormula.matchAll(/D(\d+):D(\d+)/g)) {
        for (let rn = Number(from); rn <= Number(to); rn++) {
          const v = ws.getCell(`D${rn}`).value;
          computed += typeof v === 'number' ? v : 0;
        }
      }
      check('סה"כ לתשלום: חישוב ידני של טווחי הנוסחה בפועל = data.grandTotal (150 מפגש + 250 בונוס + 300 הוצאות = 700)',
        computed, data.grandTotal);
    }

    await testCombinedWorkbook();
  })();
}
