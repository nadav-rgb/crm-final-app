// lib/payrollExcel.js — ייצוא גיליון שכר לאקסל מעמוד התשלומים.
// גיליון רזה בכוונה: שם הפעיל וכמה כסף מגיע לו, בלי פירוט לפי לקוח. הפירוט המלא
// נשאר בדוח ה-txt שלצידו. הקובץ מיועד להעברה לחשבות, ולכן כל תא כספי הוא **מספר**
// ולא טקסט — כדי שאפשר יהיה לסכם אותו באקסל.
//
// CommonJS בכוונה (כמו lib/paymentCalc.js): כך אפשר לבדוק את בניית הגיליון ישירות
// ב-Node בלי דפדפן. webpack מטפל ב-interop מול ה-import ב-pages/payments.jsx.
//
// exceljs נטענת ב-import דינמי בתוך הפונקציה: היא כבדה (~1MB) ונחוצה רק בלחיצה על
// הכפתור, כך שהיא לא נכנסת ל-bundle הראשוני של העמוד.

// סדר העמודות בגיליון. הסכום = פעילות + בונוסים + סיורים + הוצאות, ולכן ארבע
// עמודות הכסף מסתכמות בדיוק לעמודת הסה"כ — תנאי לכך שהחשבות תוכל לבדוק את עצמה.
const COLUMNS = [
  { header: 'שם הפעיל',      key: 'name',     width: 24 },
  { header: 'תשלום פעילות',  key: 'activity', width: 15 },
  { header: 'בונוסים',       key: 'bonuses',  width: 12 },
  { header: 'הדרכת סיורים',  key: 'guide',    width: 14 },
  { header: 'החזר הוצאות',   key: 'expenses', width: 14 },
  { header: 'סה"כ לתשלום',   key: 'total',    width: 15 },
];

const MONEY_FORMAT = '#,##0 ₪';

/**
 * בונה שורות לגיליון מתוך paymentData של עמוד התשלומים.
 * breakdown מכיל גם קשרים (type==='קשר') וגם בונוסים — הפרדה לשתי עמודות נפרדות.
 */
function buildPayrollRows(paymentData) {
  return (paymentData || []).map(({ activist, breakdown = [], expensesTotal, guidePay, grandTotal }) => {
    const activity = breakdown.filter(b => b.type === 'קשר').reduce((s, b) => s + Number(b.amount || 0), 0);
    const bonuses  = breakdown.filter(b => b.type !== 'קשר').reduce((s, b) => s + Number(b.amount || 0), 0);
    return {
      name:     activist?.name ?? '',
      activity,
      bonuses,
      guide:    Number(guidePay || 0),
      expenses: Number(expensesTotal || 0),
      total:    Number(grandTotal || 0),
    };
  });
}

/**
 * בונה חוברת עבודה של exceljs. פונקציה טהורה — בלי DOM — כדי שתהיה בת-בדיקה ב-Node.
 * @returns Promise<Workbook>
 */
async function buildPayrollWorkbook(paymentData, monthName, year) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`תשלומים ${monthName}`, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });

  ws.columns = COLUMNS;

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6C5CE7' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 22;

  buildPayrollRows(paymentData).forEach(r => ws.addRow(r));

  // שורת סיכום — נוסחת SUM אמיתית ולא ערך קפוא, כדי שתתעדכן אם עורכים ידנית באקסל.
  const firstDataRow = 2;
  const lastDataRow  = ws.rowCount;
  const hasData = lastDataRow >= firstDataRow;
  const totalRow = ws.addRow({
    name: 'סה"כ',
    ...Object.fromEntries(COLUMNS.slice(1).map(c => {
      const col = ws.getColumn(c.key).letter;
      // גיליון ריק — אין טווח לסכם, ולכן 0 קבוע במקום נוסחה שבורה.
      return [c.key, hasData ? { formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})` } : 0];
    })),
  });
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EFFE' } };

  COLUMNS.slice(1).forEach(c => { ws.getColumn(c.key).numFmt = MONEY_FORMAT; });

  return wb;
}

/**
 * מייצר ומוריד קובץ xlsx עם גיליון שכר לחודש נתון. דפדפן בלבד.
 * @param paymentData — מערך הפעילים מעמוד התשלומים (activist, breakdown, expensesTotal, guidePay, grandTotal)
 * @param monthName   — שם החודש בעברית, לשם הגיליון ולשם הקובץ
 * @param year        — שנה
 */
async function exportPayrollXlsx(paymentData, monthName, year) {
  const wb = await buildPayrollWorkbook(paymentData, monthName, year);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `תשלומים-${monthName}-${year}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

module.exports = { exportPayrollXlsx, buildPayrollWorkbook, buildPayrollRows, COLUMNS };
