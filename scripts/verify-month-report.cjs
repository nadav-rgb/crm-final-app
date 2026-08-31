// Guarded, aggregate-only historical payment verification.
const path = require('node:path');
const {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
} = require('./security/operational-guard.cjs');
const { calcMonthlyPayment, deriveMitzvotBonuses } = require('../lib/paymentCalc.js');

const operation = beginOperation({ scriptName: 'verify-month-report' });
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
  await appendOperationalAudit(sb, operation, 'operational.month-report.read');
  const [interactionsResult, contactsResult, activistsResult, cancellationsResult, expensesResult, toursResult] = await Promise.all([
    sb.from('interactions').select('id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('contacts').select('id,activist_id,project_id,joined_at,source,referred_by,mitzvot_history,high_potential')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('activist_directory').select('activist_code,role,project_id,project_ids')
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
  const paid = activists.filter((entry) => entry.role === 'activist')
    .map((entry) => Number(entry.activist_code)).filter(Number.isSafeInteger);
  let rows = 0;
  let total = 0;
  for (const activistId of paid) {
    const payment = calcMonthlyPayment(
      activistId, interactions, contacts,
      mitzvot.filter((bonus) => Number(bonus.activist_id) === activistId && bonus.month === monthKey),
      participantBonuses.filter((bonus) => Number(bonus.activist_id) === activistId && bonus.month === monthKey),
      undefined, cancelled, { year, month: monthIndex },
    );
    const expensesTotal = expenses.filter((entry) => Number(entry.activist_id) === activistId && entry.date >= start && entry.date < end)
      .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
    const guideTotal = tours.filter((entry) => entry.status === 'completed' && Number(entry.guide_activist_id) === activistId
      && entry.date >= start && entry.date < end).length * 750;
    const grandTotal = payment.total + expensesTotal + guideTotal;
    if (grandTotal !== 0) {
      rows += 1;
      total += grandTotal;
    }
  }
  if (total === 0) throw new Error('Operational verification refused: zero aggregate total');
  process.stdout.write(`${JSON.stringify({
    script: operation.scriptName,
    target: operation.redact(operation.target.ref),
    projectId: operation.target.projectId,
    period: `${year}-${String(month).padStart(2, '0')}`,
    maxRows: operation.maxRows,
    paidActivists: rows,
    aggregateTotal: total,
  }, null, 2)}\n`);
}

main().catch(() => {
  console.error('Operational month verification failed without exposing target or payroll data.');
  process.exitCode = 1;
});
