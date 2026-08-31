// Guarded duplicate finder. --apply is an audited, bounded mutation; otherwise it is dry-run only.
const path = require('node:path');
const {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
} = require('./security/operational-guard.cjs');

const wantsApply = process.argv.includes('--apply');
const operation = beginOperation({
  scriptName: 'find-duplicate-interactions',
  mode: wantsApply ? 'write' : 'read',
});
const sb = createGuardedSupabase(operation, { rootDir: path.join(__dirname, '..') });

function bounded(result) {
  if (result.error) throw new Error('Operational query refused: interactions');
  return operation.assertBoundedRows(result.data ?? [], 'interactions');
}

function duplicateGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.participants?.derived_from) continue;
    const key = [row.activist_id, row.contact_id, row.date, row.type, row.quality, String(row.description ?? '').trim()].join('\u0000');
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1)
    .map((group) => [...group].sort((left, right) => Number(left.id) - Number(right.id)));
}

async function main() {
  await appendOperationalAudit(sb, operation, 'operational.duplicate-interactions.read');
  const result = await sb.from('interactions')
    .select('id,contact_id,activist_id,project_id,type,quality,date,time,description,participants')
    .eq('project_id', operation.target.projectId)
    .order('date').limit(operation.maxRows + 1);
  const groups = duplicateGroups(bounded(result));
  const extras = groups.flatMap((group) => group.slice(1));
  operation.assertBoundedRows(extras, 'duplicate candidates');
  const preview = {
    script: operation.scriptName,
    projectId: operation.target.projectId,
    dryRun: !operation.apply,
    groups: groups.length,
    candidateCount: extras.length,
    candidateIds: extras.map((row) => operation.redact(row.id)),
  };
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!operation.apply || extras.length === 0) return;

  await appendOperationalAudit(sb, operation, 'operational.duplicate-interactions.delete');
  const { error } = await sb.from('interactions').delete()
    .eq('project_id', operation.target.projectId)
    .in('id', extras.map((row) => row.id));
  if (error) throw new Error('Operational mutation refused: duplicate interactions');
  process.stdout.write(`${JSON.stringify({ applied: true, deleted: extras.length }, null, 2)}\n`);
}

main().catch(() => {
  console.error('Operational duplicate workflow failed without exposing target or business data.');
  process.exitCode = 1;
});
