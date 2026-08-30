import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertSafeTestTarget } from './verify-rls-live.mjs';

export const MIGRATION_SEQUENCE = Object.freeze([
  '0018', '0019', '0020', '0021', '0022', '0023', '0024',
]);

const MIGRATIONS = Object.freeze({
  '0018': 'migrations/0018_security_foundation.sql',
  '0019': 'migrations/0019_security_rls.sql',
  '0020': 'migrations/0020_security_rpcs.sql',
  '0021': 'migrations/0021_meetings_security.sql',
  '0022': 'migrations/0022_tours_security.sql',
  '0023': 'migrations/0023_notifications_security.sql',
  '0024': 'migrations/0024_finance_security.sql',
});

const MIGRATION_VERIFICATIONS = Object.freeze({
  '0018': ['private-schema-revoked', 'legacy-owner-backfills-complete', 'identity-map-unique'],
  '0019': ['all-sensitive-tables-force-rls', 'grants-exact', 'audit-triggers-redacted'],
  '0020': ['rpc-dependencies-resolve', 'search-paths-fixed', 'rpc-grants-exact'],
  '0021': ['reminder-format-constraint', 'cancel-rpc-narrows-authority', 'no-broad-row-mutation'],
  '0022': ['tour-report-constraints', 'report-rpc-derives-actor', 'report-columns-not-broadly-granted'],
  '0023': ['uuid-ownership-complete', 'endpoint-unique', 'event-authority-resource-derived'],
  '0024': ['finance-scope-narrows-only', 'projection-allowlisted', 'audit-atomic-and-redacted'],
});

const CLEANUP_TABLES = new Set([
  'notification_reads', 'notifications', 'push_subscriptions', 'fcm_tokens',
  'meeting_reminders', 'base_meeting_reports', 'interactions', 'expenses',
  'bonus_cancellations', 'feedback_reports', 'tours', 'meeting_houses', 'contacts',
  'payment_config', 'projects',
]);
const CLEANUP_RESOURCES = [...CLEANUP_TABLES].filter((table) => table !== 'projects');

const EVIDENCE_KEYS = Object.freeze([
  'caseId', 'actorClass', 'resourceClass', 'blockingLayer',
  'expectedStatus', 'actualStatus',
]);
const STATUS = /^(?:allowed|denied|pass|fail|skipped|blocked|2\d\d|4\d\d|5\d\d)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR_CLASSES = new Set([
  'anonymous', 'ceo-aal1', 'ceo-aal2', 'head-aal1', 'head-aal2',
  'coordinator', 'activist', 'finance', 'disabled-user', 'stale-session', 'system',
]);
const RESOURCE_CLASSES = new Set([
  'contact', 'interaction', 'meeting-reminder', 'tour', 'notification',
  'finance-summary', 'session', 'audit', 'security-posture', 'membership',
  'project', 'http', 'auth-user', 'push-subscription', 'feedback-report', 'expense',
]);
const BLOCKING_LAYERS = new Set([
  'RLS', 'PostgREST', 'RPC', 'Grant', 'BFF', 'Session', 'CSRF',
  'RateLimit', 'MFA', 'PostgreSQL', 'HTTP',
]);

export function createSecurityRunId() {
  return randomUUID();
}

export function buildMigrationPlan(schemaFixture) {
  if (schemaFixture !== 'tests/security/fixtures/legacy-security-schema.sql') {
    throw new Error('migration plan refused: unexpected legacy schema fixture');
  }
  return MIGRATION_SEQUENCE.map((id) => Object.freeze({
    id,
    file: MIGRATIONS[id],
    stopOnFailure: true,
    verifications: [...MIGRATION_VERIFICATIONS[id]],
  }));
}

export function buildSyntheticFixtureBlueprint(securityRunId) {
  if (!UUID.test(securityRunId)) {
    throw new Error('fixture plan refused: invalid security run id');
  }
  return Object.freeze({
    securityRunId,
    projects: Object.freeze([{ alias: 'projectA' }, { alias: 'projectB' }]),
    actors: Object.freeze([
      { alias: 'ceo', role: 'ceo', aal: 2 },
      { alias: 'headA', role: 'head', project: 'projectA', aal: 2 },
      { alias: 'headB', role: 'head', project: 'projectB', aal: 2 },
      { alias: 'coordA', role: 'coord', project: 'projectA', aal: 1 },
      { alias: 'activistA1', role: 'activist', project: 'projectA', aal: 1 },
      { alias: 'activistA2', role: 'activist', project: 'projectA', aal: 1 },
      { alias: 'activistB1', role: 'activist', project: 'projectB', aal: 1 },
      { alias: 'financeA', role: 'finance', project: 'projectA', aal: 1 },
      { alias: 'disabled', role: 'activist', project: 'projectA', state: 'disabled', aal: 1 },
      { alias: 'staleSecurityVersion', role: 'activist', project: 'projectA', state: 'stale', aal: 1 },
    ]),
    resources: Object.freeze([
      'contacts', 'interactions', 'meetingHouses', 'meetingReminders', 'tours',
      'notifications', 'expenses', 'bonusCancellations', 'paymentConfig',
    ]),
  });
}

export function buildLegacyFixtureRows(runId, actorIds) {
  if (!UUID.test(runId ?? '')) throw new Error('legacy fixture refused: invalid security run id');
  const requiredActors = [
    'ceo', 'headA', 'headB', 'coordA', 'activistA1', 'activistA2',
    'activistB1', 'financeA', 'disabled', 'staleSecurityVersion',
  ];
  if (requiredActors.some((alias) => !UUID.test(actorIds?.[alias] ?? ''))) {
    throw new Error('legacy fixture refused: synthetic actor map is incomplete');
  }

  const projectA = 910001;
  const projectB = 910002;
  const codes = Object.freeze({
    headA: 1001, headB: 1002, coordA: 1003, financeA: 1004,
    activistA1: 1101, activistA2: 1102, activistB1: 1201,
    disabled: 1103, staleSecurityVersion: 1104,
  });
  const profile = (alias, role, projectId = null) => ({
    id: actorIds[alias],
    name: `Synthetic ${alias}`,
    role,
    project_id: projectId,
    project_ids: projectId ? [projectId] : [],
    activist_code: codes[alias] ?? null,
    security_run_id: runId,
  });
  const contactA = randomUUID();
  const contactA2 = randomUUID();
  const contactB = randomUUID();
  const meetingA = `security-${runId}-meeting-a`;
  const meetingB = `security-${runId}-meeting-b`;
  const tourA = `security-${runId}-tour-a`;
  const tourB = `security-${runId}-tour-b`;

  return Object.freeze({
    projects: [
      { id: projectA, name: 'Synthetic Project A', security_run_id: runId },
      { id: projectB, name: 'Synthetic Project B', security_run_id: runId },
    ],
    profiles: [
      profile('ceo', 'ceo'),
      profile('headA', 'head', projectA),
      profile('headB', 'head', projectB),
      profile('coordA', 'coord', projectA),
      profile('activistA1', 'activist', projectA),
      profile('activistA2', 'activist', projectA),
      profile('activistB1', 'activist', projectB),
      profile('financeA', 'finance', projectA),
      profile('disabled', 'activist', projectA),
      profile('staleSecurityVersion', 'activist', projectA),
    ],
    contacts: [
      {
        id: contactA, project_id: projectA, activist_id: codes.activistA1,
        name: 'Synthetic Contact A1', high_potential: true,
        mitzvot_history: [{ mitzva: 'synthetic', from: 0, to: 1, date: '2026-08-10' }],
        joined_at: '2026-08-02', source: 'external', security_run_id: runId,
      },
      {
        id: contactA2, project_id: projectA, activist_id: codes.activistA2,
        name: 'Synthetic Contact A2', high_potential: false,
        mitzvot_history: [], joined_at: '2026-08-03', source: 'internal', security_run_id: runId,
      },
      {
        id: contactB, project_id: projectB, activist_id: codes.activistB1,
        name: 'Synthetic Contact B1', high_potential: false,
        mitzvot_history: [], joined_at: '2026-08-04', source: 'internal', security_run_id: runId,
      },
    ],
    interactions: [
      {
        id: randomUUID(), contact_id: contactA, project_id: projectA,
        activist_id: codes.activistA1, type: 'טלפוני', quality: 'ידידותי',
        duration_minutes: 20, date: '2026-08-05', participants: {}, security_run_id: runId,
      },
      {
        id: randomUUID(), contact_id: contactA2, project_id: projectA,
        activist_id: codes.activistA2, type: 'פרונטלי', quality: 'תורני',
        duration_minutes: 45, date: '2026-08-06', participants: {}, security_run_id: runId,
      },
      {
        id: randomUUID(), contact_id: contactB, project_id: projectB,
        activist_id: codes.activistB1, type: 'וידאו', quality: 'ידידותי',
        duration_minutes: 30, date: '2026-08-07', participants: {}, security_run_id: runId,
      },
    ],
    base_meeting_reports: [
      { id: randomUUID(), project_id: projectA, activist_id: codes.activistA1, security_run_id: runId },
      { id: randomUUID(), project_id: projectB, activist_id: codes.activistB1, security_run_id: runId },
    ],
    meeting_houses: [
      { id: meetingA, project_id: projectA, assigned_activists: [codes.activistA1], security_run_id: runId },
      { id: meetingB, project_id: projectB, assigned_activists: [codes.activistB1], security_run_id: runId },
    ],
    meeting_reminders: [
      {
        id: randomUUID(), meeting_id: meetingA, type: 'activist', coordinator_id: null,
        activist_id: String(codes.activistA1), remind_at: '2026-08-15T10:00:00Z', security_run_id: runId,
      },
      {
        id: randomUUID(), meeting_id: meetingB, type: 'activist', coordinator_id: null,
        activist_id: String(codes.activistB1), remind_at: '2026-08-15T11:00:00Z', security_run_id: runId,
      },
    ],
    tours: [
      {
        id: tourA, project_id: projectA, tour_number: 'SYN-A', settlement: 'Synthetic A',
        date: '2026-08-20', start_time: '10:00:00', guide_name: 'Synthetic activistA1',
        guide_activist_id: codes.activistA1, host_activist_id: codes.activistA2,
        assigned_activists: [codes.activistA1], status: 'upcoming', security_run_id: runId,
      },
      {
        id: tourB, project_id: projectB, tour_number: 'SYN-B', settlement: 'Synthetic B',
        date: '2026-08-21', start_time: '11:00:00', guide_name: 'Synthetic activistB1',
        guide_activist_id: codes.activistB1, host_activist_id: null,
        assigned_activists: [codes.activistB1], status: 'upcoming', security_run_id: runId,
      },
    ],
    expenses: [
      { id: randomUUID(), project_id: projectA, activist_id: codes.activistA1, date: '2026-08-12', amount: 17, description: 'Synthetic expense A', security_run_id: runId },
      { id: randomUUID(), project_id: projectB, activist_id: codes.activistB1, date: '2026-08-13', amount: 19, description: 'Synthetic expense B', security_run_id: runId },
    ],
    bonus_cancellations: [
      { id: randomUUID(), project_id: projectA, activist_id: codes.activistA2, cancelled_by: codes.coordA, bonus_key: `${codes.activistA2}|synthetic|2026-7`, security_run_id: runId },
    ],
    payment_config: [{
      id: 1,
      rate_phone_friendly: 10, rate_phone_torani: 12,
      rate_video_friendly: 14, rate_video_torani: 16,
      rate_frontal_friendly: 18, rate_frontal_torani: 20,
      rate_multi: 22, rate_shabbat_hosting: 24, rate_tour_guide: 26,
      min_duration_minutes: 10, cap_phone: 20, cap_frontal: 20, cap_multi: 20,
      cap_contact_phone_high: 5, cap_contact_phone_regular: 3,
      cap_contact_frontal_high: 5, cap_contact_frontal_regular: 3,
      bonus_loyalty_6: 60, bonus_loyalty_4: 40,
      bonus_mitzvot_level: 5, bonus_new_participant: 7, security_run_id: runId,
    }],
    notifications: [
      { id: randomUUID(), recipient_id: String(codes.activistA1), client_id: `security-${runId}-notification-a`, type: 'system', title: 'Synthetic update', body: 'Synthetic generic body', url: '/notifications', priority: 'normal', read: false, security_run_id: runId },
      { id: randomUUID(), recipient_id: String(codes.activistB1), client_id: `security-${runId}-notification-b`, type: 'system', title: 'Synthetic update', body: 'Synthetic generic body', url: '/notifications', priority: 'normal', read: false, security_run_id: runId },
    ],
    notification_reads: [
      { id: randomUUID(), recipient_id: String(codes.activistA1), security_run_id: runId },
      { id: randomUUID(), recipient_id: String(codes.activistB1), security_run_id: runId },
    ],
    push_subscriptions: [
      { id: randomUUID(), activist_id: String(codes.activistA1), subscription: { endpoint: `https://example.invalid/${runId}/a` }, security_run_id: runId },
      { id: randomUUID(), activist_id: String(codes.activistB1), subscription: { endpoint: `https://example.invalid/${runId}/b` }, security_run_id: runId },
    ],
    fcm_tokens: [
      { id: randomUUID(), activist_id: String(codes.activistA1), token: `synthetic-${runId}-a`, security_run_id: runId },
      { id: randomUUID(), activist_id: String(codes.activistB1), token: `synthetic-${runId}-b`, security_run_id: runId },
    ],
    feedback_reports: [
      { id: randomUUID(), project_id: projectA, reporter_id: codes.activistA1, security_run_id: runId },
      { id: randomUUID(), project_id: projectB, reporter_id: codes.activistB1, security_run_id: runId },
    ],
  });
}

export async function provisionLegacyDatabase({
  client, runId, actorIds, targetUrl, productionUrl, confirmed,
}) {
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed });
  if (!client) throw new Error('legacy fixture refused: local service client required');
  const rowsByTable = buildLegacyFixtureRows(runId, actorIds);
  for (const [table, rows] of Object.entries(rowsByTable)) {
    const { error } = await client.from(table).insert(rows);
    if (error) throw new Error(`legacy fixture stopped at ${table}`);
  }
  return Object.freeze({
    securityRunId: runId,
    projectA: rowsByTable.projects[0].id,
    projectB: rowsByTable.projects[1].id,
    contactA: rowsByTable.contacts[0].id,
    contactA2: rowsByTable.contacts[1].id,
    contactB: rowsByTable.contacts[2].id,
    meetingA: rowsByTable.meeting_houses[0].id,
    meetingB: rowsByTable.meeting_houses[1].id,
    tourAssignedA: rowsByTable.tours[0].id,
    tourB: rowsByTable.tours[1].id,
    period: '2026-08',
  });
}

export function assertCleanupScope({ runId, table }) {
  if (!UUID.test(runId ?? '') || !CLEANUP_TABLES.has(table)) {
    throw new Error('cleanup refused: exact run id and allowlisted table required');
  }
  return Object.freeze({ runId, table, column: 'security_run_id' });
}

export function sanitizeEvidenceRows(rows) {
  if (!Array.isArray(rows)) throw new Error('evidence refused: array required');
  return rows.map((row) => {
    const sanitized = Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, row?.[key]]));
    if (!/^SEC-\d{3}(?:-[A-Z0-9-]+)?$/.test(sanitized.caseId ?? '')
      || !STATUS.test(String(sanitized.expectedStatus ?? ''))
      || !STATUS.test(String(sanitized.actualStatus ?? ''))
      || !ACTOR_CLASSES.has(sanitized.actorClass)
      || !RESOURCE_CLASSES.has(sanitized.resourceClass)
      || !BLOCKING_LAYERS.has(sanitized.blockingLayer)) {
      throw new Error('evidence refused: invalid or sensitive-shaped case data');
    }
    return sanitized;
  });
}

function syntheticCredential() {
  return randomBytes(32).toString('base64url');
}

function serviceClient({ targetUrl, productionUrl, confirmed, serviceRoleKey }) {
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed });
  if (typeof serviceRoleKey !== 'string' || serviceRoleKey.length < 20) {
    throw new Error('fixture provisioning refused: local service credential required in process memory');
  }
  return createClient(targetUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Creates synthetic Auth identities only. The returned credentials are deliberately
 * process-local and must be consumed by the same live-test process, never serialized.
 */
export async function createSyntheticAuthActorsWithClient({
  client, runId, targetUrl, productionUrl, confirmed,
}) {
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed });
  if (!client?.auth?.admin || !UUID.test(runId ?? '')) {
    throw new Error('fixture provisioning refused: local admin client and exact run id required');
  }
  const blueprint = buildSyntheticFixtureBlueprint(runId);
  const actors = new Map();
  const createdUserIds = [];

  for (const actor of blueprint.actors) {
    const password = syntheticCredential();
    const email = `security-${runId}-${actor.alias.toLowerCase()}@example.invalid`;
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { security_run_id: runId, fixture_alias: actor.alias },
    });
    if (error || !data.user) {
      let cleanupFailed = false;
      for (const userId of createdUserIds.reverse()) {
        const cleanup = await client.auth.admin.deleteUser(userId);
        cleanupFailed ||= Boolean(cleanup.error);
      }
      if (cleanupFailed) {
        throw new Error(`fixture provisioning cleanup failed after actor ${actor.alias}`);
      }
      throw new Error(`fixture provisioning stopped at actor ${actor.alias}`);
    }
    createdUserIds.push(data.user.id);
    actors.set(actor.alias, Object.freeze({
      id: data.user.id,
      email,
      password,
      role: actor.role,
      project: actor.project,
      state: actor.state,
      aal: actor.aal,
    }));
  }

  return Object.freeze({ runId, blueprint, actors, client });
}

export async function provisionSyntheticAuthActors(options) {
  const client = serviceClient(options);
  const runId = options.runId ?? createSecurityRunId();
  return createSyntheticAuthActorsWithClient({
    client,
    runId,
    targetUrl: options.targetUrl,
    productionUrl: options.productionUrl,
    confirmed: options.confirmed,
  });
}

export async function cleanupSyntheticFixtures({
  client, runId, targetUrl, productionUrl, confirmed,
}) {
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed });
  if (!client || !UUID.test(runId ?? '')) {
    throw new Error('cleanup refused: client and exact run id required');
  }
  const counts = {};
  for (const table of CLEANUP_RESOURCES) {
    const scope = assertCleanupScope({ runId, table });
    const { count: before, error: countError } = await client
      .from(scope.table).select('*', { count: 'exact', head: true }).eq(scope.column, scope.runId);
    if (countError) throw new Error(`cleanup stopped while counting ${scope.table}`);
    const { error: deleteError } = await client
      .from(scope.table).delete().eq(scope.column, scope.runId);
    if (deleteError) throw new Error(`cleanup stopped while deleting ${scope.table}`);
    const { count: after, error: verifyError } = await client
      .from(scope.table).select('*', { count: 'exact', head: true }).eq(scope.column, scope.runId);
    if (verifyError || after !== 0) throw new Error(`cleanup verification failed for ${scope.table}`);
    counts[scope.table] = Object.freeze({ before: before ?? 0, after: after ?? 0 });
  }

  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error('cleanup stopped while listing synthetic users');
  const users = data.users.filter((user) => user.user_metadata?.security_run_id === runId);
  for (const user of users) {
    const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error('cleanup stopped while deleting an exact synthetic user');
  }
  counts.authUsers = Object.freeze({ before: users.length, after: 0 });

  const projectScope = assertCleanupScope({ runId, table: 'projects' });
  const { count: projectsBefore, error: projectCountError } = await client
    .from('projects').select('*', { count: 'exact', head: true })
    .eq(projectScope.column, projectScope.runId);
  if (projectCountError) throw new Error('cleanup stopped while counting projects');
  const { error: projectDeleteError } = await client
    .from('projects').delete().eq(projectScope.column, projectScope.runId);
  if (projectDeleteError) throw new Error('cleanup stopped while deleting projects');
  const { count: projectsAfter, error: projectVerifyError } = await client
    .from('projects').select('*', { count: 'exact', head: true })
    .eq(projectScope.column, projectScope.runId);
  if (projectVerifyError || projectsAfter !== 0) throw new Error('cleanup verification failed for projects');
  counts.projects = Object.freeze({ before: projectsBefore ?? 0, after: projectsAfter ?? 0 });
  return Object.freeze(counts);
}

async function main() {
  const runId = createSecurityRunId();
  const blueprint = buildSyntheticFixtureBlueprint(runId);
  const plan = buildMigrationPlan('tests/security/fixtures/legacy-security-schema.sql');
  process.stdout.write(`${JSON.stringify({
    mode: 'synthetic-plan-only',
    projectCount: blueprint.projects.length,
    actorCount: blueprint.actors.length,
    migrationCount: plan.length,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
