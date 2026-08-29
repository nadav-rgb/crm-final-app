import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanClientBundle } from '../../scripts/security/scan-client-bundle.mjs';
import {
  createBaseReportCommand,
  updateBaseReportCommand,
  toBaseReportDto,
} from '../../lib/security/domains/base-reports.mjs';
import { activistA, activistB, coordA, PROJECT_A, makeContext } from './fixtures.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function listFiles(directory) {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(directory, { withFileTypes: true }));
  const output = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(absolute));
    else if (/\.(?:js|jsx|mjs)$/.test(entry.name)) output.push(absolute);
  }
  return output;
}

function isClientSource(file) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (relative.startsWith('pages/api/')) return false;
  if (relative.startsWith('lib/security/')) return false;
  if (/\/(?:supabaseAdmin|fcmAdmin|webPushSend|notifyRecipients|interactionReportServer|toursSheet)\.js$/.test(`/${relative}`)) return false;
  return relative.startsWith('pages/') || relative.startsWith('components/') || relative.startsWith('lib/');
}

test('client sources contain no Supabase authority, bearer helper or sensitive persistence', async () => {
  const files = [
    ...await listFiles(path.join(root, 'pages')),
    ...await listFiles(path.join(root, 'components')),
    ...await listFiles(path.join(root, 'lib')),
  ].filter(isClientSource);
  const findings = [];
  const forbidden = [
    ['browser-supabase', /getSupabaseClient|persistSession\s*:\s*true|supabase\.from\s*\(/],
    ['browser-bearer', /authHeader\s*\(|Authorization\s*:/],
    ['pii-local-storage', /localStorage\s*\.|localStorage\s*\[/],
    ['pii-data-import', /(?:data\/(?:contacts|interactions|messages|base-meetings)|chatDemo)/],
    ['legacy-directory', /USERNAME_TO_EMAIL|achdut-crm\.test|ceo123|coord123|activist123/],
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const [category, pattern] of forbidden) {
      if (pattern.test(source)) findings.push(`${category}:${path.relative(root, file).replaceAll('\\', '/')}`);
    }
  }
  assert.deepEqual(findings, []);
});

test('remaining session storage is limited to non-sensitive view preferences', async () => {
  const files = [...await listFiles(path.join(root, 'pages')), ...await listFiles(path.join(root, 'components')), ...await listFiles(path.join(root, 'lib'))]
    .filter(isClientSource);
  const allowedKeys = new Set(['activistsView', 'contactsView', 'myActivitiesView']);
  const findings = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/sessionStorage\.(?:getItem|setItem)\(['"]([^'"]+)['"]/g)) {
      if (!allowedKeys.has(match[1])) findings.push(path.relative(root, file).replaceAll('\\', '/'));
    }
  }
  assert.deepEqual(findings, []);
});

test('legacy browser authority files and tracked PII artifacts are absent from the current tree', async () => {
  const forbidden = [
    'lib/supabaseClient.js', 'lib/apiAuth.js', 'lib/paymentConfig.js', 'lib/meetingHousesStorage.js',
    'lib/reminderTrigger.js', 'lib/chatDemo.js', 'components/ReminderSchedulerMount.jsx',
    'data/contacts.js', 'data/interactions.js', 'data/messages.js', 'data/base-meetings.js',
    'scripts/gen-contacts-seed.js',
    'scripts/contacts_seed.sql', 'scripts/contacts_seed_beta.sql',
    'reports/דו״ח-קשרים-אחדות-יהודית.pdf', 'reports/דו״ח-קשרים-אחדות-יהודית.xlsx',
  ];
  const existing = [];
  for (const relative of forbidden) {
    try { await readFile(path.join(root, relative)); existing.push(relative); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.deepEqual(existing, []);
});

test('base reports, tours and notification calls use same-origin BFF adapters', async () => {
  const crm = await readFile(path.join(root, 'lib/CrmStore.jsx'), 'utf8');
  const notify = await readFile(path.join(root, 'lib/notifyApi.js'), 'utf8');
  assert.match(crm, /apiFetch\(['"]\/api\/base-meetings/);
  assert.match(crm, /fetchToursFromSupabase\(apiFetch\)/);
  assert.doesNotMatch(crm, /select\(['"]\*['"]\)|scopeQueryToUser|getSupabaseClient|persistBaseMeetings/);
  assert.match(notify, /post\(apiFetch,/);
  assert.doesNotMatch(notify, /authHeader|fetch\(/);
});

test('business data failures expose an error state instead of demo or pricing fallbacks', async () => {
  const crm = await readFile(path.join(root, 'lib/CrmStore.jsx'), 'utf8');
  const baseMeetings = await readFile(path.join(root, 'pages/base-meetings.jsx'), 'utf8');
  const addContact = await readFile(path.join(root, 'pages/contacts/add.jsx'), 'utf8');
  assert.match(crm, /dataLoadErrors/);
  assert.doesNotMatch(crm, /DEFAULT_CONFIG/);
  assert.match(baseMeetings, /saveError/);
  assert.doesNotMatch(baseMeetings, /summarizeBaseMeetingDemo/);
  assert.match(addContact, /duplicateError/);
  assert.doesNotMatch(addContact, /catch\s*\{\s*return null;\s*\}/);
});

test('base report commands derive project and actor authority from the authorized house', () => {
  const house = {
    id: '40000000-0000-4000-8000-000000000001', project_id: PROJECT_A,
    assigned_user_ids: [activistA.userId], house_number: '12', settlement: 'Synthetic',
    host_name: 'Synthetic Host', facilitator_name: 'Synthetic Facilitator',
  };
  const input = {
    id: 'house_40000000-0000-4000-8000-000000000001_activist_7_meeting_1',
    houseId: house.id, meetingNumber: 1, date: '2026-08-29', startTime: '10:00',
    structuredAnswers: { participant_count: 4, general_notes: 'Synthetic report' },
    answers: 'Synthetic report', participantCount: 4,
  };
  const command = createBaseReportCommand(makeContext(activistA), house, input, {
    activistCode: 7, actorName: 'Synthetic Actor', now: '2026-08-29T10:30:00.000Z',
  });
  assert.equal(command.actor_user_id, activistA.userId);
  assert.equal(command.project_id, PROJECT_A);
  assert.equal(command.house_id, house.id);
  assert.equal(command.activist_id, 7);
  assert.equal(command.submitted, true);
  assert.throws(() => createBaseReportCommand(makeContext(activistB), house, input, {
    activistCode: 8, actorName: 'Other', now: '2026-08-29T10:30:00.000Z',
  }), (error) => error?.code === 'NOT_FOUND');
  assert.throws(() => createBaseReportCommand(makeContext(activistA), house, {
    ...input, projectId: 202,
  }, { activistCode: 7, actorName: 'Synthetic Actor' }), (error) => error?.code === 'VALIDATION_FAILED');
});

test('base report update is allowlisted and DTO does not expose authority metadata', () => {
  const existing = {
    id: 'report-1', project_id: PROJECT_A, actor_user_id: activistA.userId,
    structured_answers: {}, answers: '', participant_count: 0, ai_summary: null,
  };
  const command = updateBaseReportCommand(makeContext(coordA), existing, {
    structuredAnswers: { general_notes: 'Updated' }, answers: 'Updated', participantCount: 3,
  });
  assert.deepEqual(Object.keys(command).sort(), ['answers', 'participant_count', 'structured_answers']);
  const dto = toBaseReportDto(existing);
  assert.doesNotMatch(JSON.stringify(dto), /actor_user_id|project_id/);
});

test('business APIs use service role only in the explicit cron allowlist', async () => {
  const apiFiles = await listFiles(path.join(root, 'pages/api'));
  const findings = [];
  for (const file of apiFiles) {
    const source = await readFile(file, 'utf8');
    if (!/getSupabaseAdmin/.test(source)) continue;
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (!relative.startsWith('pages/api/cron/')) findings.push(relative);
  }
  assert.deepEqual(findings, []);
});

test('client bundle scanner reports categories and paths without matching values', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mekarvim-client-scan-'));
  try {
    const staticRoot = path.join(temporary, '.next/static/chunks');
    await mkdir(staticRoot, { recursive: true });
    const syntheticToken = 'Bearer eyJsynthetic.header.payload';
    await writeFile(path.join(staticRoot, 'bad.js'), `const x=${JSON.stringify(syntheticToken)};`);
    const result = await scanClientBundle({ root: temporary });
    assert.equal(result.ok, false);
    assert.equal(result.findings[0].category, 'bearer-token');
    assert.equal(result.findings[0].file, '.next/static/chunks/bad.js');
    assert.doesNotMatch(JSON.stringify(result), /eyJsynthetic|header\.payload/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
