// Guarded payroll workbook verification. The workbook stays in approved encrypted/non-synced storage.
const fs = require('node:fs');
const path = require('node:path');
const {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
} = require('./security/operational-guard.cjs');
const { calcMonthlyPayment, deriveMitzvotBonuses, deriveToraniBonuses } = require('../lib/paymentCalc.js');
const { buildPayrollWorkbook, buildPayrollRows } = require('../lib/payrollExcel.js');

const operation = beginOperation({ scriptName: 'verify-payroll-xlsx' });
const [rawYear, rawMonth] = operation.positional;
const year = Number(rawYear);
const month = Number(rawMonth);
if (!Number.isSafeInteger(year) || year < 2020 || year > 2100 || !Number.isSafeInteger(month) || month < 1 || month > 12) {
  throw new Error('Operational guard refused: provide explicit year/month positional scope');
}
const sb = createGuardedSupabase(operation, { rootDir: path.join(__dirname, '..') });

function bounded(result, label) {
  if (result.error) throw new Error(`Operational query refused: ${label}`);
  return operation.assertBoundedRows(result.data ?? [], label);
}

async function main() {
  await appendOperationalAudit(sb, operation, 'operational.payroll-xlsx.read');
  const [interactionsResult, contactsResult, activistsResult, cancellationsResult, expensesResult, toursResult] = await Promise.all([
    sb.from('interactions').select('id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('contacts').select('id,activist_id,project_id,joined_at,source,referred_by,mitzvot_history,high_potential')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('activist_directory').select('activist_code,name,role,project_id,project_ids')
      .contains('project_ids', [operation.target.projectId]).limit(operation.maxRows + 1),
    sb.from('bonus_cancellations').select('bonus_key,project_id')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('expenses').select('activist_id,project_id,date,amount')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('tours').select('project_id,status,guide_activist_id,date')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
  ]);
  const interactions = bounded(interactionsResult, 'interactions');
  const contacts = bounded(contactsResult, 'contacts');
  const activists = bounded(activistsResult, 'activists');
  const cancellations = bounded(cancellationsResult, 'bonus cancellations');
  const expenses = bounded(expensesResult, 'expenses');
  const tours = bounded(toursResult, 'tours');
  const monthIndex = month - 1;
  const monthKey = `${year}-${monthIndex}`;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const cancelled = new Set(cancellations.map((entry) => entry.bonus_key));
  const participantBonuses = contacts
    .filter((contact) => contact.activist_id && contact.joined_at && (contact.source === 'external' || contact.referred_by))
    .map((contact) => {
      const date = new Date(contact.joined_at);
      return { activist_id: contact.activist_id, contact_id: contact.id, month: `${date.getFullYear()}-${date.getMonth()}` };
    });
  const mitzvot = deriveMitzvotBonuses(contacts);
  const toraniBonuses = deriveToraniBonuses(interactions, contacts);
  const paymentData = activists.filter((entry) => entry.role === 'activist')
    .map((entry) => ({ ...entry, id: Number(entry.activist_code) }))
    .filter((entry) => Number.isSafeInteger(entry.id))
    .map((activist) => {
      const payment = calcMonthlyPayment(
        activist.id, interactions, contacts,
        mitzvot.filter((bonus) => Number(bonus.activist_id) === activist.id && bonus.month === monthKey),
        participantBonuses.filter((bonus) => Number(bonus.activist_id) === activist.id && bonus.month === monthKey),
        undefined, cancelled, { year, month: monthIndex },
        toraniBonuses.filter((bonus) => Number(bonus.activist_id) === activist.id && bonus.month === monthKey),
      );
      const expensesTotal = expenses.filter((entry) => Number(entry.activist_id) === activist.id && entry.date >= start && entry.date < end)
        .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
      const guidedCount = tours.filter((entry) => entry.status === 'completed' && Number(entry.guide_activist_id) === activist.id
        && entry.date >= start && entry.date < end).length;
      const guidePay = guidedCount * 750;
      return { activist, ...payment, expensesTotal, guidePay, guidedCount, grandTotal: payment.total + expensesTotal + guidePay };
    })
    .filter((entry) => entry.grandTotal !== 0);
  operation.assertBoundedRows(paymentData, 'payroll rows');
  if (paymentData.length === 0) throw new Error('Operational verification refused: no bounded payroll rows');
  const rows = buildPayrollRows(paymentData);
  for (const row of rows) {
    if (row.activity + row.bonuses + row.guide + row.expenses !== row.total) {
      throw new Error('Operational verification refused: payroll row total mismatch');
    }
  }
  const pageTotal = paymentData.reduce((sum, entry) => sum + entry.grandTotal, 0);
  if (rows.reduce((sum, row) => sum + row.total, 0) !== pageTotal) {
    throw new Error('Operational verification refused: aggregate total mismatch');
  }
  const monthName = new Intl.DateTimeFormat('he-IL', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthIndex, 1)));
  const workbook = await buildPayrollWorkbook(paymentData, monthName, year);
  const outputPath = operation.exportPath(`payroll-${operation.target.ref}-${year}-${String(month).padStart(2, '0')}.xlsx`);
  await workbook.xlsx.writeFile(outputPath);
  const ExcelJS = (await import('exceljs')).default;
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.readFile(outputPath);
  const worksheet = reloaded.worksheets[0];
  if (!worksheet?.views?.[0]?.rightToLeft || worksheet.getRow(worksheet.rowCount).getCell(1).value !== 'סה"כ') {
    throw new Error('Operational verification refused: workbook layout mismatch');
  }
  const totalCell = worksheet.getRow(worksheet.rowCount).getCell(6);
  if (!totalCell.formula || !/^SUM\(/.test(totalCell.formula)) {
    throw new Error('Operational verification refused: workbook total formula mismatch');
  }
  process.stdout.write(`${JSON.stringify({
    script: operation.scriptName,
    target: operation.redact(operation.target.ref),
    projectId: operation.target.projectId,
    period: `${year}-${String(month).padStart(2, '0')}`,
    maxRows: operation.maxRows,
    payrollRows: rows.length,
    aggregateTotal: pageTotal,
    workbook: { path: operation.redact(outputPath), bytes: fs.statSync(outputPath).size },
  }, null, 2)}\n`);
}

main().catch(() => {
  console.error('Operational payroll verification failed without exposing target or payroll data.');
  process.exitCode = 1;
});
