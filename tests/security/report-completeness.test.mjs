import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { escapeRegex } from './helpers.mjs';

const reportPath = 'SECURITY_HARDENING_REPORT.md';
const readReport = () => readFile(reportPath, 'utf8');
const permittedVerdict = 'NOT READY FOR REAL SENSITIVE DATA';
const prohibitedPositiveVerdict = ['READY', 'FOR', 'SECURITY', 'REVIEW'].join(' ');
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

test('blocked run has one negative verdict and exact live-evidence statuses', async () => {
  const report = await readReport();
  const verdictPattern = new RegExp(
    `${escapeRegex(prohibitedPositiveVerdict)}|${escapeRegex(permittedVerdict)}`,
    'g',
  );
  const verdicts = report.match(verdictPattern) ?? [];
  assert.deepEqual(verdicts, [permittedVerdict]);
  assert.doesNotMatch(report, new RegExp(escapeRegex(prohibitedPositiveVerdict)));
  assert.doesNotMatch(report, new RegExp(escapeRegex(prohibitedAbsoluteClaim), 'i'));
  for (const required of [
    /\| G5 controlled live security testing \| BLOCKED \|/,
    /\| Month report against an approved isolated source \| NOT RUN \|/,
    /\| Payroll XLSX against an approved isolated source \| NOT RUN \|/,
    /Live database posture[^\n]*UNVERIFIED/,
    /Live cross-tenant, IDOR, RLS, and provider MFA behavior[^\n]*UNVERIFIED/,
    /16 explicit live skips/,
  ]) assert.match(report, required);
});

test('report keeps deterministic evidence distinct from unperformed live proof', async () => {
  const report = await readReport();
  for (const statement of [
    'No migration has been applied.',
    'No Supabase environment was contacted.',
    'Production is untouched.',
    '17 protected tables plus one classified view',
    'Static contract evidence is not live database proof.',
  ]) assert.match(report, new RegExp(escapeRegex(statement)));
  for (const commit of [
    '72b9196f22812e5dc2452efe33f1fbbf23f3dd4c',
    '6e3a950c52bc18f7e29730b0e6443762f75b81c1',
    'a2af2026de052fd696f948a8375dcec7cc5704f7',
  ]) assert.match(report, new RegExp(commit));
  assert.match(report, /\| Command \| Status \| Exact result \|/);
  assert.match(report, /\| Critical \| High \| Moderate \| Low \| Total \|/);
});

test('database matrix covers every classified object and CRUD/RPC evidence field', async () => {
  const report = await readReport();
  assert.match(
    report,
    /\| Object \| Evidence status \| RLS \| SELECT \| INSERT \| UPDATE \| DELETE \| Relevant RPC\/control \|/,
  );
  for (const object of classifiedDatabaseObjects) {
    assert.match(report, new RegExp('^\\| `' + escapeRegex(object) + '` \\|', 'm'), `missing matrix row: ${object}`);
  }
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
