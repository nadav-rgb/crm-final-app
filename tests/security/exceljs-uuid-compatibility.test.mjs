import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildInteractionReport } = require('../../lib/interactionReport.js');
const { createInteractionWorkbookBuffer } = require('../../lib/interactionReportExcel.js');
const { buildPayrollWorkbook } = require('../../lib/payrollExcel.js');
const { comparePaymentOrder } = require('../../lib/paymentCalc.js');

async function loadWorkbook(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

test('ExcelJS round-trips Hebrew, styles, formulas, and UUID-backed conditional formatting', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('בדיקת תאימות', { views: [{ rightToLeft: true }] });
  sheet.getCell('A1').value = 'סיכום חודשי';
  sheet.getCell('A1').font = { bold: true, color: { argb: 'FF3A249B' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EFFE' } };
  sheet.getCell('A2').value = 10;
  sheet.getCell('A3').value = 20;
  sheet.getCell('A4').value = { formula: 'SUM(A2:A3)', result: 30 };
  sheet.addConditionalFormatting({
    ref: 'A2:A3',
    rules: [{
      type: 'dataBar',
      cfvo: [{ type: 'min' }, { type: 'max' }],
      color: 'FF638EC6',
    }],
  });

  const buffer = await workbook.xlsx.writeBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(buffer.byteLength > 1_000);

  const reopened = await loadWorkbook(buffer);
  const reopenedSheet = reopened.getWorksheet('בדיקת תאימות');
  assert.equal(reopenedSheet.views[0].rightToLeft, true);
  assert.equal(reopenedSheet.getCell('A1').value, 'סיכום חודשי');
  assert.equal(reopenedSheet.getCell('A1').font.bold, true);
  assert.equal(reopenedSheet.getCell('A1').font.color.argb, 'FF3A249B');
  assert.equal(reopenedSheet.getCell('A1').fill.fgColor.argb, 'FFF0EFFE');
  assert.deepEqual(reopenedSheet.getCell('A4').value, { formula: 'SUM(A2:A3)', result: 30 });
  assert.equal(reopenedSheet.conditionalFormattings[0].rules[0].type, 'dataBar');
  assert.match(reopenedSheet.conditionalFormattings[0].rules[0].x14Id, /^\{[0-9A-F-]{36}\}$/);
});

test('production interaction-report workbook opens with Hebrew content and original totals', async () => {
  const report = buildInteractionReport({
    project: { id: 1, name: 'אחדות יהודית' },
    activists: [{ id: 7, activist_code: 7, name: 'שרה כהן', role: 'activist', project_ids: [1] }],
    contacts: [{
      id: 101,
      name: 'רות לוי',
      activist_id: 7,
      project_id: 1,
      mitzvot_history: [{ mitzva: 'שבת', from: 1, to: 2, date: '2026-07-10' }],
    }],
    interactions: [{
      id: 201,
      activist_id: 7,
      contact_id: 101,
      project_id: 1,
      date: '2026-07-10',
      type: 'פרונטלי',
      quality: 'תורני',
      duration_minutes: 45,
    }],
  });

  const buffer = await createInteractionWorkbookBuffer(report);
  const reopened = await loadWorkbook(buffer);
  assert.deepEqual(reopened.worksheets.map(sheet => sheet.name), [
    'סיכום לפי פעיל',
    'התקדמות במצוות',
    'סיכום מצוות',
    'סיכום ארגוני',
  ]);
  const summary = reopened.getWorksheet('סיכום לפי פעיל');
  assert.equal(summary.views[0].rightToLeft, true);
  assert.equal(summary.getCell('A7').value, 'שרה כהן');
  assert.equal(summary.getCell('B7').value, 1);
  assert.equal(summary.getCell('C7').value, 1);
  assert.equal(summary.getCell('J7').value, 45);
  assert.equal(summary.getCell('A8').value, 'סה״כ כל הפעילים');
});

test('production payroll workbook opens with Hebrew, numeric values, styles, and formulas', async () => {
  const workbook = await buildPayrollWorkbook([{
    activist: { name: 'שרה כהן' },
    breakdown: [
      { type: 'קשר', amount: 300 },
      { type: 'בונוס-מצוות', amount: 100 },
    ],
    expensesTotal: 400,
    guidePay: 200,
    grandTotal: 1_000,
  }], 'יולי', 2026);
  const reopened = await loadWorkbook(await workbook.xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('תשלומים יולי');

  assert.equal(sheet.views[0].rightToLeft, true);
  assert.equal(sheet.getCell('A1').value, 'שם הפעיל');
  assert.equal(sheet.getCell('A2').value, 'שרה כהן');
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['שרה כהן', 300, 100, 200, 400, 1_000]);
  assert.equal(sheet.getCell('A3').value, 'סה"כ');
  assert.deepEqual(sheet.getCell('F3').value, { formula: 'SUM(F2:F2)' });
  assert.equal(sheet.getCell('F2').numFmt, '#,##0 ₪');
  assert.equal(sheet.getCell('A1').font.bold, true);
});

test('payment ordering remains deterministic across price, date, and id ties', () => {
  const payment = (quality, date, id) => ({ type: 'פרונטלי', quality, date, id });
  const rows = [
    payment('ידידותי', '2026-07-01', 1),
    payment('תורני', '2026-07-20', 2),
    payment('תורני', '2026-07-01', 5),
    payment('תורני', '2026-07-01', 3),
  ];

  assert.deepEqual(rows.sort(comparePaymentOrder).map(row => row.id), [3, 5, 2, 1]);
});
