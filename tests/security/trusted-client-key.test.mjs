import test from 'node:test';
import assert from 'node:assert/strict';
import { clientKey } from '../../pages/api/auth/_shared.mjs';
import { buildRateLimitKey } from '../../lib/security/auth-service.mjs';

function request({ headers = {}, remoteAddress = '203.0.113.77' } = {}) {
  return { headers, socket: { remoteAddress } };
}

test('trusted Vercel client address is canonicalized while caller-supplied XFF is ignored', () => {
  assert.equal(clientKey(request({
    headers: {
      'x-vercel-forwarded-for': '198.51.100.203',
      'x-forwarded-for': '192.0.2.9, 192.0.2.10',
    },
  }), { isVercel: true }), 'ip4:198.51.100.0/24');

  assert.equal(clientKey(request({
    headers: { 'x-forwarded-for': '198.51.100.203, 198.51.100.204' },
  })), 'ip4:203.0.113.0/24');
});

test('trusted client key bounds IPv6 and refuses ambiguous forwarded values', () => {
  assert.equal(clientKey(request({
    headers: { 'x-vercel-forwarded-for': '2001:db8:abcd:12ff::beef' },
  }), { isVercel: true }), 'ip6:2001:0db8:abcd:1200::/56');

  assert.equal(clientKey(request({
    headers: { 'x-vercel-forwarded-for': '198.51.100.1, 198.51.100.2' },
    remoteAddress: '2001:db8:ffff:ab12::1',
  }), { isVercel: true }), 'ip6:2001:0db8:ffff:ab00::/56');

  assert.equal(clientKey(request({
    headers: { 'x-vercel-forwarded-for': '198.51.100.203' },
  })), 'ip4:203.0.113.0/24');
});

test('rate limit keys combine a canonical network bucket with opaque identity and session buckets', () => {
  const baseline = buildRateLimitKey({
    networkKey: 'ip4:198.51.100.0/24', identity: 'Head Account', session: 'session-secret-a',
  });
  assert.match(baseline, /^network=ip4:198\.51\.100\.0\/24\|identity=sha256:[A-Za-z0-9_-]{24}\|session=sha256:[A-Za-z0-9_-]{24}$/);
  assert.doesNotMatch(baseline, /Head Account|session-secret-a/);
  assert.notEqual(baseline, buildRateLimitKey({
    networkKey: 'ip4:198.51.100.0/24', identity: 'Other Account', session: 'session-secret-a',
  }));
  assert.notEqual(baseline, buildRateLimitKey({
    networkKey: 'ip4:198.51.100.0/24', identity: 'Head Account', session: 'session-secret-b',
  }));
  assert.match(buildRateLimitKey({ networkKey: 'untrusted-caller-text', identity: 'Head Account' }), /^network=ip:unknown\|identity=/);
});
