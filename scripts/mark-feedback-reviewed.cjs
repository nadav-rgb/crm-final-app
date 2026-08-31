// Guarded single-record review workflow. Historic bulk matching is intentionally disabled.
const path = require('node:path');
const {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
} = require('./security/operational-guard.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wantsApply = process.argv.includes('--apply');
const operation = beginOperation({
  scriptName: 'mark-feedback-reviewed',
  mode: wantsApply ? 'write' : 'read',
});
const feedbackId = operation.option('id');
const reviewerNote = operation.option('note');
if (operation.option('round')) {
  throw new Error('Operational guard refused: legacy bulk rounds are disabled; use one explicitly scoped --id');
}
if (!UUID.test(feedbackId ?? '') || typeof reviewerNote !== 'string' || reviewerNote.trim().length < 1 || reviewerNote.length > 500) {
  throw new Error('Operational guard refused: --id UUID and bounded --note are required');
}
const sb = createGuardedSupabase(operation, { rootDir: path.join(__dirname, '..') });

async function main() {
  await appendOperationalAudit(sb, operation, 'operational.feedback-review.read');
  const { data, error } = await sb.from('feedback_reports')
    .select('id,project_id,status')
    .eq('project_id', operation.target.projectId).eq('id', feedbackId).maybeSingle();
  if (error || !data) throw new Error('Operational query refused: feedback report');
  process.stdout.write(`${JSON.stringify({
    script: operation.scriptName,
    projectId: operation.target.projectId,
    dryRun: !operation.apply,
    feedback: operation.redact(data.id),
    currentStatus: data.status,
    note: operation.redact(reviewerNote),
    maxRows: operation.maxRows,
  }, null, 2)}\n`);
  if (!operation.apply) return;

  await appendOperationalAudit(sb, operation, 'operational.feedback-review.apply');
  const { error: updateError } = await sb.from('feedback_reports')
    .update({ status: 'reviewed', reviewer_note: reviewerNote, reviewed_at: new Date().toISOString() })
    .eq('project_id', operation.target.projectId).eq('id', feedbackId);
  if (updateError) throw new Error('Operational mutation refused: feedback review');
  process.stdout.write(`${JSON.stringify({ applied: true, feedback: operation.redact(feedbackId) }, null, 2)}\n`);
}

main().catch(() => {
  console.error('Operational feedback workflow failed without exposing target or report content.');
  process.exitCode = 1;
});
