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
const BONUS_CATEGORIES = [
  { label: 'בונוס לימוד',       types: ['בונוס-לימוד-4', 'בונוס-לימוד-6'] },
  { label: 'בונוס עליה במצוות', types: ['בונוס-מצוות'] },
  { label: 'בונוס משתתף חדש',   types: ['בונוס-חדש'] },
];

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

// שם גיליון תקין: עד 31 תווים, בלי : \ / ? * [ ]
function safeSheetName(name) {
  return String(name || 'גיליון').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
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
function uniqueSheetName(wb, name) {
  const base = safeSheetName(name);
  if (!wb.getWorksheet(base)) return base;
  let i = 2;
  while (wb.getWorksheet(`${base} (${i})`.slice(0, 31))) i++;
  return `${base} (${i})`.slice(0, 31);
}

/**
 * buildCombinedActivityWorkbook — לשונית "סיכום כללי" (כל הפעילים מוערמים + סה"כ
 * ארגוני לפי סוג בסוף), ואז לשונית מלאה לכל פעיל.
 */
async function buildCombinedActivityWorkbook(activistsData, monthName, year) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  const overview = wb.addWorksheet('סיכום כללי');
  setupSheet(overview);
  let r = 1;
  // שורה→ [count, total] לכל שורת-סוג, כדי לחשב את הסה"כ הארגוני בסוף בלי לרוץ שוב על הנתונים.
  const perTypeCells = TYPE_ROWS.map(() => ({ countCells: [], totalCells: [] }));

  for (const { activistName, data } of activistsData) {
    const blockStartRow = r;
    r = writeSummaryBlock(overview, r, activistName, monthName, year, data);
    // אחרי writeSummaryBlock יש כבר שורה ריקה בסוף — מוסיפים עוד אחת ל-2 שורות ריקות בסה"כ.
    r += 1;

    // איתור שורות טבלת-הסוגים שנכתבו זה עתה, כדי לצבור אותן לסה"כ הארגוני.
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
  }

  // סה"כ ארגוני לפי סוג פעילות
  const orgHeaderRow = overview.getRow(r);
  orgHeaderRow.getCell(1).value = 'סה"כ ארגוני לפי סוג פעילות';
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
