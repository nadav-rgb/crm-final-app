const REQUIRED = Object.freeze({
  'content-security-policy': (value) => value.includes("frame-ancestors 'none'") && !value.includes('unsafe-eval'),
  'strict-transport-security': (value) => value === 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': (value) => value === 'nosniff',
  'referrer-policy': (value) => value === 'strict-origin-when-cross-origin',
  'permissions-policy': (value) => value === 'camera=(), geolocation=(), payment=(), microphone=(self)',
  'x-frame-options': (value) => value === 'DENY',
  'cache-control': (value) => {
    const directives = new Set(value.toLowerCase().split(',').map((entry) => entry.trim()).filter(Boolean));
    const names = new Set([...directives].map((entry) => entry.split('=', 1)[0].trim()));
    return directives.has('no-store') && directives.has('private')
      && !names.has('public') && !names.has('s-maxage');
  },
});

function exactBaseUrl(value) {
  const parsed = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.origin !== value || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) {
    throw new Error('SECURITY_HTTP_BASE_URL must be an exact HTTPS origin or local HTTP origin');
  }
  return parsed.origin;
}

function nonceFrom(csp) {
  return csp.match(/'nonce-([^']+)'/)?.[1] ?? null;
}

async function verifyResponse(baseUrl, definition) {
  const response = await fetch(`${baseUrl}${definition.path}`, {
    method: definition.method,
    redirect: 'manual',
    headers: definition.headers,
    body: definition.body,
  });
  if (response.status !== definition.expectedStatus) {
    throw new Error(
      `${definition.method} ${definition.path} expected ${definition.expectedStatus}, received ${response.status}`,
    );
  }
  const observed = {};
  for (const [name, predicate] of Object.entries(REQUIRED)) {
    const value = response.headers.get(name) ?? '';
    if (!predicate(value)) throw new Error(`${definition.path} has invalid ${name}`);
    observed[name] = value;
  }
  if (response.headers.get('access-control-allow-origin') === '*') {
    throw new Error(`${definition.path} exposes wildcard CORS`);
  }
  if (response.headers.has('x-powered-by')) throw new Error(`${definition.path} exposes X-Powered-By`);
  const nonce = nonceFrom(observed['content-security-policy']);
  if (definition.checkBodyNonce) {
    const body = await response.text();
    const scripts = body.match(/<script\b[^>]*>/gi) ?? [];
    if (scripts.length === 0 || scripts.some((tag) => !tag.includes(`nonce="${nonce}"`))) {
      throw new Error(`${definition.path} scripts do not share the response CSP nonce`);
    }
  }
  process.stdout.write(`${definition.method} ${definition.path} ${response.status}\n`);
  for (const [name, value] of Object.entries(observed)) process.stdout.write(`${name}: ${value}\n`);
  return nonce;
}

export async function verifyHttp(baseUrl = process.env.SECURITY_HTTP_BASE_URL) {
  if (!baseUrl) throw new Error('SECURITY_HTTP_BASE_URL is required');
  const origin = exactBaseUrl(baseUrl);
  const checks = [
    { method: 'GET', path: '/', expectedStatus: 200, checkBodyNonce: true },
    { method: 'GET', path: '/api/auth/session', expectedStatus: 401 },
    {
      method: 'POST', path: '/api/auth/logout', expectedStatus: 403,
      headers: { 'content-type': 'application/json', origin: 'https://invalid.example' }, body: '{}',
    },
    { method: 'GET', path: '/__security_missing__', expectedStatus: 404, checkBodyNonce: true },
    { method: 'GET', path: '/500', expectedStatus: 500, checkBodyNonce: true },
  ];
  const nonces = [];
  for (const check of checks) nonces.push(await verifyResponse(origin, check));
  if (nonces.some((nonce) => !nonce) || new Set(nonces).size !== nonces.length) {
    throw new Error('CSP nonce is absent or reused across responses');
  }
  process.stdout.write('http-security verification: PASS\n');
  process.stdout.write('hsts-preload: CODE_PRESENT_STAGING_VERIFICATION_REQUIRED\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyHttp().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
import { pathToFileURL } from 'node:url';
