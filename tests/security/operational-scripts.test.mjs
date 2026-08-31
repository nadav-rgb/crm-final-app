import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  appendOperationalAudit,
  beginOperation,
  createGuardedSupabase,
  redactOperationalValue,
} from '../../scripts/security/operational-guard.cjs';

const safeArguments = (extra = []) => [
  '--target-url=https://testproject.supabase.co',
  '--target-ref=testproject',
  '--project-id=17',
  '--production-url=https://productionproject.supabase.co',
  '--export-dir=C:\\SecureExports',
  '--confirm-export=APPROVED_NON_SYNCED_ENCRYPTED',
  '--actor=security.operator',
  '--reason=deterministic security verification',
  '--max-rows=25',
  '--dry-run',
  ...extra,
];
const replaceOption = (argumentsList, name, value) => argumentsList
  .filter((argument) => !argument.startsWith(`${name}=`))
  .concat(`${name}=${value}`);

test('operational preflight refuses before environment loading unless the complete explicit target contract is supplied', () => {
  let environmentLoaded = false;
  assert.throws(() => beginOperation({ scriptName: 'debug-payment', argv: [] }), /dry-run|target-url/);
  assert.equal(environmentLoaded, false);

  const operation = beginOperation({ scriptName: 'debug-payment', argv: safeArguments() });
  assert.equal(operation.target.ref, 'testproject');
  assert.equal(operation.target.projectId, 17);
  assert.equal(operation.maxRows, 25);
  assert.equal(operation.apply, false);

  const client = createGuardedSupabase(operation, {
    rootDir: process.cwd(),
    loadEnvironment: () => {
      environmentLoaded = true;
      return {
        NEXT_PUBLIC_SUPABASE_URL: 'https://testproject.supabase.co',
        SUPABASE_SECRET_KEY: 'synthetic-service-role-key',
        OPERATIONS_PRODUCTION_URL: 'https://productionproject.supabase.co',
      };
    },
    createClientImpl: (url, key) => ({ url, key }),
    writeAudit: () => {},
  });
  assert.equal(environmentLoaded, true);
  assert.deepEqual(client, {
    url: 'https://testproject.supabase.co', key: 'synthetic-service-role-key',
  });
});

test('operational preflight rejects Production, synced exports, unbounded reads, and unconfirmed writes', () => {
  const productionTargetArguments = replaceOption(
    replaceOption(safeArguments(), '--target-url', 'https://productionproject.supabase.co'),
    '--target-ref', 'productionproject',
  );
  assert.throws(() => beginOperation({ scriptName: 'debug-payment', argv: productionTargetArguments }), /Production/);
  assert.throws(() => beginOperation({ scriptName: 'debug-payment', argv: replaceOption(
    safeArguments(), '--export-dir', 'C:\\Users\\operator\\OneDrive\\Exports',
  ) }), /non-synced/);
  assert.throws(() => beginOperation({ scriptName: 'debug-payment', argv: replaceOption(
    safeArguments(), '--max-rows', '10001',
  ) }), /max-rows/);
  assert.throws(() => beginOperation({ scriptName: 'find-duplicate-interactions', mode: 'write', argv: safeArguments([
    '--apply',
  ]) }), /confirm-write/);
  assert.throws(() => beginOperation({ scriptName: 'find-duplicate-interactions', mode: 'write', argv: safeArguments([
    '--apply', '--confirm-write=wrong',
  ]) }), /typed/);

  const operation = beginOperation({
    scriptName: 'find-duplicate-interactions',
    mode: 'write',
    argv: safeArguments([
      '--apply', '--confirm-write=WRITE:find-duplicate-interactions:testproject:17:25',
    ]),
  });
  assert.equal(operation.apply, true);
});

test('central guard binds the post-preflight environment to the approved target and redacts operator-visible values', () => {
  const operation = beginOperation({ scriptName: 'compare-payment-impact', argv: safeArguments() });
  assert.throws(() => createGuardedSupabase(operation, {
    rootDir: process.cwd(),
    loadEnvironment: () => ({
      NEXT_PUBLIC_SUPABASE_URL: 'https://anotherproject.supabase.co',
      SUPABASE_SECRET_KEY: 'synthetic-service-role-key',
      OPERATIONS_PRODUCTION_URL: 'https://productionproject.supabase.co',
    }),
    createClientImpl: () => { throw new Error('client creation must not occur'); },
    writeAudit: () => {},
  }), /does not match/);
  assert.match(redactOperationalValue('private-name-or-phone'), /^redacted:[a-f0-9]{12}$/);
  assert.doesNotMatch(redactOperationalValue('private-name-or-phone'), /private-name-or-phone/);
});

test('central guard emits a fail-closed redacted remote audit contract before a privileged data operation', async () => {
  const operation = beginOperation({ scriptName: 'debug-payment', argv: safeArguments() });
  const calls = [];
  await appendOperationalAudit({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { error: null };
    },
  }, operation, 'operational.debug-payment.read');
  assert.equal(calls[0].name, 'app_audit_append');
  assert.equal(calls[0].args.p_project_id, 17);
  assert.equal(calls[0].args.p_action, 'operational.debug-payment.read');
  assert.equal(calls[0].args.p_effective_role, 'maintenance');
  assert.doesNotMatch(JSON.stringify(calls[0].args), /security\.operator|deterministic security verification/);
  await assert.rejects(() => appendOperationalAudit({
    rpc: async () => ({ error: { message: 'synthetic failure' } }),
  }, operation, 'operational.debug-payment.read'), /remote audit append failed/);
});

test('every privileged script uses only the central guarded client and declares bounded, redacted operation handling', async () => {
  const scripts = [
    'scripts/debug-payment.cjs',
    'scripts/compare-payment-impact.cjs',
    'scripts/find-duplicate-interactions.cjs',
    'scripts/mark-feedback-reviewed.cjs',
    'scripts/generate-interaction-report-files.cjs',
    'scripts/verify-month-report.cjs',
    'scripts/verify-payroll-xlsx.cjs',
  ];
  for (const script of scripts) {
    const source = await readFile(new URL(`../../${script}`, import.meta.url), 'utf8');
    assert.match(source, /beginOperation/);
    assert.match(source, /createGuardedSupabase/);
    assert.match(source, /appendOperationalAudit/);
    assert.match(source, /maxRows|assertBoundedRows/);
    assert.match(source, /redactOperationalValue|redact/);
    assert.doesNotMatch(source, /readFileSync\(['"]\.env\.local['"]\)/);
    assert.doesNotMatch(source, /require\(['"]@supabase\/supabase-js['"]\)/);
    assert.doesNotMatch(source, /createClient\(/);
  }
});

test('each privileged entrypoint rejects default invocation before it can load a target environment or contact Supabase', () => {
  const scripts = [
    'scripts/debug-payment.cjs',
    'scripts/compare-payment-impact.cjs',
    'scripts/find-duplicate-interactions.cjs',
    'scripts/mark-feedback-reviewed.cjs',
    'scripts/generate-interaction-report-files.cjs',
    'scripts/verify-month-report.cjs',
    'scripts/verify-payroll-xlsx.cjs',
  ];
  for (const script of scripts) {
    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, script);
    assert.match(output, /Operational guard refused/);
    assert.doesNotMatch(output, /\.env\.local|ENOENT/i);
  }
});
