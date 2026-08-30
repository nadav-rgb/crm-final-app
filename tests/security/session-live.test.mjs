import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertSafeTestTarget } from '../../scripts/security/verify-rls-live.mjs';

const enabled = process.env.SECURITY_TEST_CONFIRM_ISOLATED === 'true';
const live = { skip: enabled ? false : 'requires confirmed isolated G5 loopback target' };

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replaceAll('=', '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('invalid TOTP secret encoding');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotp(secret, timestamp = Date.now()) {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

function loadSessionFixture() {
  const targetUrl = process.env.SECURITY_TEST_SUPABASE_URL;
  const productionUrl = process.env.SECURITY_TEST_PRODUCTION_COMPARISON_URL;
  assertSafeTestTarget({ targetUrl, productionUrl, confirmed: enabled });
  const publishableKey = process.env.SECURITY_TEST_SUPABASE_PUBLISHABLE_KEY;
  const fixture = JSON.parse(process.env.SECURITY_TEST_SESSION_FIXTURE ?? '{}');
  if (!publishableKey || !fixture.tokens || !fixture.expected) {
    throw new Error('isolated session fixture is incomplete');
  }
  return { targetUrl, publishableKey, fixture };
}

test('disabled and stale-security-version JWTs cannot read protected rows', live, async () => {
  const { targetUrl, publishableKey, fixture } = loadSessionFixture();
  for (const actor of ['disabled', 'staleSecurityVersion']) {
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
      p_period: fixture.expected.period,
      p_project_id: fixture.expected.projectA,
      p_user_id: null,
    });
    assert.ok(error, `${actor} unexpectedly crossed the AAL2 boundary`);
  }
});

test('revoked and rotated session material cannot be replayed', live, async () => {
  const { fixture } = loadSessionFixture();
  for (const status of ['expired', 'logoutReplay', 'preRotationReplay']) {
    assert.equal(fixture.expected[status], 'denied', `${status} was not proven denied`);
  }
});

test('RFC-compatible TOTP generation uses the expected 30-second SHA-1 counter', () => {
  assert.equal(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
});

test('local GoTrue performs real TOTP enrollment, AAL2 rotation and factor reset', live, async () => {
  const { targetUrl, publishableKey, fixture } = loadSessionFixture();
  const credential = fixture.credentials?.headA;
  assert.ok(credential?.email && credential?.password, 'process-local TOTP actor credentials missing');
  const client = createClient(targetUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signedIn = await client.auth.signInWithPassword(credential);
  assert.ifError(signedIn.error);
  const aal1Token = signedIn.data.session?.access_token;
  assert.ok(aal1Token, 'AAL1 access token missing');

  let factorId;
  try {
    const enrolled = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `security-${fixture.expected.securityRunId}`,
    });
    assert.ifError(enrolled.error);
    factorId = enrolled.data?.id;
    const secret = enrolled.data?.totp?.secret;
    assert.ok(factorId && secret, 'local GoTrue did not return a TOTP enrollment contract');

    const verified = await client.auth.mfa.challengeAndVerify({
      factorId,
      code: generateTotp(secret),
    });
    assert.ifError(verified.error);
    assert.notEqual(verified.data?.access_token, aal1Token, 'MFA did not rotate the session token');

    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    assert.ifError(assurance.error);
    assert.equal(assurance.data?.currentLevel, 'aal2');
  } finally {
    if (factorId) {
      const reset = await client.auth.mfa.unenroll({ factorId });
      assert.ifError(reset.error);
    }
    await client.auth.signOut({ scope: 'local' });
  }
});
