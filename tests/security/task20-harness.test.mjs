import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  waitForLegacySchemaCache,
} from '../../scripts/security/provision-test-fixtures.mjs';
import {
  derivePinnedLocalStackContract,
  RLS_EXPECTED_POLICY_COUNTS,
  RLS_PROTECTED_TABLES,
  SENSITIVE_TABLES,
} from '../../scripts/security/verify-rls-live.mjs';
import { G5_CASE_MANIFEST } from '../../scripts/security/g5-evidence.mjs';

const schemaPath = new URL('./fixtures/legacy-security-schema.sql', import.meta.url);
const localProjectId = 'mekarvim-security-g5-harness';
const localApiPort = 54321;
const pinnedSmtpTemplateBlock = `# Uncomment to expose additional ports for testing user applications that send emails.
# smtp_port = 54325
# pop3_port = 54326`;

function pinnedSupabaseConfig() {
  return `project_id = "legacy-project"

[api]
enabled = true
port = 54321

[db]
port = 54322
shadow_port = 54320

[db.pooler]
enabled = false
port = 54329

[studio]
enabled = true
port = 54323

[local_smtp]
enabled = true
port = 54324
${pinnedSmtpTemplateBlock}

[analytics]
enabled = true
port = 54327

[edge_runtime]
enabled = true
inspector_port = 8083

[auth.mfa.totp]
enroll_enabled = false
verify_enabled = false
`;
}

function pinnedDockerContainers({ projectId = localProjectId, apiPort = localApiPort } = {}) {
  const ports = derivePinnedLocalStackContract(apiPort).stackPorts;
  const specs = [
    ['db', { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.db) }] }],
    ['kong', { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.api) }] }],
    ['auth', {}],
    ['rest', {}],
    ['studio', { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.studio) }] }],
    ['analytics', { '4000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.analytics) }] }],
    ['edge_runtime', {}],
    ['mailpit', {
      '8025/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.mailpit) }],
      '1025/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.smtp) }],
      '1110/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.pop3) }],
    }],
  ];
  return specs.map(([component, portBindings], index) => ({
    Id: String(index + 1).repeat(12),
    Name: `/supabase_${component}_${projectId}`,
    Config: { Labels: { 'com.supabase.cli.project': projectId } },
    NetworkSettings: { Ports: portBindings },
  }));
}

function localSafety(targetUrl = `http://127.0.0.1:${localApiPort}`) {
  const contract = derivePinnedLocalStackContract(localApiPort);
  return {
    targetUrl,
    productionUrl: 'https://production-project.invalid',
    confirmed: true,
    expectedProjectId: localProjectId,
    expectedApiPort: localApiPort,
    stackIdentity: {
      verified: true,
      projectId: localProjectId,
      apiPort: localApiPort,
      listenerPorts: contract.listenerPorts,
      containers: [
        {
          name: `supabase_db_${localProjectId}`, projectId: localProjectId,
          role: 'database', hostPorts: [contract.stackPorts.db],
        },
        {
          name: `supabase_kong_${localProjectId}`, projectId: localProjectId,
          role: 'api', hostPorts: [localApiPort], hostApiPort: localApiPort,
        },
        { name: `supabase_auth_${localProjectId}`, projectId: localProjectId, role: 'auth', hostPorts: [] },
        { name: `supabase_rest_${localProjectId}`, projectId: localProjectId, role: 'rest', hostPorts: [] },
        {
          name: `supabase_analytics_${localProjectId}`, projectId: localProjectId,
          role: 'analytics', hostPorts: [contract.stackPorts.analytics],
        },
        {
          name: `supabase_edge_runtime_${localProjectId}`, projectId: localProjectId,
          role: 'edge-runtime', hostPorts: [],
        },
        {
          name: `supabase_mailpit_${localProjectId}`, projectId: localProjectId,
          role: 'mailpit',
          hostPorts: [contract.stackPorts.mailpit, contract.stackPorts.smtp, contract.stackPorts.pop3],
        },
        {
          name: `supabase_studio_${localProjectId}`, projectId: localProjectId,
          role: 'studio', hostPorts: [contract.stackPorts.studio],
        },
      ],
    },
  };
}

function inventoryCounts() {
  return {
    tables: 18, columns: 91, constraints: 18, rlsEnabled: 0, rlsForced: 0,
    policies: 0, tableGrants: 18, routineGrants: 0, functions: 0,
  };
}

function postCleanupCounts() {
  return {
    anonymousSurfaces: 18,
    anonymousLeaks: 0,
    postureTables: 17,
    rlsEnabledTables: 17,
    rlsForcedTables: 17,
  };
}

function cleanupEvidence() {
  return {
    primary: [
      { kind: 'auth-user', schema: 'auth', table: 'users', resources: 2, before: 2, after: 0 },
      { kind: 'public-row', schema: 'public', table: 'contacts', resources: 1, before: 1, after: 0 },
    ],
    derived: [
      { kind: 'audit-event', schema: 'app_private', table: 'audit_events', resources: 1, before: 1, after: 0 },
    ],
    residuals: [
      { kind: 'audit-event', schema: 'app_private', table: 'audit_events', count: 0 },
      { kind: 'rate-bucket', schema: 'app_private', table: 'rate_limit_buckets', count: 0 },
      { kind: 'session', schema: 'app_private', table: 'auth_sessions', count: 0 },
    ],
  };
}

function completeLifecycleEvidence() {
  const plan = buildMigrationPlan('tests/security/fixtures/legacy-security-schema.sql');
  const inventories = [
    { stage: 'legacy-before-reset-proof', migrationId: null, inventory: inventoryCounts() },
    { stage: 'reset-proof', migrationId: '0018', inventory: inventoryCounts() },
    { stage: 'legacy-after-reset-proof', migrationId: null, inventory: inventoryCounts() },
    ...plan.map((step) => ({
      stage: 'forward', migrationId: step.id, inventory: inventoryCounts(),
    })),
    { stage: 'rollback', migrationId: null, inventory: inventoryCounts() },
    ...plan.map((step) => ({
      stage: 'final-forward', migrationId: step.id, inventory: inventoryCounts(),
    })),
    { stage: 'post-cleanup', migrationId: null, inventory: inventoryCounts() },
  ];
  const checks = [
    ...plan[0].verifications.map((check) => ({
      stage: 'reset-proof', migrationId: plan[0].id, checkId: check.id,
      expected: check.expected, actual: check.expected,
    })),
    ...['forward', 'final-forward'].flatMap((stage) => plan.flatMap((step) => (
      step.verifications.map((check) => ({
        stage, migrationId: step.id, checkId: check.id,
        expected: check.expected, actual: check.expected,
      }))
    ))),
  ];
  return {
    inventories,
    checks,
    postCleanupSecurity: postCleanupCounts(),
    cleanup: cleanupEvidence(),
  };
}

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
    for (const verification of step.verifications) {
      assert.match(verification.id, new RegExp(`^${step.id}-[a-z0-9-]+$`));
      assert.match(verification.sql, /^select[\s\S]+(?:pass|fail)/i);
      assert.equal(verification.expected, 'pass');
    }
  }
  const postureCheck = plan.find((step) => step.id === '0019')?.verifications
    .find((verification) => verification.id === '0019-posture-callable');
  assert.match(postureCheck?.sql ?? '', /from\s+public\.app_security_posture\(\)/i);
});

test('synthetic fixture blueprint contains no credentials, tokens, PII or authority inputs', () => {
  const runId = createSecurityRunId();
  const blueprint = buildSyntheticFixtureBlueprint(runId);
  assert.equal(blueprint.securityRunId, runId);
  assert.deepEqual(blueprint.projects.map((project) => project.alias), ['projectA', 'projectB']);
  assert.deepEqual(blueprint.actors.map((actor) => actor.alias), [
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion', 'unlinked',
  ]);
  const serialized = JSON.stringify(blueprint);
  assert.doesNotMatch(serialized, /password|access[_-]?token|refresh[_-]?token|service[_-]?role|phone|notes/i);
  assert.doesNotMatch(serialized, /@(?:gmail|outlook|hotmail|yahoo)\./i);
});

test('legacy fixture rows exercise owner backfills for both tenants using exact run tagging', () => {
  const runId = createSecurityRunId();
  const actorIds = Object.fromEntries([
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion', 'unlinked',
  ].map((alias) => [alias, createSecurityRunId()]));
  const fixture = buildLegacyFixtureRows(runId, actorIds);
  assert.deepEqual(fixture.projects.map((row) => row.id), [1, 2]);
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
  assert.deepEqual(new Set(fixture.contacts.map((row) => row.project_id)), new Set([1, 2]));
  assert.deepEqual(new Set(fixture.contacts.map((row) => row.activist_id)), new Set([1101, 1102, 1201]));
});

test('legacy provisioner accepts one prebuilt exact fixture for registry parity', async () => {
  const runId = createSecurityRunId();
  const actorIds = Object.fromEntries([
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion', 'unlinked',
  ].map((alias) => [alias, createSecurityRunId()]));
  const rowsByTable = buildLegacyFixtureRows(runId, actorIds);
  const inserted = new Map();
  const client = {
    from(table) {
      return {
        select() {
          return { async limit() { return { error: null }; } };
        },
        async insert(rows) {
          inserted.set(table, rows);
          return { error: null };
        },
      };
    },
  };
  const provisioned = await provisionLegacyDatabase({
    client,
    runId,
    actorIds,
    rowsByTable,
    ...localSafety(),
  });
  assert.equal(provisioned.rowsByTable, rowsByTable);
  assert.equal(inserted.get('contacts'), rowsByTable.contacts);
  assert.equal(provisioned.activistA, actorIds.activistA1);
  assert.equal(provisioned.activistB, actorIds.activistB1);
});

test('legacy schema cache readiness retries reads only and never retries a mutation', async () => {
  const trace = [];
  let toursProbe = 0;
  const client = {
    from(table) {
      return {
        select() {
          return {
            async limit() {
              trace.push(`probe:${table}`);
              if (table === 'tours' && toursProbe++ === 0) return { error: { code: 'PGRST205' } };
              return { error: null };
            },
          };
        },
      };
    },
  };
  await waitForLegacySchemaCache({
    client,
    tables: ['projects', 'tours'],
    maxAttempts: 2,
    pause: async () => { trace.push('pause'); },
  });
  assert.deepEqual(trace, [
    'probe:projects', 'probe:tours', 'pause', 'probe:projects', 'probe:tours',
  ]);
});

test('legacy provisioner exposes only a safe PostgreSQL code when a local insert fails', async () => {
  const runId = createSecurityRunId();
  const actorIds = Object.fromEntries([
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion', 'unlinked',
  ].map((alias) => [alias, createSecurityRunId()]));
  const rowsByTable = buildLegacyFixtureRows(runId, actorIds);
  const client = {
    from(table) {
      return {
        select() {
          return { async limit() { return { error: null }; } };
        },
        async insert() {
          return table === 'tours'
            ? { error: { code: '22007', message: 'sensitive row value', details: 'sensitive detail' } }
            : { error: null };
        },
      };
    },
  };
  await assert.rejects(() => provisionLegacyDatabase({
    client, runId, actorIds, rowsByTable, ...localSafety(),
  }), (error) => {
    assert.match(error.message, /legacy fixture stopped at tours \[22007\]/);
    assert.doesNotMatch(error.message, /sensitive/i);
    return true;
  });
});

test('finance parity is computed in-process from the deterministic fixture and existing payment model', async () => {
  const module = await import('../../scripts/security/provision-test-fixtures.mjs');
  assert.equal(typeof module.computeDeterministicFinanceExpected, 'function');
  const actorIds = Object.fromEntries([
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion', 'unlinked',
  ].map((alias) => [alias, createSecurityRunId()]));
  const expected = module.computeDeterministicFinanceExpected({
    runId: createSecurityRunId(),
    actorIds,
  });

  assert.deepEqual(expected.projectA, [
    {
      user_id: actorIds.activistA1,
      name: 'Synthetic activistA1',
      period: '2026-08',
      activity_total: 10,
      bonus_total: 12,
      tour_total: 0,
      expense_total: 17,
      grand_total: 39,
    },
    {
      user_id: actorIds.activistA2,
      name: 'Synthetic activistA2',
      period: '2026-08',
      activity_total: 20,
      bonus_total: 0,
      tour_total: 0,
      expense_total: 0,
      grand_total: 20,
    },
    {
      user_id: actorIds.staleSecurityVersion,
      name: 'Synthetic staleSecurityVersion',
      period: '2026-08',
      activity_total: 0,
      bonus_total: 0,
      tour_total: 0,
      expense_total: 0,
      grand_total: 0,
    },
  ]);
  assert.deepEqual(expected.projectB, [{
    user_id: actorIds.activistB1,
    name: 'Synthetic activistB1',
    period: '2026-08',
    activity_total: 14,
    bonus_total: 0,
    tour_total: 0,
    expense_total: 19,
    grand_total: 33,
  }]);
  assert.deepEqual(expected.byActor.activistA, expected.projectA.slice(0, 1));
  assert.deepEqual(expected.byActor.headAal2, expected.projectA);
  assert.deepEqual(expected.byActor.financeA, expected.projectA);
  assert.deepEqual(expected.byActor.ceoAal2ProjectA, expected.projectA);
});

test('exact run registry cleans private derived rows before Auth users and proves zero leftovers', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.createSecurityRunRegistry, 'function');
  assert.equal(typeof module.cleanupRegisteredSecurityRun, 'function');
  const runId = createSecurityRunId();
  const actorId = createSecurityRunId();
  const registry = module.createSecurityRunRegistry(runId);
  registry.register({ kind: 'auth-user', schema: 'auth', table: 'users', column: 'id', value: actorId });
  registry.register({
    kind: 'auth-identity', schema: 'app_private', table: 'auth_identities',
    column: 'auth_user_id', value: actorId,
  });
  registry.register({ kind: 'audit-event', schema: 'app_private', table: 'audit_events', column: 'id', value: 41 });
  registry.register({ kind: 'session', schema: 'app_private', table: 'auth_sessions', column: 'session_hash', value: 'session-hash-a' });
  registry.register({ kind: 'rate-bucket', schema: 'app_private', table: 'rate_limit_buckets', column: 'bucket_hash', value: 'bucket-hash-a' });
  registry.register({ kind: 'membership', schema: 'public', table: 'project_memberships', selector: { project_id: 1, user_id: actorId } });
  const contactId = createSecurityRunId();
  const interactionId = createSecurityRunId();
  registry.register({ kind: 'public-row', schema: 'public', table: 'contacts', column: 'id', value: contactId });
  registry.register({ kind: 'public-row', schema: 'public', table: 'interactions', column: 'id', value: interactionId });
  registry.register({ kind: 'project', schema: 'public', table: 'projects', column: 'id', value: 1 });

  const remaining = new Map(registry.entries().map((entry) => [entry.key, 1]));
  const deletionOrder = [];
  const database = {
    async countExact(entry) { return remaining.get(entry.key) ?? 0; },
    async deleteExact(entry) {
      if (entry.table === 'contacts') {
        assert.equal(remaining.get(`public.interactions:id:${interactionId}`), 0,
          'contact FK child must be deleted first');
      }
      deletionOrder.push(entry.kind === 'public-row' ? entry.table : entry.kind);
      remaining.set(entry.key, 0);
    },
  };
  const authAdmin = {
    async deleteUser(id) {
      assert.equal(id, actorId);
      assert.equal(remaining.get('app_private.audit_events:id:41'), 0, 'audit FK still blocks Auth deletion');
      deletionOrder.push('auth-user');
      remaining.set(`auth.users:id:${actorId}`, 0);
      return { error: null };
    },
  };
  const counts = await module.cleanupRegisteredSecurityRun({ registry, database, authAdmin });
  assert.equal([...remaining.values()].some(Boolean), false);
  assert.equal(Object.values(counts).every((entry) => entry.before === 1 && entry.after === 0), true);
  assert.ok(deletionOrder.indexOf('audit-event') < deletionOrder.indexOf('auth-user'));
  assert.ok(deletionOrder.indexOf('auth-identity') < deletionOrder.indexOf('auth-user'));
  assert.ok(deletionOrder.indexOf('interactions') < deletionOrder.indexOf('contacts'));
  assert.ok(deletionOrder.indexOf('auth-user') < deletionOrder.indexOf('project'));
});

test('cleanup evidence groups exact counts without retaining selectors, ids or hashes', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.summarizeCleanupEvidence, 'function');
  const runId = createSecurityRunId();
  const actorId = createSecurityRunId();
  const primaryRegistry = module.createSecurityRunRegistry(runId);
  primaryRegistry.register({
    kind: 'auth-user', schema: 'auth', table: 'users', column: 'id', value: actorId,
  });
  primaryRegistry.register({
    kind: 'session', schema: 'app_private', table: 'auth_sessions',
    column: 'session_hash', value: 'sensitive-session-hash-a',
  });
  const primaryCounts = Object.fromEntries(primaryRegistry.entries().map((entry) => [
    entry.key, { before: 1, after: 0 },
  ]));
  const derivedRegistry = module.createSecurityRunRegistry(runId);
  derivedRegistry.register({
    kind: 'audit-event', schema: 'app_private', table: 'audit_events', column: 'id', value: 71,
  });
  const derivedCounts = Object.fromEntries(derivedRegistry.entries().map((entry) => [
    entry.key, { before: 1, after: 0 },
  ]));

  const evidence = module.summarizeCleanupEvidence({
    primaryRegistry,
    primaryCounts,
    derivedRegistry,
    derivedCounts,
    leftovers: { sessionHashes: [], auditEventIds: [], rateBucketHashes: [] },
  });
  assert.deepEqual(evidence, {
    primary: [
      { kind: 'auth-user', schema: 'auth', table: 'users', resources: 1, before: 1, after: 0 },
      { kind: 'session', schema: 'app_private', table: 'auth_sessions', resources: 1, before: 1, after: 0 },
    ],
    derived: [
      { kind: 'audit-event', schema: 'app_private', table: 'audit_events', resources: 1, before: 1, after: 0 },
    ],
    residuals: [
      { kind: 'audit-event', schema: 'app_private', table: 'audit_events', count: 0 },
      { kind: 'rate-bucket', schema: 'app_private', table: 'rate_limit_buckets', count: 0 },
      { kind: 'session', schema: 'app_private', table: 'auth_sessions', count: 0 },
    ],
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes(actorId), false);
  assert.equal(serialized.includes('sensitive-session-hash-a'), false);
  assert.doesNotMatch(serialized, /selector|column|value|hash/i);
});

test('local lifecycle executes reset proof, migrations, rollback, live flows and cleanup in fail-closed order', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.runG5LocalLifecycle, 'function');
  const trace = [];
  const plan = buildMigrationPlan('tests/security/fixtures/legacy-security-schema.sql');
  const sanitizedInventory = inventoryCounts();
  const database = {
    async resetToLegacy() { trace.push('reset'); },
    async inventory() { trace.push('inventory'); return { ...sanitizedInventory }; },
    async applyFile(file) { trace.push(`apply:${file.split('/').at(-1)}`); },
    async queryCheck(check) { trace.push(`check:${check.id}`); return 'pass'; },
    async verifyRollback() { trace.push('rollback-proof'); return true; },
  };
  const registry = { entries: () => [] };
  const result = await module.runG5LocalLifecycle({
    migrationPlan: plan,
    database,
    target: { verified: true },
    async assertTarget() { trace.push('identity'); },
    async prepareActors() { trace.push('prepare-actors'); return { actorIds: {} }; },
    async seedLegacy() { trace.push('seed-legacy'); },
    async provision() { trace.push('provision'); return { registry, liveEnvironment: {} }; },
    async runLiveEvidence() { trace.push('live-evidence'); return [{ caseId: 'SEC-001', actualStatus: 'denied' }]; },
    async cleanup() {
      trace.push('cleanup');
      return {
        clean: true,
        cleanupEvidence: cleanupEvidence(),
        postCleanupInventory: { ...sanitizedInventory },
        postCleanupSecurity: postCleanupCounts(),
      };
    },
    async abortCleanup() { trace.push('abort-cleanup'); },
  });
  assert.equal(result.completed, true);
  assert.deepEqual(trace.slice(0, 9), [
    'identity', 'reset', 'prepare-actors', 'seed-legacy', 'inventory', 'apply:0018_security_foundation.sql',
    'check:0018-private-schema-revoked',
    'check:0018-owner-backfills-complete',
    'check:0018-identity-map-unique',
  ]);
  assert.equal(trace.filter((item) => item === 'reset').length, 3);
  assert.equal(trace.filter((item) => item === 'prepare-actors').length, 1);
  assert.equal(trace.filter((item) => item === 'seed-legacy').length, 3);
  assert.equal(trace.filter((item) => item === 'inventory').length, 18);
  assert.equal(trace.filter((item) => item.startsWith('apply:0018_')).length, 3);
  assert.ok(trace.indexOf('rollback-proof') < trace.lastIndexOf('reset'));
  assert.ok(trace.indexOf('provision') < trace.indexOf('live-evidence'));
  assert.ok(trace.indexOf('live-evidence') < trace.indexOf('cleanup'));
  assert.equal(result.lifecycleEvidence.inventories.length, 19);
  assert.equal(result.lifecycleEvidence.checks.length, 47);
  assert.deepEqual(result.lifecycleEvidence.inventories[0], {
    stage: 'legacy-before-reset-proof',
    migrationId: null,
    inventory: sanitizedInventory,
  });
  assert.deepEqual(Object.keys(result.lifecycleEvidence.checks[0]).sort(), [
    'actual', 'checkId', 'expected', 'migrationId', 'stage',
  ]);
  assert.deepEqual(result.lifecycleEvidence.postCleanupSecurity, postCleanupCounts());
  assert.deepEqual(result.lifecycleEvidence.cleanup, cleanupEvidence());
  assert.doesNotMatch(JSON.stringify(result.lifecycleEvidence), /select|password|token|row content/i);
});

test('lifecycle evidence fails closed on omitted stages or non-passing migration checks', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const complete = completeLifecycleEvidence();
  assert.equal(module.sanitizeLifecycleEvidence(complete).inventories.length, 19);
  assert.throws(() => module.sanitizeLifecycleEvidence({
    ...complete,
    inventories: complete.inventories.slice(1),
  }), /lifecycle|inventory|complete/i);
  assert.throws(() => module.sanitizeLifecycleEvidence({
    ...complete,
    checks: complete.checks.map((entry, index) => (
      index === 0 ? { ...entry, actual: 'fail' } : entry
    )),
  }), /lifecycle|check|pass/i);
  assert.throws(() => module.sanitizeLifecycleEvidence({
    ...complete,
    postCleanupSecurity: { ...complete.postCleanupSecurity, anonymousSurfaces: 19 },
  }), /security|anonymous|surface/i);
});

test('local lifecycle performs exact abort cleanup after actor creation on migration failure', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const trace = [];
  const plan = buildMigrationPlan('tests/security/fixtures/legacy-security-schema.sql');
  const database = {
    async resetToLegacy() { trace.push('reset'); },
    async inventory() { return inventoryCounts(); },
    async applyFile() { throw new Error('synthetic migration failure'); },
    async queryCheck() { return 'pass'; },
    async verifyRollback() { return true; },
  };
  await assert.rejects(() => module.runG5LocalLifecycle({
    migrationPlan: plan,
    database,
    target: { verified: true },
    async assertTarget() {},
    async prepareActors() { trace.push('prepare-actors'); return { actorIds: { synthetic: true } }; },
    async seedLegacy() { trace.push('seed-legacy'); },
    async provision() { throw new Error('must not provision'); },
    async runLiveEvidence() { throw new Error('must not run live'); },
    async cleanup() { throw new Error('must not use normal cleanup'); },
    async abortCleanup({ actors }) {
      assert.deepEqual(actors, { actorIds: { synthetic: true } });
      trace.push('abort-cleanup');
    },
  }), /synthetic migration failure/);
  assert.deepEqual(trace, ['reset', 'prepare-actors', 'seed-legacy', 'abort-cleanup']);
});

test('local lifecycle preserves the root failure when abort cleanup also fails', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const plan = buildMigrationPlan('tests/security/fixtures/legacy-security-schema.sql');
  const database = {
    async resetToLegacy() {},
    async inventory() { return inventoryCounts(); },
    async applyFile() { throw new Error('synthetic root failure'); },
    async queryCheck() { return 'pass'; },
    async verifyRollback() { return true; },
  };
  await assert.rejects(() => module.runG5LocalLifecycle({
    migrationPlan: plan,
    database,
    target: { verified: true },
    async assertTarget() {},
    async prepareActors() { return { actorIds: { synthetic: true } }; },
    async seedLegacy() {},
    async provision() { throw new Error('must not provision'); },
    async runLiveEvidence() { throw new Error('must not run live'); },
    async cleanup() { throw new Error('must not use normal cleanup'); },
    async abortCleanup() { throw new Error('synthetic abort failure'); },
  }), (error) => {
    assert.match(error.message, /synthetic root failure/);
    assert.match(error.message, /abort cleanup/i);
    return true;
  });
});

test('local PostgreSQL adapter executes only exact task-owned Docker/psql commands', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.createLocalPostgresAdapter, 'function');
  const commands = [];
  const target = localSafety();
  const database = module.createLocalPostgresAdapter({
    repoRoot: 'C:/synthetic/repository',
    target,
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    async readFile(file) {
      if (file.endsWith('legacy-security-schema.sql')) return '-- TEST-ONLY legacy schema';
      if (file.endsWith('0018_security_foundation.sql')) return '-- migration 0018';
      throw new Error(`unexpected file ${file}`);
    },
    runCommand(executable, args, options) {
      commands.push({ executable, args, options });
      const input = String(options.input ?? '');
      if (input.includes('json_build_object')) {
        assert.match(input, /pg_policies/);
        assert.match(input, /routine_privileges/);
        assert.match(input, /relrowsecurity/);
        return {
          status: 0,
          stdout: '{"tables":18,"columns":91,"constraints":18,"rlsEnabled":0,"rlsForced":0,"policies":0,"tableGrants":18,"routineGrants":0,"functions":0}',
          stderr: '',
        };
      }
      if (input.includes("then 'pass'")) return { status: 0, stdout: 'pass\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  await database.resetToLegacy();
  await database.applyFile('migrations/0018_security_foundation.sql');
  assert.deepEqual(await database.inventory('legacy'), {
    tables: 18,
    columns: 91,
    constraints: 18,
    rlsEnabled: 0,
    rlsForced: 0,
    policies: 0,
    tableGrants: 18,
    routineGrants: 0,
    functions: 0,
  });
  assert.equal(await database.queryCheck({
    id: '0018-synthetic', sql: "select case when true then 'pass' else 'fail' end", expected: 'pass',
  }), 'pass');
  assert.equal(await database.verifyRollback(), true);

  assert.equal(commands.length, 5);
  for (const command of commands) {
    assert.equal(command.executable, 'C:/Program Files/Docker/docker.exe');
    assert.deepEqual(command.args.slice(0, 3), [
      'exec', '-i', `supabase_db_${localProjectId}`,
    ]);
    assert.equal(command.options.shell, false);
    assert.equal(command.options.windowsHide, true);
    assert.doesNotMatch(command.args.join(' '), /password|token|key/i);
  }
  assert.match(commands[0].options.input, /drop schema if exists app_private cascade/i);
  assert.match(commands[0].options.input, /TEST-ONLY legacy schema/);
  assert.equal(commands[1].options.input, '-- migration 0018');
});

test('local PostgreSQL adapter reports only an approved migration path and SQLSTATE', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  let capturedArgs = [];
  const database = module.createLocalPostgresAdapter({
    repoRoot: 'C:/synthetic/repository',
    target: localSafety(),
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    async readFile() { return '-- failing migration'; },
    runCommand(_executable, args) {
      capturedArgs = args;
      return {
        status: 1,
        stdout: '',
        stderr: 'ERROR:  42601: syntax error at or near "SELECT"\nLINE 663: sensitive SQL\nCONTEXT: PL/pgSQL function inline_code_block line 46 at EXECUTE\nLOCATION: sensitive detail',
      };
    },
  });
  await assert.rejects(
    () => database.applyFile('migrations/0019_security_rls.sql'),
    (error) => {
      assert.match(error.message, /migrations\/0019_security_rls\.sql \[42601 line 663 context inline_code_block:46 token SELECT\]/);
      assert.doesNotMatch(error.message, /sensitive|row value|SQL and/i);
      return true;
    },
  );
  assert.ok(capturedArgs.includes('--set=VERBOSITY=verbose'));
});

test('local PostgreSQL checks classify array failures without exposing database detail', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const database = module.createLocalPostgresAdapter({
    repoRoot: 'C:/synthetic/repository',
    target: localSafety(),
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    async readFile() { return '-- unused'; },
    runCommand() {
      return {
        status: 1,
        stdout: '',
        stderr: 'ERROR:  22023: multidimensional arrays must have array expressions with matching dimensions\nDETAIL: must-never-reach-safe-diagnostics',
      };
    },
  });
  await assert.rejects(() => database.queryCheck({
    id: '0019-posture-callable',
    sql: "select case when true then 'pass' else 'fail' end",
    expected: 'pass',
  }), (error) => {
    assert.match(error.message, /22023[\s\S]*array-constructor-dimensions/i);
    assert.doesNotMatch(error.message, /must-never-reach-safe-diagnostics/i);
    return true;
  });
});

test('local PostgreSQL checks distinguish sanitized posture grant failures', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const cases = [
    ['public or anon table grant present', 'anonymous-table-grant'],
    ['public or anon column grant present', 'anonymous-column-grant'],
    ['unexpected authenticated column grant', 'unexpected-column-grant'],
    ['required authenticated column grant missing: sensitive-detail', 'required-column-grant-missing'],
    ['authenticated table grants differ on sensitive-detail', 'table-grant-mismatch'],
  ];
  for (const [databaseMessage, expectedReason] of cases) {
    const database = module.createLocalPostgresAdapter({
      repoRoot: 'C:/synthetic/repository',
      target: localSafety(),
      dockerExecutable: 'C:/Program Files/Docker/docker.exe',
      async readFile() { return '-- unused'; },
      runCommand() {
        return {
          status: 1,
          stdout: '',
          stderr: `ERROR:  P0001: security posture refused: ${databaseMessage}`,
        };
      },
    });
    await assert.rejects(() => database.queryCheck({
      id: '0019-posture-callable',
      sql: "select case when true then 'pass' else 'fail' end",
      expected: 'pass',
    }), (error) => {
      assert.match(error.message, new RegExp(`P0001 ${expectedReason}`));
      assert.doesNotMatch(error.message, /sensitive-detail/i);
      return true;
    });
  }
});

test('PostgreSQL invariants are measured directly and fail closed without caller verdict JSON', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.runDirectPostgresAssertions, 'function');
  const actorId = createSecurityRunId();
  const executed = [];
  const database = {
    async execute(sql) {
      executed.push(sql);
      return executed.length === 1 ? 'pass' : 'fail';
    },
  };
  await assert.rejects(() => module.runDirectPostgresAssertions({
    database,
    actorId,
    projectId: 1,
    expectedRows: 3,
    period: '2026-08',
  }), /audit|PostgreSQL|assertion/i);
  assert.equal(executed.length, 2);

  executed.length = 0;
  database.execute = async (sql) => { executed.push(sql); return 'pass'; };
  assert.deepEqual(await module.runDirectPostgresAssertions({
    database,
    actorId,
    projectId: 1,
    expectedRows: 3,
    period: '2026-08',
  }), {
    searchPathHijack: 'pass',
    financeAuditFailure: 'pass',
    unauditedRowsReturned: 0,
  });
  assert.equal(executed.length, 2);
  assert.match(executed[0], /= 3/);
});

test('local PostgreSQL adapter enacts expiry, disabled-user and stale-version state', async () => {
  const { createLocalPostgresAdapter } = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const actorId = createSecurityRunId();
  const sql = [];
  const database = createLocalPostgresAdapter({
    repoRoot: 'C:/synthetic/repository',
    target: localSafety(),
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    async readFile() { return '-- unused'; },
    runCommand(_executable, _args, options) {
      sql.push(String(options.input));
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(typeof database.expireSessionsForUser, 'function');
  assert.equal(typeof database.expireAccessTokensForUser, 'function');
  assert.equal(typeof database.disableProfile, 'function');
  assert.equal(typeof database.bumpSecurityVersion, 'function');
  await database.expireSessionsForUser(actorId);
  await database.expireAccessTokensForUser(actorId);
  await database.disableProfile(actorId);
  await database.bumpSecurityVersion(actorId);
  assert.equal(sql.length, 4);
  assert.match(sql[0], /update app_private\.auth_sessions[\s\S]*idle_expires_at[\s\S]*user_id/i);
  assert.match(sql[1], /update app_private\.auth_sessions[\s\S]*access_token_expires_at[\s\S]*user_id/i);
  assert.match(sql[2], /update public\.profiles[\s\S]*disabled_at[\s\S]*where id/i);
  assert.match(sql[3], /security_version\s*=\s*security_version\s*\+\s*1/i);
  for (const statement of sql) assert.match(statement, new RegExp(actorId, 'i'));
});

test('direct-JWT fixture creates measured AAL1/AAL2 tokens and enacts disabled/stale states', async () => {
  const module = await import('../../scripts/security/provision-test-fixtures.mjs');
  assert.equal(typeof module.createDirectJwtFixture, 'function');
  const aliases = [
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion', 'unlinked',
  ];
  const actors = new Map(aliases.map((alias) => [alias, {
    alias,
    id: createSecurityRunId(),
    email: `${alias}@example.invalid`,
    password: `synthetic-${alias}-password`,
  }]));
  const factorsReset = [];
  const clients = new Map();
  const createClientForActor = (actor) => {
    const client = {
      auth: {
        async signInWithPassword() {
          return { data: { session: { access_token: `${actor.alias}-aal1` } }, error: null };
        },
        mfa: {
          async enroll() {
            return { data: { id: `${actor.alias}-factor`, totp: { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' } }, error: null };
          },
          async challengeAndVerify() {
            return { data: { access_token: `${actor.alias}-aal2` }, error: null };
          },
          async unenroll({ factorId }) {
            factorsReset.push(factorId);
            return { error: null };
          },
        },
        async signOut() { return { error: null }; },
      },
    };
    clients.set(actor.alias, client);
    return client;
  };
  const state = [];
  const database = {
    async disableProfile(id) { state.push(['disabled', id]); },
    async bumpSecurityVersion(id) { state.push(['stale', id]); },
  };
  const result = await module.createDirectJwtFixture({ actors, createClientForActor, database });
  assert.deepEqual(Object.keys(result.tokens).sort(), [
    'activistA', 'activistA2', 'activistB', 'ceoAal1', 'ceoAal2', 'coordA',
    'disabled', 'financeA', 'headAal1', 'headAal2', 'staleSecurityVersion',
  ]);
  assert.equal(result.tokens.ceoAal1, 'ceo-aal1');
  assert.equal(result.tokens.ceoAal2, 'ceo-aal2');
  assert.equal(result.tokens.headAal1, 'headA-aal1');
  assert.equal(result.tokens.headAal2, 'headA-aal2');
  assert.deepEqual(state, [
    ['disabled', actors.get('disabled').id],
    ['stale', actors.get('staleSecurityVersion').id],
  ]);
  assert.deepEqual(factorsReset.sort(), ['ceo-factor', 'headA-factor']);

  await assert.rejects(() => module.createDirectJwtFixture({
    actors,
    createClientForActor(actor) {
      return {
        auth: {
          async signInWithPassword() {
            return { data: { session: { access_token: `${actor.alias}-aal1` } }, error: null };
          },
          mfa: {
            async enroll() {
              return {
                data: null,
                error: { code: 'mfa_factor_name_conflict', status: 422, message: 'sensitive provider detail' },
              };
            },
          },
          async signOut() { return { error: null }; },
        },
      };
    },
    database,
  }), (error) => {
    assert.match(error.message, /ceo enrollment \[mfa_factor_name_conflict status 422\]/);
    assert.doesNotMatch(error.message, /sensitive|provider detail/i);
    return true;
  });
});

test('run registry inventories every seeded, Auth, membership and derived private resource', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.registerSyntheticRunResources, 'function');
  assert.equal(typeof module.registerDerivedPrivateResources, 'function');
  const runId = createSecurityRunId();
  const aliases = [
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion', 'unlinked',
  ];
  const actorIds = Object.fromEntries(aliases.map((alias) => [alias, createSecurityRunId()]));
  const actors = new Map(aliases.map((alias) => [alias, { alias, id: actorIds[alias] }]));
  const rows = buildLegacyFixtureRows(runId, actorIds);
  const runRegistry = module.createSecurityRunRegistry(runId);
  module.registerSyntheticRunResources({ registry: runRegistry, rowsByTable: rows, actors });
  const baseEntries = runRegistry.entries();
  const publicRowCount = Object.values(rows).reduce((total, tableRows) => total + tableRows.length, 0);
  const membershipCount = rows.profiles.filter((profile) => profile.project_id != null).length;
  assert.equal(baseEntries.length, publicRowCount + membershipCount + actors.size * 2);
  assert.equal(baseEntries.filter((entry) => entry.kind === 'auth-user').length, actors.size);
  assert.equal(baseEntries.filter((entry) => entry.kind === 'auth-identity').length, actors.size);
  assert.deepEqual(
    new Set(baseEntries.filter((entry) => entry.kind === 'auth-identity').map((entry) => entry.column)),
    new Set(['auth_user_id']),
  );
  assert.equal(baseEntries.filter((entry) => entry.kind === 'membership').length, membershipCount);

  module.registerDerivedPrivateResources({
    registry: runRegistry,
    resources: {
      sessionHashes: ['session-a', 'session-b'],
      auditEventIds: [71, 72],
      rateBucketHashes: ['bucket-a'],
    },
  });
  assert.equal(runRegistry.entries().filter((entry) => entry.kind === 'session').length, 2);
  assert.equal(runRegistry.entries().filter((entry) => entry.kind === 'audit-event').length, 2);
  assert.equal(runRegistry.entries().filter((entry) => entry.kind === 'rate-bucket').length, 1);
});

test('local stack controller captures keys in memory and binds start/status/stop to the exact project', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.createLocalStackController, 'function');
  const projectDir = `C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local/${localProjectId}`;
  const calls = [];
  const dockerCalls = [];
  const shutdownProbes = [];
  let stackRunning = false;
  const inspections = pinnedDockerContainers();
  const preparedContract = derivePinnedLocalStackContract(localApiPort);
  const controller = module.createLocalStackController({
    projectId: localProjectId,
    apiPort: localApiPort,
    projectDir,
    allowedRoot: 'C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local',
    supabaseExecutable: 'C:/synthetic/bin/supabase.exe',
    dockerShimExecutable: 'C:/synthetic/shim/docker.exe',
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    productionUrl: 'https://production-project.invalid',
    async prepareProject() { calls.push('prepare'); return preparedContract; },
    runCommand(_executable, args, options) {
      calls.push(args.join(' '));
      assert.equal(options.env.G5_DOCKER_LOOPBACK_SHIM_ACTIVE, 'true');
      assert.equal(options.env.G5_DOCKER_REAL_EXECUTABLE, 'C:\\Program Files\\Docker\\docker.exe');
      assert.equal(options.env.G5_DOCKER_EXPECTED_PROJECT_ID, localProjectId);
      assert.equal(options.env.G5_DOCKER_ALLOWED_PUBLISH_PORTS, preparedContract.persistentHostPorts.join(','));
      assert.equal(options.env.PATH.split(';')[0], 'C:\\synthetic\\shim');
      if (args[0] === '--version') return { status: 0, stdout: '2.115.0\n', stderr: '' };
      if (args[0] === 'start') stackRunning = true;
      if (args[0] === 'stop') stackRunning = false;
      if (args[0] === 'status') return {
        status: 0,
        stdout: JSON.stringify({
          API_URL: `http://127.0.0.1:${localApiPort}`,
          ANON_KEY: 'synthetic-local-publishable-key',
          SERVICE_ROLE_KEY: 'synthetic-local-service-role-key',
          DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres',
        }),
        stderr: '',
      };
      return { status: 0, stdout: '', stderr: '' };
    },
    runDocker(args) {
      dockerCalls.push(args.join(' '));
      if (args[0] === 'ps') return {
        status: 0,
        stdout: stackRunning ? inspections.map((item) => item.Id).join('\n') : '',
        stderr: '',
      };
      if (args[0] === 'volume') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: JSON.stringify(inspections), stderr: '' };
    },
    async probePort(host, port) {
      shutdownProbes.push(`${host}:${port}`);
      return false;
    },
  });
  const started = await controller.start();
  assert.equal(started.target.targetUrl, `http://127.0.0.1:${localApiPort}`);
  assert.equal(started.credentials.publishableKey, 'synthetic-local-publishable-key');
  assert.equal(started.credentials.serviceRoleKey, 'synthetic-local-service-role-key');
  assert.equal(started.target.stackIdentity.projectId, localProjectId);
  await controller.stop();
  const resolvedProjectDir = projectDir.replaceAll('/', '\\');
  assert.deepEqual(calls, [
    '--version',
    'prepare',
    `start --workdir ${resolvedProjectDir}`,
    `status --workdir ${resolvedProjectDir} --output json`,
    `stop --workdir ${resolvedProjectDir} --no-backup`,
  ]);
  assert.equal(dockerCalls.some((command) => command.startsWith('ps --all --filter label=')), true);
  assert.equal(dockerCalls.some((command) => command.startsWith('ps --all --filter name=')), true);
  assert.equal(dockerCalls.filter((command) => command.startsWith('volume ls')).length, 2);
  assert.deepEqual(new Set(shutdownProbes), new Set([
    ...preparedContract.listenerPorts.flatMap((port) => [
      `127.0.0.1:${port}`, `::1:${port}`,
    ]),
  ]));
});

test('local stack preparation pins CLI 2.115.0 and validates every enabled and disabled listener section', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(module.PINNED_SUPABASE_CLI_VERSION, '2.115.0');
  assert.equal(typeof module.preparePinnedLocalStackConfig, 'function');

  const prepared = module.preparePinnedLocalStackConfig({
    config: pinnedSupabaseConfig(),
    projectId: localProjectId,
    apiPort: localApiPort,
  });
  assert.deepEqual(prepared.contract.listenerPorts, [
    54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327,
  ]);
  assert.deepEqual(prepared.contract.reservedPorts, [
    54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327, 54329, 54342,
  ]);
  assert.deepEqual(prepared.contract.containerHostPorts['edge-runtime'], []);
  assert.deepEqual(prepared.contract.services, {
    api: true,
    studio: true,
    localSmtp: true,
    analytics: true,
    pooler: false,
    edgeRuntime: true,
  });
  assert.match(prepared.config, /project_id = "mekarvim-security-g5-harness"/);
  assert.match(prepared.config, /\[edge_runtime\][\s\S]*inspector_port = 54342/);
  assert.match(prepared.config, /\[db\.pooler\][\s\S]*enabled = false[\s\S]*port = 54329/);
  assert.match(prepared.config, /\[local_smtp\][\s\S]*\nsmtp_port = 54325\npop3_port = 54326/);
  assert.match(prepared.config, /\[auth\.mfa\.totp\][\s\S]*enroll_enabled = true[\s\S]*verify_enabled = true/);
  assert.doesNotMatch(prepared.config, /^# (?:smtp|pop3)_port\s*=/m);

  const customBase = module.preparePinnedLocalStackConfig({
    config: pinnedSupabaseConfig(),
    projectId: localProjectId,
    apiPort: 55000,
  });
  assert.match(customBase.config, /\[local_smtp\][\s\S]*\nsmtp_port = 55004\npop3_port = 55005/);

  const movedBlock = pinnedSupabaseConfig()
    .replace(`${pinnedSmtpTemplateBlock}\n`, '')
    .replace('[analytics]', `[analytics]\n${pinnedSmtpTemplateBlock}`);
  for (const invalid of [
    pinnedSupabaseConfig().replace('[local_smtp]', '[inbucket]'),
    `${pinnedSupabaseConfig()}\n[inbucket]\nenabled = true\nport = 54324\n`,
    pinnedSupabaseConfig().replace(`${pinnedSmtpTemplateBlock}\n`, ''),
    pinnedSupabaseConfig().replace('# smtp_port = 54325\n', ''),
    pinnedSupabaseConfig().replace('# pop3_port = 54326\n', ''),
    pinnedSupabaseConfig().replace('# smtp_port = 54325', '# smtp_ports = 54325'),
    pinnedSupabaseConfig().replace('# smtp_port = 54325', '# smtp_port = 54399'),
    pinnedSupabaseConfig().replace('# smtp_port = 54325', 'smtp_port = 54325'),
    pinnedSupabaseConfig()
      .replace('# smtp_port = 54325', 'smtp_port = 54325')
      .replace('# pop3_port = 54326', 'pop3_port = 54326'),
    pinnedSupabaseConfig().replace('# smtp_port = 54325', 'smtp_port = 54325\n# smtp_port = 54325'),
    pinnedSupabaseConfig().replace(pinnedSmtpTemplateBlock, `${pinnedSmtpTemplateBlock}\n${pinnedSmtpTemplateBlock}`),
    `${pinnedSupabaseConfig()}\n# Uncomment to expose additional ports for testing user applications that send emails.\n`,
    pinnedSupabaseConfig().replace('# Uncomment to expose additional ports for testing user applications that send emails.\n', ''),
    movedBlock,
    pinnedSupabaseConfig().replace('[analytics]\nenabled = true', '[analytics]\nenabled = true\nenabled = true'),
    pinnedSupabaseConfig().replace('[db.pooler]\nenabled = false', '[db.pooler]\nenabled = true'),
    pinnedSupabaseConfig().replace('enroll_enabled = false\n', ''),
    pinnedSupabaseConfig().replace('verify_enabled = false', 'verify_enabled = false\nverify_enabled = false'),
    pinnedSupabaseConfig().replace('[auth.mfa.totp]', '[auth.mfa.webauthn]'),
  ]) {
    assert.throws(() => module.preparePinnedLocalStackConfig({
      config: invalid,
      projectId: localProjectId,
      apiPort: localApiPort,
    }), /config|contract|section|listener|disabled/i);
  }
});

test('partial non-zero stack start owns cleanup and independently proves exact final state', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const projectDir = `C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local/${localProjectId}`;
  const calls = [];
  const dockerCalls = [];
  const probes = [];
  let partiallyRunning = false;
  const partialContainer = {
    Id: 'a'.repeat(12),
    Name: `/supabase_kong_${localProjectId}`,
    Config: { Labels: { 'com.supabase.cli.project': localProjectId } },
    NetworkSettings: {
      Ports: {
        '8000/tcp': [
          { HostIp: '127.0.0.1', HostPort: String(localApiPort) },
          { HostIp: '::1', HostPort: '60000' },
        ],
      },
    },
  };
  const contract = module.preparePinnedLocalStackConfig({
    config: pinnedSupabaseConfig(), projectId: localProjectId, apiPort: localApiPort,
  }).contract;
  const controller = module.createLocalStackController({
    projectId: localProjectId,
    apiPort: localApiPort,
    projectDir,
    allowedRoot: 'C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local',
    supabaseExecutable: 'C:/synthetic/bin/supabase.exe',
    dockerShimExecutable: 'C:/synthetic/shim/docker.exe',
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    productionUrl: 'https://production-project.invalid',
    async prepareProject() { calls.push('prepare'); return contract; },
    runCommand(_executable, args) {
      calls.push(args.join(' '));
      if (args[0] === '--version') return { status: 0, stdout: '2.115.0\n', stderr: '' };
      if (args[0] === 'start') {
        partiallyRunning = true;
        return { status: 1, stdout: '', stderr: 'synthetic private failure' };
      }
      if (args[0] === 'stop') partiallyRunning = false;
      return { status: 0, stdout: '', stderr: '' };
    },
    runDocker(args) {
      dockerCalls.push(args.join(' '));
      if (args[0] === 'ps') return { status: 0, stdout: partiallyRunning ? partialContainer.Id : '', stderr: '' };
      if (args[0] === 'inspect') return { status: 0, stdout: JSON.stringify([partialContainer]), stderr: '' };
      if (args[0] === 'volume') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '[]', stderr: '' };
    },
    async probePort(host, port) { probes.push(`${host}:${port}`); return false; },
  });

  await assert.rejects(() => controller.start(), /start/i);
  const resolvedProjectDir = projectDir.replaceAll('/', '\\');
  assert.deepEqual(calls, [
    '--version',
    'prepare',
    `start --workdir ${resolvedProjectDir}`,
    `stop --workdir ${resolvedProjectDir} --no-backup`,
  ]);
  assert.equal(partiallyRunning, false);
  assert.ok(dockerCalls.some((call) => call.startsWith('ps --all --filter label=')));
  assert.ok(dockerCalls.some((call) => call.startsWith('ps --all --filter name=')));
  assert.equal(dockerCalls.filter((call) => call.startsWith('volume ls')).length, 2);
  assert.deepEqual(new Set(probes.map((entry) => Number(entry.split(':').at(-1)))),
    new Set([...contract.listenerPorts, 60000]));
});

test('partial start preserves the start error and cleanup failure while still running final-state proof', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const projectDir = `C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local/${localProjectId}`;
  const contract = module.preparePinnedLocalStackConfig({
    config: pinnedSupabaseConfig(), projectId: localProjectId, apiPort: localApiPort,
  }).contract;
  let probes = 0;
  const controller = module.createLocalStackController({
    projectId: localProjectId,
    apiPort: localApiPort,
    projectDir,
    allowedRoot: 'C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local',
    supabaseExecutable: 'C:/synthetic/bin/supabase.exe',
    dockerShimExecutable: 'C:/synthetic/shim/docker.exe',
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    productionUrl: 'https://production-project.invalid',
    async prepareProject() { return contract; },
    runCommand(_executable, args) {
      if (args[0] === '--version') return { status: 0, stdout: '2.115.0\n', stderr: '' };
      return { status: 1, stdout: 'private output', stderr: 'private error' };
    },
    runDocker(args) {
      if (args[0] === 'ps' || args[0] === 'volume') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '[]', stderr: '' };
    },
    async probePort() { probes += 1; return false; },
  });
  await assert.rejects(() => controller.start(), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /start/i);
    assert.match(error.errors[1].message, /cleanup/i);
    assert.doesNotMatch(error.message, /private output|private error/i);
    return true;
  });
  assert.equal(probes, contract.listenerPorts.length * 2);
});

test('local stack controller rejects an unpinned CLI before project mutation or start', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  let prepared = false;
  const commands = [];
  const commandEnvironments = [];
  const controller = module.createLocalStackController({
    projectId: localProjectId,
    apiPort: localApiPort,
    projectDir: `C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local/${localProjectId}`,
    allowedRoot: 'C:/synthetic/repository/.superpowers/sdd/2026-08-27-security-hardening/g5-local',
    supabaseExecutable: 'C:/synthetic/bin/supabase.exe',
    dockerShimExecutable: 'C:/synthetic/shim/docker.exe',
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    productionUrl: 'https://production-project.invalid',
    async prepareProject() { prepared = true; },
    runCommand(_executable, args, options) {
      commands.push(args.join(' '));
      commandEnvironments.push(options.env);
      return { status: 0, stdout: '2.114.0\n', stderr: '' };
    },
    runDocker() { throw new Error('Docker must not be inspected before version validation'); },
  });
  await assert.rejects(() => controller.start(), /version|pinned/i);
  assert.equal(prepared, false);
  assert.deepEqual(commands, ['--version']);
  assert.equal(commandEnvironments[0].SUPABASE_NO_UPDATE_NOTIFIER, '1');
  assert.equal(commandEnvironments[0].SUPABASE_TELEMETRY_DISABLED, '1');
});

test('stack shutdown proof rejects exact-project containers, volumes and configured listeners', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.verifyLocalStackStopped, 'function');
  const cleanDocker = (args) => {
    assert.ok(args.includes(`label=com.supabase.cli.project=${localProjectId}`)
      || args.includes(`name=${localProjectId}`));
    return { status: 0, stdout: '', stderr: '' };
  };
  assert.deepEqual(await module.verifyLocalStackStopped({
    projectId: localProjectId,
    apiPort: localApiPort,
    runDocker: cleanDocker,
    async probePort() { return false; },
  }), { containers: 0, volumes: 0, listeners: 0 });

  await assert.rejects(() => module.verifyLocalStackStopped({
    projectId: localProjectId,
    apiPort: localApiPort,
    runDocker(args) {
      if (args[0] === 'ps') return { status: 0, stdout: 'a'.repeat(12), stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    async probePort() { return false; },
  }), /container/i);
  await assert.rejects(() => module.verifyLocalStackStopped({
    projectId: localProjectId,
    apiPort: localApiPort,
    runDocker(args) {
      if (args[0] === 'volume' && args.includes('label=com.supabase.cli.project=' + localProjectId)) {
        return { status: 0, stdout: `supabase_db_${localProjectId}`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    async probePort() { return false; },
  }), /volume/i);
  await assert.rejects(() => module.verifyLocalStackStopped({
    projectId: localProjectId,
    apiPort: localApiPort,
    runDocker: cleanDocker,
    async probePort(_host, port) { return port === localApiPort + 2; },
  }), /listener/i);

  const hiddenContainer = {
    Id: 'f'.repeat(12),
    Name: `/supabase_studio_${localProjectId}`,
    Config: { Labels: {} },
    NetworkSettings: { Ports: {} },
  };
  const calls = [];
  await assert.rejects(() => module.verifyLocalStackStopped({
    projectId: localProjectId,
    apiPort: localApiPort,
    runDocker(args) {
      calls.push([...args]);
      if (args[0] === 'ps') {
        const isLabelQuery = args.includes(`label=com.supabase.cli.project=${localProjectId}`);
        return {
          status: 0,
          stdout: isLabelQuery ? '' : hiddenContainer.Id,
          stderr: '',
        };
      }
      if (args[0] === 'inspect') {
        return { status: 0, stdout: JSON.stringify([hiddenContainer]), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    async probePort() { return false; },
  }), /container|identity|name/i);
  assert.ok(calls.some((args) => args[0] === 'ps' && args.includes(`name=${localProjectId}`)));
  assert.ok(calls.some((args) => args[0] === 'inspect' && args.includes(hiddenContainer.Id)));
  await assert.rejects(() => module.verifyLocalStackStopped({
    projectId: localProjectId,
    apiPort: 65533,
    runDocker: cleanDocker,
    async probePort() { return false; },
  }), /port|boundary/i);
});

test('private derived-resource inventory returns exact identifiers for registry delta tracking', async () => {
  const { createLocalPostgresAdapter } = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const database = createLocalPostgresAdapter({
    repoRoot: 'C:/synthetic/repository',
    target: localSafety(),
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    async readFile() { return '-- unused'; },
    runCommand(_executable, _args, options) {
      assert.match(String(options.input), /auth_sessions[\s\S]*audit_events[\s\S]*rate_limit_buckets/i);
      return {
        status: 0,
        stdout: JSON.stringify({
          sessionHashes: ['session-a'], auditEventIds: [11, 12], rateBucketHashes: ['bucket-a'],
        }),
        stderr: '',
      };
    },
  });
  assert.deepEqual(await database.inventoryPrivateResourceIds(), {
    sessionHashes: ['session-a'], auditEventIds: [11, 12], rateBucketHashes: ['bucket-a'],
  });
});

test('post-cleanup proof reruns anonymous isolation and forced-RLS posture with sanitized counts', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.verifyPostCleanupSecurity, 'function');
  const anonymousRows = SENSITIVE_TABLES.map((table) => ({ table, blocked: true, leaked: false }));
  const postureRows = RLS_PROTECTED_TABLES.map((tableName) => ({
    table_name: tableName, rls_enabled: true, rls_forced: true,
    policy_count: RLS_EXPECTED_POLICY_COUNTS[tableName],
  }));
  const serviceClient = {
    async rpc(name) {
      assert.equal(name, 'app_security_posture');
      return { data: postureRows, error: null };
    },
  };
  assert.deepEqual(await module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient,
    async anonymousProbe() { return anonymousRows; },
  }), {
    anonymousSurfaces: 18,
    anonymousLeaks: 0,
    postureTables: 17,
    rlsEnabledTables: 17,
    rlsForcedTables: 17,
  });

  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient,
    async anonymousProbe() { return [{ table: 'contacts', blocked: false, leaked: true }]; },
  }), /anonymous|isolation|leak/i);
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return { data: [{ table_name: 'contacts', rls_enabled: true, rls_forced: false }], error: null };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), /posture|RLS/i);
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return {
          data: postureRows.map((row) => {
            if (row.table_name !== 'contacts') return row;
            const { policy_count: _policyCount, ...withoutPolicyCount } = row;
            return withoutPolicyCount;
          }),
          error: null,
        };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), /contacts[\s\S]*policy[\s\S]*UNKNOWN[\s\S]*expected[\s\S]*4/i);
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return {
          data: null,
          error: { code: '42501', message: 'must-never-reach-safe-diagnostics' },
        };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), (error) => {
    assert.match(error.message, /posture[\s\S]*42501/i);
    assert.doesNotMatch(error.message, /must-never-reach-safe-diagnostics/i);
    return true;
  });
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return {
          data: null,
          error: {
            code: '22023',
            message: 'multidimensional arrays must have array expressions with matching dimensions',
          },
        };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), /22023[\s\S]*array-constructor-dimensions/i);
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return {
          data: null,
          error: { code: '22023', message: 'cannot accumulate arrays of different dimensionality' },
        };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), /22023[\s\S]*array-aggregate-dimensionality/i);
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return {
          data: null,
          error: { code: '22023', message: 'empty array includes synthetic-secret' },
        };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), (error) => {
    assert.match(error.message, /posture[\s\S]*22023[\s\S]*array-empty/i);
    assert.doesNotMatch(error.message, /synthetic-secret/i);
    return true;
  });
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return {
          data: null,
          error: { code: '22023', message: 'cannot extract elements from a scalar' },
        };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), /posture[\s\S]*22023[\s\S]*jsonb-scalar/i);
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient: {
      async rpc() {
        return {
          data: null,
          error: { code: '22023', message: 'invalid parameter value includes synthetic-secret' },
        };
      },
    },
    async anonymousProbe() { return anonymousRows; },
  }), (error) => {
    assert.match(error.message, /posture[\s\S]*22023[\s\S]*parameter/i);
    assert.doesNotMatch(error.message, /synthetic-secret/i);
    return true;
  });
  await assert.rejects(() => module.verifyPostCleanupSecurity({
    targetUrl: `http://127.0.0.1:${localApiPort}`,
    publishableKey: 'synthetic-local-publishable-key',
    serviceClient,
    async anonymousProbe() {
      return anonymousRows.map((row, index) => (
        index === anonymousRows.length - 1 ? { ...anonymousRows[0] } : row
      ));
    },
  }), /anonymous|surface|isolation/i);
});

test('local BFF controller uses an exact loopback origin and keeps server credentials process-local', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.createLocalBffController, 'function');
  const spawned = [];
  let running = true;
  let exitWaited = false;
  let probeCalls = 0;
  let listenerProbeCalls = 0;
  const child = {
    pid: 4242,
    exitCode: null,
    killed: false,
    kill() { this.killed = true; this.exitCode = 0; running = false; },
  };
  const controller = module.createLocalBffController({
    repoRoot: 'C:/synthetic/repository',
    port: 43877,
    target: {
      targetUrl: `http://127.0.0.1:${localApiPort}`,
      stackIdentity: { verified: true },
    },
    credentials: {
      publishableKey: 'synthetic-local-publishable-key',
      serviceRoleKey: 'synthetic-local-service-role-key',
    },
    spawnProcess(executable, args, options) {
      spawned.push({ executable, args, options });
      return child;
    },
    async probe(origin) {
      assert.equal(origin, 'http://127.0.0.1:43877');
      probeCalls += 1;
      return running;
    },
    async waitForExit(owned) {
      assert.equal(owned, child);
      assert.equal(owned.exitCode, 0);
      exitWaited = true;
    },
    async probeListener(host, port) {
      assert.equal(host, '127.0.0.1');
      assert.equal(port, 43877);
      listenerProbeCalls += 1;
      return running;
    },
  });
  const started = await controller.start();
  assert.deepEqual(started, { origin: 'http://127.0.0.1:43877', processId: 4242 });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].options.shell, false);
  assert.equal(spawned[0].options.windowsHide, true);
  assert.equal(spawned[0].options.env.SUPABASE_URL, `http://127.0.0.1:${localApiPort}`);
  assert.equal(spawned[0].options.env.NODE_ENV, 'test');
  assert.equal(spawned[0].options.env.SECURITY_BFF_AUTH_ENABLED, 'true');
  assert.ok(spawned[0].options.env.SESSION_ID_PEPPER.length >= 32);
  assert.ok(spawned[0].options.env.SESSION_TOKEN_ENCRYPTION_KEY_V1.length >= 43);
  await controller.stop();
  assert.equal(child.killed, true);
  assert.equal(exitWaited, true);
  assert.equal(probeCalls, 1);
  assert.equal(listenerProbeCalls, 1);
});

test('local BFF shutdown fails closed when TCP listener remains despite non-ready HTTP status', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  let ready = false;
  const child = {
    pid: 4243,
    exitCode: null,
    kill() { this.exitCode = 0; },
  };
  const controller = module.createLocalBffController({
    repoRoot: 'C:/synthetic/repository',
    port: 43877,
    target: { targetUrl: `http://127.0.0.1:${localApiPort}`, stackIdentity: { verified: true } },
    credentials: {
      publishableKey: 'synthetic-local-publishable-key',
      serviceRoleKey: 'synthetic-local-service-role-key',
    },
    spawnProcess() { return child; },
    async probe() { ready = true; return true; },
    async waitForExit() {},
    async probeListener() { return true; },
  });
  await controller.start();
  assert.equal(ready, true);
  await assert.rejects(() => controller.stop(), /listener|shutdown/i);
});

test('single live-suite runner derives sanitized evidence only from an actual child PASS', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.runLocalLiveTests, 'function');
  assert.equal(module.G5_REQUIRED_LIVE_TESTS.length, new Set(G5_CASE_MANIFEST.map((row) => row.testName)).size);
  assert.ok(G5_CASE_MANIFEST.length >= 25);
  const calls = [];
  const target = localSafety();
  const result = module.runLocalLiveTests({
    repoRoot: 'C:/synthetic/repository',
    target,
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    credentials: {
      publishableKey: 'synthetic-local-publishable-key',
      serviceRoleKey: 'synthetic-local-service-role-key',
    },
    bffOrigin: 'http://127.0.0.1:43877',
    bffPort: 43877,
    directFixture: { tokens: { activistA: 'synthetic-token' }, resources: { actorIds: {} } },
    sessionFixture: { tokens: { activistA: 'synthetic-token' }, credentials: {}, resources: { actorIds: {} } },
    runCommand(executable, args, options) {
      calls.push({ executable, args, options });
      const cases = module.G5_REQUIRED_LIVE_TESTS
        .map((name, index) => `ok ${index + 1} - ${name}`)
        .join('\n');
      const observations = G5_CASE_MANIFEST
        .map(({ caseId, expectedStatus, testName }) => `# G5_OBSERVATION ${JSON.stringify({ caseId, actualStatus: expectedStatus, testName })}`)
        .join('\n');
      return {
        status: 0,
        stdout: `TAP version 13\n${cases}\n${observations}\n# fail 0\n# skipped 0\n`,
        stderr: '',
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.SECURITY_TEST_CONFIRM_ISOLATED, 'true');
  assert.equal(calls[0].options.env.SECURITY_TEST_SUPABASE_URL, target.targetUrl);
  assert.equal(calls[0].options.env.SECURITY_TEST_SUPABASE_SERVICE_ROLE_KEY,
    'synthetic-local-service-role-key');
  assert.equal(calls[0].options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(result.length, G5_CASE_MANIFEST.length);
  assert.deepEqual(Object.keys(result[0]).sort(), [
    'actorClass', 'actualStatus', 'blockingLayer', 'caseId',
    'expectedStatus', 'resourceClass',
  ]);

  assert.throws(() => module.runLocalLiveTests({
    repoRoot: 'C:/synthetic/repository',
    target,
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    credentials: {
      publishableKey: 'synthetic-local-publishable-key',
      serviceRoleKey: 'synthetic-local-service-role-key',
    },
    bffOrigin: 'http://127.0.0.1:43877',
    bffPort: 43877,
    directFixture: { tokens: {}, resources: {} },
    sessionFixture: { tokens: {}, credentials: {}, resources: {} },
    runCommand() { return { status: 1, stdout: 'sensitive output', stderr: 'sensitive error' }; },
  }), /live security suite failed/);
  assert.throws(() => module.runLocalLiveTests({
    repoRoot: 'C:/synthetic/repository',
    target,
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    credentials: {
      publishableKey: 'synthetic-local-publishable-key',
      serviceRoleKey: 'synthetic-local-service-role-key',
    },
    bffOrigin: 'http://127.0.0.1:43877',
    bffPort: 43877,
    directFixture: { tokens: {}, resources: {} },
    sessionFixture: { tokens: {}, credentials: {}, resources: {} },
    runCommand() {
      return {
        status: 1,
        stdout: `not ok 7 - ${module.G5_REQUIRED_LIVE_TESTS[0]}\nerror: 'G5_SAFE_CHECKPOINT:finance-allow-ceo-aal2-parity-bonus-total'\n# sensitive fixture detail`,
        stderr: 'sensitive process detail',
      };
    },
  }), (error) => {
    assert.match(error.message, /live security suite failed \[case 1 checkpoint finance-allow-ceo-aal2-parity-bonus-total\]/);
    assert.doesNotMatch(error.message, /sensitive|fixture|process/i);
    return true;
  });
  assert.throws(() => module.runLocalLiveTests({
    repoRoot: 'C:/synthetic/repository',
    target,
    dockerExecutable: 'C:/Program Files/Docker/docker.exe',
    credentials: {
      publishableKey: 'synthetic-local-publishable-key',
      serviceRoleKey: 'synthetic-local-service-role-key',
    },
    bffOrigin: 'http://127.0.0.1:43877',
    bffPort: 43877,
    directFixture: { tokens: {}, resources: {} },
    sessionFixture: { tokens: {}, credentials: {}, resources: {} },
    runCommand() {
      const cases = module.G5_REQUIRED_LIVE_TESTS
        .map((name, index) => `ok ${index + 1} - ${name}`)
        .join('\n');
      return { status: 0, stdout: `TAP version 13\n${cases}\n# fail 0\n# skipped 0\n`, stderr: '' };
    },
  }), /observation|measured evidence.*incomplete/i);
});

test('configured G5 entry refuses caller verdicts before constructing local infrastructure', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.loadLocalG5Configuration, 'function');
  assert.throws(() => module.loadLocalG5Configuration({
    repoRoot: 'C:/synthetic/repository',
    runId: createSecurityRunId(),
    env: {
      SECURITY_TEST_EXECUTE_LOCAL_G5: 'true',
      SECURITY_TEST_SUPABASE_CLI: 'C:/synthetic/bin/supabase.exe',
      SECURITY_TEST_DOCKER_CLI: 'C:/Program Files/Docker/docker.exe',
      SECURITY_TEST_DOCKER_LOOPBACK_SHIM: 'C:/synthetic/shim/docker.exe',
      SECURITY_TEST_POSTGRES_ASSERTIONS: '{"searchPathHijack":"pass"}',
    },
  }), /caller verdict|self-attested/i);
});

test('configured G5 ports keep the complete pinned listener contract separate from the BFF', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const baseEnv = {
    SECURITY_TEST_EXECUTE_LOCAL_G5: 'true',
    SECURITY_TEST_SUPABASE_CLI: 'C:/synthetic/bin/supabase.exe',
    SECURITY_TEST_DOCKER_CLI: 'C:/Program Files/Docker/docker.exe',
    SECURITY_TEST_DOCKER_LOOPBACK_SHIM: 'C:/synthetic/shim/docker.exe',
  };
  const config = module.loadLocalG5Configuration({
    repoRoot: 'C:/synthetic/repository',
    runId: createSecurityRunId(),
    env: { ...baseEnv, SECURITY_TEST_SUPABASE_API_PORT: '65514', SECURITY_TEST_BFF_PORT: '43877' },
  });
  assert.deepEqual(config.stackPorts, {
    shadowDb: 65513,
    api: 65514,
    db: 65515,
    studio: 65516,
    mailpit: 65517,
    smtp: 65518,
    pop3: 65519,
    analytics: 65520,
    pooler: 65522,
    edgeInspector: 65535,
  });
  assert.deepEqual(config.listenerPorts, [
    65513, 65514, 65515, 65516, 65517, 65518, 65519, 65520,
  ]);
  assert.deepEqual(config.reservedPorts, [
    65513, 65514, 65515, 65516, 65517, 65518, 65519, 65520, 65522, 65535,
  ]);
  assert.equal(config.dockerShimExecutable, 'C:/synthetic/shim/docker.exe');

  assert.throws(() => module.loadLocalG5Configuration({
    repoRoot: 'C:/synthetic/repository',
    runId: createSecurityRunId(),
    env: {
      SECURITY_TEST_EXECUTE_LOCAL_G5: 'true',
      SECURITY_TEST_SUPABASE_CLI: 'C:/synthetic/bin/supabase.exe',
      SECURITY_TEST_DOCKER_CLI: 'C:/Program Files/Docker/docker.exe',
    },
  }), /shim|configuration/i);

  assert.throws(() => module.loadLocalG5Configuration({
    repoRoot: 'C:/synthetic/repository',
    runId: createSecurityRunId(),
    env: {
      ...baseEnv,
      SECURITY_TEST_SUPABASE_API_PORT: '65514',
      SECURITY_TEST_BFF_PORT: '65535',
    },
  }), /port|configuration/i);

  assert.throws(() => module.loadLocalG5Configuration({
    repoRoot: 'C:/synthetic/repository',
    runId: createSecurityRunId(),
    env: { ...baseEnv, SECURITY_TEST_SUPABASE_API_PORT: '65515' },
  }), /port|configuration/i);
  for (const bffPort of [54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327, 54329, 54342]) {
    assert.throws(() => module.loadLocalG5Configuration({
      repoRoot: 'C:/synthetic/repository',
      runId: createSecurityRunId(),
      env: {
        ...baseEnv,
        SECURITY_TEST_SUPABASE_API_PORT: '54321',
        SECURITY_TEST_BFF_PORT: String(bffPort),
      },
    }), /port|configuration/i);
  }
});

test('configured G5 entry owns stack start, lifecycle, sanitized evidence write and exact stop', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  assert.equal(typeof module.runConfiguredLocalG5, 'function');
  const trace = [];
  const config = module.loadLocalG5Configuration({
    repoRoot: 'C:/synthetic/repository',
    runId: createSecurityRunId(),
    env: {
      SECURITY_TEST_EXECUTE_LOCAL_G5: 'true',
      SECURITY_TEST_SUPABASE_CLI: 'C:/synthetic/bin/supabase.exe',
      SECURITY_TEST_DOCKER_CLI: 'C:/Program Files/Docker/docker.exe',
      SECURITY_TEST_DOCKER_LOOPBACK_SHIM: 'C:/synthetic/shim/docker.exe',
    },
  });
  const evidence = [{
    caseId: 'SEC-001', actorClass: 'anonymous', resourceClass: 'contact',
    blockingLayer: 'RLS', expectedStatus: 'denied', actualStatus: 'denied',
  }];
  const lifecycleEvidence = completeLifecycleEvidence();
  const result = await module.runConfiguredLocalG5({
    config,
    runtime: {
      createStackController() {
        return {
          async start() {
            trace.push('stack-start');
            return {
              target: { safety: localSafety() },
              credentials: {
                publishableKey: 'synthetic-local-publishable-key',
                serviceRoleKey: 'synthetic-local-service-role-key',
              },
            };
          },
          async stop() { trace.push('stack-stop'); },
        };
      },
      createDatabase() { trace.push('database'); return {}; },
      createServiceClient() { trace.push('service-client'); return {}; },
      async runLifecycle(options) {
        trace.push('lifecycle');
        assert.equal(typeof options.prepareActors, 'function');
        assert.equal(typeof options.abortCleanup, 'function');
        return {
          completed: true,
          evidence,
          lifecycleEvidence,
          cleanup: { clean: true },
        };
      },
      async writeSanitizedEvidence(file, payload) {
        trace.push('evidence');
        assert.equal(file, config.evidencePath);
        assert.deepEqual(payload, { cases: evidence, lifecycle: lifecycleEvidence });
      },
    },
  });
  assert.deepEqual(trace, [
    'stack-start', 'database', 'service-client', 'lifecycle', 'stack-stop', 'evidence',
  ]);
  assert.deepEqual(result, {
    completed: true,
    projectId: config.projectId,
    evidenceCount: 1,
    cleanupClean: true,
  });
});

test('configured G5 abort cleanup resets the disposable database without a second Auth delete', async () => {
  const module = await import('../../scripts/security/g5-local-orchestrator.mjs');
  const trace = [];
  const config = module.loadLocalG5Configuration({
    repoRoot: 'C:/synthetic/repository',
    runId: createSecurityRunId(),
    env: {
      SECURITY_TEST_EXECUTE_LOCAL_G5: 'true',
      SECURITY_TEST_SUPABASE_CLI: 'C:/synthetic/bin/supabase.exe',
      SECURITY_TEST_DOCKER_CLI: 'C:/Program Files/Docker/docker.exe',
      SECURITY_TEST_DOCKER_LOOPBACK_SHIM: 'C:/synthetic/shim/docker.exe',
    },
  });
  await assert.rejects(() => module.runConfiguredLocalG5({
    config,
    runtime: {
      createStackController() {
        return {
          async start() {
            trace.push('stack-start');
            return {
              target: { safety: localSafety() },
              credentials: {
                publishableKey: 'synthetic-local-publishable-key',
                serviceRoleKey: 'synthetic-local-service-role-key',
              },
            };
          },
          async stop() { trace.push('stack-stop'); },
        };
      },
      createDatabase() {
        return { async resetToLegacy() { trace.push('reset'); } };
      },
      createServiceClient() {
        return {
          auth: { admin: { async deleteUser() { throw new Error('second Auth delete forbidden'); } } },
        };
      },
      async runLifecycle(options) {
        const actors = new Map([['synthetic', { id: createSecurityRunId() }]]);
        await options.abortCleanup({ actors: { actors } });
        throw new Error('synthetic root failure');
      },
    },
  }), /synthetic root failure/);
  assert.deepEqual(trace, ['stack-start', 'reset', 'stack-stop']);
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
      ...localSafety(),
    }),
    /fixture provisioning stopped at actor headA/,
  );
  assert.equal(deleted.length, 1);
});

test('every mutating provision/cleanup boundary refuses a remote client before use', async () => {
  let touched = 0;
  const client = new Proxy({}, { get() { touched += 1; return undefined; } });
  const safety = localSafety('https://remote-test.supabase.co');
  await assert.rejects(
    () => createSyntheticAuthActorsWithClient({ client, runId: createSecurityRunId(), ...safety }),
    /refused (?:non-loopback|non-local-http)/i,
  );
  await assert.rejects(
    () => provisionLegacyDatabase({ client, runId: createSecurityRunId(), actorIds: {}, ...safety }),
    /refused (?:non-loopback|non-local-http)/i,
  );
  await assert.rejects(
    () => cleanupSyntheticFixtures({ client, runId: createSecurityRunId(), ...safety }),
    /refused (?:non-loopback|non-local-http)/i,
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
  assert.match(source, /runConfiguredLocalG5/);
  assert.doesNotMatch(source, /synthetic-plan-only/);
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
  assert.match(runbook, /bun build scripts\/security\/g5-docker-loopback-shim\.mjs --compile/i);
  assert.match(runbook, /SECURITY_TEST_DOCKER_LOOPBACK_SHIM/);
  assert.match(runbook, /127\.0\.0\.1[\s\S]*Docker publish/i);
  assert.match(runbook, /\[auth\.mfa\.totp\][\s\S]*enroll_enabled\s*=\s*true[\s\S]*verify_enabled\s*=\s*true/i);
});

test('documented G5 entrypoint fails closed instead of deadlocking when execution is disabled', async () => {
  const runbook = await readFile(new URL('../../docs/security/STAGING_RUNBOOK.md', import.meta.url), 'utf8');
  const command = /^node\s+(scripts\/security\/[a-z0-9-]+\.mjs)$/m.exec(runbook)?.[1];
  assert.ok(command, 'runbook must document one executable G5 entrypoint');

  const result = spawnSync(process.execPath, [command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.notEqual(result.status, 13);
  assert.match(output, /G5 local entry refused incomplete executable configuration/);
  assert.doesNotMatch(output, /unsettled top-level await/i);
});
