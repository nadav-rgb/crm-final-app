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
      { name: `supabase_edge_runtime_${projectId}`, projectId, role: 'edge-runtime', hostPorts: [contract.stackPorts.edgeInspector] },
      {
        name: `supabase_mailpit_${projectId}`, projectId, role: 'mailpit',
        hostPorts: [contract.stackPorts.mailpit, contract.stackPorts.smtp, contract.stackPorts.pop3],
      },
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
    ['studio', { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.studio) }] }],
    ['analytics', { '4000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.analytics) }] }],
    ['edge_runtime', { '8083/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ports.edgeInspector) }] }],
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

test('anonymous isolation denies every classified public surface', live, async () => {
  const { targetUrl } = loadVerifiedLocalTarget();
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(publishableKey, 'missing local publishable key');

  const results = await verifyAnonymousIsolation({ targetUrl, publishableKey });
  assert.equal(results.length, SENSITIVE_TABLES.length, 'classified security posture count is not exact');
  assert.deepEqual(new Set(results.map((result) => result.table)), new Set(SENSITIVE_TABLES));
  assert.equal(results.some((result) => result.leaked), false);
});

test('direct PostgREST rejects anonymous PII mutation independently of the BFF', live, async () => {
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
});

test('RLS denies cross-project and cross-activist contact CRUD', live, async () => {
  const { clients, resources } = loadDirectFixture();

  const { data: projectBRead, error: projectBReadError } = await clients.activistA
    .from('contacts').select('id').eq('id', resources.contactB);
  assert.ifError(projectBReadError);
  assert.deepEqual(projectBRead, []);

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

  for (const mutation of [
    clients.activistA.from('contacts').update({ project_id: resources.projectA })
      .eq('id', resources.contactB).select('id'),
    clients.activistA.from('contacts').update({ assigned_user_id: resources.activistA })
      .eq('id', resources.contactA2).select('id'),
    clients.activistA.from('contacts').delete().eq('id', resources.contactB).select('id'),
  ]) {
    const { data, error } = await mutation;
    assert.ok(error || !data?.length, 'cross-authority mutation unexpectedly changed a row');
  }
});

test('RLS role projection is exact across CEO, Head, Coordinator, Finance and Activist', live, async () => {
  const { clients, resources } = loadDirectFixture();

  const ceoRows = await clients.ceoAal2.from('contacts').select('id')
    .in('id', [resources.contactA, resources.contactB]);
  assert.ifError(ceoRows.error);
  assert.equal(ceoRows.data.length, 2);

  for (const actor of ['headAal2', 'coordA']) {
    const allowed = await clients[actor].from('contacts').select('id').eq('id', resources.contactA);
    const denied = await clients[actor].from('contacts').select('id').eq('id', resources.contactB);
    assert.ifError(allowed.error);
    assert.ifError(denied.error);
    assert.equal(allowed.data.length, 1);
    assert.deepEqual(denied.data, []);
  }

  for (const actor of ['headAal1', 'ceoAal1', 'financeA']) {
    const { data, error } = await clients[actor].from('contacts').select('id').limit(1);
    assert.ok(error || !data?.length, `${actor} unexpectedly received contact PII`);
  }
});

test('service-only posture inventory proves forced RLS without exposing row data', live, async () => {
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
});
