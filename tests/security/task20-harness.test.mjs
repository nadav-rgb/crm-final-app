import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MIGRATION_SEQUENCE,
  assertCleanupScope,
  buildLegacyFixtureRows,
  buildMigrationPlan,
  buildSyntheticFixtureBlueprint,
  cleanupSyntheticFixtures,
  createSyntheticAuthActorsWithClient,
  createSecurityRunId,
  provisionLegacyDatabase,
  sanitizeEvidenceRows,
} from '../../scripts/security/provision-test-fixtures.mjs';

const schemaPath = new URL('./fixtures/legacy-security-schema.sql', import.meta.url);

test('test-only legacy schema fixture covers the repository-derived migration contract', async () => {
  const sql = await readFile(schemaPath, 'utf8');
  assert.match(sql, /TEST-ONLY[\s\S]*not a production migration/i);
  for (const table of [
    'projects', 'profiles', 'contacts', 'interactions', 'base_meeting_reports',
    'meeting_houses', 'meeting_reminders', 'tours', 'expenses',
    'bonus_cancellations', 'payment_config', 'notifications', 'notification_reads',
    'push_subscriptions', 'fcm_tokens', 'feedback_reports',
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, 'i'), `missing ${table}`);
  }
  assert.match(sql, /create view public\.activist_directory/i);
  assert.match(sql, /security_run_id uuid/i);
  assert.match(sql, /references auth\.users\(id\)/i);
  assert.match(sql, /create table public\.contacts[\s\S]*phone text[\s\S]*is_active boolean/i);
});

test('migration harness encodes exact ordered stop-and-verify steps', () => {
  assert.deepEqual(MIGRATION_SEQUENCE, ['0018', '0019', '0020', '0021', '0022', '0023', '0024']);
  const plan = buildMigrationPlan('tests/security/fixtures/legacy-security-schema.sql');
  assert.equal(plan.length, 7);
  assert.deepEqual(plan.map((step) => step.id), MIGRATION_SEQUENCE);
  for (const step of plan) {
    assert.match(step.file, new RegExp(`^migrations/${step.id}_[a-z0-9_]+\\.sql$`));
    assert.ok(step.stopOnFailure);
    assert.ok(step.verifications.length > 0);
  }
});

test('synthetic fixture blueprint contains no credentials, tokens, PII or authority inputs', () => {
  const runId = createSecurityRunId();
  const blueprint = buildSyntheticFixtureBlueprint(runId);
  assert.equal(blueprint.securityRunId, runId);
  assert.deepEqual(blueprint.projects.map((project) => project.alias), ['projectA', 'projectB']);
  assert.deepEqual(blueprint.actors.map((actor) => actor.alias), [
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion',
  ]);
  const serialized = JSON.stringify(blueprint);
  assert.doesNotMatch(serialized, /password|access[_-]?token|refresh[_-]?token|service[_-]?role|phone|notes/i);
  assert.doesNotMatch(serialized, /@(?:gmail|outlook|hotmail|yahoo)\./i);
});

test('legacy fixture rows exercise owner backfills for both tenants using exact run tagging', () => {
  const runId = createSecurityRunId();
  const actorIds = Object.fromEntries([
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion',
  ].map((alias) => [alias, createSecurityRunId()]));
  const fixture = buildLegacyFixtureRows(runId, actorIds);
  assert.deepEqual(fixture.projects.map((row) => row.id), [910001, 910002]);
  assert.equal(fixture.profiles.length, 10);
  assert.equal(fixture.contacts.length, 3);
  assert.equal(fixture.interactions.length >= 3, true);
  assert.equal(fixture.meeting_reminders.length >= 2, true);
  assert.equal(fixture.tours.length >= 2, true);
  for (const [table, rows] of Object.entries(fixture)) {
    for (const row of rows) {
      assert.equal(row.security_run_id, runId, `${table} row is not exact-run tagged`);
    }
  }
  assert.deepEqual(new Set(fixture.contacts.map((row) => row.project_id)), new Set([910001, 910002]));
  assert.deepEqual(new Set(fixture.contacts.map((row) => row.activist_id)), new Set([1101, 1102, 1201]));
});

test('partial Auth provisioning deletes only users created by the failed exact run', async () => {
  const deleted = [];
  let created = 0;
  const client = {
    auth: {
      admin: {
        async createUser() {
          created += 1;
          if (created === 2) return { data: { user: null }, error: new Error('synthetic failure') };
          return { data: { user: { id: createSecurityRunId() } }, error: null };
        },
        async deleteUser(id) {
          deleted.push(id);
          return { error: null };
        },
      },
    },
  };
  const runId = createSecurityRunId();
  await assert.rejects(
    () => createSyntheticAuthActorsWithClient({
      client,
      runId,
      targetUrl: 'http://127.0.0.1:54321',
      productionUrl: 'https://production-project.invalid',
      confirmed: true,
    }),
    /fixture provisioning stopped at actor headA/,
  );
  assert.equal(deleted.length, 1);
});

test('every mutating provision/cleanup boundary refuses a remote client before use', async () => {
  let touched = 0;
  const client = new Proxy({}, { get() { touched += 1; return undefined; } });
  const safety = {
    targetUrl: 'https://remote-test.supabase.co',
    productionUrl: 'https://production-project.invalid',
    confirmed: true,
  };
  await assert.rejects(
    () => createSyntheticAuthActorsWithClient({ client, runId: createSecurityRunId(), ...safety }),
    /refused non-loopback/i,
  );
  await assert.rejects(
    () => provisionLegacyDatabase({ client, runId: createSecurityRunId(), actorIds: {}, ...safety }),
    /refused non-loopback/i,
  );
  await assert.rejects(
    () => cleanupSyntheticFixtures({ client, runId: createSecurityRunId(), ...safety }),
    /refused non-loopback/i,
  );
  assert.equal(touched, 0);
});

test('cleanup is bound to one non-empty UUID run id and an allowlisted table', () => {
  const runId = createSecurityRunId();
  assert.deepEqual(assertCleanupScope({ runId, table: 'contacts' }), {
    runId,
    table: 'contacts',
    column: 'security_run_id',
  });
  for (const input of [
    { runId: '', table: 'contacts' },
    { runId: 'not-a-uuid', table: 'contacts' },
    { runId, table: '' },
    { runId, table: 'auth.users' },
    { runId, table: 'projects; drop schema public' },
  ]) {
    assert.throws(() => assertCleanupScope(input), /cleanup refused/i);
  }
});

test('evidence sanitizer emits case metadata only and refuses secret-shaped values', () => {
  const safe = sanitizeEvidenceRows([{
    caseId: 'SEC-001',
    actorClass: 'anonymous',
    resourceClass: 'contact',
    blockingLayer: 'RLS',
    expectedStatus: 'denied',
    actualStatus: 'denied',
    token: 'must-not-survive',
    row: { name: 'must-not-survive' },
  }]);
  assert.deepEqual(safe, [{
    caseId: 'SEC-001',
    actorClass: 'anonymous',
    resourceClass: 'contact',
    blockingLayer: 'RLS',
    expectedStatus: 'denied',
    actualStatus: 'denied',
  }]);
  assert.doesNotMatch(JSON.stringify(safe), /must-not-survive/);
  assert.throws(() => sanitizeEvidenceRows([{
    caseId: 'SEC-001',
    actorClass: 'anonymous',
    resourceClass: 'contact',
    blockingLayer: 'RLS',
    expectedStatus: 'denied',
    actualStatus: 'Bearer synthetic-secret',
  }]), /evidence refused/i);
  assert.throws(() => sanitizeEvidenceRows([{
    caseId: 'SEC-001',
    actorClass: 'person@example.invalid',
    resourceClass: 'contact',
    blockingLayer: 'RLS',
    expectedStatus: 'denied',
    actualStatus: 'denied',
  }]), /evidence refused/i);
  assert.throws(() => sanitizeEvidenceRows([{
    caseId: 'SEC-001',
    actorClass: 'anonymous',
    resourceClass: 'notes',
    blockingLayer: 'RLS',
    expectedStatus: 'denied',
    actualStatus: 'denied',
  }]), /evidence refused/i);
});

test('live suites remain explicitly gated when isolated confirmation is absent', async () => {
  const [rls, session, contracts] = await Promise.all([
    readFile(new URL('./rls-live.test.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./session-live.test.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./db-contracts-live.test.mjs', import.meta.url), 'utf8'),
  ]);
  for (const source of [rls, session, contracts]) {
    assert.match(source, /SECURITY_TEST_CONFIRM_ISOLATED/);
    assert.match(source, /skip:/);
  }
});

test('provisioner never prints or serializes generated credentials', async () => {
  const source = await readFile(new URL('../../scripts/security/provision-test-fixtures.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:console\.(?:log|info)|stdout\.write)\s*\([^)]*(?:password|serviceRoleKey|access_token|refresh_token)/i);
  assert.match(source, /process-local[\s\S]*never serialized/i);
  assert.match(source, /user_metadata:\s*\{\s*security_run_id:/i);
});

test('G5 runbook pins local-only reset, per-step verification, rollback and exact cleanup', async () => {
  const runbook = await readFile(new URL('../../docs/security/STAGING_RUNBOOK.md', import.meta.url), 'utf8');
  assert.match(runbook, /localhost[\s\S]*127\.0\.0\.1[\s\S]*\[::1\]/i);
  assert.match(runbook, /never[\s\S]*remote Supabase/i);
  assert.match(runbook, /legacy-security-schema\.sql[\s\S]*not[\s\S]*Production parity/i);
  assert.match(runbook, /0018[\s\S]*0019[\s\S]*0020[\s\S]*0021[\s\S]*0022[\s\S]*0023[\s\S]*0024/i);
  assert.match(runbook, /0024[\s\S]*0023[\s\S]*0022[\s\S]*0021[\s\S]*0020[\s\S]*0019[\s\S]*0018/i);
  assert.match(runbook, /security_run_id[\s\S]*exact/i);
  assert.match(runbook, /case ID[\s\S]*expected[\s\S]*actual/i);
});
