// Guarded, redacted diagnostic for one activist in one explicitly approved test project.
const {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
} = require('./security/operational-guard.cjs');
const { calcInteractionPayment, comparePaymentOrder } = require('../lib/paymentCalc.js');

const operation = beginOperation({ scriptName: 'debug-payment' });
const activistId = requiredActivistId();
const sb = createGuardedSupabase(operation, { rootDir: require('node:path').join(__dirname, '..') });

function requiredActivistId() {
  const activistId = Number(operation.option('activist-id'));
  if (!Number.isSafeInteger(activistId) || activistId <= 0) {
    throw new Error('Operational guard refused: --activist-id must be a positive numeric identifier');
  }
  return activistId;
}

function rows(result, label) {
  if (result.error) throw new Error(`Operational query refused: ${label}`);
  return operation.assertBoundedRows(result.data ?? [], label);
}

async function main() {
  await appendOperationalAudit(sb, operation, 'operational.debug-payment.read');
  const [interactionsResult, contactsResult] = await Promise.all([
    sb.from('interactions')
      .select('id,contact_id,activist_id,project_id,type,quality,duration_minutes,date,participants')
      .eq('project_id', operation.target.projectId).eq('activist_id', activistId)
      .limit(operation.maxRows + 1),
    sb.from('contacts')
      .select('id,high_potential')
      .eq('project_id', operation.target.projectId)
      .limit(operation.maxRows + 1),
  ]);
  const interactions = rows(interactionsResult, 'interactions');
  const contacts = rows(contactsResult, 'contacts');
  const contactsById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  const byMonth = new Map();
  for (const interaction of interactions) {
    const date = new Date(interaction.date);
    const month = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
    const list = byMonth.get(month) ?? [];
    list.push(interaction);
    byMonth.set(month, list);
  }
  const summary = [];
  for (const [month, list] of byMonth) {
    const accumulated = [];
    let payable = 0;
    let total = 0;
    for (const interaction of [...list].sort(comparePaymentOrder)) {
      const previousForContact = accumulated.filter((entry) => entry.contact_id === interaction.contact_id);
      const result = calcInteractionPayment(
        interaction,
        previousForContact,
        contactsById.get(String(interaction.contact_id))?.high_potential ?? false,
        accumulated,
      );
      if (result.payable) {
        accumulated.push(interaction);
        payable += 1;
        total += result.amount;
      }
    }
    summary.push({ month, rows: list.length, payable, unpaid: list.length - payable, total });
  }
  process.stdout.write(`${JSON.stringify({
    script: operation.scriptName,
    activist: operation.redact(activistId),
    projectId: operation.target.projectId,
    maxRows: operation.maxRows,
    summary,
  }, null, 2)}\n`);
}

main().catch(() => {
  console.error('Operational diagnostic failed without exposing target or business data.');
  process.exitCode = 1;
});
