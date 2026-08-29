import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatFinding,
  resolveInsideRoot,
  scanGitHistory,
  scanText,
} from '../../scripts/security/scan-secrets.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('secret findings contain category, location, line and hash prefix but never the value', () => {
  const synthetic = `ghp_${'A'.repeat(36)}`;
  const findings = scanText(`GITHUB_TOKEN=${synthetic}\n`, {
    file: 'synthetic.env', source: 'current',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'github-token');
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].hashPrefix, /^[a-f0-9]{10}$/);
  const output = formatFinding(findings[0]);
  assert.match(output, /github-token current synthetic\.env:1 hash=[a-f0-9]{10} rotation=required/);
  assert.doesNotMatch(output, /ghp_|A{12}/);
  assert.doesNotMatch(JSON.stringify(findings), /ghp_|A{12}/);
});

test('scanner path resolution cannot escape the selected repository', () => {
  assert.throws(() => resolveInsideRoot(root, '../outside.txt'));
  assert.equal(resolveInsideRoot(root, 'package.json'), path.join(root, 'package.json'));
});

test('history scanner detects a removed synthetic credential without returning its value', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mekarvim-history-scan-'));
  const synthetic = `sk-ant-api03-${'B'.repeat(48)}`;
  try {
    execFileSync('git', ['init', '-q'], { cwd: temporary });
    execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: temporary });
    execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: temporary });
    await writeFile(path.join(temporary, 'config.txt'), `ANTHROPIC_API_KEY=${synthetic}\n`);
    execFileSync('git', ['add', 'config.txt'], { cwd: temporary });
    execFileSync('git', ['commit', '-qm', 'synthetic secret fixture'], { cwd: temporary });
    await writeFile(path.join(temporary, 'config.txt'), 'ANTHROPIC_API_KEY=\n');
    execFileSync('git', ['commit', '-qam', 'remove synthetic fixture'], { cwd: temporary });
    const findings = scanGitHistory({ root: temporary });
    assert.equal(findings.some((finding) => finding.category === 'anthropic-key'), true);
    assert.doesNotMatch(JSON.stringify(findings), /sk-ant-api03|B{12}/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('repository ignore and environment contracts exclude local secrets and generated artifacts', async () => {
  const ignore = await readFile(path.join(root, '.gitignore'), 'utf8');
  const example = await readFile(path.join(root, '.env.example'), 'utf8');
  for (const rule of [
    '.env.*', '!.env.example', '.next/', 'coverage/', '*.log', 'reports/*.pdf',
    'reports/*.xlsx', 'android/*.jks', 'android/*.keystore', 'android/key.properties',
  ]) assert.equal(ignore.split(/\r?\n/).includes(rule), true, `missing ignore rule ${rule}`);
  assert.match(example, /^APP_ORIGIN=$/m);
  assert.match(example, /^SUPABASE_SERVICE_ROLE_KEY=$/m);
  assert.match(example, /^SESSION_TOKEN_ENCRYPTION_KEY_V1=$/m);
  assert.match(example, /^CRON_SECRET=$/m);
  assert.doesNotMatch(example, /=\S+/);
});

test('client scanner covers every server-only credential name and prints no matches', async () => {
  const source = await readFile(path.join(root, 'scripts/security/scan-client-bundle.mjs'), 'utf8');
  for (const name of [
    'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_TOKEN_ENCRYPTION_KEY', 'SESSION_ID_PEPPER',
    'CRON_SECRET', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY',
  ]) assert.match(source, new RegExp(name));
  assert.doesNotMatch(source, /match\[0\]|\.match\(/);
});
