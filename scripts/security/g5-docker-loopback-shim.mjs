import path from 'node:path';

const PROJECT_ID = /^mekarvim-security-g5-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PUBLISH_FLAGS = new Set(['-p', '--publish']);

function refuse() {
  throw new Error('G5 Docker loopback shim refused command');
}

function exactProjectIdentity(args, projectId) {
  const expectedLabel = `com.supabase.cli.project=${projectId}`;
  let name = null;
  let labelled = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--name') name = args[index + 1] ?? null;
    else if (arg.startsWith('--name=')) name = arg.slice('--name='.length);
    if (arg === '--label' && args[index + 1] === expectedLabel) labelled = true;
    else if (arg === `--label=${expectedLabel}`) labelled = true;
  }
  const escapedProject = projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!labelled || !new RegExp(`^supabase_[a-z0-9_]+_${escapedProject}$`).test(name ?? '')) refuse();
}

function rewriteMapping(value, allowedPorts) {
  const match = /^(?:(127\.0\.0\.1):)?(\d+):(\d+)(\/(?:tcp|udp))?$/.exec(value ?? '');
  if (!match) refuse();
  const hostPort = Number(match[2]);
  const containerPort = Number(match[3]);
  if (!allowedPorts.has(hostPort)
    || !Number.isSafeInteger(containerPort) || containerPort < 1 || containerPort > 65535) refuse();
  return `127.0.0.1:${hostPort}:${containerPort}${match[4] ?? ''}`;
}

export function rewriteDockerPublishArgs(args, { projectId, allowedPorts }) {
  if (!Array.isArray(args) || !PROJECT_ID.test(projectId ?? '') || !Array.isArray(allowedPorts)) refuse();
  const allowed = new Set(allowedPorts.map(Number));
  if (!allowed.size || [...allowed].some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65535)) refuse();

  let published = false;
  const rewritten = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (PUBLISH_FLAGS.has(arg)) {
      const mapping = args[index + 1];
      if (mapping == null) refuse();
      rewritten.push(arg, rewriteMapping(mapping, allowed));
      index += 1;
      published = true;
      continue;
    }
    if (arg.startsWith('--publish=')) {
      rewritten.push(`--publish=${rewriteMapping(arg.slice('--publish='.length), allowed)}`);
      published = true;
      continue;
    }
    rewritten.push(arg);
  }
  if (published) {
    if (!['create', 'run'].includes(args[0])) refuse();
    exactProjectIdentity(args, projectId);
  }
  return rewritten;
}

async function main() {
  if (process.env.G5_DOCKER_LOOPBACK_SHIM_ACTIVE !== 'true') refuse();
  const realDocker = process.env.G5_DOCKER_REAL_EXECUTABLE;
  const projectId = process.env.G5_DOCKER_EXPECTED_PROJECT_ID;
  const allowedPorts = (process.env.G5_DOCKER_ALLOWED_PUBLISH_PORTS ?? '')
    .split(',').filter(Boolean).map(Number);
  if (!path.isAbsolute(realDocker ?? '')
    || path.basename(realDocker).toLowerCase() !== 'docker.exe'
    || path.resolve(realDocker) === path.resolve(process.execPath)) refuse();
  const args = rewriteDockerPublishArgs(process.argv.slice(2), { projectId, allowedPorts });
  if (typeof globalThis.Bun?.spawn !== 'function') refuse();
  const child = globalThis.Bun.spawn([realDocker, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exitCode = await child.exited;
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    process.stderr.write('G5 Docker loopback shim refused command\n');
    process.exitCode = 64;
  }
}
