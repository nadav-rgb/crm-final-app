import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { escapeRegex } from './helpers.mjs';
import { G5_CASE_MANIFEST, G5_REQUIRED_LIVE_TESTS } from '../../scripts/security/g5-evidence.mjs';

const reportPath = 'SECURITY_HARDENING_REPORT.md';
const readReport = () => readFile(reportPath, 'utf8');
const permittedVerdict = ['READY', 'FOR', 'SECURITY', 'REVIEW'].join(' ');
const prohibitedNegativeVerdict = 'NOT READY FOR REAL SENSITIVE DATA';
const prohibitedAbsoluteClaim = ['100%', 'secure'].join(' ');

const requiredHeadings = [
  'Executive Summary',
  'Findings',
  'Changes',
  'Authentication & Session',
  'Authorization',
  'Database / RLS Matrix',
  'Test Evidence',
  'Negative / Adversarial Tests',
  'Dependencies',
  'Secrets',
  'External Integrations',
  'Android',
  'Remaining Risks',
  'External Blockers',
  'Rollback',
  'Final Verdict',
];

const classifiedDatabaseObjects = [
  'projects',
  'project_memberships',
  'profiles',
  'contacts',
  'interactions',
  'base_meeting_reports',
  'meeting_houses',
  'meeting_reminders',
  'tours',
  'expenses',
  'bonus_cancellations',
  'payment_config',
  'notifications',
  'notification_reads',
  'push_subscriptions',
  'fcm_tokens',
  'feedback_reports',
  'activist_directory',
];

const protectedTables = classifiedDatabaseObjects.filter((object) => object !== 'activist_directory');

const scopedFindings = [
  'C1',
  ...Array.from({ length: 11 }, (_, index) => `I${index + 1}`),
  ...Array.from({ length: 3 }, (_, index) => `M${index + 1}`),
];

function sectionUnderHeading(report, heading) {
  const startPattern = new RegExp(`^## ${escapeRegex(heading)}\\r?$`, 'm');
  const match = startPattern.exec(report);
  assert.ok(match, `missing H2 section: ${heading}`);
  const remainder = report.slice(match.index + match[0].length);
  const nextHeading = /\r?\n## /.exec(remainder);
  return nextHeading ? remainder.slice(0, nextHeading.index) : remainder;
}

function markdownCells(line) {
  if (!line.startsWith('|') || !line.endsWith('|')) return null;
  return line.slice(1, -1).split('|').map((cell) => cell.trim());
}

function tableRows(section, headerCells) {
  const lines = section.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const cells = markdownCells(line);
    return cells && cells.length === headerCells.length
      && cells.every((cell, index) => cell === headerCells[index]);
  });
  assert.notEqual(headerIndex, -1, `missing table header: ${headerCells.join(' | ')}`);

  const separator = markdownCells(lines[headerIndex + 1] ?? '');
  assert.ok(
    separator
      && separator.length === headerCells.length
      && separator.every((cell) => /^:?-{3,}:?$/.test(cell)),
    `invalid table separator: ${headerCells.join(' | ')}`,
  );

  const rows = [];
  for (const line of lines.slice(headerIndex + 2)) {
    const cells = markdownCells(line);
    if (!cells) break;
    rows.push(cells);
  }
  return rows;
}

test('security hardening report contains the complete required section contract', async () => {
  const report = await readReport();
  for (const heading of requiredHeadings) {
    assert.match(report, new RegExp(`^## ${escapeRegex(heading)}$`, 'm'), `missing H2 section: ${heading}`);
  }
  assert.equal(
    (report.match(/^## /gm) ?? []).length,
    requiredHeadings.length,
    'report must use the exact required H2 section set',
  );
});

test('completed run has one positive verdict and exact live-evidence statuses', async () => {
  const report = await readReport();
  const verdictPattern = new RegExp(
    `${escapeRegex(permittedVerdict)}|${escapeRegex(prohibitedNegativeVerdict)}`,
    'g',
  );
  const verdicts = report.match(verdictPattern) ?? [];
  assert.deepEqual(verdicts, [permittedVerdict]);
  assert.doesNotMatch(report, new RegExp(escapeRegex(prohibitedNegativeVerdict)));
  assert.doesNotMatch(report, new RegExp(escapeRegex(prohibitedAbsoluteClaim), 'i'));
  for (const required of [
    /\| `node scripts\/security\/g5-local-orchestrator\.mjs` \| PASS \(exit 0\) \|/,
    /\| `node scripts\/verify-month-report\.cjs <year> <month>` \| NOT RUN \|/,
    /\| `node scripts\/verify-payroll-xlsx\.cjs <year> <month>` \| NOT RUN \|/,
    /Live database posture[^\n]*PASS/,
    /Live cross-tenant, IDOR, RLS, and provider MFA behavior[^\n]*PASS/,
    new RegExp(`${G5_REQUIRED_LIVE_TESTS.length} live tests; ${G5_REQUIRED_LIVE_TESTS.length} pass; 0 skip; 0 fail`),
  ]) assert.match(report, required);
});

test('report keeps deterministic evidence distinct from measured live proof', async () => {
  const report = await readReport();
  for (const statement of [
    'Migrations 0018 through 0024 were applied sequentially',
    'No remote Supabase environment was contacted.',
    'Production is untouched.',
    '17 protected tables plus one classified view',
    'Static contract evidence and live database proof are reported separately.',
    `The measured harness manifest contains ${G5_CASE_MANIFEST.length} exact unique SEC IDs`,
    'Database-backed G5 evidence: 48/48 exact cases matched expected outcomes.',
  ]) assert.match(report, new RegExp(escapeRegex(statement)));
  assert.match(report, /\| Critical \| High \| Moderate \| Low \| Total \|/);
});

test('G5 closeout records exact disposable identity and destruction proof', async () => {
  const report = await readReport();
  for (const pattern of [
    /mekarvim-security-g5-f358e8022ba8/,
    /API `56321`; DB `56322`; Studio `56323`; Mail `56324`/,
    /loopback-only.*127\.0\.0\.1/i,
    /twelve exact-project containers/i,
    /supabase_analytics_mekarvim-security-g5-f358e8022ba8/,
    /supabase_edge_runtime_mekarvim-security-g5-f358e8022ba8/,
    /supabase_realtime_mekarvim-security-g5-f358e8022ba8/,
    /supabase_vector_mekarvim-security-g5-f358e8022ba8/,
    /18\/18 excluded container metadata records matched/i,
    /Containers `0`; volumes `0`; networks `0`; listeners `0`/,
    /47\/47 migration checks passed/,
    /48\/48 exact cases matched expected outcomes/,
    /anonymous leaks `0`; 17\/17 RLS enabled and forced/,
  ]) assert.match(report, pattern);

  for (const forbidden of [
    /G5.*BLOCKED/i,
    /live UNVERIFIED/i,
    /0\.0\.0\.0:5632[1-9]/,
  ]) assert.doesNotMatch(report, forbidden);
});

test('scoped closeout table accounts for every requested finding without conflating live proof', async () => {
  const report = await readReport();
  const rows = tableRows(sectionUnderHeading(report, 'Findings'), [
    'Finding', 'Original defect', 'Fix commit(s)', 'Test evidence', 'Status', 'Residual risk',
  ]);
  assert.equal(rows.length, scopedFindings.length, 'scoped closeout table must contain exactly 15 rows');

  const names = [];
  for (const row of rows) {
    assert.equal(row.length, 6, `finding row must have exactly six fields: ${row.join(' | ')}`);
    assert.ok(row.every(Boolean), `finding row must have no empty field: ${row.join(' | ')}`);
    const findingMatch = /^`(C1|I(?:[1-9]|1[01])|M[1-3])`$/.exec(row[0]);
    assert.ok(findingMatch, `invalid scoped finding id: ${row[0]}`);
    names.push(findingMatch[1]);
    assert.equal(row[4], 'ADDRESSED', `${findingMatch[1]} must have an exact addressed status`);
    assert.match(row[5], /G5|time-bound|operator|runtime/i, `${findingMatch[1]} must name a bounded residual risk`);
  }

  assert.equal(new Set(names).size, scopedFindings.length, 'scoped closeout table must not duplicate findings');
  assert.deepEqual([...names].sort(), [...scopedFindings].sort());
});

test('test evidence names every required command with exact status and bounded result', async () => {
  const report = await readReport();
  const rows = tableRows(sectionUnderHeading(report, 'Test Evidence'), [
    'Command', 'Status', 'Exact result',
  ]);
  const byCommand = new Map();
  for (const row of rows) {
    assert.equal(row.length, 3, `command evidence row must have exactly three fields: ${row.join(' | ')}`);
    assert.ok(row.every(Boolean), `command evidence row must have no empty field: ${row.join(' | ')}`);
    assert.ok(!byCommand.has(row[0]), `duplicate command evidence row: ${row[0]}`);
    byCommand.set(row[0], row.slice(1));
  }

  const required = [
    ['`npm ci`', /^PASS \(exit 0\)$/, /packages installed; .* audited; 0 vulnerabilities/],
    ['`npm run test:baseline`', /^PASS \(exit 0\)$/, /51 total; 51 pass; 0 skip; 0 fail/],
    ['`npm run verify:interaction-report`', /^PASS \(exit 0\)$/, /27 total; 27 pass; 0 skip; 0 fail/],
    ['`node scripts/verify-payment-order.cjs`', /^PASS \(exit 0\)$/, /24 total; 24 pass; 0 skip; 0 fail/],
    [
      '`npm run test:security`',
      /^PASS \(exit 0\)$/,
      new RegExp(`343 total; 324 pass; ${G5_REQUIRED_LIVE_TESTS.length} explicit live skips; 0 fail`),
    ],
    [
      '`node --test tests/security/finance-reports-feedback.test.mjs tests/security/jspdf-compatibility.test.mjs tests/security/exceljs-uuid-compatibility.test.mjs`',
      /^PASS \(exit 0\)$/,
      /32 total; 32 pass; 0 skip; 0 fail/,
    ],
    [
      '`npm run test:security -- tests/security/report-completeness.test.mjs`',
      /^PASS \(exit 0\)$/,
      /\d+ total; \d+ pass; 0 skip; 0 fail/,
    ],
    ['`npm run build`', /^PASS \(exit 0\)$/, /Next\.js 16\.3\.3 Webpack production build/],
    [
      '`node .superpowers/sdd/2026-08-27-security-hardening/start-g4-http.mjs`',
      /^PASS \(owned process started\)$/,
      /127\.0\.0\.1:43877/,
    ],
    [
      "`$env:SECURITY_HTTP_BASE_URL='http://127.0.0.1:43877'; node scripts/security/verify-http.mjs`",
      /^PASS \(exit 0\)$/,
      /exact 200\/401\/403\/404\/500; .* five unique nonces/,
    ],
    [
      '`Ctrl+C` to the owned launcher; `Get-NetTCPConnection -LocalPort 43877 -State Listen`',
      /^PASS \(cleanup check\)$/,
      /0 listeners/,
    ],
    ['`node scripts/security/scan-client-bundle.mjs`', /^PASS \(exit 0\)$/, /0 findings/],
    ['`node scripts/security/scan-secrets.mjs --current`', /^PASS \(exit 0\)$/, /0 findings/],
    ['`node scripts/security/scan-secrets.mjs --tracked`', /^PASS \(exit 0\)$/, /0 findings/],
    ['`node scripts/security/scan-secrets.mjs --history`', /^PASS \(exit 0\)$/, /0 findings/],
    ['`npm audit --json`', /^PASS \(exit 0\)$/, /0 Critical; 0 High; 0 Moderate; 0 Low; 0 total/],
    ['`npm audit --omit=dev --json`', /^PASS \(exit 0\)$/, /0 Critical; 0 High; 0 Moderate; 0 Low; 0 total/],
    ['`node --test tests/security/android-hardening.test.mjs`', /^PASS \(exit 0\)$/, /6 total; 6 pass; 0 skip; 0 fail/],
    [
      "`$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\\Sdk'; if (-not (Test-Path -LiteralPath $taskAndroidSdk)) { throw 'Android SDK unavailable' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\\gradlew.bat -p android testDebugUnitTest assembleDebug`",
      /^PASS \(exit 0\)$/,
      /BUILD SUCCESSFUL(?: in \d+s)?; \d+ actionable tasks/,
    ],
    [
      "`$taskAndroidSdk=Join-Path $env:LOCALAPPDATA 'Android\\Sdk'; if (Test-Path -LiteralPath 'android\\keystore.properties') { throw 'keystore.properties unexpectedly exists' }; $env:ANDROID_HOME=$taskAndroidSdk; $env:ANDROID_SDK_ROOT=$taskAndroidSdk; android\\gradlew.bat -p android assembleRelease`",
      /^EXPECTED FAIL \(exit 1\)$/,
      /Release signing configuration missing: android\/keystore\.properties; assertion PASS/,
    ],
    [
      '`node scripts/security/g5-local-orchestrator.mjs`',
      /^PASS \(exit 0\)$/,
      new RegExp(`${G5_REQUIRED_LIVE_TESTS.length} live tests; ${G5_REQUIRED_LIVE_TESTS.length} pass; 0 skip; 0 fail; ${G5_CASE_MANIFEST.length}\\/${G5_CASE_MANIFEST.length} evidence cases`),
    ],
    ['`node scripts/verify-month-report.cjs <year> <month>`', /^NOT RUN$/, /`\.env\.local`; privileged Supabase; person-level output/],
    ['`node scripts/verify-payroll-xlsx.cjs <year> <month>`', /^NOT RUN$/, /`\.env\.local`; privileged Supabase; person\/payroll output/],
    ['`git diff --check`', /^PASS \(exit 0\)$/, /0 whitespace errors; checked before each final report commit/],
    ['`git status --short --branch`', /^PASS \(exit 0\)$/, /tracked tree clean after the final-report commit/],
  ];

  for (const [command, statusPattern, resultPattern] of required) {
    assert.ok(byCommand.has(command), `missing literal command evidence row: ${command}`);
    const [status, result] = byCommand.get(command);
    assert.match(status, statusPattern, `wrong status for ${command}`);
    assert.match(result, resultPattern, `incomplete exact result for ${command}`);
  }
});

test('database matrix covers every classified object and CRUD/RPC evidence field', async () => {
  const report = await readReport();
  const rows = tableRows(sectionUnderHeading(report, 'Database / RLS Matrix'), [
    'Object', 'Evidence status', 'RLS', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'Relevant RPC/control',
  ]);
  assert.equal(rows.length, 18, 'database matrix must contain exactly 18 classified rows');

  const names = [];
  for (const row of rows) {
    assert.equal(row.length, 8, `matrix row must have exactly eight fields: ${row.join(' | ')}`);
    assert.ok(row.every(Boolean), `matrix row must have no empty field: ${row.join(' | ')}`);
    const objectMatch = /^`([^`]+)`$/.exec(row[0]);
    assert.ok(objectMatch, `matrix object must be one canonical code-formatted name: ${row[0]}`);
    names.push(objectMatch[1]);
    assert.equal(row[1], 'Static PASS; live PASS', `wrong evidence status for ${objectMatch[1]}`);
  }

  assert.equal(new Set(names).size, 18, 'database matrix must not contain duplicate object rows');
  assert.deepEqual([...names].sort(), [...classifiedDatabaseObjects].sort());

  for (const table of protectedTables) {
    const row = rows.find(([object]) => object === `\`${table}\``);
    assert.equal(row[2], 'Enable + force', `${table} must be classified as a protected RLS table`);
  }
  const viewRow = rows.find(([object]) => object === '`activist_directory`');
  assert.equal(
    viewRow[2],
    'Security-invoker view over protected sources',
    'activist_directory must be the sole classified security-invoker view',
  );
});

test('report contains no credential values or real-looking PII evidence', async () => {
  const report = await readReport();
  const forbidden = [
    /Bearer\s+[A-Za-z0-9._-]+/i,
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:password|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+/i,
    /\b(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SESSION_ID_PEPPER|SESSION_TOKEN_ENCRYPTION_KEY_V\d+|CRON_SECRET|VAPID_PRIVATE_KEY|GITHUB_TOKEN|ANTHROPIC_API_KEY)\s*[:=]\s*\S+/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+972|\b05\d)[ -]?\d{3}[ -]?\d{4}\b/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(report, pattern);
});
