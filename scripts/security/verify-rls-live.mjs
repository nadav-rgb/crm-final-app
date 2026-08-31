import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const RLS_PROTECTED_TABLES = Object.freeze([
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
]);

export const RLS_EXPECTED_POLICY_COUNTS = Object.freeze({
  projects: 4,
  project_memberships: 1,
  profiles: 1,
  contacts: 4,
  interactions: 4,
  base_meeting_reports: 4,
  meeting_houses: 4,
  meeting_reminders: 2,
  tours: 4,
  expenses: 4,
  bonus_cancellations: 3,
  payment_config: 3,
  notifications: 3,
  notification_reads: 4,
  push_subscriptions: 4,
  fcm_tokens: 4,
  feedback_reports: 4,
});

export const SENSITIVE_TABLES = Object.freeze([
  ...RLS_PROTECTED_TABLES,
  'activist_directory',
]);

const PROJECT_ID = /^mekarvim-security-g5-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const REQUIRED_CONTAINERS = Object.freeze({
  database: 'supabase_db_',
  api: 'supabase_kong_',
  auth: 'supabase_auth_',
  rest: 'supabase_rest_',
});
const OPTIONAL_CONTAINERS = Object.freeze({
  studio: 'supabase_studio_',
  meta: 'supabase_meta_',
  storage: 'supabase_storage_',
  imgproxy: 'supabase_imgproxy_',
  realtime: 'supabase_realtime_',
  analytics: 'supabase_analytics_',
  vector: 'supabase_vector_',
  pooler: 'supabase_pooler_',
  'edge-runtime': 'supabase_edge_runtime_',
  mailpit: 'supabase_mailpit_',
  inbucket: 'supabase_inbucket_',
});

export const PINNED_SUPABASE_CLI_VERSION = '2.115.0';

export function derivePinnedLocalStackContract(apiPort) {
  const api = Number(apiPort);
  if (!Number.isSafeInteger(api) || api < 1025 || api > 65514) {
    throw new Error('refused invalid pinned local stack API port');
  }
  const stackPorts = Object.freeze({
    shadowDb: api - 1,
    api,
    db: api + 1,
    studio: api + 2,
    mailpit: api + 3,
    smtp: api + 4,
    pop3: api + 5,
    analytics: api + 6,
    pooler: api + 8,
    edgeInspector: api + 21,
  });
  const services = Object.freeze({
    api: true,
    studio: true,
    localSmtp: true,
    analytics: true,
    pooler: false,
    edgeRuntime: true,
  });
  const listenerPorts = Object.freeze([
    stackPorts.shadowDb,
    stackPorts.api,
    stackPorts.db,
    stackPorts.studio,
    stackPorts.mailpit,
    stackPorts.smtp,
    stackPorts.pop3,
    stackPorts.analytics,
  ]);
  const reservedPorts = Object.freeze([...new Set(Object.values(stackPorts))]
    .sort((left, right) => left - right));
  const persistentHostPorts = Object.freeze(listenerPorts.filter((port) => port !== stackPorts.shadowDb));
  const containerHostPorts = Object.freeze({
    database: Object.freeze([stackPorts.db]),
    api: Object.freeze([stackPorts.api]),
    auth: Object.freeze([]),
    rest: Object.freeze([]),
    studio: Object.freeze([stackPorts.studio]),
    meta: Object.freeze([]),
    storage: Object.freeze([]),
    imgproxy: Object.freeze([]),
    realtime: Object.freeze([]),
    analytics: Object.freeze([stackPorts.analytics]),
    vector: Object.freeze([]),
    pooler: Object.freeze([]),
    'edge-runtime': Object.freeze([]),
    mailpit: Object.freeze([stackPorts.mailpit, stackPorts.smtp, stackPorts.pop3]),
    inbucket: Object.freeze([stackPorts.mailpit, stackPorts.smtp, stackPorts.pop3]),
  });
  return Object.freeze({
    cliVersion: PINNED_SUPABASE_CLI_VERSION,
    stackPorts,
    services,
    listenerPorts,
    reservedPorts,
    persistentHostPorts,
    containerHostPorts,
  });
}

function exactApiPort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('refused invalid local API port');
  }
  return port;
}

function assertExactStackIdentity(stackIdentity, projectId, apiPort) {
  const contract = derivePinnedLocalStackContract(apiPort);
  if (!stackIdentity?.verified
    || stackIdentity.projectId !== projectId
    || Number(stackIdentity.apiPort) !== apiPort
    || !Array.isArray(stackIdentity.containers)
    || !Array.isArray(stackIdentity.listenerPorts)
    || stackIdentity.listenerPorts.length !== contract.listenerPorts.length
    || stackIdentity.listenerPorts.some((port, index) => port !== contract.listenerPorts[index])) {
    throw new Error('refused unverified local stack identity');
  }

  for (const [role, prefix] of Object.entries(REQUIRED_CONTAINERS)) {
    const expectedName = `${prefix}${projectId}`;
    const container = stackIdentity.containers.find((entry) => entry?.role === role);
    if (!container
      || container.name !== expectedName
      || container.projectId !== projectId
      || !Array.isArray(container.hostPorts)
      || (role === 'api' && Number(container.hostApiPort) !== apiPort)) {
      throw new Error(`refused local stack container identity for ${role}`);
    }
  }

  for (const entry of stackIdentity.containers) {
    const role = containerRole(entry?.name, projectId);
    const allowedPorts = contract.containerHostPorts[role];
    const measuredPorts = Array.isArray(entry?.hostPorts)
      ? [...new Set(entry.hostPorts.map(Number))].sort((left, right) => left - right)
      : null;
    if (!role || role !== entry?.role || entry?.projectId !== projectId
      || (role === 'pooler' && contract.services.pooler === false)
      || !Array.isArray(allowedPorts) || !Array.isArray(measuredPorts)
      || measuredPorts.some((port) => !Number.isSafeInteger(port))
      || measuredPorts.length !== allowedPorts.length
      || measuredPorts.some((port, index) => port !== allowedPorts[index])) {
      throw new Error('refused mixed or inexact local stack container identity');
    }
  }
  for (const role of [...Object.keys(REQUIRED_CONTAINERS), 'studio', 'analytics', 'edge-runtime']) {
    if (stackIdentity.containers.filter((entry) => entry.role === role).length !== 1) {
      throw new Error(`refused local stack container identity for ${role}`);
    }
  }
  if (stackIdentity.containers.filter((entry) => ['mailpit', 'inbucket'].includes(entry.role)).length !== 1) {
    throw new Error('refused local stack SMTP container identity');
  }
  const measuredHostPorts = [...new Set(stackIdentity.containers.flatMap((entry) => entry.hostPorts))]
    .sort((left, right) => left - right);
  if (measuredHostPorts.length !== contract.persistentHostPorts.length
    || measuredHostPorts.some((port, index) => port !== contract.persistentHostPorts[index])) {
    throw new Error('refused local stack host listener identity');
  }
}

function dockerResult(result, action) {
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`local stack identity inspection failed at ${action}`);
  }
  return result.stdout.trim();
}

function dockerIds(result, action) {
  const ids = dockerResult(result, action).split(/\r?\n/).filter(Boolean);
  if (ids.some((id) => !/^[0-9a-f]{12,64}$/i.test(id))) {
    throw new Error(`local stack container inspection failed at ${action}`);
  }
  return ids;
}

export function inspectLocalContainerCandidates({ projectId, runDocker, includeStopped = false }) {
  if (!PROJECT_ID.test(projectId ?? '') || typeof runDocker !== 'function'
    || typeof includeStopped !== 'boolean') {
    throw new Error('local stack container inspection refused invalid boundary');
  }
  const command = includeStopped ? ['ps', '--all'] : ['ps'];
  const queries = [
    [...command, '--filter', `label=com.supabase.cli.project=${projectId}`, '--format', '{{.ID}}'],
    [...command, '--filter', `name=${projectId}`, '--format', '{{.ID}}'],
  ];
  const ids = [...new Set(queries.flatMap((args, index) => dockerIds(
    runDocker(args), index === 0 ? 'project-label listing' : 'project-name listing',
  )))];
  if (!ids.length) return Object.freeze([]);

  let inspected;
  try {
    inspected = JSON.parse(dockerResult(runDocker(['inspect', ...ids]), 'candidate inspection'));
  } catch {
    throw new Error('local stack container inspection returned invalid output');
  }
  if (!Array.isArray(inspected) || inspected.length !== ids.length) {
    throw new Error('local stack container inspection returned incomplete output');
  }
  const seen = new Set();
  const candidates = inspected.map((item) => {
    const id = String(item?.Id ?? '');
    const matchingIds = ids.filter((candidateId) => id.startsWith(candidateId));
    if (!/^[0-9a-f]{12,64}$/i.test(id) || matchingIds.length !== 1 || seen.has(matchingIds[0])) {
      throw new Error('local stack container inspection returned mismatched identity');
    }
    seen.add(matchingIds[0]);
    const portInventory = item?.NetworkSettings?.Ports;
    if (portInventory == null || typeof portInventory !== 'object' || Array.isArray(portInventory)) {
      throw new Error('local stack container inspection returned invalid binding inventory');
    }
    const hostBindings = Object.entries(portInventory).flatMap(([containerPort, bindings]) => (
      Array.isArray(bindings) ? bindings.map((binding) => Object.freeze({
        containerPort,
        hostIp: binding?.HostIp ?? null,
        hostPort: binding?.HostPort ?? null,
      })) : []
    ));
    return Object.freeze({
      id: matchingIds[0],
      name: String(item?.Name ?? '').replace(/^\//, ''),
      projectId: item?.Config?.Labels?.['com.supabase.cli.project'] ?? null,
      hostBindings: Object.freeze(hostBindings),
    });
  });
  return Object.freeze(candidates);
}

function containerRole(name, projectId) {
  return Object.entries({ ...REQUIRED_CONTAINERS, ...OPTIONAL_CONTAINERS })
    .find(([, prefix]) => name === `${prefix}${projectId}`)?.[0] ?? null;
}

export function inspectLocalStackIdentity({
  projectId,
  apiPort,
  runDocker = (args) => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true }),
}) {
  if (!PROJECT_ID.test(projectId ?? '')) {
    throw new Error('local stack identity refused: unexpected project id');
  }
  const expectedPort = exactApiPort(apiPort);
  const contract = derivePinnedLocalStackContract(expectedPort);
  const inspected = inspectLocalContainerCandidates({ projectId, runDocker });
  if (inspected.length < Object.keys(REQUIRED_CONTAINERS).length) {
    throw new Error('local stack identity refused: required containers are missing');
  }

  const containers = [];
  for (const item of inspected) {
    const name = item.name;
    const role = containerRole(name, projectId);
    const labelledProject = item.projectId;
    if (!role || labelledProject !== projectId) {
      throw new Error('local stack identity refused: unexpected container label or name');
    }
    if (role === 'pooler' && contract.services.pooler === false) {
      throw new Error('local stack identity refused: disabled pooler container is present');
    }
    const bindings = item.hostBindings;
    if (!Array.isArray(bindings)
      || bindings.some((binding) => !['127.0.0.1', '::1', '[::1]'].includes(binding?.hostIp)
        || !Number.isSafeInteger(Number(binding?.hostPort)))) {
      throw new Error('local stack identity refused: container binding is not exact loopback');
    }
    const measuredPorts = [...new Set(bindings.map((binding) => Number(binding.hostPort)))].sort((a, b) => a - b);
    const allowedPorts = contract.containerHostPorts[role];
    if (!Array.isArray(allowedPorts)
      || measuredPorts.length !== allowedPorts.length
      || measuredPorts.some((port, index) => port !== allowedPorts[index])) {
      throw new Error('local stack identity refused: container binding listener set is not exact');
    }
    const container = {
      name, projectId: labelledProject, role, hostPorts: Object.freeze(measuredPorts),
    };
    if (role === 'api') container.hostApiPort = expectedPort;
    containers.push(Object.freeze(container));
  }

  for (const role of Object.keys(REQUIRED_CONTAINERS)) {
    if (containers.filter((container) => container.role === role).length !== 1) {
      throw new Error(`local stack identity refused: exact ${role} container missing`);
    }
  }
  for (const role of ['studio', 'analytics', 'edge-runtime']) {
    if (containers.filter((container) => container.role === role).length !== 1) {
      throw new Error(`local stack identity refused: enabled ${role} container missing`);
    }
  }
  if (containers.filter((container) => ['mailpit', 'inbucket'].includes(container.role)).length !== 1) {
    throw new Error('local stack identity refused: exact local SMTP container missing');
  }
  const measuredHostPorts = [...new Set(containers.flatMap((container) => container.hostPorts))]
    .sort((a, b) => a - b);
  if (measuredHostPorts.length !== contract.persistentHostPorts.length
    || measuredHostPorts.some((port, index) => port !== contract.persistentHostPorts[index])) {
    throw new Error('local stack identity refused: measured host listener union is not exact');
  }
  const identity = Object.freeze({
    verified: true,
    projectId,
    apiPort: expectedPort,
    listenerPorts: contract.listenerPorts,
    containers: Object.freeze([
      ...Object.keys(REQUIRED_CONTAINERS)
        .map((role) => containers.find((container) => container.role === role)),
      ...containers.filter((container) => Object.hasOwn(OPTIONAL_CONTAINERS, container.role))
        .sort((left, right) => left.role.localeCompare(right.role)),
    ]),
  });
  assertExactStackIdentity(identity, projectId, expectedPort);
  return identity;
}

export function loadVerifiedLocalTarget({ env = process.env, runDocker } = {}) {
  const projectId = env.SECURITY_TEST_PROJECT_ID;
  const apiPort = exactApiPort(env.SECURITY_TEST_SUPABASE_API_PORT);
  let measuredDocker = runDocker;
  if (!measuredDocker) {
    const dockerExecutable = env.SECURITY_TEST_DOCKER_CLI;
    if (!path.isAbsolute(dockerExecutable ?? '')) {
      throw new Error('absolute local Docker CLI is required for stack identity');
    }
    measuredDocker = (args) => spawnSync(dockerExecutable, args, {
      encoding: 'utf8', windowsHide: true, shell: false,
    });
  }
  const stackIdentity = inspectLocalStackIdentity({ projectId, apiPort, runDocker: measuredDocker });
  const target = assertSafeTestTarget({
    targetUrl: env.SECURITY_TEST_SUPABASE_URL,
    productionUrl: env.SECURITY_TEST_PRODUCTION_COMPARISON_URL,
    confirmed: env.SECURITY_TEST_CONFIRM_ISOLATED === 'true',
    expectedProjectId: projectId,
    expectedApiPort: apiPort,
    stackIdentity,
  });
  const safety = Object.freeze({
    targetUrl: target.origin,
    productionUrl: env.SECURITY_TEST_PRODUCTION_COMPARISON_URL,
    confirmed: true,
    expectedProjectId: projectId,
    expectedApiPort: apiPort,
    stackIdentity,
  });
  return Object.freeze({
    targetUrl: target.origin,
    productionUrl: env.SECURITY_TEST_PRODUCTION_COMPARISON_URL,
    projectId,
    apiPort,
    stackIdentity,
    safety,
  });
}

export function assertSafeTestTarget({
  targetUrl,
  productionUrl,
  confirmed,
  expectedProjectId,
  expectedApiPort,
  stackIdentity,
}) {
  if (confirmed !== true) {
    throw new Error('isolated test target confirmation required');
  }
  if (!targetUrl || !productionUrl) {
    throw new Error('test and production target URLs are required');
  }
  if (!PROJECT_ID.test(expectedProjectId ?? '')) {
    throw new Error('refused unexpected local stack project id');
  }
  const apiPort = exactApiPort(expectedApiPort);

  const target = new URL(targetUrl);
  const production = new URL(productionUrl);
  if (target.origin === production.origin) {
    throw new Error('refused production target');
  }
  if (target.username || target.password) {
    throw new Error('refused target URL credentials');
  }
  if (target.protocol !== 'http:') {
    throw new Error('refused non-local-HTTP test target');
  }
  if (!LOOPBACK_HOSTS.has(target.hostname)) {
    throw new Error('refused non-loopback test target');
  }
  if (target.pathname !== '/' || target.search || target.hash) {
    throw new Error('refused non-root or decorated test target');
  }
  if (!target.port || Number(target.port) !== apiPort) {
    throw new Error('refused unexpected local API port');
  }

  assertExactStackIdentity(stackIdentity, expectedProjectId, apiPort);

  return Object.freeze({
    origin: target.origin,
    hostname: target.hostname,
    projectId: expectedProjectId,
    apiPort,
  });
}

export async function verifyAnonymousIsolation({ targetUrl, publishableKey }) {
  const client = createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const results = [];

  for (const table of SENSITIVE_TABLES) {
    const { data, error } = await client.from(table).select('*').limit(1);
    const leaked = !error && Array.isArray(data) && data.length > 0;
    results.push({ table, blocked: Boolean(error) || data?.length === 0, leaked });
  }
  return results;
}

async function main() {
  const { targetUrl } = loadVerifiedLocalTarget();

  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error('missing test publishable key');
  const results = await verifyAnonymousIsolation({ targetUrl, publishableKey });
  for (const result of results) {
    process.stdout.write(`${result.table}: ${result.blocked ? 'blocked' : 'LEAK'}\n`);
  }
  if (results.some((result) => result.leaked)) process.exitCode = 1;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  await main();
}
