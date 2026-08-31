// Guarded sensitive export. Files are written only to the explicitly approved non-synced directory.
const fs = require('node:fs');
const path = require('node:path');
const {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
} = require('./security/operational-guard.cjs');
const { loadLiveInteractionReport } = require('../lib/interactionReportServer');
const { createInteractionWorkbookBuffer } = require('../lib/interactionReportExcel');
const { buildInteractionReportPdf } = require('../lib/interactionReportPdf');

const operation = beginOperation({ scriptName: 'generate-interaction-report-files' });
if (operation.target.projectId !== 1) {
  throw new Error('Operational guard refused: this report has an approved fixed project scope of 1 only');
}
const from = operation.option('from') ?? '';
const to = operation.option('to') ?? '';
if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
  throw new Error('Operational guard refused: --from/--to must be ISO dates');
}
const rootDir = path.join(__dirname, '..');
const sb = createGuardedSupabase(operation, { rootDir });
const fontPath = path.join(rootDir, 'public', 'fonts', 'Assistant-Regular.ttf');

function assert(condition) {
  if (!condition) throw new Error('Operational report validation refused');
}

async function main() {
  await appendOperationalAudit(sb, operation, 'operational.interaction-report.export');
  const report = await loadLiveInteractionReport({
    supabase: sb, startDate: from, endDate: to, maxRows: operation.maxRows,
  });
  operation.assertBoundedRows(report.rows ?? [], 'report rows');
  assert(report.meta.projectId === operation.target.projectId);
  assert(report.rows.length > 0 && report.totals.totalClients > 0 && report.totals.totalInteractions > 0);
  assert(report.rows.reduce((sum, row) => sum + row.totalInteractions, 0) === report.totals.totalInteractions);
  const [excelBuffer, pdfBytes] = await Promise.all([
    createInteractionWorkbookBuffer(report),
    buildInteractionReportPdf(report, { fontBinary: fs.readFileSync(fontPath) }),
  ]);
  assert(Buffer.from(excelBuffer).subarray(0, 2).toString('ascii') === 'PK');
  assert(Buffer.from(pdfBytes).subarray(0, 5).toString('ascii') === '%PDF-');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const excelPath = operation.exportPath(`interaction-report-${operation.target.ref}-${stamp}.xlsx`);
  const pdfPath = operation.exportPath(`interaction-report-${operation.target.ref}-${stamp}.pdf`);
  fs.writeFileSync(excelPath, Buffer.from(excelBuffer), { mode: 0o600 });
  fs.writeFileSync(pdfPath, Buffer.from(pdfBytes), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    script: operation.scriptName,
    projectId: operation.target.projectId,
    maxRows: operation.maxRows,
    activists: report.rows.length,
    clients: report.totals.totalClients,
    interactions: report.totals.totalInteractions,
    excel: { path: operation.redact(excelPath), bytes: fs.statSync(excelPath).size },
    pdf: { path: operation.redact(pdfPath), bytes: fs.statSync(pdfPath).size },
  }, null, 2)}\n`);
}

main().catch(() => {
  console.error('Operational report export failed without exposing target or report data.');
  process.exitCode = 1;
});
