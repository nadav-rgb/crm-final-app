import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../../lib/security/auth-service.mjs';
import { createApiClient } from '../../lib/security/api-client.mjs';
import { getServerEnv } from '../../lib/security/env.mjs';
import { hasCode, pick } from './helpers.mjs';
import { readFile } from 'node:fs/promises';

const IDS = {
  activist: '00000000-0000-4000-8000-000000000011',
  head: '00000000-0000-4000-8000-000000000012',
  disabled: '00000000-0000-4000-8000-000000000013',
};

function makeHarness() {
  let nextSession = 0;
  const identities = new Map([
    ['activist', { userId: IDS.activist, email: 'activist@identity.invalid' }],
    ['head', { userId: IDS.head, email: 'head@identity.invalid' }],
    ['disabled', { userId: IDS.disabled, email: 'disabled@identity.invalid' }],
  ]);
  const profiles = new Map([
    [IDS.activist, {
      userId: IDS.activist, name: 'Synthetic Activist', role: 'activist', activistCode: 101,
      securityVersion: 2, disabledAt: null, projects: [{ id: 1, name: 'Project A', role: 'activist' }],
    }],
    [IDS.head, {
      userId: IDS.head, name: 'Synthetic Head', role: 'head', activistCode: 102,
      securityVersion: 4, disabledAt: null, projects: [{ id: 1, name: 'Project A', role: 'head' }],
    }],
    [IDS.disabled, {
      userId: IDS.disabled, name: 'Disabled User', role: 'activist', activistCode: 103,
      securityVersion: 7, disabledAt: '2026-08-27T00:00:00.000Z', projects: [],
    }],
  ]);
  const storedSessions = new Map();
  const auditEvents = [];
  let loginAttempts = 0;

  const provider = {
    async signInWithPassword({ email, password }) {
      if (password !== 'correct-password' || email.startsWith('unknown-')) {
        const error = new Error('provider said invalid credentials');
        error.code = 'INVALID_CREDENTIALS';
        throw error;
      }
      const identity = [...identities.values()].find((candidate) => candidate.email === email);
      return {
        userId: identity.userId,
        accessToken: `access-${identity.userId}`,
        refreshToken: `refresh-${identity.userId}`,
        accessTokenExpiresAt: '2026-08-27T11:00:00.000Z',
        aal: identity.userId === IDS.head ? 1 : 1,
      };
    },
    async enrollMfa() { return { factorId: '00000000-0000-4000-8000-000000000099', qrCode: 'otpauth://synthetic' }; },
    async challengeMfa() { return { challengeId: '00000000-0000-4000-8000-000000000098' }; },
    async verifyMfa() { return { aal: 2, accessToken: 'access-aal2', refreshToken: 'refresh-aal2' }; },
    async requestPasswordReset() { return true; },
    async exchangeRecoveryToken() {
      return { userId: IDS.activist, accessToken: 'recovery-access', refreshToken: 'recovery-refresh', aal: 1 };
    },
    async updatePassword() { return true; },
  };

  const sessions = {
    async create(input) {
      const id = `session_${++nextSession}_${'x'.repeat(32)}`;
      const session = { ...input, id, idHash: `hash_${nextSession}`, csrfToken: `csrf_${nextSession}`, csrfHash: `csrf_hash_${nextSession}` };
      storedSessions.set(session.idHash, session);
      return session;
    },
    async load(cookie) {
      const session = [...storedSessions.values()].find((item) => item.id === cookie);
      if (!session || session.revokedAt) throw Object.assign(new Error('invalid'), { code: 'SESSION_INVALID' });
      return session;
    },
    async rotate(session, patch) {
      session.revokedAt = '2026-08-27T10:00:00.000Z';
      const next = { ...session, ...patch, id: `session_${++nextSession}_${'y'.repeat(32)}`, idHash: `hash_${nextSession}`, csrfToken: `csrf_${nextSession}`, revokedAt: null };
      storedSessions.set(next.idHash, next);
      return next;
    },
    async revoke(session) {
      if (session.revokedAt) return false;
      session.revokedAt = '2026-08-27T10:00:00.000Z';
      return true;
    },
    async revokeAll(userId) {
      for (const session of storedSessions.values()) if (session.userId === userId) session.revokedAt = '2026-08-27T10:00:00.000Z';
    },
  };

  const rateLimiter = {
    async consume() {
      loginAttempts += 1;
      return { allowed: loginAttempts <= 5, retryAfterSeconds: loginAttempts <= 5 ? 0 : 600 };
    },
  };
  const identityStore = {
    async resolve(username) { return identities.get(username) ?? null; },
    async loadProfile(userId) { return profiles.get(userId) ?? null; },
    async bumpSecurityVersion(userId) { profiles.get(userId).securityVersion += 1; },
  };
  const audit = { async append(event) { auditEvents.push(event); } };
  const service = createAuthService({ identityStore, provider, sessions, rateLimiter, audit });
  return { service, storedSessions, auditEvents, profiles };
}

async function publicFailure(promise) {
  try {
    await promise;
    return { status: 200 };
  } catch (error) {
    return pick(error, ['status', 'code', 'publicMessage']);
  }
}

test('unknown username and bad password have identical public response', async () => {
  const unknown = makeHarness().service;
  const badPassword = makeHarness().service;
  assert.deepEqual(
    await publicFailure(unknown.login({ username: 'nobody', password: 'correct-password', ipKey: 'ip-a' })),
    await publicFailure(badPassword.login({ username: 'activist', password: 'wrong-password', ipKey: 'ip-b' })),
  );
});

test('head at AAL1 receives only mfa_required state without provider tokens or PII', async () => {
  const { service } = makeHarness();
  const result = await service.login({ username: ' HEAD ', password: 'correct-password', ipKey: 'ip' });
  assert.deepEqual(pick(result, ['authState', 'aal']), { authState: 'mfa_required', aal: 1 });
  assert.equal(result.user.name, 'Synthetic Head');
  assert.equal(result.user.pii, undefined);
  assert.equal(result.accessToken, undefined);
  assert.equal(result.refreshToken, undefined);
  assert.doesNotMatch(JSON.stringify(result), /access-|refresh-|@identity\.invalid/);
});

test('login always creates a new authenticated session and ignores fixation material', async () => {
  const { service } = makeHarness();
  const first = await service.login({ username: 'activist', password: 'correct-password', ipKey: 'ip', sessionId: 'attacker-fixed' });
  const second = await service.login({ username: 'activist', password: 'correct-password', ipKey: 'ip', sessionId: 'attacker-fixed' });
  assert.notEqual(first.cookieValue, 'attacker-fixed');
  assert.notEqual(first.cookieValue, second.cookieValue);
});

test('logout revokes server session before it can be loaded again', async () => {
  const { service } = makeHarness();
  const login = await service.login({ username: 'activist', password: 'correct-password', ipKey: 'ip' });
  const session = await service.getSession(login.cookieValue);
  await service.logout(session);
  await assert.rejects(() => service.getSession(login.cookieValue), hasCode('SESSION_INVALID'));
});

test('disabled users and sixth login attempt fail closed', async () => {
  const disabled = makeHarness().service;
  await assert.rejects(
    () => disabled.login({ username: 'disabled', password: 'correct-password', ipKey: 'ip' }),
    hasCode('AUTH_INVALID'),
  );

  const { service } = makeHarness();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await publicFailure(service.login({ username: 'nobody', password: 'wrong-password', ipKey: 'shared-ip' }));
  }
  await assert.rejects(
    () => service.login({ username: 'nobody', password: 'wrong-password', ipKey: 'shared-ip' }),
    hasCode('RATE_LIMITED'),
  );
});

test('MFA verification rotates the session and unlocks AAL2 without exposing tokens', async () => {
  const { service } = makeHarness();
  const login = await service.login({ username: 'head', password: 'correct-password', ipKey: 'ip' });
  const before = await service.getSession(login.cookieValue);
  const verified = await service.verifyMfa(before, {
    factorId: '00000000-0000-4000-8000-000000000099',
    challengeId: '00000000-0000-4000-8000-000000000098',
    code: '123456',
  });
  assert.equal(verified.aal, 2);
  assert.equal(verified.authState, 'active');
  assert.notEqual(verified.cookieValue, login.cookieValue);
  await assert.rejects(() => service.getSession(login.cookieValue), hasCode('SESSION_INVALID'));
  assert.doesNotMatch(JSON.stringify(verified), /access-aal2|refresh-aal2/);
});

test('recovery session cannot be authorized for business capabilities', async () => {
  const { service } = makeHarness();
  await assert.rejects(
    () => service.authorizeRecoverySession('one-time-recovery-token', 'contacts:read'),
    hasCode('AUTH_SCOPE_DENIED'),
  );
  const recovery = await service.authorizeRecoverySession('one-time-recovery-token', 'password:complete');
  assert.equal(recovery.authState, 'recovery');
  await service.completePasswordReset(recovery, 'a-new-synthetic-password');
  await assert.rejects(() => service.getSession(recovery.id), hasCode('SESSION_INVALID'));
});

test('browser API client enforces same-origin cookies and in-memory CSRF without bearer tokens', async () => {
  const calls = [];
  const apiFetch = createApiClient({
    origin: 'https://crm.example.test',
    getCsrfToken: () => 'csrf-memory-only',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) };
    },
  });
  await apiFetch('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal(calls[0].url, 'https://crm.example.test/api/auth/logout');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], 'csrf-memory-only');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  await assert.rejects(() => apiFetch('https://evil.invalid/api', { method: 'GET' }), hasCode('CLIENT_ORIGIN_DENIED'));
});

test('production auth runtime requires server-only session and Supabase configuration', () => {
  const encryptionKey = Buffer.alloc(32, 9).toString('base64url');
  const env = getServerEnv({
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://crm.example.test',
    SUPABASE_URL: 'https://synthetic.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
    SESSION_ID_PEPPER: 'synthetic-session-pepper-at-least-32-bytes',
    SESSION_TOKEN_ENCRYPTION_KEY_V1: encryptionKey,
    SESSION_TOKEN_KEY_VERSION: '1',
    SECURITY_BFF_AUTH_ENABLED: 'true',
  });
  assert.equal(env.securityBffAuthEnabled, true);
  assert.equal(env.sessionIdPepper.length >= 32, true);
  assert.equal(env.sessionTokenKeyVersion, 1);
  assert.equal(env.sessionTokenKeys[1], encryptionKey);

  assert.throws(() => getServerEnv({
    NODE_ENV: 'production', APP_ORIGIN: 'https://crm.example.test',
  }), hasCode('CONFIG_INVALID'));
});

test('auth identity lookup and global session invalidation RPCs are service-only', async () => {
  const sql = await readFile('migrations/0020_security_rpcs.sql', 'utf8');
  for (const name of ['app_identity_resolve', 'app_user_security_invalidate']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\b`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[^;]* from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[^;]* to service_role`, 'i'));
  }
  const rollback = await readFile('migrations/rollback/0018-0020-pre-cutover.sql', 'utf8');
  assert.match(rollback, /drop function if exists public\.app_identity_resolve/i);
  assert.match(rollback, /drop function if exists public\.app_user_security_invalidate/i);
});
