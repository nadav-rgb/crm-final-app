import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  access, mkdir, readFile as readFileFromDisk, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import {
  buildLegacyFixtureRows,
  buildMigrationPlan,
  createDirectJwtFixture,
  createSecurityRunId,
  createSyntheticAuthActorsWithClient,
  provisionLegacyDatabase,
  sanitizeEvidenceRows,
} from './provision-test-fixtures.mjs';
import {
  buildMeasuredEvidenceRows,
  G5_REQUIRED_LIVE_TESTS,
  parseG5ObservationsFromTap,
} from './g5-evidence.mjs';
import {
  assertSafeTestTarget,
  derivePinnedLocalStackContract,
  inspectLocalContainerCandidates,
  inspectLocalStackIdentity,
  PINNED_SUPABASE_CLI_VERSION,
  RLS_EXPECTED_POLICY_COUNTS,
  RLS_PROTECTED_TABLES,
  SENSITIVE_TABLES,
  verifyAnonymousIsolation,
} from './verify-rls-live.mjs';

export { PINNED_SUPABASE_CLI_VERSION };
export { G5_CASE_MANIFEST, G5_REQUIRED_LIVE_TESTS } from './g5-evidence.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLEANUP_ORDER = Object.freeze({
  session: 10,
  'rate-bucket': 20,
  'audit-event': 30,
  'auth-identity': 35,
  'public-row': 40,
  membership: 50,
  profile: 60,
  'auth-user': 70,
  project: 80,
});
const PUBLIC_ROW_ORDER = Object.freeze({
  notification_reads: 40,
  meeting_reminders: 41,
  interactions: 42,
  base_meeting_reports: 43,
  expenses: 44,
  bonus_cancellations: 45,
  feedback_reports: 46,
  push_subscriptions: 47,
  fcm_tokens: 48,
  tours: 49,
  meeting_houses: 50,
  notifications: 51,
  contacts: 52,
  payment_config: 53,
});
const LIVE_TEST_FILES = Object.freeze([
  'tests/security/rls-live.test.mjs',
  'tests/security/db-contracts-live.test.mjs',
  'tests/security/session-live.test.mjs',
]);
const INVENTORY_KEYS = Object.freeze([
  'tables', 'columns', 'constraints', 'rlsEnabled', 'rlsForced',
  'policies', 'tableGrants', 'routineGrants', 'functions',
]);
const G5_MIGRATION_PLAN = Object.freeze(buildMigrationPlan(
  'tests/security/fixtures/legacy-security-schema.sql',
));
const EXPECTED_INVENTORY_SEQUENCE = Object.freeze([
  'legacy-before-reset-proof:null',
  'reset-proof:0018',
  'legacy-after-reset-proof:null',
  ...G5_MIGRATION_PLAN.map((step) => `forward:${step.id}`),
  'rollback:null',
  ...G5_MIGRATION_PLAN.map((step) => `final-forward:${step.id}`),
  'post-cleanup:null',
]);
const EXPECTED_CHECK_SEQUENCE = Object.freeze([
  ...G5_MIGRATION_PLAN[0].verifications.map((check) => `reset-proof:${check.id}`),
  ...['forward', 'final-forward'].flatMap((stage) => G5_MIGRATION_PLAN.flatMap((step) => (
    step.verifications.map((check) => `${stage}:${check.id}`)
  ))),
]);

function scalar(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && value.length > 0 && value.length <= 512) return value;
  throw new Error('run registry refused: invalid exact selector value');
}

function registryKey(entry) {
  const prefix = `${entry.schema}.${entry.table}`;
  if (entry.selector) {
    const pairs = Object.entries(entry.selector)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([column, value]) => `${column}=${scalar(value)}`);
    if (pairs.length < 1) throw new Error('run registry refused: empty exact selector');
    return `${prefix}:${pairs.join(',')}`;
  }
  return `${prefix}:${entry.column}:${scalar(entry.value)}`;
}

function validateRegistryEntry(entry) {
  if (!Object.hasOwn(CLEANUP_ORDER, entry?.kind)
    || !/^(?:public|auth|app_private)$/.test(entry?.schema ?? '')
    || !/^[a-z][a-z0-9_]{0,62}$/.test(entry?.table ?? '')
    || (!entry?.selector && !/^[a-z][a-z0-9_]{0,62}$/.test(entry?.column ?? ''))) {
    throw new Error('run registry refused: invalid exact resource');
  }
}

export function createSecurityRunRegistry(runId) {
  if (!UUID.test(runId ?? '')) throw new Error('run registry refused: exact UUID run id required');
  const resources = new Map();
  return Object.freeze({
    runId,
    register(entry) {
      validateRegistryEntry(entry);
      const normalized = Object.freeze({ ...entry, key: registryKey(entry) });
      if (resources.has(normalized.key)) throw new Error('run registry refused: duplicate resource');
      resources.set(normalized.key, normalized);
      return normalized;
    },
    entries() {
      return Object.freeze([...resources.values()]);
    },
  });
}

export function registerSyntheticRunResources({ registry, rowsByTable, actors }) {
  if (!registry?.runId || !rowsByTable || !(actors instanceof Map)) {
    throw new Error('run registry refused: seeded resource inventory is incomplete');
  }
  for (const [table, rows] of Object.entries(rowsByTable)) {
    if (!Array.isArray(rows)) throw new Error('run registry refused: invalid seeded table rows');
    for (const row of rows) {
      if (row.security_run_id !== registry.runId || row.id == null) {
        throw new Error('run registry refused: seeded row is not exact-run tagged');
      }
      registry.register({
        kind: table === 'projects' ? 'project' : table === 'profiles' ? 'profile' : 'public-row',
        schema: 'public',
        table,
        column: 'id',
        value: row.id,
      });
    }
  }
  for (const actor of actors.values()) {
    if (!UUID.test(actor?.id ?? '')) throw new Error('run registry refused: invalid Auth actor');
    registry.register({ kind: 'auth-user', schema: 'auth', table: 'users', column: 'id', value: actor.id });
    registry.register({
      kind: 'auth-identity', schema: 'app_private', table: 'auth_identities', column: 'auth_user_id', value: actor.id,
    });
  }
  for (const profile of rowsByTable.profiles ?? []) {
    if (profile.project_id == null) continue;
    registry.register({
      kind: 'membership',
      schema: 'public',
      table: 'project_memberships',
      selector: { project_id: profile.project_id, user_id: profile.id },
    });
  }
  return registry;
}

export function registerDerivedPrivateResources({ registry, resources }) {
  if (!registry?.runId || !resources) {
    throw new Error('run registry refused: derived resource inventory is incomplete');
  }
  for (const sessionHash of resources.sessionHashes ?? []) {
    registry.register({
      kind: 'session', schema: 'app_private', table: 'auth_sessions', column: 'session_hash', value: sessionHash,
    });
  }
  for (const auditId of resources.auditEventIds ?? []) {
    registry.register({
      kind: 'audit-event', schema: 'app_private', table: 'audit_events', column: 'id', value: auditId,
    });
  }
  for (const bucketHash of resources.rateBucketHashes ?? []) {
    registry.register({
      kind: 'rate-bucket', schema: 'app_private', table: 'rate_limit_buckets', column: 'bucket_hash', value: bucketHash,
    });
  }
  return registry;
}

async function probeTcpPort(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export function deriveLocalStackPorts(apiPort) {
  return derivePinnedLocalStackContract(apiPort).stackPorts;
}

function configContractError() {
  throw new Error('local Supabase config contract is unsupported');
}

export function preparePinnedLocalStackConfig({ config, projectId, apiPort }) {
  if (typeof config !== 'string'
    || !/^mekarvim-security-g5-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(projectId ?? '')) {
    configContractError();
  }
  let contract;
  try { contract = derivePinnedLocalStackContract(apiPort); } catch { configContractError(); }
  const lines = config.split(/\r?\n/);
  const parse = (contentLines) => {
    const sections = new Map([['', 1]]);
    const entries = new Map();
    const lineSections = [];
    let section = '';
    for (let index = 0; index < contentLines.length; index += 1) {
      const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(contentLines[index]);
      if (header) {
        section = header[1];
        sections.set(section, (sections.get(section) ?? 0) + 1);
        lineSections[index] = section;
        continue;
      }
      lineSections[index] = section;
      const entry = /^\s*([a-zA-Z0-9_]+)\s*=\s*([^#]*?)(?:\s+#.*)?$/.exec(contentLines[index]);
      if (!entry) continue;
      const name = `${section}.${entry[1]}`;
      const values = entries.get(name) ?? [];
      values.push({ index, value: entry[2].trim() });
      entries.set(name, values);
    }
    return { sections, entries, lineSections };
  };
  const initialInventory = parse(lines);
  const { sections } = initialInventory;

  const requiredSections = ['api', 'db', 'db.pooler', 'studio', 'local_smtp', 'analytics', 'edge_runtime'];
  if (requiredSections.some((name) => sections.get(name) !== 1) || sections.has('inbucket')) {
    configContractError();
  }

  const smtpTemplateBlock = [
    '# Uncomment to expose additional ports for testing user applications that send emails.',
    '# smtp_port = 54325',
    '# pop3_port = 54326',
  ];
  const blockStarts = lines.flatMap((line, index) => (
    smtpTemplateBlock.every((expected, offset) => lines[index + offset] === expected) ? [index] : []
  ));
  const activeOptionalPorts = [...initialInventory.entries.keys()]
    .filter((name) => name.endsWith('.smtp_port') || name.endsWith('.pop3_port'));
  const optionalCommentIndexes = lines.flatMap((line, index) => (
    /^\s*#\s*(?:smtp|pop3)_ports?\s*=/.test(line) ? [index] : []
  ));
  const explanationIndexes = lines.flatMap((line, index) => (
    line === smtpTemplateBlock[0] ? [index] : []
  ));
  const blockStart = blockStarts[0];
  if (blockStarts.length !== 1
    || activeOptionalPorts.length
    || explanationIndexes.length !== 1
    || explanationIndexes[0] !== blockStart
    || smtpTemplateBlock.some((_line, offset) => initialInventory.lineSections[blockStart + offset] !== 'local_smtp')
    || optionalCommentIndexes.length !== 2
    || optionalCommentIndexes[0] !== blockStart + 1
    || optionalCommentIndexes[1] !== blockStart + 2) {
    configContractError();
  }
  lines[blockStart + 1] = `smtp_port = ${contract.stackPorts.smtp}`;
  lines[blockStart + 2] = `pop3_port = ${contract.stackPorts.pop3}`;
  const { entries } = parse(lines);

  const replacements = new Map([
    ['.project_id', `"${projectId}"`],
    ['api.enabled', 'true'],
    ['api.port', String(contract.stackPorts.api)],
    ['db.port', String(contract.stackPorts.db)],
    ['db.shadow_port', String(contract.stackPorts.shadowDb)],
    ['db.pooler.enabled', 'false'],
    ['db.pooler.port', String(contract.stackPorts.pooler)],
    ['studio.enabled', 'true'],
    ['studio.port', String(contract.stackPorts.studio)],
    ['local_smtp.enabled', 'true'],
    ['local_smtp.port', String(contract.stackPorts.mailpit)],
    ['local_smtp.smtp_port', String(contract.stackPorts.smtp)],
    ['local_smtp.pop3_port', String(contract.stackPorts.pop3)],
    ['analytics.enabled', 'true'],
    ['analytics.port', String(contract.stackPorts.analytics)],
    ['edge_runtime.enabled', 'true'],
    ['edge_runtime.inspector_port', String(contract.stackPorts.edgeInspector)],
  ]);
  for (const [name, nextValue] of replacements) {
    const matches = entries.get(name);
    if (!Array.isArray(matches) || matches.length !== 1) configContractError();
    if (name.endsWith('.enabled') && matches[0].value !== nextValue) configContractError();
    const key = name.slice(name.lastIndexOf('.') + 1);
    lines[matches[0].index] = `${key} = ${nextValue}`;
  }
  const preparedConfig = lines.join('\n');
  const finalInventory = parse(lines);
  for (const [name, expectedValue] of replacements) {
    const finalEntries = finalInventory.entries.get(name);
    if (!Array.isArray(finalEntries) || finalEntries.length !== 1
      || finalEntries[0].value !== expectedValue) configContractError();
  }
  return Object.freeze({ config: preparedConfig, contract });
}

function shutdownDockerLines(result, boundary) {
  if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`local stack shutdown verification failed at ${boundary}`);
  }
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

export async function verifyLocalStackStopped({
  projectId,
  apiPort,
  listenerPorts,
  runDocker,
  probePort = probeTcpPort,
}) {
  let contract;
  try { contract = derivePinnedLocalStackContract(apiPort); } catch {
    throw new Error('local stack shutdown verification refused invalid port boundary');
  }
  const requestedListeners = listenerPorts ?? contract.listenerPorts;
  const expectedListeners = Array.isArray(requestedListeners)
    ? [...new Set(requestedListeners.map(Number))].sort((left, right) => left - right)
    : [];
  if (!expectedListeners.length
    || expectedListeners.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65535)
    || contract.listenerPorts.some((port) => !expectedListeners.includes(port))) {
    throw new Error('local stack shutdown verification refused incomplete listener contract');
  }
  if (!/^mekarvim-security-g5-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(projectId ?? '')
    || typeof runDocker !== 'function'
    || typeof probePort !== 'function') {
    throw new Error('local stack shutdown verification refused invalid boundary');
  }
  const label = `com.supabase.cli.project=${projectId}`;
  const containers = inspectLocalContainerCandidates({ projectId, runDocker, includeStopped: true });
  if (containers.length) throw new Error('local stack shutdown verification found exact-project container');

  const labelledVolumes = shutdownDockerLines(runDocker([
    'volume', 'ls', '--filter', `label=${label}`, '--format', '{{.Name}}',
  ]), 'labelled volume inventory');
  const namedVolumeCandidates = shutdownDockerLines(runDocker([
    'volume', 'ls', '--filter', `name=${projectId}`, '--format', '{{.Name}}',
  ]), 'named volume inventory');
  const escapedProject = projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactVolume = new RegExp(`^supabase_[a-z0-9_]+_${escapedProject}$`);
  const exactNamedVolumes = namedVolumeCandidates.filter((name) => exactVolume.test(name));
  if (labelledVolumes.length || exactNamedVolumes.length) {
    throw new Error('local stack shutdown verification found exact-project volume');
  }

  const listeners = (await Promise.all(expectedListeners.flatMap((port) => [
    probePort('127.0.0.1', port),
    probePort('::1', port),
  ]))).filter(Boolean).length;
  if (listeners) throw new Error('local stack shutdown verification found configured listener');
  return Object.freeze({ containers: 0, volumes: 0, listeners: 0 });
}

export async function verifyPostCleanupSecurity({
  targetUrl,
  publishableKey,
  serviceClient,
  anonymousProbe = verifyAnonymousIsolation,
}) {
  const parsedTarget = new URL(targetUrl ?? '');
  if (parsedTarget.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsedTarget.hostname)
    || parsedTarget.pathname !== '/' || parsedTarget.search || parsedTarget.hash
    || typeof publishableKey !== 'string' || publishableKey.length < 20
    || typeof serviceClient?.rpc !== 'function'
    || typeof anonymousProbe !== 'function') {
    throw new Error('post-cleanup security proof refused invalid local boundary');
  }
  const anonymous = await anonymousProbe({ targetUrl: parsedTarget.origin, publishableKey });
  const anonymousTables = new Set(anonymous?.map?.((row) => row?.table));
  if (!Array.isArray(anonymous) || anonymous.length !== SENSITIVE_TABLES.length
    || anonymousTables.size !== SENSITIVE_TABLES.length
    || SENSITIVE_TABLES.some((table) => !anonymousTables.has(table))
    || anonymous.some((row) => row?.blocked !== true || row?.leaked !== false)) {
    throw new Error('post-cleanup anonymous isolation proof failed');
  }
  const posture = await serviceClient.rpc('app_security_posture');
  const postureRows = Array.isArray(posture?.data) ? posture.data : [];
  const postureTables = new Set(postureRows.map((row) => row?.table_name));
  if (posture?.error || !Array.isArray(posture?.data)
    || postureRows.length !== RLS_PROTECTED_TABLES.length
    || postureTables.size !== RLS_PROTECTED_TABLES.length
    || RLS_PROTECTED_TABLES.some((table) => !postureTables.has(table))
    || postureRows.some((row) => row?.rls_enabled !== true
      || row?.rls_forced !== true
      || row?.policy_count !== RLS_EXPECTED_POLICY_COUNTS[row?.table_name])) {
    throw new Error('post-cleanup forced-RLS posture proof failed');
  }
  return Object.freeze({
    anonymousSurfaces: anonymous.length,
    anonymousLeaks: anonymous.filter((row) => row.leaked).length,
    postureTables: postureRows.length,
    rlsEnabledTables: postureRows.filter((row) => row.rls_enabled).length,
    rlsForcedTables: postureRows.filter((row) => row.rls_forced).length,
  });
}

export function createLocalStackController({
  projectId,
  apiPort,
  projectDir,
  allowedRoot,
  supabaseExecutable,
  dockerShimExecutable,
  dockerExecutable,
  productionUrl,
  prepareProject,
  runCommand = (executable, args, options) => spawnSync(executable, args, options),
  runDocker,
  probePort = probeTcpPort,
}) {
  const resolvedRoot = path.resolve(allowedRoot ?? '');
  const resolvedProject = path.resolve(projectDir ?? '');
  const resolvedShim = path.resolve(dockerShimExecutable ?? '');
  const resolvedDocker = path.resolve(dockerExecutable ?? '');
  const relativeProject = path.relative(resolvedRoot, resolvedProject);
  if (!/^mekarvim-security-g5-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(projectId ?? '')
    || path.basename(resolvedProject) !== projectId
    || !relativeProject || relativeProject.startsWith('..') || path.isAbsolute(relativeProject)
    || !path.isAbsolute(supabaseExecutable ?? '')
    || !path.isAbsolute(dockerShimExecutable ?? '')
    || path.basename(resolvedShim).toLowerCase() !== 'docker.exe'
    || !path.isAbsolute(dockerExecutable ?? '')
    || path.basename(resolvedDocker).toLowerCase() !== 'docker.exe'
    || resolvedShim.toLowerCase() === resolvedDocker.toLowerCase()) {
    throw new Error('local stack controller refused unexpected project boundary');
  }
  let stackContract;
  try { stackContract = derivePinnedLocalStackContract(apiPort); } catch {
    throw new Error('local stack controller refused invalid API port');
  }
  const expectedPort = stackContract.stackPorts.api;

  function command(args, action) {
    const inheritedPath = process.env.PATH ?? process.env.Path ?? '';
    const shimmedPath = `${path.dirname(resolvedShim)}${path.delimiter}${inheritedPath}`;
    const result = runCommand(supabaseExecutable, args, {
      encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: shimmedPath,
        Path: shimmedPath,
        SUPABASE_NO_UPDATE_NOTIFIER: '1',
        SUPABASE_TELEMETRY_DISABLED: '1',
        G5_DOCKER_LOOPBACK_SHIM_ACTIVE: 'true',
        G5_DOCKER_REAL_EXECUTABLE: resolvedDocker,
        G5_DOCKER_EXPECTED_PROJECT_ID: projectId,
        G5_DOCKER_ALLOWED_PUBLISH_PORTS: stackContract.persistentHostPorts.join(','),
      },
    });
    if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
      throw new Error(`local Supabase ${action} failed`);
    }
    return result.stdout.trim();
  }

  async function defaultPrepareProject() {
    await mkdir(resolvedProject, { recursive: true });
    const configPath = path.join(resolvedProject, 'supabase', 'config.toml');
    try {
      await access(configPath);
    } catch {
      command(['init', '--workdir', resolvedProject], 'initialization');
    }
    const prepared = preparePinnedLocalStackConfig({
      config: await readFileFromDisk(configPath, 'utf8'), projectId, apiPort: expectedPort,
    });
    await writeFile(configPath, prepared.config, { encoding: 'utf8', flag: 'w' });
    return prepared.contract;
  }

  let active = false;
  let verifiedTarget = null;
  async function stopOwnedStack(action, { measureListeners = false } = {}) {
    const failures = [];
    let measuredListeners = [];
    if (measureListeners) {
      try {
        const partialCandidates = inspectLocalContainerCandidates({
          projectId, runDocker, includeStopped: true,
        });
        measuredListeners = partialCandidates.flatMap((candidate) => candidate.hostBindings)
          .map((binding) => Number(binding.hostPort))
          .filter((port) => Number.isSafeInteger(port) && port >= 1 && port <= 65535);
      } catch (cause) {
        failures.push(cause);
      }
    }
    try { command(['stop', '--workdir', resolvedProject, '--no-backup'], action); } catch (cause) {
      failures.push(cause);
    }
    let proof;
    try {
      proof = await verifyLocalStackStopped({
        projectId,
        apiPort: expectedPort,
        listenerPorts: [...stackContract.listenerPorts, ...measuredListeners],
        runDocker,
        probePort,
      });
      active = false;
      verifiedTarget = null;
    } catch (cause) {
      failures.push(cause);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'local stack stop and final-state verification failed');
    }
    return proof;
  }
  return Object.freeze({
    async start() {
      if (active) throw new Error('local stack controller refused duplicate start');
      const selectedVersion = command(['--version'], 'version');
      if (selectedVersion !== PINNED_SUPABASE_CLI_VERSION) {
        throw new Error('local Supabase CLI version is not the pinned contract');
      }
      const preparedContract = await (prepareProject ?? defaultPrepareProject)({
        projectDir: resolvedProject, projectId, apiPort: expectedPort,
      });
      if (preparedContract?.cliVersion !== stackContract.cliVersion
        || JSON.stringify(preparedContract?.stackPorts) !== JSON.stringify(stackContract.stackPorts)
        || JSON.stringify(preparedContract?.services) !== JSON.stringify(stackContract.services)
        || JSON.stringify(preparedContract?.reservedPorts) !== JSON.stringify(stackContract.reservedPorts)
        || JSON.stringify(preparedContract?.listenerPorts) !== JSON.stringify(stackContract.listenerPorts)) {
        throw new Error('local Supabase prepared config did not prove the pinned listener contract');
      }
      active = true;
      try {
        command(['start', '--workdir', resolvedProject], 'start');
        const status = JSON.parse(command([
          'status', '--workdir', resolvedProject, '--output', 'json',
        ], 'status'));
        const targetUrl = status.API_URL;
        const publishableKey = status.ANON_KEY;
        const serviceRoleKey = status.SERVICE_ROLE_KEY;
        const dbUrl = status.DB_URL;
        if (typeof publishableKey !== 'string' || publishableKey.length < 20
          || typeof serviceRoleKey !== 'string' || serviceRoleKey.length < 20
          || typeof dbUrl !== 'string' || !dbUrl.startsWith('postgresql://')) {
          throw new Error('local Supabase status omitted process-local credentials');
        }
        const stackIdentity = inspectLocalStackIdentity({
          projectId, apiPort: expectedPort, runDocker,
        });
        const safety = Object.freeze({
          targetUrl,
          productionUrl,
          confirmed: true,
          expectedProjectId: projectId,
          expectedApiPort: expectedPort,
          stackIdentity,
        });
        const safe = assertSafeTestTarget(safety);
        verifiedTarget = Object.freeze({
          targetUrl: safe.origin,
          projectId,
          apiPort: expectedPort,
          stackIdentity,
          safety,
        });
        return Object.freeze({
          target: verifiedTarget,
          credentials: Object.freeze({ publishableKey, serviceRoleKey, dbUrl }),
        });
      } catch (cause) {
        try {
          await stopOwnedStack('failed-start cleanup', { measureListeners: true });
        } catch (cleanupCause) {
          throw new AggregateError(
            [cause, cleanupCause],
            'local Supabase start failed and exact cleanup verification also failed',
          );
        }
        throw cause;
      }
    },
    async stop() {
      if (!active || !verifiedTarget?.stackIdentity?.verified) {
        throw new Error('local stack controller refused unverified stop');
      }
      return stopOwnedStack('stop');
    },
  });
}

export function createLocalBffController({
  repoRoot,
  port,
  target,
  credentials,
  spawnProcess = (executable, args, options) => spawn(executable, args, options),
  probe = async (origin) => {
    try {
      const response = await fetch(`${origin}/api/auth/session`, { redirect: 'manual' });
      return response.status === 401;
    } catch {
      return false;
    }
  },
  waitForExit = async (owned) => {
    if (owned.exitCode != null) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('local BFF exit confirmation timed out'));
      }, 10_000);
      const onExit = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('local BFF exit confirmation failed')); };
      const cleanup = () => {
        clearTimeout(timeout);
        owned.off('exit', onExit);
        owned.off('error', onError);
      };
      owned.once('exit', onExit);
      owned.once('error', onError);
    });
  },
  probeListener = probeTcpPort,
}) {
  const bffPort = Number(port);
  if (!path.isAbsolute(repoRoot ?? '')
    || !Number.isSafeInteger(bffPort) || bffPort < 1024 || bffPort > 65535
    || !target?.targetUrl?.startsWith('http://127.0.0.1:')
    || target?.stackIdentity?.verified !== true
    || typeof credentials?.publishableKey !== 'string' || credentials.publishableKey.length < 20
    || typeof credentials?.serviceRoleKey !== 'string' || credentials.serviceRoleKey.length < 20) {
    throw new Error('local BFF controller refused invalid process boundary');
  }
  const origin = `http://127.0.0.1:${bffPort}`;
  let child = null;

  async function stopOwnedChild() {
    if (!child) throw new Error('local BFF controller refused stop without owned process');
    const owned = child;
    if (owned.exitCode == null) owned.kill('SIGTERM');
    await waitForExit(owned);
    if (await probeListener('127.0.0.1', bffPort)) {
      throw new Error('local BFF shutdown verification found the exact listener still active');
    }
    child = null;
  }

  function childEnvironment() {
    const inherited = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT']) {
      if (process.env[key]) inherited[key] = process.env[key];
    }
    return {
      ...inherited,
      // Next deliberately skips .env.local in test mode. The child receives an
      // explicit allowlist below, so no repository-local credentials are loaded.
      NODE_ENV: 'test',
      APP_ORIGIN: origin,
      SUPABASE_URL: target.targetUrl,
      SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: credentials.serviceRoleKey,
      SESSION_ID_PEPPER: randomBytes(32).toString('base64url'),
      SESSION_TOKEN_ENCRYPTION_KEY_V1: randomBytes(32).toString('base64url'),
      SESSION_TOKEN_KEY_VERSION: '1',
      SECURITY_BFF_AUTH_ENABLED: 'true',
      SECURITY_BFF_CONTACTS_ENABLED: 'true',
    };
  }

  return Object.freeze({
    async start() {
      if (child) throw new Error('local BFF controller refused duplicate start');
      const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
      child = spawnProcess(process.execPath, [
        nextBin, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(bffPort),
      ], {
        cwd: repoRoot,
        env: childEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
      try {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (child.exitCode != null) throw new Error('local BFF exited before readiness');
          if (await probe(origin)) {
            return Object.freeze({ origin, processId: child.pid });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error('local BFF readiness timed out');
      } catch (cause) {
        await stopOwnedChild();
        throw cause;
      }
    },
    async stop() {
      await stopOwnedChild();
    },
  });
}

function isolatedChildEnvironment() {
  const inherited = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT']) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  return inherited;
}

export function runLocalLiveTests({
  repoRoot,
  target,
  dockerExecutable,
  credentials,
  bffOrigin,
  bffPort,
  directFixture,
  sessionFixture,
  runCommand = (executable, args, options) => spawnSync(executable, args, options),
}) {
  assertSafeTestTarget(target);
  const parsedBff = new URL(bffOrigin ?? '');
  if (!path.isAbsolute(repoRoot ?? '')
    || !path.isAbsolute(dockerExecutable ?? '')
    || typeof credentials?.publishableKey !== 'string' || credentials.publishableKey.length < 20
    || typeof credentials?.serviceRoleKey !== 'string' || credentials.serviceRoleKey.length < 20
    || parsedBff.protocol !== 'http:' || parsedBff.hostname !== '127.0.0.1'
    || parsedBff.pathname !== '/' || parsedBff.search || parsedBff.hash
    || Number(parsedBff.port) !== Number(bffPort)
    || !directFixture?.tokens || !directFixture?.resources
    || !sessionFixture?.tokens || !sessionFixture?.credentials || !sessionFixture?.resources) {
    throw new Error('live security suite refused incomplete local runtime state');
  }
  const env = {
    ...isolatedChildEnvironment(),
    NODE_ENV: 'test',
    SECURITY_TEST_CONFIRM_ISOLATED: 'true',
    SECURITY_TEST_SUPABASE_URL: target.targetUrl,
    SECURITY_TEST_PRODUCTION_COMPARISON_URL: target.productionUrl,
    SECURITY_TEST_PROJECT_ID: target.expectedProjectId,
    SECURITY_TEST_SUPABASE_API_PORT: String(target.expectedApiPort),
    SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
    SECURITY_TEST_SUPABASE_SERVICE_ROLE_KEY: credentials.serviceRoleKey,
    SECURITY_TEST_DOCKER_CLI: dockerExecutable,
    SECURITY_TEST_BFF_ORIGIN: parsedBff.origin,
    SECURITY_TEST_BFF_PORT: String(bffPort),
    SECURITY_TEST_DIRECT_JWT_FIXTURE: JSON.stringify(directFixture),
    SECURITY_TEST_SESSION_FIXTURE: JSON.stringify(sessionFixture),
  };
  const result = runCommand(process.execPath, [
    '--test', '--test-concurrency=1', '--test-reporter=tap', ...LIVE_TEST_FILES,
  ], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!result || result.status !== 0) {
    // Child output is intentionally not included: it shares process-memory fixtures.
    throw new Error('live security suite failed');
  }
  const tapLines = result.stdout.split(/\r?\n/);
  const passedNames = new Set(tapLines.flatMap((line) => {
    const match = /^ok \d+ - (.+)$/.exec(line);
    return match ? [match[1]] : [];
  }));
  if (!tapLines.includes('# fail 0')
    || !tapLines.includes('# skipped 0')
    || G5_REQUIRED_LIVE_TESTS.some((name) => !passedNames.has(name))) {
    throw new Error('measured live cases are incomplete');
  }
  return Object.freeze(sanitizeEvidenceRows(buildMeasuredEvidenceRows({
    observations: parseG5ObservationsFromTap(result.stdout),
    passedTests: passedNames,
  })));
}

export function loadLocalG5Configuration({
  env = process.env,
  repoRoot = process.cwd(),
  runId = createSecurityRunId(),
} = {}) {
  const selfAttested = [
    'SECURITY_TEST_POSTGRES_ASSERTIONS',
    'SECURITY_TEST_DIRECT_JWT_FIXTURE',
    'SECURITY_TEST_SESSION_FIXTURE',
    'SECURITY_TEST_FINANCE_EXPECTED',
  ].filter((key) => env[key] != null);
  if (selfAttested.length) {
    throw new Error('G5 local entry refused caller verdict or self-attested fixture input');
  }
  const resolvedRepo = path.resolve(repoRoot ?? '');
  const supabaseExecutable = env.SECURITY_TEST_SUPABASE_CLI;
  const dockerExecutable = env.SECURITY_TEST_DOCKER_CLI;
  const dockerShimExecutable = env.SECURITY_TEST_DOCKER_LOOPBACK_SHIM;
  const apiPort = Number(env.SECURITY_TEST_SUPABASE_API_PORT ?? 54321);
  const bffPort = Number(env.SECURITY_TEST_BFF_PORT ?? 43877);
  let stackPorts;
  let stackContract;
  try {
    stackContract = derivePinnedLocalStackContract(apiPort);
    stackPorts = stackContract.stackPorts;
  } catch {
    throw new Error('G5 local entry refused invalid stack port configuration');
  }
  if (env.SECURITY_TEST_EXECUTE_LOCAL_G5 !== 'true'
    || !path.isAbsolute(resolvedRepo)
    || !UUID.test(runId ?? '')
    || !path.isAbsolute(supabaseExecutable ?? '')
    || !path.isAbsolute(dockerExecutable ?? '')
    || !path.isAbsolute(dockerShimExecutable ?? '')
    || path.basename(dockerShimExecutable).toLowerCase() !== 'docker.exe'
    || !Number.isSafeInteger(bffPort) || bffPort < 1024 || bffPort > 65535
    || stackContract.reservedPorts.includes(bffPort)) {
    throw new Error('G5 local entry refused incomplete executable configuration');
  }
  const suffix = runId.replaceAll('-', '').slice(0, 12);
  const projectId = `mekarvim-security-g5-${suffix}`;
  const allowedRoot = path.join(
    resolvedRepo, '.superpowers', 'sdd', '2026-08-27-security-hardening', 'g5-local',
  );
  return Object.freeze({
    runId,
    repoRoot: resolvedRepo,
    projectId,
    apiPort,
    stackPorts,
    listenerPorts: stackContract.listenerPorts,
    bffPort,
    allowedRoot,
    projectDir: path.join(allowedRoot, projectId),
    evidencePath: path.join(allowedRoot, `${projectId}-evidence.json`),
    supabaseExecutable,
    dockerExecutable,
    dockerShimExecutable,
    productionUrl: 'https://production-project.invalid',
    reservedPorts: stackContract.reservedPorts,
  });
}

export async function cleanupRegisteredSecurityRun({ registry, database, authAdmin }) {
  const entries = registry?.entries?.();
  if (!Array.isArray(entries)
    || typeof database?.countExact !== 'function'
    || typeof database?.deleteExact !== 'function'
    || typeof authAdmin?.deleteUser !== 'function') {
    throw new Error('exact cleanup refused: registry and local cleanup adapters required');
  }
  const rank = (entry) => entry.kind === 'public-row'
    ? (PUBLIC_ROW_ORDER[entry.table] ?? CLEANUP_ORDER['public-row'])
    : CLEANUP_ORDER[entry.kind];
  const ordered = [...entries].sort((left, right) =>
    rank(left) - rank(right) || left.key.localeCompare(right.key));
  const counts = {};

  for (const entry of ordered) {
    const before = await database.countExact(entry);
    if (!Number.isSafeInteger(before) || before < 0 || before > 1) {
      throw new Error(`exact cleanup refused: ${entry.key} is not uniquely scoped`);
    }
    if (entry.kind === 'auth-user') {
      if (before === 1) {
        const result = await authAdmin.deleteUser(entry.value);
        if (result?.error) throw new Error(`exact cleanup failed for ${entry.key}`);
      }
    } else if (before === 1) {
      await database.deleteExact(entry);
    }
    const after = await database.countExact(entry);
    if (after !== 0) throw new Error(`exact cleanup verification failed for ${entry.key}`);
    counts[entry.key] = Object.freeze({ before, after });
  }
  return Object.freeze(counts);
}

const CLEANUP_RESIDUAL_GROUPS = Object.freeze([
  Object.freeze({ source: 'auditEventIds', kind: 'audit-event', schema: 'app_private', table: 'audit_events' }),
  Object.freeze({ source: 'rateBucketHashes', kind: 'rate-bucket', schema: 'app_private', table: 'rate_limit_buckets' }),
  Object.freeze({ source: 'sessionHashes', kind: 'session', schema: 'app_private', table: 'auth_sessions' }),
]);

function sanitizeCleanupAggregateRows(rows, boundary) {
  if (!Array.isArray(rows)) throw new Error(`G5 cleanup evidence refused invalid ${boundary} groups`);
  const groups = new Set();
  const sanitized = rows.map((row) => {
    const keys = ['kind', 'schema', 'table', 'resources', 'before', 'after'];
    const group = `${row?.kind}:${row?.schema}.${row?.table}`;
    if (!row || Object.keys(row).length !== keys.length
      || !Object.hasOwn(CLEANUP_ORDER, row.kind)
      || !/^(?:public|auth|app_private)$/.test(row.schema ?? '')
      || !/^[a-z][a-z0-9_]{0,62}$/.test(row.table ?? '')
      || !Number.isSafeInteger(row.resources) || row.resources < 1
      || !Number.isSafeInteger(row.before) || row.before < 0 || row.before > row.resources
      || row.after !== 0 || groups.has(group)) {
      throw new Error(`G5 cleanup evidence refused unsafe ${boundary} aggregate`);
    }
    groups.add(group);
    return Object.freeze(Object.fromEntries(keys.map((key) => [key, row[key]])));
  });
  return Object.freeze(sanitized.sort((left, right) => (
    `${left.kind}:${left.schema}.${left.table}`.localeCompare(`${right.kind}:${right.schema}.${right.table}`)
  )));
}

function sanitizeCleanupEvidence(evidence) {
  if (!evidence || Object.keys(evidence).length !== 3) {
    throw new Error('G5 cleanup evidence refused incomplete aggregate proof');
  }
  const primary = sanitizeCleanupAggregateRows(evidence.primary, 'primary');
  const derived = sanitizeCleanupAggregateRows(evidence.derived, 'derived');
  if (!primary.length || !Array.isArray(evidence.residuals)
    || evidence.residuals.length !== CLEANUP_RESIDUAL_GROUPS.length) {
    throw new Error('G5 cleanup evidence refused incomplete zero-residual proof');
  }
  const residuals = evidence.residuals.map((row, index) => {
    const expected = CLEANUP_RESIDUAL_GROUPS[index];
    if (!row || Object.keys(row).length !== 4
      || row.kind !== expected.kind || row.schema !== expected.schema || row.table !== expected.table
      || row.count !== 0) {
      throw new Error('G5 cleanup evidence refused non-zero residual proof');
    }
    return Object.freeze({ kind: row.kind, schema: row.schema, table: row.table, count: 0 });
  });
  return Object.freeze({ primary, derived, residuals: Object.freeze(residuals) });
}

function aggregateCleanupCounts(registry, counts, boundary) {
  const entries = registry?.entries?.();
  if (!Array.isArray(entries) || !counts || typeof counts !== 'object') {
    throw new Error(`G5 cleanup evidence refused incomplete ${boundary} inputs`);
  }
  const expectedKeys = new Set(entries.map((entry) => entry.key));
  if (Object.keys(counts).length !== expectedKeys.size
    || Object.keys(counts).some((key) => !expectedKeys.has(key))) {
    throw new Error(`G5 cleanup evidence refused mismatched ${boundary} counts`);
  }
  const grouped = new Map();
  for (const entry of entries) {
    const count = counts[entry.key];
    if (!count || Object.keys(count).length !== 2
      || !Number.isSafeInteger(count.before) || count.before < 0 || count.before > 1
      || count.after !== 0) {
      throw new Error(`G5 cleanup evidence refused invalid ${boundary} count`);
    }
    const key = `${entry.kind}:${entry.schema}.${entry.table}`;
    const current = grouped.get(key) ?? {
      kind: entry.kind, schema: entry.schema, table: entry.table,
      resources: 0, before: 0, after: 0,
    };
    current.resources += 1;
    current.before += count.before;
    current.after += count.after;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

export function summarizeCleanupEvidence({
  primaryRegistry,
  primaryCounts,
  derivedRegistry,
  derivedCounts,
  leftovers,
}) {
  if (!leftovers || Object.keys(leftovers).length !== CLEANUP_RESIDUAL_GROUPS.length) {
    throw new Error('G5 cleanup evidence refused incomplete private residual inventory');
  }
  const residuals = CLEANUP_RESIDUAL_GROUPS.map((group) => {
    const values = leftovers[group.source];
    if (!Array.isArray(values) || values.length !== 0) {
      throw new Error('G5 cleanup evidence refused non-zero private residual inventory');
    }
    return { kind: group.kind, schema: group.schema, table: group.table, count: 0 };
  });
  return sanitizeCleanupEvidence({
    primary: aggregateCleanupCounts(primaryRegistry, primaryCounts, 'primary'),
    derived: aggregateCleanupCounts(derivedRegistry, derivedCounts, 'derived'),
    residuals,
  });
}

function exactIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value ?? '')) {
    throw new Error('local PostgreSQL adapter refused invalid identifier');
  }
  return `"${value}"`;
}

function sqlLiteral(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return `'${scalar(value).replaceAll("'", "''")}'`;
}

function exactPredicate(entry) {
  const pairs = entry.selector ? Object.entries(entry.selector) : [[entry.column, entry.value]];
  if (pairs.length < 1) throw new Error('local PostgreSQL adapter refused empty selector');
  return pairs.map(([column, value]) => `${exactIdentifier(column)} = ${sqlLiteral(value)}`).join(' and ');
}

export function createLocalPostgresAdapter({
  repoRoot,
  target,
  dockerExecutable,
  readFile = (file) => readFileFromDisk(file, 'utf8'),
  runCommand = (executable, args, options) => spawnSync(executable, args, options),
}) {
  assertSafeTestTarget(target);
  if (!path.isAbsolute(repoRoot ?? '') || !path.isAbsolute(dockerExecutable ?? '')) {
    throw new Error('local PostgreSQL adapter refused non-absolute executable or repository path');
  }
  const databaseContainer = target.stackIdentity.containers
    .find((container) => container.role === 'database')?.name;
  if (databaseContainer !== `supabase_db_${target.expectedProjectId}`) {
    throw new Error('local PostgreSQL adapter refused unexpected database container');
  }

  async function execute(sql) {
    if (typeof sql !== 'string' || sql.trim().length < 1) {
      throw new Error('local PostgreSQL adapter refused empty SQL');
    }
    const result = runCommand(dockerExecutable, [
      'exec', '-i', databaseContainer,
      'psql', '--username=postgres', '--dbname=postgres', '--no-psqlrc',
      '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose', '--tuples-only', '--no-align', '--quiet',
    ], {
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!result || result.status !== 0 || typeof result.stdout !== 'string') {
      const safeStderr = String(result?.stderr ?? '');
      const sqlState = /ERROR:\s+([0-9A-Z]{5}):/.exec(safeStderr)?.[1] ?? 'UNKNOWN';
      const parsedLine = Number(/\bLINE\s+(\d+):/.exec(safeStderr)?.[1]);
      const sqlLine = Number.isSafeInteger(parsedLine) && parsedLine > 0 ? parsedLine : null;
      const error = new Error(`local PostgreSQL command failed [${sqlState}]`);
      error.sqlState = sqlState;
      error.sqlLine = sqlLine;
      throw error;
    }
    return result.stdout.trim();
  }

  function repositoryFile(file) {
    if (!/^(?:migrations\/(?:00(?:18|19|20|21|22|23|24)_[a-z0-9_]+\.sql|rollback\/0018-0024-pre-cutover\.sql)|tests\/security\/fixtures\/legacy-security-schema\.sql)$/.test(file)) {
      throw new Error('local PostgreSQL adapter refused unexpected SQL file');
    }
    const resolved = path.resolve(repoRoot, file);
    const relative = path.relative(path.resolve(repoRoot), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('local PostgreSQL adapter refused SQL outside repository');
    }
    return resolved;
  }

  return Object.freeze({
    async resetToLegacy() {
      const legacy = await readFile(repositoryFile('tests/security/fixtures/legacy-security-schema.sql'));
      await execute(`begin;
drop schema if exists app_private cascade;
drop schema if exists public cascade;
create schema public authorization postgres;
grant usage on schema public to anon, authenticated, service_role;
commit;
${legacy}
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
notify pgrst, 'reload schema';`);
    },
    async applyFile(file) {
      const sql = await readFile(repositoryFile(file));
      try {
        await execute(sql);
      } catch (cause) {
        const sqlState = /^(?:[0-9A-Z]{5}|UNKNOWN)$/.test(cause?.sqlState ?? '')
          ? cause.sqlState
          : 'UNKNOWN';
        const sqlLine = Number.isSafeInteger(cause?.sqlLine) && cause.sqlLine > 0
          ? ` line ${cause.sqlLine}`
          : '';
        throw new Error(`local PostgreSQL migration failed at ${file} [${sqlState}${sqlLine}]`);
      }
    },
    async inventory() {
      const output = await execute(`select json_build_object(
        'tables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relkind in ('r','v')),
        'columns', (select count(*) from information_schema.columns where table_schema in ('public','app_private')),
        'constraints', (select count(*) from pg_constraint x join pg_namespace n on n.oid=x.connamespace where n.nspname in ('public','app_private')),
        'rlsEnabled', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relrowsecurity),
        'rlsForced', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relforcerowsecurity),
        'policies', (select count(*) from pg_policies where schemaname in ('public','app_private')),
        'tableGrants', (select count(*) from information_schema.role_table_grants where table_schema in ('public','app_private')),
        'routineGrants', (select count(*) from information_schema.routine_privileges where routine_schema in ('public','app_private')),
        'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private'))
      )::text;`);
      try { return JSON.parse(output); } catch { throw new Error('local PostgreSQL inventory returned invalid output'); }
    },
    async queryCheck(check) {
      if (!/^00(?:18|19|20|21|22|23|24)-[a-z0-9-]+$/.test(check?.id ?? '')
        || typeof check?.sql !== 'string' || check.expected !== 'pass') {
        throw new Error('local PostgreSQL adapter refused invalid migration check');
      }
      return execute(check.sql);
    },
    async verifyRollback() {
      const output = await execute(`select case when
        to_regnamespace('app_private') is null
        and to_regprocedure('public.app_finance_summary(text,integer,uuid)') is null
        and to_regprocedure('public.app_enqueue_notification_event(text,text,integer)') is null
        and to_regprocedure('public.app_submit_tour_report(text,jsonb)') is null
        and to_regprocedure('public.app_cancel_meeting_reminders(text)') is null
        then 'pass' else 'fail' end;`);
      return output === 'pass';
    },
    async countExact(entry) {
      validateRegistryEntry(entry);
      const output = await execute(`select count(*)::text from ${exactIdentifier(entry.schema)}.${exactIdentifier(entry.table)} where ${exactPredicate(entry)};`);
      const count = Number(output);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('exact count returned invalid output');
      return count;
    },
    async deleteExact(entry) {
      validateRegistryEntry(entry);
      await execute(`delete from ${exactIdentifier(entry.schema)}.${exactIdentifier(entry.table)} where ${exactPredicate(entry)};`);
    },
    async expireSessionsForUser(userId) {
      if (!UUID.test(userId ?? '')) throw new Error('session expiry refused: exact actor UUID required');
      await execute(`update app_private.auth_sessions
        set idle_expires_at = now() - interval '1 second',
            absolute_expires_at = now() - interval '1 second'
        where user_id = '${userId}' and revoked_at is null;`);
    },
    async expireAccessTokensForUser(userId) {
      if (!UUID.test(userId ?? '')) throw new Error('access-token expiry refused: exact actor UUID required');
      await execute(`update app_private.auth_sessions
        set access_token_expires_at = now() - interval '1 second'
        where user_id = '${userId}' and revoked_at is null;`);
    },
    async disableProfile(userId) {
      if (!UUID.test(userId ?? '')) throw new Error('profile disable refused: exact actor UUID required');
      await execute(`update public.profiles set disabled_at = now() where id = '${userId}';`);
    },
    async bumpSecurityVersion(userId) {
      if (!UUID.test(userId ?? '')) throw new Error('security-version change refused: exact actor UUID required');
      await execute(`update public.profiles
        set security_version = security_version + 1
        where id = '${userId}';`);
    },
    async inventoryPrivateResourceIds() {
      const output = await execute(`select json_build_object(
        'sessionHashes', coalesce((select json_agg(session_hash order by session_hash) from app_private.auth_sessions), '[]'::json),
        'auditEventIds', coalesce((select json_agg(id order by id) from app_private.audit_events), '[]'::json),
        'rateBucketHashes', coalesce((select json_agg(bucket_hash order by bucket_hash) from app_private.rate_limit_buckets), '[]'::json)
      )::text;`);
      let resources;
      try { resources = JSON.parse(output); } catch { throw new Error('private resource inventory returned invalid output'); }
      if (!Array.isArray(resources.sessionHashes)
        || !Array.isArray(resources.auditEventIds)
        || !Array.isArray(resources.rateBucketHashes)) {
        throw new Error('private resource inventory returned an incomplete contract');
      }
      return resources;
    },
    execute,
  });
}

function assertFinanceAssertionInput({ actorId, projectId, expectedRows, period }) {
  if (!UUID.test(actorId ?? '')
    || !Number.isSafeInteger(projectId) || projectId < 1
    || !Number.isSafeInteger(expectedRows) || expectedRows < 0 || expectedRows > 100
    || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period ?? '')) {
    throw new Error('PostgreSQL assertion refused: invalid deterministic fixture scope');
  }
}

export async function runDirectPostgresAssertions({
  database, actorId, projectId, expectedRows, period,
}) {
  assertFinanceAssertionInput({ actorId, projectId, expectedRows, period });
  if (typeof database?.execute !== 'function') {
    throw new Error('PostgreSQL assertion refused: direct local database adapter required');
  }
  const claims = JSON.stringify({ sub: actorId, aal: 'aal2', role: 'authenticated' });
  const searchPathHijack = await database.execute(`begin;
create temporary table payment_config (id integer);
set local role authenticated;
do $g5$ begin perform set_config('request.jwt.claims', '${claims}', true); end $g5$;
select case when
  (select count(*) from public.app_finance_summary('${period}', ${projectId}, null)) = ${expectedRows}
  and coalesce((select proconfig @> array['search_path=pg_catalog, public, app_private']
    from pg_proc where oid='public.app_finance_summary(text,integer,uuid)'::regprocedure), false)
  then 'pass' else 'fail' end;
rollback;`);
  if (searchPathHijack !== 'pass') {
    throw new Error('PostgreSQL search-path assertion failed');
  }

  const financeAuditFailure = await database.execute(`begin;
create temporary table g5_atomic_result (value text not null);
create or replace function pg_temp.g5_block_finance_audit() returns trigger language plpgsql as $$
begin raise exception 'synthetic audit failure'; end $$;
create trigger g5_block_finance_audit before insert on app_private.audit_events
for each row execute function pg_temp.g5_block_finance_audit();
set local role authenticated;
do $g5$
declare v_failed boolean := false; v_rows integer := -1;
begin
  perform set_config('request.jwt.claims', '${claims}', true);
  begin
    select count(*) into v_rows from public.app_finance_summary('${period}', ${projectId}, null);
  exception when others then
    v_failed := true;
  end;
  insert into pg_temp.g5_atomic_result(value)
  values (case when v_failed and v_rows = -1 then 'pass' else 'fail' end);
end $g5$;
reset role;
drop trigger g5_block_finance_audit on app_private.audit_events;
select value from pg_temp.g5_atomic_result;
rollback;`);
  if (financeAuditFailure !== 'pass') {
    throw new Error('PostgreSQL finance audit atomicity assertion failed');
  }
  return {
    searchPathHijack: 'pass',
    financeAuditFailure: 'pass',
    unauditedRowsReturned: 0,
  };
}

function sanitizeInventory(inventory) {
  if (!inventory || Object.keys(inventory).length !== INVENTORY_KEYS.length) {
    throw new Error('G5 inventory refused incomplete sanitized counts');
  }
  const sanitized = {};
  for (const key of INVENTORY_KEYS) {
    const value = inventory[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('G5 inventory refused non-count value');
    }
    sanitized[key] = value;
  }
  return Object.freeze(sanitized);
}

function inventoryRecord(stage, migrationId, inventory) {
  if (!/^(?:legacy-before-reset-proof|legacy-after-reset-proof|reset-proof|forward|rollback|final-forward|post-cleanup)$/.test(stage)
    || (migrationId !== null && !/^00(?:18|19|20|21|22|23|24)$/.test(migrationId))) {
    throw new Error('G5 inventory refused unexpected lifecycle stage');
  }
  return Object.freeze({ stage, migrationId, inventory: sanitizeInventory(inventory) });
}

export function sanitizeLifecycleEvidence(evidence) {
  if (!Array.isArray(evidence?.inventories) || !Array.isArray(evidence?.checks)) {
    throw new Error('G5 lifecycle evidence refused incomplete arrays');
  }
  const inventories = evidence.inventories.map((entry) => inventoryRecord(
    entry?.stage,
    entry?.migrationId ?? null,
    entry?.inventory,
  ));
  const checks = evidence.checks.map((entry) => {
    if (!/^(?:reset-proof|forward|final-forward)$/.test(entry?.stage ?? '')
      || !/^00(?:18|19|20|21|22|23|24)$/.test(entry?.migrationId ?? '')
      || !new RegExp(`^${entry.migrationId}-[a-z0-9-]+$`).test(entry?.checkId ?? '')
      || entry?.expected !== 'pass'
      || entry?.actual !== 'pass') {
      throw new Error('G5 lifecycle evidence refused invalid migration check result');
    }
    return Object.freeze({
      stage: entry.stage,
      migrationId: entry.migrationId,
      checkId: entry.checkId,
      expected: entry.expected,
      actual: entry.actual,
    });
  });
  const inventorySequence = inventories.map((entry) => `${entry.stage}:${entry.migrationId}`);
  const checkSequence = checks.map((entry) => `${entry.stage}:${entry.checkId}`);
  if (inventorySequence.length !== EXPECTED_INVENTORY_SEQUENCE.length
    || inventorySequence.some((entry, index) => entry !== EXPECTED_INVENTORY_SEQUENCE[index])
    || checkSequence.length !== EXPECTED_CHECK_SEQUENCE.length
    || checkSequence.some((entry, index) => entry !== EXPECTED_CHECK_SEQUENCE[index])) {
    throw new Error('G5 lifecycle evidence refused incomplete ordered lifecycle');
  }
  const security = evidence.postCleanupSecurity;
  const securityKeys = [
    'anonymousSurfaces', 'anonymousLeaks', 'postureTables',
    'rlsEnabledTables', 'rlsForcedTables',
  ];
  if (!security || Object.keys(security).length !== securityKeys.length
    || securityKeys.some((key) => !Number.isSafeInteger(security[key]) || security[key] < 0)
    || security.anonymousSurfaces !== SENSITIVE_TABLES.length || security.anonymousLeaks !== 0
    || security.postureTables !== RLS_PROTECTED_TABLES.length
    || security.rlsEnabledTables !== security.postureTables
    || security.rlsForcedTables !== security.postureTables) {
    throw new Error('G5 lifecycle evidence refused invalid post-cleanup security proof');
  }
  const cleanup = sanitizeCleanupEvidence(evidence.cleanup);
  return Object.freeze({
    inventories: Object.freeze(inventories),
    checks: Object.freeze(checks),
    postCleanupSecurity: Object.freeze(Object.fromEntries(
      securityKeys.map((key) => [key, security[key]]),
    )),
    cleanup,
  });
}

async function applyAndVerify(database, step, stage, lifecycleEvidence) {
  await database.applyFile(step.file);
  for (const verification of step.verifications) {
    const observed = await database.queryCheck(verification);
    lifecycleEvidence.checks.push(Object.freeze({
      stage,
      migrationId: step.id,
      checkId: verification.id,
      expected: verification.expected,
      actual: observed,
    }));
    if (observed !== verification.expected) {
      throw new Error(`migration ${step.id} verification failed at ${verification.id}`);
    }
  }
  lifecycleEvidence.inventories.push(inventoryRecord(
    stage,
    step.id,
    await database.inventory(`${stage}-${step.id}`),
  ));
}

export async function runG5LocalLifecycle({
  migrationPlan,
  database,
  target,
  assertTarget,
  prepareActors,
  seedLegacy,
  provision,
  runLiveEvidence,
  cleanup,
  abortCleanup,
}) {
  if (!Array.isArray(migrationPlan) || migrationPlan.length !== 7
    || typeof assertTarget !== 'function'
    || typeof database?.resetToLegacy !== 'function'
    || typeof database?.inventory !== 'function'
    || typeof database?.applyFile !== 'function'
    || typeof database?.queryCheck !== 'function'
    || typeof database?.verifyRollback !== 'function'
    || typeof prepareActors !== 'function'
    || typeof seedLegacy !== 'function'
    || typeof provision !== 'function'
    || typeof runLiveEvidence !== 'function'
    || typeof cleanup !== 'function'
    || typeof abortCleanup !== 'function') {
    throw new Error('G5 orchestration refused: executable local lifecycle is incomplete');
  }

  await assertTarget(target);
  await database.resetToLegacy();
  let actors;
  const lifecycleEvidence = { inventories: [], checks: [] };
  try {
    actors = await prepareActors({ database, target });
    await seedLegacy({ database, target, actors });
    const baseline = await database.inventory('legacy-before-reset-proof');
    lifecycleEvidence.inventories.push(inventoryRecord(
      'legacy-before-reset-proof', null, baseline,
    ));
    await applyAndVerify(database, migrationPlan[0], 'reset-proof', lifecycleEvidence);
    await database.resetToLegacy();
    await seedLegacy({ database, target, actors });
    const resetBaseline = await database.inventory('legacy-after-reset-proof');
    lifecycleEvidence.inventories.push(inventoryRecord(
      'legacy-after-reset-proof', null, resetBaseline,
    ));
    if (JSON.stringify(resetBaseline) !== JSON.stringify(baseline)) {
      throw new Error('G5 reset proof failed');
    }

    for (const step of migrationPlan) await applyAndVerify(database, step, 'forward', lifecycleEvidence);
    await database.applyFile('migrations/rollback/0018-0024-pre-cutover.sql');
    if (!await database.verifyRollback()) throw new Error('G5 rollback proof failed');
    lifecycleEvidence.inventories.push(inventoryRecord(
      'rollback', null, await database.inventory('rollback'),
    ));

    await database.resetToLegacy();
    await seedLegacy({ database, target, actors });
    for (const step of migrationPlan) await applyAndVerify(database, step, 'final-forward', lifecycleEvidence);

    let provisioned;
    let evidence;
    let cleanupResult;
    try {
      provisioned = await provision({ database, target, actors });
      evidence = await runLiveEvidence({ database, target, ...provisioned });
    } finally {
      if (provisioned) cleanupResult = await cleanup({ database, target, ...provisioned });
    }
    if (!cleanupResult?.clean) throw new Error('G5 exact cleanup proof failed');
    lifecycleEvidence.inventories.push(inventoryRecord(
      'post-cleanup', null, cleanupResult.postCleanupInventory,
    ));
    lifecycleEvidence.postCleanupSecurity = cleanupResult.postCleanupSecurity;
    lifecycleEvidence.cleanup = cleanupResult.cleanupEvidence;
    return Object.freeze({
      completed: true,
      evidence,
      cleanup: cleanupResult,
      lifecycleEvidence: sanitizeLifecycleEvidence(lifecycleEvidence),
    });
  } catch (cause) {
    if (actors) await abortCleanup({ database, target, actors });
    throw cause;
  }
}

async function writeSanitizedEvidence(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function actorIdMap(actors) {
  return Object.fromEntries([...actors.entries()].map(([alias, actor]) => [alias, actor.id]));
}

function publicLiveResources(seed, actorIds) {
  const {
    rowsByTable: _rowsByTable,
    ...resources
  } = seed;
  return Object.freeze({ ...resources, actorIds: Object.freeze({ ...actorIds }) });
}

function actorCredentials(actors) {
  return Object.freeze(Object.fromEntries([...actors.entries()].map(([alias, actor]) => [alias, Object.freeze({
    username: `Synthetic ${alias}`.toLowerCase(),
    email: actor.email,
    password: actor.password,
  })])));
}

export async function runConfiguredLocalG5({
  config = loadLocalG5Configuration(),
  runtime = {},
} = {}) {
  const createStack = runtime.createStackController ?? createLocalStackController;
  const createDatabase = runtime.createDatabase ?? createLocalPostgresAdapter;
  const createServiceClient = runtime.createServiceClient ?? ((targetUrl, serviceRoleKey) => createClient(
    targetUrl,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  ));
  const runLifecycle = runtime.runLifecycle ?? runG5LocalLifecycle;
  const runLiveTests = runtime.runLiveTests ?? runLocalLiveTests;
  const createBff = runtime.createBffController ?? createLocalBffController;
  const emitEvidence = runtime.writeSanitizedEvidence ?? writeSanitizedEvidence;
  const runDocker = (args) => spawnSync(config.dockerExecutable, args, {
    encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024,
  });
  const stack = createStack({
    projectId: config.projectId,
    apiPort: config.apiPort,
    projectDir: config.projectDir,
    allowedRoot: config.allowedRoot,
    supabaseExecutable: config.supabaseExecutable,
    dockerShimExecutable: config.dockerShimExecutable,
    dockerExecutable: config.dockerExecutable,
    productionUrl: config.productionUrl,
    runDocker,
  });
  let stackStarted = false;
  let bffController = null;
  let bffStarted = false;
  try {
    const local = await stack.start();
    stackStarted = true;
    const target = local.target.safety;
    assertSafeTestTarget(target);
    const database = createDatabase({
      repoRoot: config.repoRoot,
      target,
      dockerExecutable: config.dockerExecutable,
    });
    const service = createServiceClient(target.targetUrl, local.credentials.serviceRoleKey);
    let latestSeed = null;

    const lifecycle = await runLifecycle({
      migrationPlan: buildMigrationPlan('tests/security/fixtures/legacy-security-schema.sql'),
      database,
      target,
      async assertTarget(candidate) {
        assertSafeTestTarget(candidate);
      },
      async prepareActors() {
        return createSyntheticAuthActorsWithClient({
          client: service,
          runId: config.runId,
          ...target,
        });
      },
      async seedLegacy({ actors }) {
        const actorIds = actorIdMap(actors.actors);
        const rowsByTable = buildLegacyFixtureRows(config.runId, actorIds);
        latestSeed = await provisionLegacyDatabase({
          client: service,
          runId: config.runId,
          actorIds,
          rowsByTable,
          ...target,
        });
      },
      async provision({ actors }) {
        if (!latestSeed) throw new Error('G5 provisioning refused missing exact seed inventory');
        const actorIds = actorIdMap(actors.actors);
        const resources = publicLiveResources(latestSeed, actorIds);
        const registry = createSecurityRunRegistry(config.runId);
        registerSyntheticRunResources({
          registry,
          rowsByTable: latestSeed.rowsByTable,
          actors: actors.actors,
        });
        const direct = await createDirectJwtFixture({
          actors: actors.actors,
          createClientForActor: () => createClient(target.targetUrl, local.credentials.publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          }),
          database,
        });
        const directFixture = Object.freeze({ tokens: direct.tokens, resources });
        const sessionFixture = Object.freeze({
          tokens: direct.tokens,
          credentials: actorCredentials(actors.actors),
          resources,
        });
        bffController = createBff({
          repoRoot: config.repoRoot,
          port: config.bffPort,
          target,
          credentials: local.credentials,
        });
        const bff = await bffController.start();
        bffStarted = true;
        return {
          registry,
          actors,
          resources,
          directFixture,
          sessionFixture,
          bffOrigin: bff.origin,
        };
      },
      async runLiveEvidence({ directFixture, sessionFixture, bffOrigin }) {
        return runLiveTests({
          repoRoot: config.repoRoot,
          target,
          dockerExecutable: config.dockerExecutable,
          credentials: local.credentials,
          bffOrigin,
          bffPort: config.bffPort,
          directFixture,
          sessionFixture,
        });
      },
      async cleanup({ registry }) {
        if (!bffStarted) throw new Error('G5 cleanup refused missing owned BFF process');
        await bffController.stop();
        bffStarted = false;
        registerDerivedPrivateResources({
          registry,
          resources: await database.inventoryPrivateResourceIds(),
        });
        const primaryCounts = await cleanupRegisteredSecurityRun({
          registry,
          database,
          authAdmin: service.auth.admin,
        });
        const derivedRegistry = createSecurityRunRegistry(config.runId);
        registerDerivedPrivateResources({
          registry: derivedRegistry,
          resources: await database.inventoryPrivateResourceIds(),
        });
        const derivedCounts = await cleanupRegisteredSecurityRun({
          registry: derivedRegistry,
          database,
          authAdmin: service.auth.admin,
        });
        const leftovers = await database.inventoryPrivateResourceIds();
        if (Object.values(leftovers).some((values) => values.length !== 0)) {
          throw new Error('G5 cleanup refused unregistered private leftovers');
        }
        const cleanupEvidence = summarizeCleanupEvidence({
          primaryRegistry: registry,
          primaryCounts,
          derivedRegistry,
          derivedCounts,
          leftovers,
        });
        const postCleanupSecurity = await verifyPostCleanupSecurity({
          targetUrl: target.targetUrl,
          publishableKey: local.credentials.publishableKey,
          serviceClient: service,
        });
        const postCleanupInventory = await database.inventory('post-cleanup');
        return Object.freeze({
          clean: true,
          primaryCounts,
          derivedCounts,
          cleanupEvidence,
          postCleanupSecurity,
          postCleanupInventory,
        });
      },
      async abortCleanup({ actors }) {
        if (bffStarted) {
          await bffController.stop();
          bffStarted = false;
        }
        await database.resetToLegacy();
        for (const actor of actors.actors.values()) {
          const deletion = await service.auth.admin.deleteUser(actor.id);
          if (deletion?.error) throw new Error('G5 abort cleanup failed for exact synthetic actor');
        }
      },
    });
    const evidence = sanitizeEvidenceRows(lifecycle.evidence);
    const sanitizedLifecycle = sanitizeLifecycleEvidence(lifecycle.lifecycleEvidence);
    await stack.stop();
    stackStarted = false;
    await emitEvidence(config.evidencePath, Object.freeze({
      cases: evidence,
      lifecycle: sanitizedLifecycle,
    }));
    return Object.freeze({
      completed: lifecycle.completed === true,
      projectId: config.projectId,
      evidenceCount: evidence.length,
      cleanupClean: lifecycle.cleanup?.clean === true,
    });
  } finally {
    try {
      if (bffStarted) {
        await bffController.stop();
        bffStarted = false;
      }
    } finally {
      if (stackStarted) await stack.stop();
    }
  }
}

async function main() {
  const result = await runConfiguredLocalG5();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
