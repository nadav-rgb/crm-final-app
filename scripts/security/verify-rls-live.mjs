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
});

function exactApiPort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('refused invalid local API port');
  }
  return port;
}

function assertExactStackIdentity(stackIdentity, projectId, apiPort) {
  if (!stackIdentity?.verified
    || stackIdentity.projectId !== projectId
    || Number(stackIdentity.apiPort) !== apiPort
    || !Array.isArray(stackIdentity.containers)) {
    throw new Error('refused unverified local stack identity');
  }

  for (const [role, prefix] of Object.entries(REQUIRED_CONTAINERS)) {
    const expectedName = `${prefix}${projectId}`;
    const container = stackIdentity.containers.find((entry) => entry?.role === role);
    if (!container
      || container.name !== expectedName
      || container.projectId !== projectId
      || (role === 'api' && Number(container.hostApiPort) !== apiPort)) {
      throw new Error(`refused local stack container identity for ${role}`);
    }
  }

  if (stackIdentity.containers.some((entry) => entry?.projectId !== projectId)) {
    throw new Error('refused mixed local stack project labels');
  }
}

function dockerResult(result, action) {
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`local stack identity inspection failed at ${action}`);
  }
  return result.stdout.trim();
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
  const ids = dockerResult(runDocker([
    'ps',
    '--filter', `label=com.supabase.cli.project=${projectId}`,
    '--format', '{{.ID}}',
  ]), 'container listing').split(/\r?\n/).filter(Boolean);
  if (ids.length < Object.keys(REQUIRED_CONTAINERS).length
    || ids.some((id) => !/^[0-9a-f]{12,64}$/i.test(id))) {
    throw new Error('local stack identity refused: required containers are missing');
  }

  const inspected = JSON.parse(dockerResult(
    runDocker(['inspect', ...ids]),
    'container inspection',
  ));
  if (!Array.isArray(inspected) || inspected.length !== ids.length) {
    throw new Error('local stack identity refused: incomplete Docker inspection');
  }

  const containers = [];
  for (const item of inspected) {
    const name = String(item?.Name ?? '').replace(/^\//, '');
    const role = containerRole(name, projectId);
    const labelledProject = item?.Config?.Labels?.['com.supabase.cli.project'];
    if (!role || labelledProject !== projectId) {
      throw new Error('local stack identity refused: unexpected container label or name');
    }
    const container = { name, projectId: labelledProject, role };
    if (role === 'api') {
      const bindings = item?.NetworkSettings?.Ports?.['8000/tcp'];
      if (!Array.isArray(bindings) || bindings.length < 1
        || bindings.some((binding) => !['127.0.0.1', '::1', '[::1]'].includes(binding?.HostIp))
        || !bindings.some((binding) => Number(binding.HostPort) === expectedPort)) {
        throw new Error('local stack identity refused: API port is not exact loopback');
      }
      container.hostApiPort = expectedPort;
    }
    containers.push(Object.freeze(container));
  }

  for (const role of Object.keys(REQUIRED_CONTAINERS)) {
    if (containers.filter((container) => container.role === role).length !== 1) {
      throw new Error(`local stack identity refused: exact ${role} container missing`);
    }
  }
  const identity = Object.freeze({
    verified: true,
    projectId,
    apiPort: expectedPort,
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
