import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createLocalPostgresAdapter } from '../../scripts/security/g5-local-orchestrator.mjs';
import { generateTotpCode } from '../../scripts/security/provision-test-fixtures.mjs';
import { loadVerifiedLocalTarget } from '../../scripts/security/verify-rls-live.mjs';

const enabled = process.env.SECURITY_TEST_CONFIRM_ISOLATED === 'true';
const live = { skip: enabled ? false : 'requires confirmed isolated G5 loopback target' };

function loadSessionFixture() {
  const target = loadVerifiedLocalTarget();
  const { targetUrl } = target;
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  const fixture = JSON.parse(process.env.SECURITY_TEST_SESSION_FIXTURE ?? '{}');
  const bff = new URL(process.env.SECURITY_TEST_BFF_ORIGIN ?? '');
  const expectedBffPort = Number(process.env.SECURITY_TEST_BFF_PORT);
  if (!publishableKey || !fixture.tokens || !fixture.credentials || !fixture.resources?.actorIds
    || bff.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(bff.hostname)
    || bff.pathname !== '/' || bff.search || bff.hash || !bff.port
    || Number(bff.port) !== expectedBffPort) {
    throw new Error('isolated session fixture is incomplete');
  }
  return { targetUrl, publishableKey, fixture, target, bffOrigin: bff.origin };
}

function localDatabase(target) {
  const dockerExecutable = process.env.SECURITY_TEST_DOCKER_CLI;
  assert.ok(dockerExecutable, 'absolute local Docker CLI path missing');
  return createLocalPostgresAdapter({
    repoRoot: process.cwd(),
    target: target.safety,
    dockerExecutable,
  });
}

async function bffRequest(bffOrigin, path, {
  method = 'GET', cookie, csrf, origin = bffOrigin, body,
} = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${bffOrigin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* status is the evidence */ }
  return {
    status: response.status,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? null,
  };
}

async function login(bffOrigin, credential) {
  const response = await bffRequest(bffOrigin, '/api/auth/login', {
    method: 'POST', body: { username: credential.username, password: credential.password },
  });
  assert.equal(response.status, 200, 'local BFF login did not create an opaque session');
  assert.ok(response.cookie && response.payload?.csrfToken, 'local BFF session contract is incomplete');
  return { cookie: response.cookie, csrf: response.payload.csrfToken, payload: response.payload };
}

test('disabled-user JWT cannot read protected rows', live, async () => {
  const { targetUrl, publishableKey, fixture } = loadSessionFixture();
  for (const actor of ['disabled']) {
    const client = createClient(targetUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${fixture.tokens[actor]}` } },
    });
    const { data, error } = await client.from('contacts').select('id').limit(1);
    assert.ok(error || data?.length === 0, `${actor} unexpectedly retained data access`);
  }
});

test('AAL1 privileged roles are denied while AAL2 is exercised separately', live, async () => {
  const { targetUrl, publishableKey, fixture } = loadSessionFixture();
  for (const actor of ['ceoAal1', 'headAal1']) {
    const client = createClient(targetUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${fixture.tokens[actor]}` } },
    });
    const { error } = await client.rpc('app_finance_summary', {
      p_period: fixture.resources.period,
      p_project_id: fixture.resources.projectA,
      p_user_id: null,
    });
    assert.ok(error, `${actor} unexpectedly crossed the AAL2 boundary`);
  }
});

test('local BFF measures expiry, logout replay, rotation, privilege transition and disabled-user denial', live, async () => {
  const { fixture, target, bffOrigin } = loadSessionFixture();
  const database = localDatabase(target);

  const expired = await login(bffOrigin, fixture.credentials.activistA1);
  await database.expireSessionsForUser(fixture.resources.actorIds.activistA1);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/session', { cookie: expired.cookie })).status, 401);

  const logout = await login(bffOrigin, fixture.credentials.activistA1);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/logout', {
    method: 'POST', cookie: logout.cookie, csrf: logout.csrf, body: {},
  })).status, 200);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/session', { cookie: logout.cookie })).status, 401);

  const rotating = await login(bffOrigin, fixture.credentials.activistA1);
  const rotated = await bffRequest(bffOrigin, '/api/auth/session', { cookie: rotating.cookie });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.cookie && rotated.cookie !== rotating.cookie, 'resume did not rotate the opaque cookie');
  assert.equal((await bffRequest(bffOrigin, '/api/auth/session', { cookie: rotating.cookie })).status, 401);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/session', { cookie: rotated.cookie })).status, 200);

  const stale = await login(bffOrigin, fixture.credentials.activistA2);
  await database.bumpSecurityVersion(fixture.resources.actorIds.activistA2);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/session', { cookie: stale.cookie })).status, 401);

  const disabled = await login(bffOrigin, fixture.credentials.activistB1);
  await database.disableProfile(fixture.resources.actorIds.activistB1);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/session', { cookie: disabled.cookie })).status, 401);
});

test('local BFF measures foreign-origin CSRF, token mismatch and shared login rate limit', live, async () => {
  const { fixture, bffOrigin } = loadSessionFixture();
  const csrf = await login(bffOrigin, fixture.credentials.coordA);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/logout', {
    method: 'POST', cookie: csrf.cookie, csrf: csrf.csrf,
    origin: 'https://foreign.invalid', body: {},
  })).status, 403);
  assert.equal((await bffRequest(bffOrigin, '/api/auth/logout', {
    method: 'POST', cookie: csrf.cookie, csrf: 'mismatched-csrf-token-value', body: {},
  })).status, 403);

  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await bffRequest(bffOrigin, '/api/auth/login', {
      method: 'POST',
      body: { username: fixture.credentials.disabled.username, password: 'invalid-password-value' },
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(statuses[5], 429);
});

test('RFC-compatible TOTP generation uses the expected 30-second SHA-1 counter', () => {
  assert.equal(generateTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
});

test('local GoTrue performs real TOTP enrollment, AAL2 rotation and factor reset', live, async () => {
  const { targetUrl, publishableKey, fixture, bffOrigin } = loadSessionFixture();
  const credential = fixture.credentials?.headA;
  assert.ok(credential?.email && credential?.password, 'process-local TOTP actor credentials missing');
  const client = createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signedIn = await client.auth.signInWithPassword({
    email: credential.email,
    password: credential.password,
  });
  assert.ifError(signedIn.error);
  const aal1Token = signedIn.data.session?.access_token;
  assert.ok(aal1Token, 'AAL1 access token missing');

  let factorId;
  try {
    const enrolled = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `security-${fixture.resources.securityRunId}`,
    });
    assert.ifError(enrolled.error);
    factorId = enrolled.data?.id;
    const secret = enrolled.data?.totp?.secret;
    assert.ok(factorId && secret, 'local GoTrue did not return a TOTP enrollment contract');

    const verified = await client.auth.mfa.challengeAndVerify({
      factorId,
      code: generateTotpCode(secret),
    });
    assert.ifError(verified.error);
    assert.notEqual(verified.data?.access_token, aal1Token, 'MFA did not rotate the session token');

    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    assert.ifError(assurance.error);
    assert.equal(assurance.data?.currentLevel, 'aal2');

    const bffSession = await login(bffOrigin, credential);
    assert.equal(bffSession.payload.authState, 'mfa_required');
    assert.equal((await bffRequest(bffOrigin,
      `/api/payments?period=${fixture.resources.period}&projectId=${fixture.resources.projectA}`,
      { cookie: bffSession.cookie })).status, 403);
    const challenge = await bffRequest(bffOrigin, '/api/auth/mfa/challenge', {
      method: 'POST', cookie: bffSession.cookie, csrf: bffSession.csrf,
      body: { factorId },
    });
    assert.equal(challenge.status, 200);
    assert.ok(challenge.payload?.challengeId);
    const bffAal2 = await bffRequest(bffOrigin, '/api/auth/mfa/verify', {
      method: 'POST', cookie: bffSession.cookie, csrf: bffSession.csrf,
      body: { factorId, challengeId: challenge.payload.challengeId, code: generateTotpCode(secret) },
    });
    assert.equal(bffAal2.status, 200);
    assert.equal(bffAal2.payload?.aal, 2);
    assert.ok(bffAal2.cookie && bffAal2.cookie !== bffSession.cookie);
    assert.equal((await bffRequest(bffOrigin,
      `/api/payments?period=${fixture.resources.period}&projectId=${fixture.resources.projectA}`,
      { cookie: bffAal2.cookie })).status, 200);
  } finally {
    if (factorId) {
      const reset = await client.auth.mfa.unenroll({ factorId });
      assert.ifError(reset.error);
    }
    await client.auth.signOut({ scope: 'local' });
  }
});
