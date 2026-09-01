const fs = require('node:fs');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');
const { loadLiveInteractionReport } = require('../lib/interactionReportServer');
const { createInteractionWorkbookBuffer } = require('../lib/interactionReportExcel');
const { buildInteractionReportPdf } = require('../lib/interactionReportPdf');

const rootDir = path.join(__dirname, '..');
const outputDir = path.join(rootDir, 'reports');
const excelPath = path.join(outputDir, 'דו״ח-קשרים-אחדות-יהודית.xlsx');
const pdfPath = path.join(outputDir, 'דו״ח-קשרים-אחדות-יהודית.pdf');
const fontPath = path.join(rootDir, 'public', 'fonts', 'Assistant-Regular.ttf');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvConfig(rootDir);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  assert(url && secretKey, 'חסרים משתני הסביבה של Supabase להפקת הדו״ח החי.');

  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report = await loadLiveInteractionReport({ supabase });

  assert(report.meta.projectId === 1, 'הדו״ח לא נטען מפרויקט 1.');
  assert(report.meta.projectName === 'אחדות יהודית', 'שם הפרויקט החי אינו תואם.');
  assert(report.rows.length > 0, 'לא נמצאו פעילים בדו״ח החי.');
  assert(report.totals.totalClients > 0, 'לא נמצאו לקוחות בדו״ח החי.');
  assert(report.totals.totalInteractions > 0, 'לא נמצאו קשרים בדו״ח החי.');
  assert(
    report.rows.reduce((sum, row) => sum + row.totalInteractions, 0) === report.totals.totalInteractions,
    'סכום הקשרים לפי פעיל אינו תואם לסיכום הארגוני.',
  );

  const [excelBuffer, pdfBytes] = await Promise.all([
    createInteractionWorkbookBuffer(report),
    buildInteractionReportPdf(report, { fontBinary: fs.readFileSync(fontPath) }),
  ]);
  assert(Buffer.from(excelBuffer).subarray(0, 2).toString('ascii') === 'PK', 'קובץ ה־Excel שהופק אינו תקין.');
  assert(Buffer.from(pdfBytes).subarray(0, 5).toString('ascii') === '%PDF-', 'קובץ ה־PDF שהופק אינו תקין.');

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(excelPath, Buffer.from(excelBuffer));
  fs.writeFileSync(pdfPath, Buffer.from(pdfBytes));

  process.stdout.write(`${JSON.stringify({
    projectId: report.meta.projectId,
    projectName: report.meta.projectName,
    activists: report.rows.length,
    clients: report.totals.totalClients,
    interactions: report.totals.totalInteractions,
    mitzvotEvents: report.mitzvotEvents.length,
    excelPath,
    excelBytes: fs.statSync(excelPath).size,
    pdfPath,
    pdfBytes: fs.statSync(pdfPath).size,
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
