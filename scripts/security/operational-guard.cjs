/*
 * Guardrails for the small number of operational scripts that still need a
 * service-role client.  Nothing in this module loads .env.local or creates a
 * client until beginOperation has accepted an explicit, non-production scope.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_ROWS_LIMIT = 10_000;
const EXPORT_ACK = 'APPROVED_NON_SYNCED_ENCRYPTED';
const SYNCED_PATH_SEGMENT = /(?:^|[\\/])(onedrive|dropbox|google drive|icloud drive)(?:[\\/]|$)/i;
const TARGET_REF = /^[a-z0-9][a-z0-9-]{2,62}$/;

function fail(message) {
  throw new Error(`Operational guard refused: ${message}`);
}

function splitArguments(argv) {
  const values = new Map();
  const flags = new Set();
  const positional = [];
  for (const argument of argv) {
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const equals = argument.indexOf('=');
    if (equals < 0) {
      if (flags.has(argument)) fail(`duplicate flag ${argument}`);
      flags.add(argument);
      continue;
    }
    const key = argument.slice(0, equals);
    const value = argument.slice(equals + 1);
    if (!value) fail(`missing value for ${key}`);
    if (values.has(key)) fail(`duplicate option ${key}`);
    values.set(key, value);
  }
  return { values, flags, positional };
}

function requiredValue(arguments, name) {
  const value = arguments.values.get(name);
  if (!value) fail(`missing ${name}`);
  return value;
}

function canonicalUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be an absolute URL`);
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail(`${label} must be a canonical origin URL`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !loopback) fail(`${label} must use HTTPS outside loopback`);
  return parsed.origin.toLowerCase();
}

function projectRefFor(origin) {
  return new URL(origin).hostname.toLowerCase().split('.')[0];
}

function validateTarget(targetUrl, targetRef, productionUrl) {
  if (!TARGET_REF.test(targetRef)) fail('target-ref is invalid');
  const target = canonicalUrl(targetUrl, 'target-url');
  const production = canonicalUrl(productionUrl, 'production-url');
  const targetHost = new URL(target).hostname.toLowerCase();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(targetHost);
  if (!loopback && targetHost !== `${targetRef}.supabase.co`) {
    fail('target-url does not match target-ref');
  }
  if (target === production || projectRefFor(target) === projectRefFor(production)
    || /(?:prod|production|live)/i.test(targetHost) || /(?:prod|production|live)/i.test(targetRef)) {
    fail('Production and live targets are denied');
  }
  return { url: target, productionUrl: production, ref: targetRef };
}

function validateExportDirectory(value, workspaceRoot) {
  if (!path.isAbsolute(value)) fail('export-dir must be an absolute non-synced path');
  const resolved = path.resolve(value);
  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  const workspace = path.resolve(workspaceRoot).replace(/\\/g, '/').toLowerCase();
  if (normalized === workspace || normalized.startsWith(`${workspace}/`) || SYNCED_PATH_SEGMENT.test(resolved)) {
    fail('export-dir must be an approved non-synced location outside the workspace');
  }
  return resolved;
}

function redactOperationalValue(value) {
  const digest = crypto.createHash('sha256')
    .update('mekarvim-operational-redaction-v1\0')
    .update(String(value ?? ''))
    .digest('hex')
    .slice(0, 12);
  return `redacted:${digest}`;
}

function assertBoundedRows(rows, maxRows, label = 'query') {
  if (!Array.isArray(rows)) fail(`${label} did not return an array`);
  if (rows.length > maxRows) fail(`${label} exceeds --max-rows=${maxRows}`);
  return rows;
}

function writeOperationAudit(operation, event, writeAudit) {
  const record = {
    timestamp: new Date().toISOString(),
    script: operation.scriptName,
    mode: operation.mode,
    targetRef: operation.target.ref,
    projectId: operation.target.projectId,
    maxRows: operation.maxRows,
    actor: operation.actor,
    reason: operation.reason,
    event,
  };
  if (writeAudit) {
    writeAudit(record);
    return;
  }
  fs.mkdirSync(operation.exportDir, { recursive: true, mode: 0o700 });
  const auditPath = path.join(operation.exportDir, 'mekarvim-operational-audit.jsonl');
  fs.appendFileSync(auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function beginOperation({
  scriptName,
  mode = 'read',
  argv = process.argv.slice(2),
  workspaceRoot = process.cwd(),
} = {}) {
  if (typeof scriptName !== 'string' || !/^[a-z0-9-]+$/.test(scriptName)) fail('script name is invalid');
  if (!['read', 'write'].includes(mode)) fail('operation mode is invalid');
  const arguments = splitArguments(argv);
  if (arguments.flags.has('--delete')) fail('legacy --delete is disabled; use an audited --apply workflow');
  if (!arguments.flags.has('--dry-run')) fail('missing --dry-run preflight acknowledgement');
  const target = validateTarget(
    requiredValue(arguments, '--target-url'),
    requiredValue(arguments, '--target-ref'),
    requiredValue(arguments, '--production-url'),
  );
  const projectId = Number(requiredValue(arguments, '--project-id'));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) fail('project-id is invalid');
  target.projectId = projectId;
  const maxRows = Number(requiredValue(arguments, '--max-rows'));
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS_LIMIT) {
    fail(`max-rows must be an integer from 1 to ${MAX_ROWS_LIMIT}`);
  }
  const actor = requiredValue(arguments, '--actor');
  const reason = requiredValue(arguments, '--reason');
  if (!/^[A-Za-z0-9._@-]{3,120}$/.test(actor)) fail('actor is invalid');
  if (reason.trim().length < 10 || reason.length > 240) fail('reason must be 10-240 characters');
  const exportDir = validateExportDirectory(requiredValue(arguments, '--export-dir'), workspaceRoot);
  if (requiredValue(arguments, '--confirm-export') !== EXPORT_ACK) {
    fail('typed confirmation for approved non-synced export storage is required');
  }
  const applyRequested = arguments.flags.has('--apply');
  if (applyRequested !== (mode === 'write')) {
    fail(mode === 'write' ? 'write mode requires --apply' : '--apply is not valid for a read-only operation');
  }
  if (mode === 'write') {
    const expectedConfirmation = `WRITE:${scriptName}:${target.ref}:${target.projectId}:${maxRows}`;
    if (requiredValue(arguments, '--confirm-write') !== expectedConfirmation) {
      fail(`typed write confirmation must be ${expectedConfirmation}`);
    }
  }
  return Object.freeze({
    scriptName,
    mode,
    apply: mode === 'write',
    target: Object.freeze(target),
    maxRows,
    actor,
    reason,
    exportDir,
    arguments,
    positional: Object.freeze(arguments.positional),
    option(name) { return arguments.values.get(`--${name}`); },
    redact: redactOperationalValue,
    assertBoundedRows(rows, label) { return assertBoundedRows(rows, maxRows, label); },
    exportPath(name) {
      if (typeof name !== 'string' || name !== path.basename(name)) fail('export filename is invalid');
      return path.join(exportDir, name);
    },
  });
}

function defaultLoadEnvironment(rootDir) {
  // @next/env is deliberately invoked only after beginOperation succeeds.
  const { loadEnvConfig } = require('@next/env');
  loadEnvConfig(rootDir);
  return process.env;
}

function createGuardedSupabase(operation, {
  rootDir = process.cwd(),
  loadEnvironment = defaultLoadEnvironment,
  createClientImpl,
  writeAudit,
} = {}) {
  if (!operation?.target?.url) fail('operation preflight is missing');
  const environment = loadEnvironment(rootDir) ?? {};
  const configuredTarget = canonicalUrl(environment.NEXT_PUBLIC_SUPABASE_URL, 'configured target URL');
  const configuredProduction = canonicalUrl(environment.OPERATIONS_PRODUCTION_URL, 'configured Production URL');
  if (configuredTarget !== operation.target.url) fail('configured target URL does not match the explicit target');
  if (configuredProduction !== operation.target.productionUrl) fail('configured Production URL does not match the explicit comparison target');
  if (configuredTarget === configuredProduction) fail('Production and live targets are denied');
  if (typeof environment.SUPABASE_SECRET_KEY !== 'string' || environment.SUPABASE_SECRET_KEY.length < 20) {
    fail('service-role credential is unavailable');
  }
  writeOperationAudit(operation, 'preflight-approved', writeAudit);
  const createClient = createClientImpl ?? require('@supabase/supabase-js').createClient;
  return createClient(configuredTarget, environment.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function appendOperationalAudit(client, operation, action, result = 'success') {
  if (!client || typeof client.rpc !== 'function') fail('audit client is unavailable');
  if (typeof action !== 'string' || !/^operational\.[a-z0-9.-]{1,80}$/.test(action)) {
    fail('operational audit action is invalid');
  }
  const actorHash = redactOperationalValue(operation.actor).slice('redacted:'.length);
  const reasonHash = redactOperationalValue(operation.reason).slice('redacted:'.length);
  const { error } = await client.rpc('app_audit_append', {
    p_actor_user_id: null,
    p_effective_role: 'maintenance',
    p_project_id: operation.target.projectId,
    p_action: action,
    p_resource_type: 'operational_script',
    p_resource_id: operation.scriptName,
    p_result: result,
    p_reason_code: `op-${reasonHash}`,
    p_correlation_id: crypto.randomUUID(),
    p_session_ref: `operator-${actorHash}`,
    p_metadata: {
      targetRef: operation.target.ref,
      actorHash,
      reasonHash,
      maxRows: operation.maxRows,
      mode: operation.mode,
    },
  });
  if (error) fail('remote audit append failed');
}

module.exports = {
  MAX_ROWS_LIMIT,
  beginOperation,
  createGuardedSupabase,
  appendOperationalAudit,
  redactOperationalValue,
  assertBoundedRows,
};
