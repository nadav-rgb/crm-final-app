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

// resolveCellValue — קורא ערך מספרי אמיתי מתא ExcelJS שנקרא מקובץ שנכתב+נקרא-חזרה,
// גם כשהתא מכיל נוסחה (לא ערך קפוא) — ואפילו נוסחה שמפנה לתא *אחר* שגם הוא נוסחה
// (למשל: "סה"כ ארגוני לתשלום" מפנה לשורת "סה"כ לתשלום" של כל פעיל, וזו עצמה נוסחת
// SUM). exceljs לא מחשב נוסחאות בעצמו — קריאה חוזרת מחזירה רק את מחרוזת הנוסחה — ואקסל
// אמיתי היה פותר את זה בעצמו; זה קיים רק כדי שנוכל לוודא כאן, בלי לפתוח אקסל אמיתי,
// שהנוסחאות המקוננות באמת מסתכמות למה שהן אמורות. תומך רק בשתי הצורות שהקובץ הזה
// בפועל מייצר: "SUM(X#:X#)+SUM(X#:X#)..." ו-"X#+X#+X#...".
function resolveCellValue(ws, cellRef, _depth = 0) {
  if (_depth > 5) throw new Error(`resolveCellValue: עומק רקורסיה חריג עבור ${cellRef}`);
  const v = ws.getCell(cellRef).value;
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  if (typeof v === 'object' && typeof v.formula === 'string') {
    let total = 0;
    for (const term of v.formula.split('+').map(s => s.trim())) {
      const sumMatch = term.match(/^SUM\(([A-Z]+)(\d+):[A-Z]+(\d+)\)$/);
      if (sumMatch) {
        const [, col, fromRow, toRow] = sumMatch;
        for (let rn = Number(fromRow); rn <= Number(toRow); rn++) {
          total += resolveCellValue(ws, `${col}${rn}`, _depth + 1);
        }
      } else if (/^[A-Z]+\d+$/.test(term)) {
        total += resolveCellValue(ws, term, _depth + 1);
      } else {
        throw new Error(`resolveCellValue: מונח נוסחה לא מזוהה "${term}" בתוך "${v.formula}"`);
      }
    }
    return total;
  }
  return 0;
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
// בונוס-תורני ב-BONUS_CATEGORIES — רגרסיה ל-Task 5: deriveActivityByType נכתב
// (Task 1, commit dfee0c7) *לפני* המיזוג עם fix/feedback-2026-08 (payment rules
// overhaul, commit 16b32bd) שהוסיף את סוג הבונוס 'בונוס-תורני' ל-calcMonthlyPayment
// (deriveToraniBonuses ב-lib/paymentCalc.js). בלי 'בונוס-תורני' ב-BONUS_CATEGORIES,
// breakdown.push({type:'בונוס-תורני', ...}) לא תואם אף קטגוריה — הבונוס נעלם בשקט
// מ-bonusRows/grandTotal של הדוח, כשה-total האמיתי (המוצג בעמוד) עדיין כולל אותו.
// שני חלקים: (א) יחידה — report סינתטי, בסגנון בלוק "קיבוץ תוספות" למעלה. (ב)
// אינטגרציה — calcMonthlyPayment אמיתי (כמו שהעמודים בפועל קוראים לו), מוודא
// שה-invariant שנשבר (grandTotal של הדוח = total של calcMonthlyPayment) מוחזק.
// ────────────────────────────────────────────────────────────────────────────
{
  const report = {
    breakdown: [
      { type: 'בונוס-חדש', contactId: 2, contactName: 'אבנט קליינר', amount: 250, desc: 'הביא משתתף חדש דרך אבנט קליינר' },
      { type: 'בונוס-תורני', contactId: 4, contactName: 'משה עמית', amount: 1000, desc: 'השלים 3 חודשים רצופים של קשר תורני' },
    ],
    unpaid: [],
  };
  const data = deriveActivityByType(report, 0, 0);
  check('בונוס-תורני מופיע כשורת תוספת נפרדת (לא נעלם, לא מתמזג עם קטגוריה אחרת)',
    data.bonusRows.map(r => r.label), ['בונוס משתתף חדש', 'בונוס תורני']);
  check('בונוס תורני: כמות 1, פירוט = desc, סכום 1000',
    data.bonusRows[1], { label: 'בונוס תורני', count: 1, detail: 'השלים 3 חודשים רצופים של קשר תורני', amount: 1000 });
  check('grandTotal כולל את הבונוס התורני (250 + 1000)', data.grandTotal, 250 + 1000);
}
{
  const report = calcMonthlyPayment(7, [], contacts, [], [], DEFAULTS, new Set(), AUG,
    [{ activist_id: 7, contact_id: 1, contactName: 'יוסי כהן', amount: 1000, desc: 'השלים 3 חודשים רצופים של קשר תורני', month: '2026-7' }]);
  const data = deriveActivityByType(report, 0, 0, DEFAULTS);
  check('אינטגרציה: calcMonthlyPayment.total כולל בונוס תורני', report.total, 1000);
  check('אינטגרציה: deriveActivityByType.grandTotal תואם בדיוק ל-calcMonthlyPayment.total (לא 0 — הבאג שתוקן)',
    data.grandTotal, report.total);
}

// ────────────────────────────────────────────────────────────────────────────
// סקירה סופית (2026-09-01), חשוב #1: BONUS_CATEGORIES הוא allow-list — בלי רשת
// ביטחון, סוג בונוס עתידי שאף אחד עוד לא קטלג היה נעלם בשקט, בדיוק כמו שקרה עם
// 'בונוס-תורני' למעלה (אותה מחלקת-באג בדיוק — לא רק היסטוריה: נבדק כאן עם סוג
// סינתטי-לגמרי, שלא קיים ולא יתקיים ב-calcMonthlyPayment, כדי לוודא שהמנגנון עצמו
// מבני ולא רק "תיקנו את המקרה שכבר נתפס"). שתי בדיקות: (1) סוג לא-מקוטלג יחיד →
// שורת "תוספות אחרות". (2) שני סוגים לא-מקוטלגים שונים → מתקבצים לשורה אחת (לא
// שתיים) עם כמות 2, בדיוק כמו כל שורת-תוספת רגילה עם כמה רשומות (ראה "קיבוץ תוספות" למעלה).
// ────────────────────────────────────────────────────────────────────────────
{
  const report = {
    breakdown: [
      { type: 'בונוס-חדש', contactId: 2, contactName: 'אבנט קליינר', amount: 250, desc: 'הביא משתתף חדש דרך אבנט קליינר' },
      { type: 'בונוס-עתידי-לא-ידוע', contactId: 5, contactName: 'איתן שגיא', amount: 777, desc: 'סוג בונוס עתידי שעדיין לא קוטלג' },
    ],
    unpaid: [],
  };
  const data = deriveActivityByType(report, 0, 0);
  check('סוג בונוס לא-מקוטלג נכנס לשורת "תוספות אחרות" בסוף הרשימה — לא נעלם',
    data.bonusRows.map(r => r.label), ['בונוס משתתף חדש', 'תוספות אחרות']);
  check('שורת "תוספות אחרות": כמות 1, פירוט = desc (כמו כל שורת-תוספת עם רשומה בודדת), סכום = 777',
    data.bonusRows[1], { label: 'תוספות אחרות', count: 1, detail: 'סוג בונוס עתידי שעדיין לא קוטלג', amount: 777 });
  check('grandTotal כולל את הסכום הלא-מקוטלג (250 + 777) — הכסף לא נעלם',
    data.grandTotal, 250 + 777);
}
{
  const report = {
    breakdown: [
      { type: 'בונוס-עתידי-א', contactId: 5, contactName: 'איתן שגיא', amount: 100, desc: 'תיאור א' },
      { type: 'בונוס-עתידי-ב', contactId: 6, contactName: 'נעה ברק', amount: 200, desc: 'תיאור ב' },
    ],
    unpaid: [],
  };
  const data = deriveActivityByType(report, 0, 0);
  check('שני סוגי-בונוס לא-מקוטלגים שונים מתקבצים יחד לשורת "תוספות אחרות" אחת (לא שתיים)',
    data.bonusRows, [{ label: 'תוספות אחרות', count: 2, detail: 'איתן שגיא + נעה ברק', amount: 300 }]);
}

// ────────────────────────────────────────────────────────────────────────────
// סקירה סופית (2026-09-01), חשוב #1(ב): בדיקת רגרסיה קבועה — calcMonthlyPayment
// אמיתי, כל 4 סוגי הבונוס הידועים בבת אחת (לימוד-4, מצוות, משתתף-חדש, תורני) +
// הוצאות + הדרכת-סיורים, מוודאת ש-deriveActivityByType.grandTotal מתאם בדיוק לנוסחה
// שהעמודים בפועל מציגים כ-grandTotal (pages/payments/[id].jsx:67, pages/payments.jsx:95:
// result.total + expensesTotal + guidePay). זה בדיוק ה-invariant שנשבר בפועל עם
// 'בונוס-תורני' (ראה הבדיקה למעלה) — ועכשיו, עם רשת-הביטחון "תוספות אחרות" (נבדקה
// ישירות למעלה), הוא מוחזק מבנית גם אם סוג עתידי ייפול בין הכיסאות. הבדיקה השנייה
// למטה ("אין שורת תוספות אחרות") היא הרכיב שכן "יתפוס" סוג *ידוע* שנשכח לקטלג
// בעתיד: הכסף לא ייעלם (הבדיקה הראשונה תמיד תעבור, גם אז) אבל הוא ייפול תחת התווית
// הגנרית — והבדיקה השנייה תיכשל, בדיוק כפי שהייתה צריכה לתפוס את השמטת
// 'בונוס-תורני' לפני שהיא קרתה בפועל.
// ────────────────────────────────────────────────────────────────────────────
{
  const activistId = 30; // ייעודי לבדיקה הזו — לא מתנגש עם activist_id אחר בקובץ
  const rows = [
    // 4 מפגשי פרונטלי-תורני עם אותו לקוח: גם משלמים כ"קשר" (300×4) וגם מפעילים
    // בונוס-לימוד-4 (בדיוק 4 — לא 6 — כדי לבדוק את השכבה "4", לא "6").
    { activist_id: activistId, project_id: 1, id: 3001, contact_id: 1, type: 'פרונטלי', quality: 'תורני', duration_minutes: 20, date: '2026-08-01' },
    { activist_id: activistId, project_id: 1, id: 3002, contact_id: 1, type: 'פרונטלי', quality: 'תורני', duration_minutes: 20, date: '2026-08-02' },
    { activist_id: activistId, project_id: 1, id: 3003, contact_id: 1, type: 'פרונטלי', quality: 'תורני', duration_minutes: 20, date: '2026-08-03' },
    { activist_id: activistId, project_id: 1, id: 3004, contact_id: 1, type: 'פרונטלי', quality: 'תורני', duration_minutes: 20, date: '2026-08-04' },
  ];
  const myMitzvotBonuses = [{ contact_id: 2, contactName: 'דנה לוי', desc: 'עליה בסרגל מצוות' }];
  const myNewBonuses     = [{ contact_id: 3, contactName: 'רון גל' }];
  const myToraniBonuses  = [{ contact_id: 1, contactName: 'יוסי כהן', desc: 'השלים 3 חודשים רצופים של קשר תורני' }];

  const report = calcMonthlyPayment(activistId, rows, contacts, myMitzvotBonuses, myNewBonuses, DEFAULTS, new Set(), AUG, myToraniBonuses);
  const expensesTotal = 343;
  const guidePay = 750;
  const data = deriveActivityByType(report, expensesTotal, guidePay, DEFAULTS);

  check('קלט: report.total כולל את כל 4 סוגי הבונוס (לימוד-4=600, מצוות=600, חדש=250, תורני=1000) + 4×300 מפגשים = 3650',
    report.total, 4 * 300 + 600 + 600 + 250 + 1000);
  check('כל 4 סוגי הבונוס מקוטלגים בשמם — אין שורת "תוספות אחרות" (אם תופיע, סוג ידוע נשר מהקטגוריה שלו)',
    data.bonusRows.map(r => r.label).sort(),
    ['בונוס לימוד', 'בונוס משתתף חדש', 'בונוס עליה במצוות', 'בונוס תורני'].sort());
  check('האינווריאנט: deriveActivityByType.grandTotal === calcMonthlyPayment.total + expensesTotal + guidePay (נוסחת grandTotal בעמודי payments)',
    data.grandTotal, report.total + expensesTotal + guidePay);
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
// uniqueSheetName — תיקון רגרסיה (סקירת קוד): שמות ששווים רק אחרי קיצוץ ל-31
// תווים גרמו ללולאה אינסופית (ראה תיעוד מלא בפונקציה עצמה ב-lib/activityByTypeExcel.js
// ו-task-4-report.md, סעיף "Fix Report"). בדיקה סינכרונית וממוקדת מול workbook
// מדומה מינימלי — לא ExcelJS אמיתי ולא buildCombinedActivityWorkbook מלא — כדי
// שתהיה מהירה ומדויקת, ומבודדת מהרולאפ הארגוני (נבדק בנפרד למטה).
// ────────────────────────────────────────────────────────────────────────────
{
  const { uniqueSheetName } = require('../lib/activityByTypeExcel.js');

  // workbook מדומה: getWorksheet/addWorksheet מעל Set של שמות — בדיוק ממשק-העל
  // היחיד ש-uniqueSheetName תלוי בו, בלי תלות ב-exceljs האמיתי.
  function makeMockWorkbook() {
    const names = new Set();
    return {
      getWorksheet: (n) => (names.has(n) ? {} : undefined),
      addWorksheet: (n) => { names.add(n); return {}; },
    };
  }

  // שלושה שמות בני 32 תווים שחולקים בדיוק את אותם 31 התווים הראשונים (שונים רק
  // בתו ה-32) — כלומר מתלכדים לחלוטין אחרי קיצוץ ל-31 (base.length === 31 בדיוק,
  // תרחיש הבאג המקורי: לפני התיקון זה היה תקוע בלולאה אינסופית כבר בפעיל השני).
  const longPrefix = 'פ'.repeat(31);
  const mockWb = makeMockWorkbook();
  const start = Date.now();
  const name1 = uniqueSheetName(mockWb, longPrefix + '1'); mockWb.addWorksheet(name1);
  const name2 = uniqueSheetName(mockWb, longPrefix + '2'); mockWb.addWorksheet(name2);
  const name3 = uniqueSheetName(mockWb, longPrefix + '3'); mockWb.addWorksheet(name3);
  const elapsedMs = Date.now() - start;

  check('שלושה שמות שמתלכדים אחרי קיצוץ ל-31 תווים → 3 שמות גיליון שונים בפועל',
    new Set([name1, name2, name3]).size, 3);
  check('כל שם גיליון שהוחזר לא עולה על 31 תווים',
    [name1, name2, name3].every(n => n.length <= 31), true);
  check('name1 (בלי התנגשות) הוא הבסיס המקוצץ המלא, בלי סיומת',
    name1, longPrefix);
  check('name2/name3 מסתיימים בסיומת מספרית תקינה " (2)"/" (3)" — לא "מעוות" (הבאג הישן הפיק שם שמסתיים ב-" (" בלי ספרה/סוגר)',
    [/ \(\d+\)$/.test(name2), / \(\d+\)$/.test(name3)], [true, true]);
  check('הפונקציה חוזרת מהר, לא תקועה בלולאה אינסופית (< שנייה עבור 3 קריאות)',
    elapsedMs < 1000, true);

  // תרחיש-גבול נוסף שהעלה הסוקר: base בן 29 תווים (לא בדיוק 31) — תחת הקוד הישן
  // הפיק שם "מעוות" (מסתיים ב-" (" בלי ספרה) שהיה ייחודי במקרה עם 2 התנגשויות
  // בלבד, אך היה נתקע גם הוא בלולאה אינסופית עם 3+ התנגשויות (אותה מחלקת-באג,
  // סף מעט שונה). בודקים 3 התנגשויות בדיוק כדי לכסות את המקרה שהקוד הישן לא שרד.
  const base29 = 'ת'.repeat(29);
  const mockWb2 = makeMockWorkbook();
  const b1 = uniqueSheetName(mockWb2, base29); mockWb2.addWorksheet(b1);
  const b2 = uniqueSheetName(mockWb2, base29); mockWb2.addWorksheet(b2);
  const b3 = uniqueSheetName(mockWb2, base29); mockWb2.addWorksheet(b3);
  check('בסיס בן 29 תווים, 3 התנגשויות: 3 שמות שונים, כולם עם סיומת תקינה',
    [new Set([b1, b2, b3]).size, [b2, b3].every(n => / \(\d+\)$/.test(n))], [3, true]);
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

  // שורת סה"כ ארגוני לפי-סוג (מפגשים בלבד) בסוף הלשונית
  let orgTotalRow = null;
  overview.eachRow((row, rowNumber) => {
    if (row.getCell(1).value === 'סה"כ ארגוני לפי סוג פעילות (מפגשים בלבד)') orgTotalRow = rowNumber;
  });
  check('בלוק "סה"כ ארגוני לפי סוג פעילות (מפגשים בלבד)" קיים בסוף הלשונית', Boolean(orgTotalRow), true);

  // סקירה סופית (2026-09-01), חשוב #2: שורת "סה"כ ארגוני לתשלום" האמיתית — מוודאת
  // שהתא הזה, לא בלוק "לפי-סוג" שלמעלה (שמכסה רק מפגשים), הוא מה ששווה לסכום
  // ה-grandTotal של כל הפעילים (150+300=450 כאן; שני הפעילים בתרחיש הזה בלי
  // בונוסים/הוצאות/הדרכות, כך ש-meetingsTotal==grandTotal לכל אחד בנפרד — התרחיש
  // העשיר יותר, עם בונוס+הוצאות+הדרכה גם יחד, נבדק ב-testCombinedWorkbookMultiActivist למטה).
  let orgGrandRowSimple = null;
  overview.eachRow((row, rowNumber) => {
    if (String(row.getCell(1).value || '').startsWith('סה"כ ארגוני לתשלום')) orgGrandRowSimple = rowNumber;
  });
  check('שורת "סה"כ ארגוני לתשלום" קיימת בלשונית הסיכום הכללי', Boolean(orgGrandRowSimple), true);
  if (orgGrandRowSimple) {
    const formula = overview.getCell(`C${orgGrandRowSimple}`).value?.formula || '';
    const refs = formula.split('+').map(s => s.trim()).filter(Boolean);
    const computed = refs.reduce((s, ref) => s + resolveCellValue(overview, ref), 0);
    check('סה"כ ארגוני לתשלום (2 פעילים, בלי בונוסים/הוצאות/הדרכות) = 150+300 = 450',
      computed, 450);
  }

  // לשונית "פעיל ב" מכילה את הפירוט המלא שלו (בדיוק כמו buildActivityWorkbook עצמאי)
  const sheetB = back.worksheets.find(s => s.name === 'פעיל ב');
  let sheetBHasDetail = false;
  sheetB.eachRow(row => { if (row.getCell(1).value === 'פירוט מלא — מסודר לפי סוג הפעילות') sheetBHasDetail = true; });
  check('לשונית פעיל ב כוללת את בלוק הפירוט המלא', sheetBHasDetail, true);

  await testCombinedWorkbookMultiActivist();
}

// ────────────────────────────────────────────────────────────────────────────
// buildCombinedActivityWorkbook עם 3 פעילים (סקירת קוד: כיסוי חסר). testCombinedWorkbook
// למעלה בודק רק 2 פעילים בלי התנגשות שם/סוג משותף/תוספות/מפגש-שלא-זוכה. כאן: שלושה
// פעילים — "ראשון" ו"שלישי" חולקים סוג פעילות (טלפוני תורני), מה שמוודא שהרולאפ
// הארגוני מסכם את שניהם (לא כפול, לא רק אחד) — ו"שני" מקבל בונוס+הוצאות+מפגש-
// שלא-זוכה, כדי לתרגל את ענפי "תוספות"/"לא זוכו" בתוך הזרימה המרוכזת עצמה (עד כה
// נבדקו רק דרך buildActivityWorkbook העצמאי של Task 3, לא דרך buildCombinedActivityWorkbook).
// "שלישי" מקבל גם הדרכת-סיורים (guidePay, ראה deriveActivityByType(report3, 0, 750)
// למטה) — סקירה סופית (2026-09-01), חשוב #2: כך שהתרחיש כולל את כל שלושת הרכיבים
// שבונוס+הוצאות+הדרכה מייצגים יחד, לבדיקת "סה"כ ארגוני לתשלום" האמיתי בסוף הפונקציה.
// ────────────────────────────────────────────────────────────────────────────
async function testCombinedWorkbookMultiActivist() {
  const { buildCombinedActivityWorkbook } = require('../lib/activityByTypeExcel.js');

  // ראשון ושלישי: כל אחד מבצע מפגש טלפוני-תורני יחיד (150 ₪) — הסוג המשותף.
  const report1 = calcMonthlyPayment(21, [
    { activist_id: 21, project_id: 1, id: 201, contact_id: 1, type: 'טלפוני', quality: 'תורני', duration_minutes: 20, date: '2026-08-01' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);
  const report3 = calcMonthlyPayment(23, [
    { activist_id: 23, project_id: 1, id: 204, contact_id: 3, type: 'טלפוני', quality: 'תורני', duration_minutes: 20, date: '2026-08-04' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);

  // שני: מפגש פרונטלי-תורני משלם (300 ₪, סוג שונה) + ניסיון טלפוני-תורני שלא זוכה
  // (5 ד' — פחות מ-15) כדי שהוא *לא* יתרום ל"טלפוני תורני" המשותף, ובנוסף בונוס +
  // הוצאות ישירות ל-breakdown/expensesTotal, כדי שהבלוק שלו כולל גם טבלת תוספות
  // וגם הערת "לא זוכו" בתוך לשונית הסיכום הכללי עצמה.
  const report2 = calcMonthlyPayment(22, [
    { activist_id: 22, project_id: 1, id: 202, contact_id: 2, type: 'פרונטלי', quality: 'תורני', duration_minutes: 45, date: '2026-08-02' },
    { activist_id: 22, project_id: 1, id: 203, contact_id: 1, type: 'טלפוני', quality: 'תורני', duration_minutes: 5,  date: '2026-08-03' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);
  report2.breakdown.push({ type: 'בונוס-חדש', contactId: 3, contactName: 'רון גל', amount: 250, desc: 'הביא משתתף חדש' });

  const data1 = deriveActivityByType(report1, 0, 0);
  const data2 = deriveActivityByType(report2, 150, 0); // expensesTotal=150 → שורת "החזר הוצאות" + ענף תוספות
  const data3 = deriveActivityByType(report3, 0, 750); // guidePay=750 → שורת "הדרכת סיורים"

  // ודאות-קלט: מוודאים את ההנחות לפני שבודקים את הפלט (טלפוני תורני = TYPE_ROWS[1]).
  check('קלט: טלפוני תורני משותף לראשון+שלישי בלבד (שני = 0, כי המפגש שלו לא זוכה)',
    [data1.typeRows[1].count, data2.typeRows[1].count, data3.typeRows[1].count], [1, 0, 1]);
  check('קלט: לפעיל שני יש גם תוספות וגם מפגש שלא זוכה', [data2.bonusRows.length > 0 && Boolean(data2.expensesRow), data2.unpaidCount], [true, 1]);

  const activistsData = [
    { activistName: 'ראשון', data: data1 },
    { activistName: 'שני', data: data2 },
    { activistName: 'שלישי', data: data3 },
  ];

  const wb = await buildCombinedActivityWorkbook(activistsData, 'אוגוסט', 2026);
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const outPath = path.join(os.tmpdir(), 'activity-report-combined-3activist-test.xlsx');
  await wb.xlsx.writeFile(outPath);

  const ExcelJS = (await import('exceljs')).default;
  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(outPath);

  check('4 לשוניות: סיכום כללי + 3 פעילים', back.worksheets.map(s => s.name),
    ['סיכום כללי', 'ראשון', 'שני', 'שלישי']);

  const overview = back.worksheets[0];

  // בלוק "שני" בתוך הסיכום הכללי עצמו כולל טבלת תוספות + הערת "לא זוכו" — מוודא
  // שהענפים האלה נכתבים גם בתוך הזרימה המרוכזת, לא רק ב-buildActivityWorkbook העצמאי.
  let hasAdditionsHeaderInOverview = false, hasUnpaidFootnoteInOverview = false;
  overview.eachRow(row => {
    const v = row.getCell(1).value;
    if (v === 'תוספות') hasAdditionsHeaderInOverview = true;
    if (typeof v === 'string' && v.startsWith('לא זוכו:')) hasUnpaidFootnoteInOverview = true;
  });
  check('בלוק "שני" בסיכום הכללי כולל טבלת תוספות (ענף שלא היה מכוסה קודם בזרימה המרוכזת)',
    hasAdditionsHeaderInOverview, true);
  check('בלוק "שני" בסיכום הכללי כולל הערת "לא זוכו" (ענף שלא היה מכוסה קודם בזרימה המרוכזת)',
    hasUnpaidFootnoteInOverview, true);

  // איתור כל שורות "טלפוני תורני": 3 שורות-פעיל (כולל 0 עבור "שני") + שורת רולאפ
  // ארגוני אחת (השורה עם מספר-השורה הגבוה ביותר, כי בלוק הרולאפ נכתב אחרי כל
  // בלוקי הפעילים).
  const toraniRows = [];
  overview.eachRow((row, rn) => { if (row.getCell(1).value === 'טלפוני תורני') toraniRows.push(rn); });
  check('4 שורות "טלפוני תורני" בלשונית הסיכום הכללי (3 שורות-פעיל + שורת רולאפ)',
    toraniRows.length, 4);

  if (toraniRows.length === 4) {
    const orgRow = Math.max(...toraniRows);
    const perActivistRows = toraniRows.filter(rn => rn !== orgRow);
    const countFormula = overview.getRow(orgRow).getCell(2).value?.formula || '';
    const totalFormula = overview.getRow(orgRow).getCell(3).value?.formula || '';

    // צורת הנוסחה: בדיוק שלושה תאי B/D (אחד לכל פעיל, כולל "שני" עם 0) מחוברים
    // ב-"+" — לא פחות (חסר פעיל) ולא יותר (כפילות) — בדיוק אותה מחלקת-באג כמו
    // ה-double-counting של Task 3.
    const countRefs = countFormula.split('+').map(s => s.trim()).sort();
    const totalRefs = totalFormula.split('+').map(s => s.trim()).sort();
    const expectedCountRefs = perActivistRows.map(rn => `B${rn}`).sort();
    const expectedTotalRefs = perActivistRows.map(rn => `D${rn}`).sort();
    check('נוסחת הספירה הארגונית ל"טלפוני תורני" מפנה בדיוק ל-3 תאי B של שורות הפעילים — לא פחות ולא יותר',
      countRefs, expectedCountRefs);
    check('נוסחת הסכום הארגוני ל"טלפוני תורני" מפנה בדיוק ל-3 תאי D של שורות הפעילים — לא פחות ולא יותר',
      totalRefs, expectedTotalRefs);

    // חישוב ידני מהתאים האמיתיים שנכתבו לקובץ (לא הנחה שהנוסחה "נראית נכון").
    const computedCount = countRefs.reduce((s, ref) => s + Number(overview.getCell(ref).value || 0), 0);
    const computedTotal = totalRefs.reduce((s, ref) => s + Number(overview.getCell(ref).value || 0), 0);
    check('סה"כ ארגוני "טלפוני תורני": מספר מפגשים בפועל = 2 (ראשון+שלישי; לא שני; לא כפול)',
      computedCount, 2);
    check('סה"כ ארגוני "טלפוני תורני": סכום ₪ בפועל = 300 (150+150; לא 450 כפול; לא 150 חסר)',
      computedTotal, 300);
  }

  // סקירה סופית (2026-09-01), חשוב #2: "סה"כ ארגוני לתשלום" האמיתי — התרחיש הסינתטי
  // עם 2-3 פעילים כולל בונוסים+הוצאות+הדרכת-סיורים שממצא #2 ביקש: "שני" תורם בונוס
  // (250)+הוצאות (150), "שלישי" תורם הדרכת-סיורים (750). מחשבים ביד מה pages/payments.jsx
  // היה מציג כ-totalAll (סכום ה-grandTotal של כל פעיל), ומוודאים שהנוסחה החדשה
  // מסתכמת לאותו מספר בדיוק — ע"י מעקב אחרי התאים בפועל (resolveCellValue), לא הנחה
  // שהנוסחה "נראית נכון". בלוק "לפי-סוג" (מפגשים-בלבד) למעלה מסתכם ל-600 בלבד
  // (150+300+150) — ההפרש מ-1750 הוא בדיוק בונוס+הוצאות+הדרכה, מה שממצא #2 טען שחסר.
  const expectedOrgGrandTotal = data1.grandTotal + data2.grandTotal + data3.grandTotal;
  check('קלט: סכום ה-grandTotal של שלושת הפעילים = 150+700+900 = 1750 (מה שהעמוד היה מציג כ-totalAll)',
    expectedOrgGrandTotal, 1750);

  let orgGrandRow = null;
  overview.eachRow((row, rn) => {
    if (String(row.getCell(1).value || '').startsWith('סה"כ ארגוני לתשלום')) orgGrandRow = rn;
  });
  check('שורת "סה"כ ארגוני לתשלום" קיימת בלשונית הסיכום הכללי (תרחיש 3 פעילים)', Boolean(orgGrandRow), true);
  if (orgGrandRow) {
    const formula = overview.getCell(`C${orgGrandRow}`).value?.formula || '';
    const refs = formula.split('+').map(s => s.trim()).filter(Boolean);
    check('נוסחת "סה"כ ארגוני לתשלום" מפנה לבדיוק 3 תאים — שורת "סה"כ לתשלום" של כל פעיל, לא פחות ולא יותר',
      refs.length, 3);
    const computed = refs.reduce((s, ref) => s + resolveCellValue(overview, ref), 0);
    check('סה"כ ארגוני לתשלום בפועל (מעקב אחרי הנוסחאות המקוננות עד לערכים הגולמיים) = 1750 — כולל בונוס+הוצאות+הדרכת-סיור, לא רק מפגשים',
      computed, 1750);
  }

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
