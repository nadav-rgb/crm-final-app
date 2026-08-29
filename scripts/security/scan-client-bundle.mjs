import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLIENT_FORBIDDEN = Object.freeze([
  ['service-key-name', /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/g],
  ['server-secret-name', /SESSION_TOKEN_ENCRYPTION_KEY|SESSION_ID_PEPPER|CRON_SECRET|VAPID_PRIVATE_KEY|ANTHROPIC_API_KEY|FCM_SERVICE_ACCOUNT|SHEETS_SERVICE_ACCOUNT|GITHUB_TOKEN/g],
  ['github-token', /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g],
  ['anthropic-key', /sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['legacy-user-directory', /USERNAME_TO_EMAIL|achdut-crm\.test/g],
  ['demo-password', /ceo123|coord123|activist123/g],
  ['bearer-token', /Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
]);

async function filesBelow(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) output.push(...await filesBelow(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

export async function scanClientBundle({ root = process.cwd() } = {}) {
  const repositoryRoot = path.resolve(root);
  const staticRoot = path.resolve(repositoryRoot, '.next/static');
  if (!staticRoot.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error('client scan path escaped repository');
  const details = await stat(staticRoot).catch(() => null);
  if (!details?.isDirectory()) {
    return { ok: false, findings: [{ category: 'bundle-missing', file: '.next/static' }] };
  }

  const findings = [];
  for (const file of await filesBelow(staticRoot)) {
    const content = await readFile(file, 'utf8').catch(() => '');
    for (const [category, expression] of CLIENT_FORBIDDEN) {
      const pattern = new RegExp(expression.source, expression.flags);
      if (!pattern.test(content)) continue;
      findings.push({ category, file: path.relative(repositoryRoot, file).replaceAll('\\', '/') });
    }
  }
  return { ok: findings.length === 0, findings };
}

async function main() {
  const result = await scanClientBundle();
  for (const finding of result.findings) process.stdout.write(`${finding.category} ${finding.file}\n`);
  if (result.ok) process.stdout.write('client-bundle clean\n');
  process.exitCode = result.ok ? 0 : 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) await main();
