/**
 * activityByTypeExcel.js — דוח פעילות חודשי לפעיל, מסודר לפי סוג פעילות.
 * ========================================================================
 * מבוסס על מפרט: docs/superpowers/specs/2026-08-31-activist-activity-report-design.md
 *
 * deriveActivityByType (למטה) היא פונקציה טהורה — קוראת רק מפלט calcMonthlyPayment
 * (lib/paymentCalc.js), לא מחשבת תשלום בעצמה. כל שינוי במדיניות תשלום נכנס דרך
 * calcMonthlyPayment בלבד, לא מפה.
 */

// שמונת שורות הסוג, סדר קבוע — לא נגזר מסדר המפתחות ב-BASE_PRICES (לא עקבי בין
// וידאו לשאר הסוגים). quality: null = לא בודקים quality בכלל (אירוח שבת).
// label "זום" (לא "וידאו") — כך בדוגמה שנדב סיפק.
const TYPE_ROWS = [
  { label: 'טלפוני ידידותי',      type: 'טלפוני',    quality: 'ידידותי',    priceKey: 'טלפוני-ידידותי' },
  { label: 'טלפוני תורני',        type: 'טלפוני',    quality: 'תורני',      priceKey: 'טלפוני-תורני' },
  { label: 'זום ידידותי',         type: 'וידאו',     quality: 'ידידותי',    priceKey: 'וידאו-ידידותי' },
  { label: 'זום תורני',           type: 'וידאו',     quality: 'תורני',      priceKey: 'וידאו-תורני' },
  { label: 'פרונטלי ידידותי',     type: 'פרונטלי',   quality: 'ידידותי',    priceKey: 'פרונטלי-ידידותי' },
  { label: 'פרונטלי תורני',       type: 'פרונטלי',   quality: 'תורני',      priceKey: 'פרונטלי-תורני' },
  { label: 'פרונטלי רב משתתפים',  type: 'פרונטלי',   quality: 'רב משתתפים', priceKey: 'פרונטלי-רב משתתפים' },
  { label: 'אירוח שבת',           type: 'אירוח שבת', quality: null,         priceKey: 'אירוח שבת' },
];

// קטגוריות תוספות — בונוס-לימוד-4 ובונוס-לימוד-6 מתמזגים ל"בונוס לימוד" אחד
// (ראה מפרט, סעיף "טבלת תוספות"). סדר הקטגוריות = סדר ההופעה בגיליון.
//
// 'בונוס-תורני' נוסף כאן ב-Task 5 (לא היה במפרט המקורי): מפרט הדוח הזה (2026-08-31)
// ו-deriveActivityByType נכתבו *לפני* המיזוג עם fix/feedback-2026-08 (payment rules
// overhaul, commit 16b32bd), שהוסיף בונוס-תורני חדש ל-calcMonthlyPayment (ראה
// deriveToraniBonuses ב-lib/paymentCalc.js). בלי השורה הזו breakdown.push({type:
// 'בונוס-תורני', ...}) לא תואם אף קטגוריה כאן — הבונוס נעלם בשקט מ-bonusRows/
// grandTotal של הדוח (מאומת עם calcMonthlyPayment אמיתי: total=1000 בעמוד מול
// grandTotal=0 בייצוא, לפני התיקון). אין קטגוריה נפרדת ל"תוספת" הזו במפרט — היא
// מתנהגת בדיוק כמו שלוש הקטגוריות האחרות (רשומה בודדת → פירוט=desc).
const BONUS_CATEGORIES = [
  { label: 'בונוס לימוד',       types: ['בונוס-לימוד-4', 'בונוס-לימוד-6'] },
  { label: 'בונוס עליה במצוות', types: ['בונוס-מצוות'] },
  { label: 'בונוס משתתף חדש',   types: ['בונוס-חדש'] },
  { label: 'בונוס תורני',       types: ['בונוס-תורני'] },
];

// רשת ביטחון (ביקורת קוד סופית, 2026-09-01): הרשימה למעלה היא allow-list — היא לא
// יכולה "לדעת" על סוג בונוס שעדיין לא נכתב. זו בדיוק מחלקת-הבאג שקרתה בפועל עם
// 'בונוס-תורני' לפני שהתווסף לרשימה (ראה ההערה למעלה): breakdown.push של סוג לא-מוכר
// לא תואם אף קטגוריה, ונעלם בשקט מ-grandTotal — בלי שגיאה, בלי אזהרה, בלי כשל בדיקה.
// deriveActivityByType (למטה) סורק אחרי הקיבוץ הרגיל אחר כל שורת breakdown שנשארה בלי
// קטגוריה (לא 'קשר' וגם לא באחת מ-BONUS_CATEGORIES) ומקבץ אותה לשורת "תוספות אחרות"
// אחת — כדי שכסף לעולם לא ייעלם לגמרי, גם אם קטגוריה חדשה תיכתב ל-calcMonthlyPayment
// בעתיד ואף אחד לא יזכור להוסיף לה שורה כאן. ראה גם scripts/verify-activity-report.cjs.

/**
 * deriveActivityByType — ממיינת פלט calcMonthlyPayment לפי סוג פעילות.
 * @param report        — { breakdown, unpaid } מ-calcMonthlyPayment (אחרי תוספת השדות ב-Task 1)
 * @param expensesTotal — סכום החזר הוצאות בחודש (כבר מחושב ב-payments.jsx/[id].jsx)
 * @param guidePay      — שכר הדרכת סיורים בחודש (כבר מחושב שם)
 * @param cfg            — DEFAULTS מ-paymentCalc.js או קונפיג מ-payment_config
 */
function deriveActivityByType(report, expensesTotal = 0, guidePay = 0, cfg) {
  const { DEFAULTS } = require('./paymentCalc.js');
  cfg = cfg || DEFAULTS;
  const breakdown = report?.breakdown || [];
  const unpaid    = report?.unpaid || [];
  const meetingRows = breakdown.filter(b => b.type === 'קשר');

  const matchesType = (row, t) => row.interactionType === t.type && (t.quality === null || row.quality === t.quality);

  const typeRows = TYPE_ROWS.map(t => {
    const rows = meetingRows.filter(m => matchesType(m, t));
    return {
      label: t.label,
      count: rows.length,
      rate: cfg.BASE_PRICES?.[t.priceKey] ?? null,
      total: rows.reduce((s, m) => s + m.amount, 0),
    };
  });
  const meetingsTotal = typeRows.reduce((s, r) => s + r.total, 0);

  const bonusRows = BONUS_CATEGORIES.map(cat => {
    const rows = breakdown.filter(b => cat.types.includes(b.type));
    if (!rows.length) return null;
    const detail = rows.length === 1 ? rows[0].desc : rows.map(r => r.contactName).join(' + ');
    return { label: cat.label, count: rows.length, detail, amount: rows.reduce((s, r) => s + r.amount, 0) };
  }).filter(Boolean);

  // רשת ביטחון — ראה ההערה מעל BONUS_CATEGORIES. categorizedTypes נגזר מ-BONUS_CATEGORIES
  // עצמו (לא רשימה כפולה בנפרד) כדי שלא יוכל לסטות ממנו: כל type שכבר נתפס באחת
  // הקטגוריות למעלה מוחרג כאן במפורש, ולכן אין שום סיכוי לספירה כפולה של אותה שורה גם
  // בקטגוריה שלה וגם כאן — הפיצול בין bonusRows (מקוטלג) ל-otherRows (לא מקוטלג) ממצה
  // ומפריד את כל breakdown שאינו 'קשר', תמיד.
  const categorizedTypes = new Set(BONUS_CATEGORIES.flatMap(cat => cat.types));
  const otherRows = breakdown.filter(b => b.type !== 'קשר' && !categorizedTypes.has(b.type));
  if (otherRows.length) {
    const detail = otherRows.length === 1 ? otherRows[0].desc : otherRows.map(r => r.contactName).join(' + ');
    bonusRows.push({ label: 'תוספות אחרות', count: otherRows.length, detail, amount: otherRows.reduce((s, r) => s + r.amount, 0) });
  }

  const expensesRow = expensesTotal > 0 ? { label: 'החזר הוצאות', amount: expensesTotal } : null;
  const guideRow    = guidePay > 0     ? { label: 'הדרכת סיורים', amount: guidePay } : null;

  const bonusTotal = bonusRows.reduce((s, r) => s + r.amount, 0) + (expensesRow?.amount ?? 0) + (guideRow?.amount ?? 0);
  const grandTotal = meetingsTotal + bonusTotal;

  const unpaidByReasonMap = new Map();
  for (const u of unpaid) unpaidByReasonMap.set(u.reason, (unpaidByReasonMap.get(u.reason) ?? 0) + 1);

  const detailByType = {};
  for (const t of TYPE_ROWS) {
    detailByType[t.label] = meetingRows
      .filter(m => matchesType(m, t))
      .map(m => ({ name: m.contactName, amount: m.amount, note: m.duration_minutes != null ? `${m.duration_minutes} ד'` : '' }));
  }

  return {
    typeRows, meetingsTotal, bonusRows, expensesRow, guideRow, grandTotal,
    unpaidCount: unpaid.length,
    unpaidByReason: [...unpaidByReasonMap.entries()].map(([reason, count]) => ({ reason, count })),
    detailByType,
  };
}

const MONEY_FORMAT = '#,##0 ₪';
const HEADER_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6C5CE7' } };
const HEADER_FONT   = { bold: true, color: { argb: 'FFFFFFFF' } };
const SUBTOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EFFE' } };

// מסיר תווים אסורים בשם גיליון — בלי הגבלת אורך. עוזר משותף ל-safeSheetName
// (שמחיל גם קיצוץ ל-31 תווים) ול-uniqueSheetName (שצריך לשלוט בקיצוץ בעצמו, כדי
// לשריין מקום לסיומת המספרית — ראה שם).
function sanitizeSheetNameChars(name) {
  return String(name || 'גיליון').replace(/[:\\/?*[\]]/g, ' ');
}

// שם גיליון תקין: עד 31 תווים, בלי : \ / ? * [ ]
function safeSheetName(name) {
  return sanitizeSheetNameChars(name).slice(0, 31);
}

function styleHeaderRow(row) {
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', horizontal: 'center' };
}

/**
 * writeSummaryBlock — כותב בלוקים 1–5 (כותרת, טבלת סוגים, תוספות, סה"כ, הערת-שוליים)
 * החל משורה startRow. מחזיר את השורה הפנויה הבאה (לשימוש בערימה בלשונית המרוכזת).
 */
function writeSummaryBlock(ws, startRow, activistName, monthName, year, data) {
  let r = startRow;

  ws.getCell(r, 1).value = `${monthName} ${year} — ${activistName}`;
  ws.getCell(r, 1).font = { bold: true, size: 13 };
  r += 1;

  // טבלת סוגי פעילות
  const typeHeaderRow = ws.getRow(r);
  typeHeaderRow.values = ['סוג הפעילות', 'מספר מפגשים', 'תעריף', 'סה"כ לתשלום'];
  styleHeaderRow(typeHeaderRow);
  r += 1;
  const firstTypeRow = r;
  for (const row of data.typeRows) {
    ws.getRow(r).values = [row.label, row.count, row.count > 0 ? row.rate : '—', row.total];
    ws.getCell(r, 4).numFmt = MONEY_FORMAT;
    r += 1;
  }
  const lastTypeRow = r - 1;
  const totalMeetingsRow = ws.getRow(r);
  totalMeetingsRow.getCell(1).value = 'סה"כ קשרים/מפגשים מזכים';
  totalMeetingsRow.getCell(4).value = { formula: `SUM(D${firstTypeRow}:D${lastTypeRow})` };
  totalMeetingsRow.getCell(4).numFmt = MONEY_FORMAT;
  totalMeetingsRow.font = { bold: true };
  totalMeetingsRow.fill = SUBTOTAL_FILL;
  r += 2; // שורה ריקה אחרי

  // טבלת תוספות (רק אם יש בכלל תוספת)
  const additions = [...data.bonusRows, data.expensesRow, data.guideRow].filter(Boolean);
  let additionsTotalFormulaRange = null;
  if (additions.length > 0) {
    const addHeaderRow = ws.getRow(r);
    addHeaderRow.values = ['תוספות', 'כמות', 'פירוט', 'סה"כ'];
    styleHeaderRow(addHeaderRow);
    r += 1;
    const firstAddRow = r;
    for (const add of additions) {
      ws.getRow(r).values = [add.label, add.count ?? 1, add.detail ?? '', add.amount];
      ws.getCell(r, 4).numFmt = MONEY_FORMAT;
      r += 1;
    }
    additionsTotalFormulaRange = [firstAddRow, r - 1];
    r += 1; // שורה ריקה
  }

  // שורת סה"כ לתשלום — נוסחה, לא ערך קפוא.
  // הערה: SUM(D{firstTypeRow}:D{lastTypeRow}) כבר מכסה את כל טבלת הסוגים במלואה —
  // אין להוסיף עוד מונח D{firstTypeRow} בודד לפניו (זו הייתה טעות בטיוטה המקורית:
  // ספירה כפולה של השורה הראשונה בטבלה, שנחשפה רק בבדיקה עם תוספות בפועל, כי
  // תעריף "טלפוני ידידותי" (השורה הראשונה) הוא 0 ₪ כרגע — מכסה את הבאג באקראי
  // עד שהתעריף הזה ישתנה שוב).
  const grandRow = ws.getRow(r);
  grandRow.getCell(1).value = `סה"כ לתשלום ${monthName} ${year}`;
  grandRow.getCell(4).value = additionsTotalFormulaRange
    ? { formula: `SUM(D${firstTypeRow}:D${lastTypeRow})+SUM(D${additionsTotalFormulaRange[0]}:D${additionsTotalFormulaRange[1]})` }
    : { formula: `SUM(D${firstTypeRow}:D${lastTypeRow})` };
  grandRow.getCell(4).numFmt = MONEY_FORMAT;
  grandRow.font = { bold: true, size: 12 };
  r += 1;

  // הערת שוליים — מפגשים שלא זוכו
  if (data.unpaidCount > 0) {
    const reasonsText = data.unpaidByReason.map(u => `${u.count} — ${u.reason}`).join(' · ');
    ws.getCell(r, 1).value = `לא זוכו: ${data.unpaidCount} קשרים — ${reasonsText}`;
    ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF999999' } };
    r += 1;
  }

  return r + 1; // שורה ריקה לפני מה שיבוא אחרי
}

/**
 * writeDetailBlock — כותב את בלוק 6 (פירוט לפי סוג) החל משורה startRow.
 * מחזיר את השורה הפנויה הבאה.
 */
function writeDetailBlock(ws, startRow, data) {
  let r = startRow;
  ws.getCell(r, 1).value = 'פירוט מלא — מסודר לפי סוג הפעילות';
  ws.getCell(r, 1).font = { bold: true, size: 13 };
  r += 1;

  for (const typeRow of data.typeRows) {
    const meetings = data.detailByType[typeRow.label] || [];
    ws.getCell(r, 1).value = `${typeRow.label} — ${typeRow.count} מפגשים`;
    ws.getCell(r, 2).value = typeRow.total;
    ws.getCell(r, 2).numFmt = MONEY_FORMAT;
    ws.getCell(r, 1).font = { bold: true };
    r += 1;

    const miniHeaderRow = ws.getRow(r);
    miniHeaderRow.values = [`מס'`, 'שם', 'סכום', 'הערה'];
    styleHeaderRow(miniHeaderRow);
    r += 1;

    if (meetings.length === 0) {
      ws.getCell(r, 1).value = 'אין פעילות מסוג זה החודש';
      ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF999999' } };
      r += 1;
    } else {
      meetings.forEach((m, i) => {
        ws.getRow(r).values = [i + 1, m.name, m.amount, m.note];
        ws.getCell(r, 3).numFmt = MONEY_FORMAT;
        r += 1;
      });
    }
    r += 1; // שורה ריקה בין קבוצות סוג
  }
  return r;
}

function setupSheet(ws) {
  ws.views = [{ rightToLeft: true }];
  ws.columns = [{ width: 26 }, { width: 16 }, { width: 16 }, { width: 16 }];
}

/**
 * buildActivityWorkbook — חוברת עבודה עם גיליון אחד (סיכום + פירוט) לפעיל בודד.
 */
async function buildActivityWorkbook(activistName, monthName, year, data) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(activistName));
  setupSheet(ws);
  const afterSummary = writeSummaryBlock(ws, 1, activistName, monthName, year, data);
  writeDetailBlock(ws, afterSummary, data);
  return wb;
}

/**
 * exportActivityXlsx — מפיק ומוריד קובץ xlsx לפעיל בודד. דפדפן בלבד.
 */
async function exportActivityXlsx(activistName, monthName, year, data) {
  const wb = await buildActivityWorkbook(activistName, monthName, year, data);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `פעילות-${activistName}-${monthName}-${year}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// מחזיר שם ייחודי בתוך workbook — מוסיף " (2)", " (3)" וכו' אם יש התנגשות.
//
// חשוב: שומרים מקום לסיומת המספרית *לפני* הקיצוץ ל-31 תווים, לא אחריו. גרסה קודמת
// קיצצה קודם ל-31 תווים (safeSheetName) ורק אז ניסתה להוסיף " (2)" ולקצץ שוב —
// וכש-base עצמו כבר 31 תווים, `${base} (2)}`.slice(0,31) פשוט זורק את כל הסיומת
// (`base` מתחיל בדיוק ב-31 התווים הראשונים בין כה וכה), כך שהמועמד יוצא זהה ל-base
// בכל איטרציה, תנאי הלולאה תמיד "אמת", והלולאה לא נעצרת לעולם — נמצא בסקירת קוד עם
// שני פעילים ששמם מתלכד אחרי קיצוץ ל-31 תווים (ותרחיש דומה, "מעוות אך לא תקוע",
// כשה-base קרוב ל-31 תווים, כמו 29, ומספר ההתנגשויות גדל).
//
// התיקון: בכל ניסיון i בונים קודם את מחרוזת הסיומת המדויקת (" (2)", " (10)"...),
// מודדים את אורכה, ורק אז חותכים את הבסיס לפי מה שנשאר מתוך 31 — כך שהסיומת (כולל
// הספרה) לעולם לא נחתכת. מכיוון שהסיומת תמיד שלמה, מועמד של i נתון תמיד שונה מהותית
// ממועמד של כל i אחר (הן בטווח ספרות זהה — רק הספרה עצמה משתנה — והן בגבול מעבר בין
// טווחי ספרות, כי ה-" (" שלפני הספרה אף פעם לא נחתך ומפריד בין המחרוזות). כלומר זה
// נכון-מבניה, לא רק "מטפל במקרים שנבדקו": ב-wb יש תמיד מספר סופי של גיליונות קיימים,
// וכל מועמד שונה מכל מועמד אחר — לכן לפי עקרון שובך היונים חייבים למצוא שם פנוי תוך
// כמות איטרציות שלא עולה על מספר הגיליונות הקיימים + 1. MAX_ATTEMPTS הוא רק רשת
// ביטחון נוספת נגד רגרסיה עתידית שתשבור את התכונה הזו בטעות.
function uniqueSheetName(wb, name) {
  const sanitized = sanitizeSheetNameChars(name);
  const candidateFor = (i) => {
    const suffix = i > 1 ? ` (${i})` : '';
    const maxBaseLen = Math.max(0, 31 - suffix.length);
    return sanitized.slice(0, maxBaseLen) + suffix;
  };
  const MAX_ATTEMPTS = 10000;
  let i = 1;
  let candidate = candidateFor(i);
  while (wb.getWorksheet(candidate)) {
    i += 1;
    if (i > MAX_ATTEMPTS) {
      throw new Error(`uniqueSheetName: לא נמצא שם גיליון פנוי עבור "${name}" אחרי ${MAX_ATTEMPTS} ניסיונות`);
    }
    candidate = candidateFor(i);
  }
  return candidate;
}

/**
 * buildCombinedActivityWorkbook — לשונית "סיכום כללי" (כל הפעילים מוערמים + רולאפ
 * ארגוני בסוף — גם "לפי סוג פעילות" מפגשים-בלבד, וגם סה"כ ארגוני אמיתי לתשלום שכולל
 * בונוסים/הוצאות/הדרכות), ואז לשונית מלאה לכל פעיל.
 */
async function buildCombinedActivityWorkbook(activistsData, monthName, year) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  const overview = wb.addWorksheet('סיכום כללי');
  setupSheet(overview);
  let r = 1;
  // שורה→ [count, total] לכל שורת-סוג, כדי לחשב את הסה"כ הארגוני-לפי-סוג בסוף בלי לרוץ שוב על הנתונים.
  const perTypeCells = TYPE_ROWS.map(() => ({ countCells: [], totalCells: [] }));
  // תאי העמודה D של שורת "סה"כ לתשלום" של כל פעיל (הסה"כ *האמיתי* שלו — מפגשים +
  // בונוסים + הוצאות + הדרכות, אותה שורה בדיוק שכל לשונית-פעיל מציגה). סה"כ ארגוני
  // אמיתי = סכום התאים האלה, לא סכום טבלת-הסוגים למטה (ראה סקירת קוד סופית,
  // 2026-09-01: הבלוק "סה"כ ארגוני לפי סוג פעילות" מכסה רק מפגשים, ולא הייתה אף תא
  // בחוברת כולה ששווה למה שעמוד /payments מציג כ"סה"כ תשלומים" — totalAll ב-pages/payments.jsx).
  const grandRowLabel = `סה"כ לתשלום ${monthName} ${year}`;
  const orgGrandTotalCells = [];

  for (const { activistName, data } of activistsData) {
    const blockStartRow = r;
    r = writeSummaryBlock(overview, r, activistName, monthName, year, data);
    // אחרי writeSummaryBlock יש כבר שורה ריקה בסוף — מוסיפים עוד אחת ל-2 שורות ריקות בסה"כ.
    r += 1;

    // איתור שורות טבלת-הסוגים שנכתבו זה עתה, כדי לצבור אותן לסה"כ הארגוני-לפי-סוג.
    for (let i = 0; i < TYPE_ROWS.length; i++) {
      const label = TYPE_ROWS[i].label;
      for (let scanRow = blockStartRow; scanRow < r; scanRow++) {
        if (overview.getCell(scanRow, 1).value === label) {
          perTypeCells[i].countCells.push(`B${scanRow}`);
          perTypeCells[i].totalCells.push(`D${scanRow}`);
          break;
        }
      }
    }

    // איתור שורת "סה"כ לתשלום" של הפעיל הזה, כדי לצבור אותה לסה"כ הארגוני האמיתי.
    for (let scanRow = blockStartRow; scanRow < r; scanRow++) {
      if (overview.getCell(scanRow, 1).value === grandRowLabel) {
        orgGrandTotalCells.push(`D${scanRow}`);
        break;
      }
    }
  }

  // סה"כ ארגוני לפי סוג פעילות — מפגשים בלבד. התווית מבהירה זאת במפורש (לא "הכל") כדי
  // שלא תיקרא כסה"כ התשלום האמיתי — ראה הסה"כ הארגוני האמיתי בהמשך, שכן כולל הכל.
  const orgHeaderRow = overview.getRow(r);
  orgHeaderRow.getCell(1).value = 'סה"כ ארגוני לפי סוג פעילות (מפגשים בלבד)';
  orgHeaderRow.getCell(1).font = { bold: true, size: 13 };
  r += 1;
  const orgTableHeaderRow = overview.getRow(r);
  orgTableHeaderRow.values = ['סוג הפעילות', 'מספר מפגשים (הכל)', 'סה"כ ₪ (הכל)'];
  styleHeaderRow(orgTableHeaderRow);
  r += 1;
  TYPE_ROWS.forEach((t, i) => {
    const row = overview.getRow(r);
    row.getCell(1).value = t.label;
    row.getCell(2).value = perTypeCells[i].countCells.length
      ? { formula: perTypeCells[i].countCells.join('+') }
      : 0;
    row.getCell(3).value = perTypeCells[i].totalCells.length
      ? { formula: perTypeCells[i].totalCells.join('+') }
      : 0;
    row.getCell(3).numFmt = MONEY_FORMAT;
    r += 1;
  });
  r += 1; // שורה ריקה לפני הסה"כ הארגוני האמיתי

  // סה"כ ארגוני לתשלום — הסכום האמיתי (מפגשים + בונוסים + הוצאות + הדרכות): נוסחה
  // שסוכמת את שורת "סה"כ לתשלום" של כל פעיל בנפרד, לא נגזרת מטבלת-הסוגים שלמעלה (כדי
  // לא לשכפל את לוגיקת הצירוף שכבר קיימת בכל grandRow של writeSummaryBlock — ראה
  // orgGrandTotalCells למעלה). זו התא היחיד בכל החוברת ששווה בדיוק למה שעמוד /payments
  // מציג כ"סה"כ תשלומים" (totalAll = סכום grandTotal של כל פעיל).
  const orgGrandRow = overview.getRow(r);
  orgGrandRow.getCell(1).value = `סה"כ ארגוני לתשלום ${monthName} ${year}`;
  orgGrandRow.getCell(3).value = orgGrandTotalCells.length
    ? { formula: orgGrandTotalCells.join('+') }
    : 0;
  orgGrandRow.getCell(3).numFmt = MONEY_FORMAT;
  orgGrandRow.font = { bold: true, size: 13 };
  r += 1;

  // לשונית מלאה לכל פעיל — זהה למה שמופק בייצוא הבודד.
  for (const { activistName, data } of activistsData) {
    const ws = wb.addWorksheet(uniqueSheetName(wb, activistName));
    setupSheet(ws);
    const afterSummary = writeSummaryBlock(ws, 1, activistName, monthName, year, data);
    writeDetailBlock(ws, afterSummary, data);
  }

  return wb;
}

/**
 * exportCombinedActivityXlsx — מפיק ומוריד קובץ xlsx מרוכז לכל הפעילים. דפדפן בלבד.
 */
async function exportCombinedActivityXlsx(activistsData, monthName, year) {
  const wb = await buildCombinedActivityWorkbook(activistsData, monthName, year);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `פעילות-כל-הפעילים-${monthName}-${year}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

module.exports = {
  deriveActivityByType, TYPE_ROWS, BONUS_CATEGORIES,
  writeSummaryBlock, writeDetailBlock, safeSheetName, uniqueSheetName,
  buildActivityWorkbook, exportActivityXlsx,
  buildCombinedActivityWorkbook, exportCombinedActivityXlsx,
};
