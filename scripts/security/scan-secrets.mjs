import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECIFIC_PATTERNS = Object.freeze([
  ['github-token', /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g],
  ['anthropic-key', /sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
]);

const SERVER_SECRET_ASSIGNMENT = new RegExp(
  String.raw`\b(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SESSION_ID_PEPPER|SESSION_TOKEN_ENCRYPTION_KEY_V\d+|CRON_SECRET|VAPID_PRIVATE_KEY|FCM_SERVICE_ACCOUNT|SHEETS_SERVICE_ACCOUNT|GITHUB_TOKEN|ANTHROPIC_API_KEY)\b[ \t]*(?:=[ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'\x60,;]+))|:[ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'))`,
  'g',
);

const SKIPPED_DIRECTORIES = new Set([
  '.git', '.next', 'node_modules', 'coverage', 'dist', 'build',
]);
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

function safeRelative(root, absolute) {
  return path.relative(root, absolute).replaceAll('\\', '/');
}

function lineAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function hashPrefix(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function credentialLike(value, name) {
  if (value.length < 16) return false;
  if (/^(?:undefined|null|example|placeholder|changeme|synthetic|dummy|fake|test)(?:[-_].*)?$/i.test(value)) return false;
  if (value.includes('example.invalid')) return false;
  if (value.includes('${') || value.includes('{{') || value.includes('<')) return false;
  if (name === 'FCM_SERVICE_ACCOUNT' || name === 'SHEETS_SERVICE_ACCOUNT') {
    return value.includes('private_key') || value.length >= 100;
  }
  return true;
}

function makeFinding({ category, source, file, line, value, commit }) {
  return Object.freeze({
    category,
    source,
    file,
    line,
    hashPrefix: hashPrefix(value),
    rotation: 'required',
    ...(commit ? { commit } : {}),
  });
}

export function scanText(text, {
  file = '<memory>', source = 'current', startingLine = 1, commit,
} = {}) {
  const findings = [];
  const seenHashes = new Set();

  for (const [category, expression] of SPECIFIC_PATTERNS) {
    const pattern = new RegExp(expression.source, expression.flags);
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const digest = hashPrefix(value);
      if (seenHashes.has(digest)) continue;
      seenHashes.add(digest);
      findings.push(makeFinding({
        category,
        source,
        file,
        line: startingLine + lineAt(text, match.index) - 1,
        value,
        commit,
      }));
    }
  }

  for (const match of text.matchAll(new RegExp(SERVER_SECRET_ASSIGNMENT.source, 'g'))) {
    const value = match.slice(2).find(Boolean);
    if (!credentialLike(value, match[1])) continue;
    const digest = hashPrefix(value);
    if (seenHashes.has(digest)) continue;
    seenHashes.add(digest);
    findings.push(makeFinding({
      category: 'server-secret-assignment',
      source,
      file,
      line: startingLine + lineAt(text, match.index) - 1,
      value,
      commit,
    }));
  }

  return findings;
}

export function formatFinding(finding) {
  const commit = finding.commit ? ` commit=${finding.commit}` : '';
  return `${finding.category} ${finding.source} ${finding.file}:${finding.line}${commit} hash=${finding.hashPrefix} rotation=${finding.rotation}`;
}

export function resolveInsideRoot(root, candidate) {
  const repositoryRoot = path.resolve(root);
  const absolute = path.resolve(repositoryRoot, candidate);
  if (absolute !== repositoryRoot && !absolute.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('secret scan path escaped repository');
  }
  return absolute;
}

async function readTextFile(absolute) {
  const details = await stat(absolute).catch(() => null);
  if (!details?.isFile() || details.size > MAX_TEXT_FILE_BYTES) return null;
  const content = await readFile(absolute).catch(() => null);
  if (!content || content.includes(0)) return null;
  return content.toString('utf8');
}

async function filesBelow(root, directory = root) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === '.git') continue;
    const absolute = resolveInsideRoot(root, path.join(directory, entry.name));
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) output.push(...await filesBelow(root, absolute));
    } else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

function deduplicate(findings) {
  const unique = new Map();
  for (const finding of findings) {
    const key = [finding.category, finding.source, finding.file, finding.line, finding.commit, finding.hashPrefix].join('|');
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()];
}

export async function scanCurrentFiles({ root = process.cwd() } = {}) {
  const repositoryRoot = path.resolve(root);
  const findings = [];
  for (const absolute of await filesBelow(repositoryRoot)) {
    const content = await readTextFile(absolute);
    if (content === null) continue;
    findings.push(...scanText(content, {
      source: 'current', file: safeRelative(repositoryRoot, absolute),
    }));
  }
  return deduplicate(findings);
}

export async function scanTrackedFiles({ root = process.cwd() } = {}) {
  const repositoryRoot = path.resolve(root);
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const findings = [];
  for (const file of listed.split('\0').filter(Boolean)) {
    const absolute = resolveInsideRoot(repositoryRoot, file);
    const content = await readTextFile(absolute);
    if (content === null) continue;
    findings.push(...scanText(content, { source: 'tracked', file: file.replaceAll('\\', '/') }));
  }
  return deduplicate(findings);
}

export function scanGitHistory({ root = process.cwd() } = {}) {
  const repositoryRoot = path.resolve(root);
  const patch = execFileSync('git', [
    'log', '-p', '--all', '--no-ext-diff', '--unified=0', '--format=commit %H',
  ], {
    cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const findings = [];
  let commit = '';
  let file = '<unknown>';
  let addedLine = 0;

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('commit ')) {
      commit = line.slice(7, 19);
      continue;
    }
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      addedLine = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      findings.push(...scanText(line.slice(1), {
        source: 'history', file, startingLine: addedLine, commit,
      }));
      addedLine += 1;
      continue;
    }
    if (line.startsWith(' ')) addedLine += 1;
  }
  return deduplicate(findings);
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const useDefaults = flags.size === 0;
  const findings = [];
  if (useDefaults || flags.has('--current')) findings.push(...await scanCurrentFiles());
  if (useDefaults || flags.has('--tracked')) findings.push(...await scanTrackedFiles());
  if (flags.has('--history')) findings.push(...scanGitHistory());
  const unique = deduplicate(findings);
  for (const finding of unique) process.stdout.write(`${formatFinding(finding)}\n`);
  if (unique.length === 0) process.stdout.write('secret-scan clean\n');
  process.exitCode = unique.length === 0 ? 0 : 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) await main();
