import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContentSecurityPolicy,
  createNonce,
  securityHeaderEntries,
} from '../../middleware.js';
import { assertSameOrigin, sendJson } from '../../lib/security/http.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

function responseRecorder() {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('CSP is nonce-bound, restrictive and unique per request', () => {
  const first = createNonce();
  const second = createNonce();
  assert.notEqual(first, second);
  const csp = buildContentSecurityPolicy(first, { production: true });
  assert.equal(csp.includes(`script-src 'self' 'nonce-${first}'`), true);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*\*/);
  assert.throws(() => buildContentSecurityPolicy("bad'; report-uri https://invalid"));
});

test('common browser and transport headers are exact and contain no wildcard CORS', () => {
  const entries = new Map(securityHeaderEntries('QUJDREVGR0hJSktMTU5PUA==', { production: true }));
  assert.equal(entries.get('Strict-Transport-Security'), 'max-age=63072000; includeSubDomains; preload');
  assert.equal(entries.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(entries.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(entries.get('Permissions-Policy'), 'camera=(), geolocation=(), payment=(), microphone=(self)');
  assert.equal(entries.get('X-Frame-Options'), 'DENY');
  assert.equal(entries.get('Cache-Control'), 'no-store, private');
  assert.equal(entries.has('Access-Control-Allow-Origin'), false);
});

test('cookie mutations accept only the exact configured origin and never a wildcard', () => {
  assert.doesNotThrow(() => assertSameOrigin({ method: 'POST', headers: { origin: 'https://crm.example.test' } }, {
    appOrigin: 'https://crm.example.test',
  }));
  for (const origin of ['*', 'https://evil.example', 'https://crm.example.test.evil', 'https://crm.example.test/']) {
    assert.throws(() => assertSameOrigin({ method: 'POST', headers: { origin } }, {
      appOrigin: 'https://crm.example.test',
    }), (error) => error?.code === 'ORIGIN_DENIED');
  }
});

test('JSON responses are private and non-cacheable for success and every error class', () => {
  for (const status of [200, 401, 403, 404, 500]) {
    const res = responseRecorder();
    sendJson(res, status, { ok: status === 200 }, { requestId: `status-${status}` });
    assert.equal(res.headers.get('cache-control'), 'no-store, private');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.statusCode, status);
  }
});

test('Next document consumes the middleware nonce and framework disclosure is disabled', async () => {
  const documentSource = await readFile(path.join(root, 'pages/_document.jsx'), 'utf8');
  const appSource = await readFile(path.join(root, 'pages/_app.jsx'), 'utf8');
  const nextConfig = await readFile(path.join(root, 'next.config.js'), 'utf8');
  const verifier = await readFile(path.join(root, 'scripts/security/verify-http.mjs'), 'utf8');
  const notFound = await readFile(path.join(root, 'pages/[...notFound].jsx'), 'utf8');
  assert.match(documentSource, /x-nonce/);
  assert.match(documentSource, /<NextScript nonce=\{nonce\}/);
  assert.match(appSource, /App\.getInitialProps/);
  assert.match(nextConfig, /poweredByHeader:\s*false/);
  assert.match(nextConfig, /Cache-Control['"],\s*value:\s*['"]no-store, private/);
  assert.match(verifier, /SECURITY_HTTP_BASE_URL/);
  assert.match(verifier, /scripts do not share the response CSP nonce/);
  assert.match(notFound, /statusCode\s*=\s*404/);
  assert.match(notFound, /no-store, private/);
  assert.doesNotMatch(nextConfig, /Access-Control-Allow-Origin['"\s,:]+\*/);
});
