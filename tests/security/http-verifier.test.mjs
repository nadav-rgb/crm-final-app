import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { verifyHttp } from '../../scripts/security/verify-http.mjs';

function securityHeaders(nonce) {
  return {
    'content-security-policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; frame-ancestors 'none'`,
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), geolocation=(), payment=(), microphone=(self)',
    'x-frame-options': 'DENY',
    'cache-control': 'no-store, private',
    'content-type': 'text/html; charset=utf-8',
  };
}

async function withFixture(statuses, callback) {
  const requests = [];
  let nonceIndex = 0;
  const server = createServer((req, res) => {
    const key = `${req.method} ${req.url}`;
    requests.push(key);
    const nonce = `fixture-nonce-${++nonceIndex}`;
    res.writeHead(statuses[key] ?? 500, securityHeaders(nonce));
    res.end(`<!doctype html><script nonce="${nonce}"></script>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('HTTP verifier rejects an unintended 500 instead of accepting it as an auth denial', async () => {
  await withFixture({
    'GET /': 200,
    'GET /api/auth/session': 500,
    'POST /api/auth/logout': 500,
    'GET /__security_missing__': 404,
    'GET /500': 500,
  }, async (baseUrl) => {
    await assert.rejects(
      () => verifyHttp(baseUrl),
      /GET \/api\/auth\/session expected 401, received 500/,
    );
  });
});

test('HTTP verifier exercises exact 200, 401, 403, 404, and 500 responses', async () => {
  await withFixture({
    'GET /': 200,
    'GET /api/auth/session': 401,
    'POST /api/auth/logout': 403,
    'GET /__security_missing__': 404,
    'GET /500': 500,
  }, async (baseUrl, requests) => {
    await verifyHttp(baseUrl);
    assert.deepEqual(requests, [
      'GET /',
      'GET /api/auth/session',
      'POST /api/auth/logout',
      'GET /__security_missing__',
      'GET /500',
    ]);
  });
});
