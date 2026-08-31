import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import {
  assertSafeTestTarget,
  derivePinnedLocalStackContract,
  loadVerifiedLocalTarget,
  RLS_EXPECTED_POLICY_COUNTS,
  RLS_PROTECTED_TABLES,
  SENSITIVE_TABLES,
  verifyAnonymousIsolation,
} from '../../scripts/security/verify-rls-live.mjs';
import { G5_DIRECT_JWT_MATRIX, observeG5Case } from '../../scripts/security/g5-evidence.mjs';

const enabled = process.env.SECURITY_TEST_CONFIRM_ISOLATED === 'true';
const live = { skip: enabled ? false : 'requires confirmed isolated G5 loopback target' };
const syntheticProduction = 'https://production-project.invalid';
const testProjectId = 'mekarvim-security-g5-unit-test';
const testApiPort = 54321;

function verifiedStackIdentity(overrides = {}) {
  const projectId = overrides.projectId ?? testProjectId;
  const apiPort = overrides.apiPort ?? testApiPort;
  const contract = derivePinnedLocalStackContract(apiPort);
  return {
    verified: overrides.verified ?? true,
    projectId,
    apiPort,
    listenerPorts: overrides.listenerPorts ?? contract.listenerPorts,
    containers: overrides.containers ?? [
      { name: `supabase_db_${projectId}`, projectId, role: 'database', hostPorts: [contract.stackPorts.db] },
      {
        name: `supabase_kong_${projectId}`, projectId, role: 'api',
        hostPorts: [apiPort], hostApiPort: apiPort,
      },
      { name: `supabase_auth_${projectId}`, projectId, role: 'auth', hostPorts: [] },
      { name: `supabase_rest_${projectId}`, projectId, role: 'rest', hostPorts: [] },
      { name: `supabase_analytics_${projectId}`, projectId, role: 'analytics', hostPorts: [contract.stackPorts.analytics] },
      { name: `supabase_edge_runtime_${projectId}`, projectId, role: 'edge-runtime', hostPorts: [] },
      {
        name: `supabase_mailpit_${projectId}`, projectId, role: 'mailpit',
        hostPorts: [contract.stackPorts.mailpit, contract.stackPorts.smtp, contract.stackPorts.pop3],
      },
      { name: `supabase_pg_meta_${projectId}`, projectId, role: 'meta', hostPorts: [] },
      { name: `supabase_studio_${projectId}`, projectId, role: 'studio', hostPorts: [contract.stackPorts.studio] },
    ],
  };
}

function pinnedDockerContainers({ projectId = testProjectId, apiPort = testApiPort, smtpRole = 'mailpit' } = {}) {
  const ports = derivePinnedLocalStackContract(apiPort).stackPorts;
  const specs = [
    ['db', { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.db) }] }],
    ['kong', { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.api) }] }],
    ['auth', {}],
    ['rest', {}],
    ['pg_meta', {}],
    ['studio', { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.studio) }] }],
    ['analytics', { '4000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.analytics) }] }],
    ['edge_runtime', {}],
    [smtpRole, {
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

function dockerInventory(containers, calls = []) {
  return (args) => {
    calls.push([...args]);
    if (args[0] === 'ps') {
      const labelFilter = args.find((entry) => entry.startsWith('label='));
      const nameFilter = args.find((entry) => entry.startsWith('name='));
      const matches = containers.filter((item) => {
        if (labelFilter) {
          return item.Config.Labels?.['com.supabase.cli.project'] === labelFilter.split('=').slice(2).join('=');
        }
        if (nameFilter) return item.Name.includes(nameFilter.slice('name='.length));
        return false;
      });
      return { status: 0, stdout: matches.map((item) => item.Id).join('\n'), stderr: '' };
    }
    if (args[0] === 'inspect') {
      const ids = new Set(args.slice(1));
      return {
        status: 0,
        stdout: JSON.stringify(containers.filter((item) => ids.has(item.Id))),
        stderr: '',
      };
    }
    return { status: 1, stdout: '', stderr: 'unexpected command' };
  };
}

function safeTarget(targetUrl = `http://127.0.0.1:${testApiPort}`) {
  return {
    targetUrl,
    productionUrl: syntheticProduction,
    confirmed: true,
    expectedProjectId: testProjectId,
    expectedApiPort: testApiPort,
    stackIdentity: verifiedStackIdentity(),
  };
}

function loadDirectFixture() {
  const { targetUrl } = loadVerifiedLocalTarget();
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  const fixture = JSON.parse(process.env.SECURITY_TEST_DIRECT_JWT_FIXTURE ?? '{}');
  if (!publishableKey || !fixture.tokens || !fixture.resources) {
    throw new Error('isolated direct-JWT fixture is incomplete');
  }
  const client = (token) => createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return {
    targetUrl,
    resources: fixture.resources,
    clients: Object.fromEntries(Object.entries(fixture.tokens)
      .map(([key, token]) => [key, client(token)])),
  };
}

function withSelector(query, selector) {
  return Object.entries(selector).reduce(
    (builder, [column, value]) => builder.eq(column, value),
    query,
  );
}

async function expectDirectDenied(resultPromise, label, { requireError = false } = {}) {
  const { data, error } = await resultPromise;
  const denied = Boolean(error) || (Array.isArray(data) && data.length === 0);
  assert.equal(denied, true, `${label} unexpectedly succeeded`);
  if (requireError) assert.ok(error, `${label} must fail before an insert or authority write`);
  return 'denied';
}

async function expectDirectAllowed(resultPromise, label) {
  const { data, error } = await resultPromise;
  assert.ifError(error);
  assert.ok(Array.isArray(data) && data.length > 0, `${label} unexpectedly returned no row`);
  return 'allowed';
}

function directSelector(table, resources) {
  const actorIds = resources.actorIds;
  const selectors = {
    projects: { id: resources.projectB },
    project_memberships: { project_id: resources.projectB, user_id: actorIds.activistB1 },
    profiles: { id: actorIds.activistB1 },
    contacts: { id: resources.contactB },
    interactions: { id: resources.interactionB },
    base_meeting_reports: { id: resources.baseMeetingReportB },
    meeting_houses: { id: resources.meetingB },
    meeting_reminders: { id: resources.meetingReminderB },
    tours: { id: resources.tourB },
    expenses: { id: resources.expenseB },
    bonus_cancellations: { id: resources.bonusCancellationA },
    payment_config: { id: resources.paymentConfigId },
    notifications: { id: resources.notificationB },
    notification_reads: { id: resources.notificationReadB },
    push_subscriptions: { id: resources.pushSubscriptionB },
    fcm_tokens: { id: resources.fcmTokenB },
    feedback_reports: { id: resources.feedbackReportB },
    activist_directory: { id: actorIds.activistB1 },
  };
  const selector = selectors[table];
  assert.ok(selector, `missing direct-JWT selector for ${table}`);
  return selector;
}

function directColumns(table) {
  return table === 'project_memberships' ? 'project_id,user_id' : 'id';
}

function directInsertPayload(table, resources) {
  const actorIds = resources.actorIds;
  const codes = resources.actorCodes;
  const marker = `g5-${resources.securityRunId}-denied-${table}`;
  const base = { security_run_id: resources.securityRunId };
  const payloads = {
    projects: { ...base, name: 'Synthetic denied project' },
    project_memberships: {
      project_id: resources.projectB, user_id: actorIds.activistA1, role: 'activist', status: 'active',
    },
    profiles: {
      ...base,
      id: actorIds.unlinked,
      name: 'Synthetic unlinked profile',
      role: 'activist',
      project_id: resources.projectB,
      project_ids: [resources.projectB],
    },
    contacts: {
      ...base,
      project_id: resources.projectB,
      assigned_user_id: actorIds.activistA1,
      activist_id: codes.activistA1,
      name: 'Synthetic denied contact',
    },
    interactions: {
      ...base,
      contact_id: resources.contactB,
      project_id: resources.projectB,
      actor_user_id: actorIds.activistA1,
      activist_id: codes.activistA1,
      type: 'synthetic',
      date: '2026-08-18',
      participants: {},
    },
    base_meeting_reports: {
      ...base,
      project_id: resources.projectB,
      actor_user_id: actorIds.activistA1,
      activist_id: codes.activistA1,
    },
    meeting_houses: {
      ...base,
      id: `${marker}-house`,
      project_id: resources.projectB,
      assigned_user_ids: [actorIds.activistA1],
      assigned_activists: [codes.activistA1],
    },
    meeting_reminders: {
      ...base,
      meeting_id: resources.meetingB,
      project_id: resources.projectB,
      recipient_user_id: actorIds.activistA1,
      activist_id: String(codes.activistA1),
      type: 'activist',
      remind_at: '2026-08-18T12:00:00Z',
      idempotency_key: `${'a'.repeat(64)}:activist_1`,
    },
    tours: {
      ...base,
      id: `${marker}-tour`,
      project_id: resources.projectB,
      tour_number: 'G5-DENIED',
      settlement: 'Synthetic',
      guide_name: 'Synthetic',
      guide_user_id: actorIds.activistA1,
      guide_activist_id: codes.activistA1,
      assigned_user_ids: [actorIds.activistA1],
      assigned_activists: [codes.activistA1],
      status: 'upcoming',
    },
    expenses: {
      ...base,
      project_id: resources.projectB,
      actor_user_id: actorIds.activistA1,
      activist_id: codes.activistA1,
      date: '2026-08-18',
      amount: 1,
    },
    bonus_cancellations: {
      ...base,
      project_id: resources.projectB,
      beneficiary_user_id: actorIds.activistA1,
      activist_id: codes.activistA1,
      cancelled_by_user_id: actorIds.activistA1,
      cancelled_by: codes.activistA1,
      bonus_key: marker,
    },
    payment_config: { ...base, id: 997001 },
    notifications: {
      ...base,
      recipient_user_id: actorIds.activistB1,
      recipient_id: String(codes.activistB1),
      client_id: `${marker}-notification`,
      type: 'system',
      title: 'Synthetic',
      body: 'Synthetic generic body',
      url: '/notifications',
      priority: 'normal',
      read: false,
    },
    notification_reads: {
      ...base,
      recipient_user_id: actorIds.activistB1,
      recipient_id: String(codes.activistB1),
      notification_id: resources.notificationB,
    },
    push_subscriptions: {
      ...base,
      user_id: actorIds.activistB1,
      activist_id: String(codes.activistB1),
      subscription: { endpoint: `https://example.invalid/${marker}-push` },
    },
    fcm_tokens: {
      ...base,
      user_id: actorIds.activistB1,
      activist_id: String(codes.activistB1),
      token: `${marker}-fcm`,
    },
    feedback_reports: {
      ...base,
      project_id: resources.projectB,
      reporter_user_id: actorIds.activistA1,
      reporter_id: codes.activistA1,
    },
  };
  const payload = payloads[table];
  assert.ok(payload, `missing direct-JWT insert payload for ${table}`);
  return payload;
}

function directUpdatePayload(table, resources) {
  const payloads = {
    projects: { name: 'Synthetic denied project update' },
    project_memberships: { status: 'suspended' },
    profiles: { name: 'Synthetic denied profile update' },
    contacts: { name: 'Synthetic denied contact update' },
    interactions: { notes: 'Synthetic denied interaction update' },
    base_meeting_reports: { project_id: resources.projectA },
    meeting_houses: { project_id: resources.projectA },
    meeting_reminders: { cancelled_at: '2026-08-18T12:00:00Z' },
    tours: { notes: 'Synthetic denied tour update' },
    expenses: { description: 'Synthetic denied expense update' },
    bonus_cancellations: { bonus_key: 'synthetic-denied-bonus-update' },
    payment_config: { rate_phone_friendly: 999 },
    notifications: { read: true },
    notification_reads: { read_at: '2026-08-18T12:00:00Z' },
    push_subscriptions: { subscription: { endpoint: 'https://example.invalid/denied-update' } },
    fcm_tokens: { token: 'synthetic-denied-token-update' },
    feedback_reports: { project_id: resources.projectA },
  };
  const payload = payloads[table];
  assert.ok(payload, `missing direct-JWT update payload for ${table}`);
  return payload;
}

function authorityTransferPatch(table, resources) {
  const actorIds = resources.actorIds;
  const codes = resources.actorCodes;
  const patches = {
    project_memberships: { project_id: resources.projectA },
    profiles: { project_id: resources.projectA },
    contacts: { project_id: resources.projectA },
    interactions: { project_id: resources.projectA },
    base_meeting_reports: { project_id: resources.projectA },
    meeting_houses: { project_id: resources.projectA },
    meeting_reminders: { project_id: resources.projectA },
    tours: { project_id: resources.projectA },
    expenses: { project_id: resources.projectA },
    bonus_cancellations: { project_id: resources.projectB },
    notifications: { recipient_user_id: actorIds.activistA1 },
    notification_reads: { recipient_user_id: actorIds.activistA1 },
    push_subscriptions: { user_id: actorIds.activistA1 },
    fcm_tokens: { user_id: actorIds.activistA1 },
    feedback_reports: { project_id: resources.projectA },
  };
  const patch = patches[table];
  assert.ok(patch, `missing authority transfer patch for ${table}`);
  if (table === 'contacts') {
    return { ...patch, assigned_user_id: actorIds.activistA1, activist_id: codes.activistA1 };
  }
  return patch;
}

function authoritySelector(table, resources) {
  const actorIds = resources.actorIds;
  const selectors = {
    project_memberships: { project_id: resources.projectB, user_id: actorIds.activistB1 },
    profiles: { id: actorIds.activistB1 },
    contacts: { id: resources.contactB },
    interactions: { id: resources.interactionB },
    base_meeting_reports: { id: resources.baseMeetingReportB },
    meeting_houses: { id: resources.meetingB },
    meeting_reminders: { id: resources.meetingReminderB },
    tours: { id: resources.tourB },
    expenses: { id: resources.expenseB },
    bonus_cancellations: { id: resources.bonusCancellationA },
    notifications: { id: resources.notificationA },
    notification_reads: { id: resources.notificationReadA },
    push_subscriptions: { id: resources.pushSubscriptionA },
    fcm_tokens: { id: resources.fcmTokenA },
    feedback_reports: { id: resources.feedbackReportA },
  };
  const selector = selectors[table];
  assert.ok(selector, `missing authority-transfer selector for ${table}`);
  return selector;
}

function authorityClient(table, clients) {
  return ['notifications', 'notification_reads', 'push_subscriptions', 'fcm_tokens', 'feedback_reports']
    .includes(table) ? clients.activistA : clients.ceoAal2;
}

function observeG5CaseInTest(testContext, caseId, actualStatus) {
  return observeG5Case(caseId, actualStatus, { testName: testContext.name });
}

test('G5 target guard accepts only explicitly confirmed exact loopback origins', () => {
  for (const targetUrl of [
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ]) {
    assert.doesNotThrow(() => assertSafeTestTarget({
      ...safeTarget(targetUrl),
    }));
  }
});

test('G5 target guard rejects production equality, missing confirmation, spoofing and remote targets', () => {
  const rejected = [
    { ...safeTarget(syntheticProduction), productionUrl: syntheticProduction },
    { ...safeTarget(), confirmed: false },
    { ...safeTarget(), confirmed: undefined },
    safeTarget('http://localhost.evil.example:54321'),
    safeTarget('http://127.0.0.1.evil.example:54321'),
    safeTarget('http://remote-test.supabase.co'),
    safeTarget('https://remote-test.supabase.co'),
    safeTarget('http://prod.example@localhost:54321'),
    safeTarget('ftp://localhost:54321'),
  ];

  for (const input of rejected) {
    assert.throws(() => assertSafeTestTarget(input), /refused|confirmation|required/i);
  }
});

test('G5 target guard rejects non-root, decorated, HTTPS, wrong-port and unrelated loopback origins', () => {
  for (const targetUrl of [
    'http://127.0.0.1:54321/not-the-root',
    'http://127.0.0.1:54321/?query=1',
    'http://127.0.0.1:54321/#fragment',
    'https://127.0.0.1:54321',
    'http://127.0.0.1:1',
    'http://localhost:65535',
  ]) {
    assert.throws(() => assertSafeTestTarget(safeTarget(targetUrl)), /refused|exact|identity|port/i);
  }
});

test('G5 target guard rejects wrong project, container label and unverified identity', () => {
  for (const stackIdentity of [
    verifiedStackIdentity({ projectId: 'mekarvim-security-g5-wrong' }),
    verifiedStackIdentity({ verified: false }),
    verifiedStackIdentity({
      containers: [
        { name: `supabase_db_${testProjectId}`, projectId: 'mekarvim-security-g5-wrong', role: 'database' },
        { name: `supabase_kong_${testProjectId}`, projectId: testProjectId, role: 'api', hostApiPort: testApiPort },
        { name: `supabase_auth_${testProjectId}`, projectId: testProjectId, role: 'auth' },
        { name: `supabase_rest_${testProjectId}`, projectId: testProjectId, role: 'rest' },
      ],
    }),
  ]) {
    assert.throws(() => assertSafeTestTarget({
      ...safeTarget(),
      stackIdentity,
    }), /refused|identity|project|container/i);
  }
});

test('Docker inspection derives the exact project-labelled local stack identity', async () => {
  const module = await import('../../scripts/security/verify-rls-live.mjs');
  assert.equal(typeof module.inspectLocalStackIdentity, 'function');
  const inspections = pinnedDockerContainers();
  const runDocker = (args) => {
    if (args[0] === 'ps') {
      return { status: 0, stdout: inspections.map((item) => item.Id).join('\n'), stderr: '' };
    }
    if (args[0] === 'inspect') {
      return { status: 0, stdout: JSON.stringify(inspections), stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected command' };
  };

  assert.deepEqual(module.inspectLocalStackIdentity({
    projectId: testProjectId,
    apiPort: testApiPort,
    runDocker,
  }), verifiedStackIdentity());
});

test('Docker inspection fails closed on missing, mixed-label or non-loopback containers', async () => {
  const { inspectLocalStackIdentity } = await import('../../scripts/security/verify-rls-live.mjs');
  assert.equal(typeof inspectLocalStackIdentity, 'function');
  const base = pinnedDockerContainers();
  const attempt = (inspections) => inspectLocalStackIdentity({
    projectId: testProjectId,
    apiPort: testApiPort,
    runDocker(args) {
      return args[0] === 'ps'
        ? { status: 0, stdout: inspections.map((item) => item.Id).join('\n'), stderr: '' }
        : { status: 0, stdout: JSON.stringify(inspections), stderr: '' };
    },
  });

  assert.throws(() => attempt(base.slice(0, 3)), /identity|container/i);
  assert.throws(() => attempt(base.map((item, index) => index === 0 ? {
    ...item,
    Config: { Labels: { 'com.supabase.cli.project': 'mekarvim-security-g5-wrong' } },
  } : item)), /label|project|identity/i);
  assert.throws(() => attempt(base.map((item, index) => index === 1 ? {
    ...item,
    NetworkSettings: { Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: String(testApiPort) }] } },
  } : item)), /loopback|port|identity/i);
});

test('Docker inspection rejects an extra loopback Kong binding outside the pinned listener contract', async () => {
  const { inspectLocalStackIdentity } = await import('../../scripts/security/verify-rls-live.mjs');
  const inspections = pinnedDockerContainers();
  inspections[1] = {
    ...inspections[1],
    NetworkSettings: {
      Ports: {
        '8000/tcp': [
          { HostIp: '127.0.0.1', HostPort: String(testApiPort) },
          { HostIp: '::1', HostPort: '60000' },
        ],
      },
    },
  };
  assert.throws(() => inspectLocalStackIdentity({
    projectId: testProjectId,
    apiPort: testApiPort,
    runDocker: dockerInventory(inspections),
  }), /binding|listener|port|identity/i);
});

test('Docker inspection combines real label/name inventories and permits exact Studio/Inbucket only', async () => {
  const { inspectLocalStackIdentity } = await import('../../scripts/security/verify-rls-live.mjs');
  const required = pinnedDockerContainers({ smtpRole: 'inbucket' });
  const studio = required.find((item) => item.Name.includes('supabase_studio_'));
  const inbucket = required.find((item) => item.Name.includes('supabase_inbucket_'));
  const inspect = (containers, calls = []) => inspectLocalStackIdentity({
    projectId: testProjectId,
    apiPort: testApiPort,
    runDocker: dockerInventory(containers, calls),
  });

  const calls = [];
  const identity = inspect(required, calls);
  assert.equal(identity.containers.find((entry) => entry.role === 'studio')?.name,
    `supabase_studio_${testProjectId}`);
  assert.equal(identity.containers.find((entry) => entry.role === 'inbucket')?.name,
    `supabase_inbucket_${testProjectId}`);
  assert.equal(calls.filter((args) => args[0] === 'ps').length, 2);
  assert.equal(calls.filter((args) => args[0] === 'ps').some((args) => args.includes('--all')), false);
  assert.ok(calls.some((args) => args.includes(`label=com.supabase.cli.project=${testProjectId}`)));
  assert.ok(calls.some((args) => args.includes(`name=${testProjectId}`)));

  for (const extra of [
    { ...studio, Name: `/prefix-supabase_studio_${testProjectId}` },
    { ...studio, Name: `/supabase_studio_${testProjectId}-suffix` },
    { ...studio, Config: { Labels: {} } },
    {
      ...studio,
      Name: `/supabase_studio_${testProjectId}-wrong-project-collision`,
      Config: { Labels: { 'com.supabase.cli.project': 'mekarvim-security-g5-wrong' } },
    },
  ]) {
    assert.throws(() => inspect([...required.filter((item) => item.Id !== studio.Id), extra]),
      /identity|label|name|project|binding/i);
  }
});

test('live target loader measures Docker identity instead of accepting a caller verdict', async () => {
  const { loadVerifiedLocalTarget } = await import('../../scripts/security/verify-rls-live.mjs');
  assert.equal(typeof loadVerifiedLocalTarget, 'function');
  const inspections = pinnedDockerContainers();
  const result = loadVerifiedLocalTarget({
    env: {
      SECURITY_TEST_CONFIRM_ISOLATED: 'true',
      SECURITY_TEST_SUPABASE_URL: `http://127.0.0.1:${testApiPort}`,
      SECURITY_TEST_PRODUCTION_COMPARISON_URL: syntheticProduction,
      SECURITY_TEST_PROJECT_ID: testProjectId,
      SECURITY_TEST_SUPABASE_API_PORT: String(testApiPort),
    },
    runDocker(args) {
      return args[0] === 'ps'
        ? { status: 0, stdout: inspections.map((item) => item.Id).join('\n'), stderr: '' }
        : { status: 0, stdout: JSON.stringify(inspections), stderr: '' };
    },
  });
  assert.equal(result.targetUrl, `http://127.0.0.1:${testApiPort}`);
  assert.equal(result.stackIdentity.verified, true);
  assert.equal(result.stackIdentity.projectId, testProjectId);

  assert.throws(() => loadVerifiedLocalTarget({
    env: {
      SECURITY_TEST_CONFIRM_ISOLATED: 'true',
      SECURITY_TEST_SUPABASE_URL: `http://127.0.0.1:${testApiPort}`,
      SECURITY_TEST_PRODUCTION_COMPARISON_URL: syntheticProduction,
      SECURITY_TEST_PROJECT_ID: testProjectId,
      SECURITY_TEST_SUPABASE_API_PORT: String(testApiPort),
      SECURITY_TEST_STACK_IDENTITY: JSON.stringify(verifiedStackIdentity()),
    },
    runDocker: () => ({ status: 1, stdout: '', stderr: 'daemon unavailable' }),
  }), /inspection|identity/i);

  assert.throws(() => loadVerifiedLocalTarget({
    env: {
      SECURITY_TEST_CONFIRM_ISOLATED: 'true',
      SECURITY_TEST_SUPABASE_URL: `http://127.0.0.1:${testApiPort}`,
      SECURITY_TEST_PRODUCTION_COMPARISON_URL: syntheticProduction,
      SECURITY_TEST_PROJECT_ID: testProjectId,
      SECURITY_TEST_SUPABASE_API_PORT: String(testApiPort),
    },
  }), /absolute local Docker CLI/i);
});

test('anonymous isolation denies every classified public surface', live, async (t) => {
  const { targetUrl } = loadVerifiedLocalTarget();
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(publishableKey, 'missing local publishable key');

  const results = await verifyAnonymousIsolation({ targetUrl, publishableKey });
  assert.equal(results.length, SENSITIVE_TABLES.length, 'classified security posture count is not exact');
  assert.deepEqual(new Set(results.map((result) => result.table)), new Set(SENSITIVE_TABLES));
  assert.equal(results.some((result) => result.leaked), false);
  observeG5CaseInTest(t, 'SEC-001', 'denied');
});

test('direct PostgREST rejects anonymous PII mutation independently of the BFF', live, async (t) => {
  const { targetUrl } = loadVerifiedLocalTarget();
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(publishableKey, 'missing local publishable key');
  const client = createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.from('contacts').insert({
    name: 'Synthetic denied actor',
    project_id: -1,
  });
  assert.ok(error, 'anonymous contact mutation unexpectedly succeeded');
  observeG5CaseInTest(t, 'SEC-014', 'denied');
});

test('RLS denies cross-project and cross-activist contact CRUD', live, async (t) => {
  const { clients, resources } = loadDirectFixture();

  const { data: projectBRead, error: projectBReadError } = await clients.activistA
    .from('contacts').select('id').eq('id', resources.contactB);
  assert.ifError(projectBReadError);
  assert.deepEqual(projectBRead, []);
  observeG5CaseInTest(t, 'SEC-004', 'denied');

  const { data: activistA2Read, error: activistA2ReadError } = await clients.activistA
    .from('contacts').select('id').eq('id', resources.contactA2);
  assert.ifError(activistA2ReadError);
  assert.deepEqual(activistA2Read, []);

  const { error: insertError } = await clients.activistA.from('contacts').insert({
    project_id: resources.projectB,
    assigned_user_id: resources.activistA,
    name: 'Synthetic forged tenant',
    security_run_id: resources.securityRunId,
  });
  assert.ok(insertError, 'cross-project insert unexpectedly succeeded');
  observeG5CaseInTest(t, 'SEC-008', 'denied');

  for (const [caseId, mutation] of [
    ['SEC-009', clients.activistA.from('contacts').update({ project_id: resources.projectA })
      .eq('id', resources.contactB).select('id')],
    ['SEC-009', clients.activistA.from('contacts').update({ assigned_user_id: resources.activistA })
      .eq('id', resources.contactA2).select('id')],
    ['SEC-010', clients.activistA.from('contacts').delete().eq('id', resources.contactB).select('id')],
  ]) {
    const { data, error } = await mutation;
    assert.ok(error || !data?.length, 'cross-authority mutation unexpectedly changed a row');
  }
  observeG5CaseInTest(t, 'SEC-009', 'denied');
  observeG5CaseInTest(t, 'SEC-010', 'denied');
});

test('RLS role projection is exact across CEO, Head, Coordinator, Finance and Activist', live, async (t) => {
  const { clients, resources } = loadDirectFixture();

  const ceoRows = await clients.ceoAal2.from('contacts').select('id')
    .in('id', [resources.contactA, resources.contactB]);
  assert.ifError(ceoRows.error);
  assert.equal(ceoRows.data.length, 2);
  observeG5CaseInTest(t, 'SEC-013', 'pass');

  for (const actor of ['headAal2', 'coordA']) {
    const allowed = await clients[actor].from('contacts').select('id').eq('id', resources.contactA);
    const denied = await clients[actor].from('contacts').select('id').eq('id', resources.contactB);
    assert.ifError(allowed.error);
    assert.ifError(denied.error);
    assert.equal(allowed.data.length, 1);
    assert.deepEqual(denied.data, []);
  }
  observeG5CaseInTest(t, 'SEC-011', 'pass');
  observeG5CaseInTest(t, 'SEC-012', 'pass');

  for (const actor of ['headAal1', 'ceoAal1', 'financeA']) {
    const { data, error } = await clients[actor].from('contacts').select('id').limit(1);
    assert.ok(error || !data?.length, `${actor} unexpectedly received contact PII`);
  }
});

test('service-only posture inventory proves forced RLS without exposing row data', live, async (t) => {
  const { targetUrl } = loadVerifiedLocalTarget();
  const serviceRoleKey = process.env.SECURITY_TEST_SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(serviceRoleKey, 'missing process-local service-role key');
  const service = createClient(targetUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service.rpc('app_security_posture');
  assert.ifError(error);
  assert.deepEqual(new Set(data.map((row) => row.table_name)), new Set(RLS_PROTECTED_TABLES));
  for (const row of data) {
    assert.equal(row.rls_enabled, true, `${row.table_name} does not enable RLS`);
    assert.equal(row.rls_forced, true, `${row.table_name} does not force RLS`);
    assert.equal(row.policy_count, RLS_EXPECTED_POLICY_COUNTS[row.table_name], `${row.table_name} policy count differs`);
  }
  observeG5CaseInTest(t, 'SEC-023', 'pass');
});

test('direct JWT matrix covers every classified object, direct action and role boundary', live, async (t) => {
  const { clients, resources } = loadDirectFixture();

  for (const row of G5_DIRECT_JWT_MATRIX) {
    const selector = directSelector(row.table, resources);
    const selected = withSelector(
      clients.activistA.from(row.table).select(directColumns(row.table)),
      selector,
    );
    if (row.table === 'payment_config') {
      await expectDirectAllowed(selected, `${row.table}:select`);
      await expectDirectDenied(
        clients.activistA.from(row.table).insert(directInsertPayload(row.table, resources)).select('id'),
        `${row.table}:insert`, { requireError: true },
      );
      await expectDirectDenied(
        withSelector(clients.activistA.from(row.table).update(directUpdatePayload(row.table, resources)).select('id'), selector),
        `${row.table}:update`,
      );
      await expectDirectDenied(
        withSelector(clients.activistA.from(row.table).delete().select('id'), selector),
        `${row.table}:delete`,
      );
      observeG5CaseInTest(t, row.caseId, 'pass');
      continue;
    }

    await expectDirectDenied(selected, `${row.table}:select`);
    if (row.table !== 'activist_directory') {
      await expectDirectDenied(
        clients.activistA.from(row.table).insert(directInsertPayload(row.table, resources))
          .select(directColumns(row.table)),
        `${row.table}:insert`, { requireError: true },
      );
      await expectDirectDenied(
        withSelector(
          clients.activistA.from(row.table).update(directUpdatePayload(row.table, resources))
            .select(directColumns(row.table)),
          selector,
        ),
        `${row.table}:update`,
      );
      await expectDirectDenied(
        withSelector(clients.activistA.from(row.table).delete().select(directColumns(row.table)), selector),
        `${row.table}:delete`,
      );
    }
    observeG5CaseInTest(t, row.caseId, 'denied');
  }
});

test('direct JWT rejects old/new-authorized authority transfers and legacy UUID divergence', live, async (t) => {
  const { clients, resources } = loadDirectFixture();

  for (const row of G5_DIRECT_JWT_MATRIX.filter((candidate) => candidate.authorityTransfer)) {
    const client = authorityClient(row.table, clients);
    await expectDirectDenied(
      withSelector(
        client.from(row.table).update(authorityTransferPatch(row.table, resources))
          .select(directColumns(row.table)),
        authoritySelector(row.table, resources),
      ),
      `${row.table}:old-new-authority-transfer`,
    );
  }

  await expectDirectDenied(
    clients.ceoAal2.from('contacts').insert({
      ...directInsertPayload('contacts', resources),
      project_id: resources.projectA,
      assigned_user_id: resources.actorIds.activistA1,
      activist_id: resources.actorCodes.activistB1,
      name: 'Synthetic divergent identity pair',
    }).select('id'),
    'contacts:legacy-uuid-divergence', { requireError: true },
  );
  observeG5CaseInTest(t, 'SEC-060', 'denied');
});
