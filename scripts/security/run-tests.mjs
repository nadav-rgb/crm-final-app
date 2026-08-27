import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();
const securityRoot = path.resolve(repoRoot, 'tests/security');

export function normalizeTestPath(value) {
  const candidate = path.resolve(repoRoot, value);
  const relativeToSecurity = path.relative(securityRoot, candidate);

  if (
    relativeToSecurity.startsWith('..') ||
    path.isAbsolute(relativeToSecurity) ||
    !candidate.endsWith('.test.mjs')
  ) {
    throw new Error('invalid security test path');
  }

  return path.relative(repoRoot, candidate).replaceAll('\\', '/');
}

export async function main(requested = process.argv.slice(2)) {
  const discovered = requested.length
    ? requested
    : (await readdir(securityRoot, { recursive: true }))
        .filter((value) => value.endsWith('.test.mjs'))
        .map((value) => path.join('tests/security', value));

  const files = discovered.map(normalizeTestPath).sort();
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...files],
    { stdio: 'inherit' },
  );

  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main();
}
