// Guarded, bounded comparison of two local payment-engine revisions.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
} = require('./security/operational-guard.cjs');

const operation = beginOperation({ scriptName: 'compare-payment-impact' });
const baseRef = operation.option('base-ref');
const [rawYear, rawMonth] = operation.positional;
const year = Number(rawYear);
const month = Number(rawMonth);
if (!/^[A-Za-z0-9._/-]{1,120}$/.test(baseRef ?? '') || !Number.isSafeInteger(year)
  || year < 2020 || year > 2100 || !Number.isSafeInteger(month) || month < 1 || month > 12) {
  throw new Error('Operational guard refused: provide a local --base-ref and year/month positional scope');
}
const sb = createGuardedSupabase(operation, { rootDir: path.join(__dirname, '..') });

function bounded(result, label) {
  if (result.error) throw new Error(`Operational query refused: ${label}`);
  return operation.assertBoundedRows(result.data ?? [], label);
}

function loadBaseEngine() {
  try {
    const source = execFileSync('git', ['show', `${baseRef}:lib/paymentCalc.js`], {
      encoding: 'utf8', maxBuffer: 4 << 20,
    });
    const target = path.join(os.tmpdir(), `paymentCalc.${baseRef.replace(/[^\w]/g, '_')}.cjs`);
    fs.writeFileSync(target, source, { encoding: 'utf8', mode: 0o600 });
    return require(target);
  } catch {
    throw new Error('Operational guard refused: requested local base revision is unavailable');
  }
}

function deriveMitzvotBonusesLegacy(contacts, perLevel) {
  return (contacts ?? []).flatMap((contact) => {
    if (!contact.activist_id || !Array.isArray(contact.mitzvot_history)) return [];
    return contact.mitzvot_history.flatMap((history) => {
      const from = Number(history?.from ?? 0);
      const to = Number(history?.to ?? 0);
      if (!history?.mitzva || to <= from) return [];
      const date = history.date ? new Date(history.date) : new Date();
      return Array.from({ length: to - from }, (_unused, index) => ({
        activist_id: contact.activist_id,
        contact_id: contact.id,
        amount: perLevel,
        month: `${date.getFullYear()}-${date.getMonth()}`,
        level: index + from + 1,
      }));
    });
  });
}

async function main() {
  await appendOperationalAudit(sb, operation, 'operational.payment-impact.read');
  const [interactionsResult, contactsResult, activistsResult, cancellationsResult] = await Promise.all([
    sb.from('interactions')
      .select('id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('contacts')
      .select('id,activist_id,project_id,joined_at,source,referred_by,mitzvot_history')
      .eq('project_id', operation.target.projectId).limit(operation.maxRows + 1),
    sb.from('activist_directory')
      .select('activist_code,role,project_id,project_ids')
      .contains('project_ids', [operation.target.projectId]).limit(operation.maxRows + 1),
    sb.from('bonus_cancellations')
      .select('bonus_key,project_id').eq('project_id', operation.target.projectId)
      .limit(operation.maxRows + 1),
  ]);
  const interactions = bounded(interactionsResult, 'interactions');
  const contacts = bounded(contactsResult, 'contacts');
  const activists = bounded(activistsResult, 'activists');
  const cancellations = bounded(cancellationsResult, 'bonus cancellations');
  const current = require('../lib/paymentCalc.js');
  const baseline = loadBaseEngine();
  const monthIndex = month - 1;
  const monthKey = `${year}-${monthIndex}`;
  const cancelledKeys = new Set(cancellations.map((row) => row.bonus_key));
  const newParticipantBonuses = contacts
    .filter((contact) => contact.activist_id && contact.joined_at && (contact.source === 'external' || contact.referred_by))
    .map((contact) => {
      const date = new Date(contact.joined_at);
      return { activist_id: contact.activist_id, contact_id: contact.id, month: `${date.getFullYear()}-${date.getMonth()}` };
    });
  const newMitzvot = current.deriveMitzvotBonuses(contacts);
  const oldMitzvot = deriveMitzvotBonusesLegacy(contacts, current.MITZVOT_BONUS_PER_LEVEL);
  const paid = activists.filter((entry) => entry.role === 'activist')
    .map((entry) => Number(entry.activist_code)).filter(Number.isSafeInteger);
  const differences = [];
  let oldTotal = 0;
  let newTotal = 0;
  for (const activistId of paid) {
    const period = { year, month: monthIndex };
    const oldResult = baseline.calcMonthlyPayment(
      activistId, interactions, contacts,
      oldMitzvot.filter((bonus) => Number(bonus.activist_id) === activistId && bonus.month === monthKey),
      newParticipantBonuses.filter((bonus) => Number(bonus.activist_id) === activistId && bonus.month === monthKey),
      baseline.DEFAULTS, cancelledKeys, period,
    );
    const newResult = current.calcMonthlyPayment(
      activistId, interactions, contacts,
      newMitzvot.filter((bonus) => Number(bonus.activist_id) === activistId && bonus.month === monthKey),
      newParticipantBonuses.filter((bonus) => Number(bonus.activist_id) === activistId && bonus.month === monthKey),
      current.DEFAULTS, cancelledKeys, period,
    );
    oldTotal += oldResult.total;
    newTotal += newResult.total;
    if (oldResult.total !== newResult.total) {
      differences.push({ activist: operation.redact(activistId), old: oldResult.total, next: newResult.total, delta: newResult.total - oldResult.total });
    }
  }
  process.stdout.write(`${JSON.stringify({
    script: operation.scriptName,
    projectId: operation.target.projectId,
    baseRef,
    period: `${year}-${String(month).padStart(2, '0')}`,
    maxRows: operation.maxRows,
    totals: { old: oldTotal, next: newTotal, delta: newTotal - oldTotal },
    differences,
  }, null, 2)}\n`);
}

main().catch(() => {
  console.error('Operational comparison failed without exposing target or business data.');
  process.exitCode = 1;
});
