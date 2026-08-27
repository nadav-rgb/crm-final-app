import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeReq, hasCode } from './helpers.mjs';
import { openToken, sealToken } from '../../lib/security/crypto.mjs';
import { productionCookie, serializeSessionCookie } from '../../lib/security/cookies.mjs';
import { verifyCsrf } from '../../lib/security/csrf.mjs';
import { consumeRateLimit } from '../../lib/security/rate-limit.mjs';
import {
  createSession,
  loadSession,
  revokeSession,
  rotateSession,
} from '../../lib/security/session.mjs';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-08-27T10:00:00.000Z');
const TOKEN_KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 8);
const securityEnv = {
  sessionIdPepper: 'synthetic-session-pepper-with-at-least-32-bytes',
  tokenKeys: { 1: TOKEN_KEY },
  tokenKeyVersion: 1,
  production: true,
};

function makeClock(start = NOW) {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance(ms) { current = new Date(current.getTime() + ms); },
  };
}

function makeStore(clock) {
  const sessions = new Map();
  const buckets = new Map();
  return {
    sessions,
    async create(record) {
      if (sessions.has(record.idHash)) throw new Error('duplicate session');
      sessions.set(record.idHash, structuredClone(record));
    },
    async load(idHash) {
      const value = sessions.get(idHash);
      return value ? structuredClone(value) : null;
    },
    async touch(idHash, lastSeenAt, idleExpiresAt) {
      const value = sessions.get(idHash);
      if (!value || value.revokedAt) return false;
      value.lastSeenAt = lastSeenAt;
      value.idleExpiresAt = idleExpiresAt;
      return true;
    },
    async rotate(oldIdHash, next, reason) {
      const old = sessions.get(oldIdHash);
      if (!old || old.revokedAt) return false;
      old.revokedAt = clock.now().toISOString();
      old.revokeReason = reason;
      sessions.set(next.idHash, structuredClone(next));
      return true;
    },
    async revoke(idHash, reason) {
      const value = sessions.get(idHash);
      if (!value || value.revokedAt) return false;
      value.revokedAt = clock.now().toISOString();
      value.revokeReason = reason;
      return true;
    },
    async consumeRateLimit(bucketHash, limit, windowSeconds) {
      const now = clock.now().getTime();
      const duration = windowSeconds * 1_000;
      let bucket = buckets.get(bucketHash);
      if (!bucket || bucket.windowStartedAt + duration <= now) {
        bucket = { windowStartedAt: now, count: 0 };
      }
      bucket.count += 1;
      buckets.set(bucketHash, bucket);
      const allowed = bucket.count <= limit;
      return {
        allowed,
        count: bucket.count,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.windowStartedAt + duration - now) / 1_000)),
      };
    },
  };
}

function sessionRequest(rawId, csrfToken) {
  return fakeReq({
    method: 'POST',
    cookies: { [productionCookie.name]: rawId },
    headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
  });
}

const activeProfile = async () => ({ disabledAt: null, securityVersion: 3 });

async function freshSession({ role = 'activist', clock = makeClock(), store = makeStore(clock) } = {}) {
  const session = await createSession({
    userId: USER_ID,
    accessToken: 'synthetic-access-token',
    refreshToken: 'synthetic-refresh-token',
    aal: role === 'head' ? 2 : 1,
    authState: 'active',
    securityVersion: 3,
    role,
  }, { store, env: securityEnv, clock });
  return { session, store, clock };
}

test('token encryption rejects tampering, unknown versions and wrong keys', () => {
  const sealed = sealToken('synthetic-provider-token', TOKEN_KEY, 1);
  const parts = sealed.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  assert.throws(() => openToken(parts.join('.'), { 1: TOKEN_KEY }), hasCode('TOKEN_DECRYPT_FAILED'));
  assert.throws(() => openToken(sealed, { 1: OTHER_KEY }), hasCode('TOKEN_DECRYPT_FAILED'));
  assert.throws(() => openToken(sealed, { 2: TOKEN_KEY }), hasCode('TOKEN_KEY_UNAVAILABLE'));
  assert.equal(openToken(sealed, { 1: TOKEN_KEY }), 'synthetic-provider-token');
});

test('production session cookie is opaque and host-bound', async () => {
  const { session, store } = await freshSession();
  assert.deepEqual(productionCookie, {
    name: '__Host-mekarvim_session',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    domain: undefined,
  });
  const cookie = serializeSessionCookie(session.id, { production: true });
  assert.match(cookie, /^__Host-mekarvim_session=[A-Za-z0-9_-]+;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.doesNotMatch(cookie, /synthetic-access-token|synthetic-refresh-token|eyJ/i);

  const stored = await store.load(session.idHash);
  assert.notEqual(stored.encryptedAccessToken, 'synthetic-access-token');
  assert.notEqual(stored.encryptedRefreshToken, 'synthetic-refresh-token');
  assert.notEqual(session.id, session.idHash);
});

test('revoked, idle-expired, absolute-expired, disabled and stale sessions fail closed', async () => {
  const cases = [
    {
      name: 'revoked',
      arrange: async ({ session, store }) => store.revoke(session.idHash, 'logout'),
      profile: activeProfile,
    },
    {
      name: 'idle expired',
      arrange: async ({ clock }) => clock.advance(8 * 60 * 60 * 1_000 + 1),
      profile: activeProfile,
    },
    {
      name: 'absolute expired',
      arrange: async ({ clock }) => clock.advance(24 * 60 * 60 * 1_000 + 1),
      profile: activeProfile,
    },
    {
      name: 'disabled',
      arrange: async () => {},
      profile: async () => ({ disabledAt: NOW.toISOString(), securityVersion: 3 }),
    },
    {
      name: 'stale security version',
      arrange: async () => {},
      profile: async () => ({ disabledAt: null, securityVersion: 4 }),
    },
  ];

  for (const item of cases) {
    const state = await freshSession();
    await item.arrange(state);
    await assert.rejects(
      () => loadSession(sessionRequest(state.session.id), {
        store: state.store,
        env: securityEnv,
        clock: state.clock,
        loadProfile: item.profile,
      }),
      hasCode('SESSION_INVALID'),
      item.name,
    );
  }
});

test('rotation invalidates replay and issues a different session and CSRF secret', async () => {
  const state = await freshSession({ role: 'head' });
  const rotated = await rotateSession(state.session, 'mfa_verified', {
    store: state.store,
    env: securityEnv,
    clock: state.clock,
  });
  assert.notEqual(rotated.id, state.session.id);
  assert.notEqual(rotated.csrfToken, state.session.csrfToken);

  await assert.rejects(
    () => loadSession(sessionRequest(state.session.id), {
      store: state.store,
      env: securityEnv,
      clock: state.clock,
      loadProfile: activeProfile,
    }),
    hasCode('SESSION_INVALID'),
  );
  const loaded = await loadSession(sessionRequest(rotated.id), {
    store: state.store,
    env: securityEnv,
    clock: state.clock,
    loadProfile: activeProfile,
  });
  assert.equal(loaded.userId, USER_ID);
});

test('CSRF token from another session and missing token are denied', async () => {
  const first = await freshSession();
  const second = await freshSession({ clock: first.clock, store: first.store });
  assert.throws(
    () => verifyCsrf(sessionRequest(first.session.id, first.session.csrfToken), second.session, securityEnv),
    hasCode('CSRF_DENIED'),
  );
  assert.throws(
    () => verifyCsrf(sessionRequest(first.session.id), first.session, securityEnv),
    hasCode('CSRF_DENIED'),
  );
  assert.doesNotThrow(
    () => verifyCsrf(sessionRequest(first.session.id, first.session.csrfToken), first.session, securityEnv),
  );
});

test('shared rate limit blocks the sixth login attempt in one window', async () => {
  const clock = makeClock();
  const sharedStore = makeStore(clock);
  const attempts = [];
  for (let index = 0; index < 6; index += 1) {
    attempts.push(await consumeRateLimit('login:192.0.2.10', 5, 15 * 60, {
      store: sharedStore,
      pepper: securityEnv.sessionIdPepper,
    }));
  }
  assert.equal(attempts[4].allowed, true);
  assert.equal(attempts[5].allowed, false);
  assert.ok(attempts[5].retryAfterSeconds > 0);
  assert.doesNotMatch(JSON.stringify(attempts), /192\.0\.2\.10/);
});

test('revocation is idempotent and never restores a session', async () => {
  const state = await freshSession();
  assert.equal(await revokeSession(state.session, 'logout', { store: state.store }), true);
  assert.equal(await revokeSession(state.session, 'logout_replay', { store: state.store }), false);
});

test('session and rate RPC migration is service-only, atomic and rollback-safe', async () => {
  const sql = await readFile('migrations/0020_security_rpcs.sql', 'utf8');
  for (const name of [
    'app_session_create',
    'app_session_load',
    'app_session_touch',
    'app_session_rotate',
    'app_session_revoke',
    'app_rate_limit_consume',
    'app_audit_append',
    'app_membership_change',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\b`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[^;]* from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[^;]* to service_role`, 'i'));
  }
  assert.match(sql, /set search_path = pg_catalog, public, app_private/i);
  assert.match(sql, /on conflict \(bucket_hash\) do update set/i);
  assert.doesNotMatch(sql, /security definer[\s\S]{0,200}set search_path\s*=\s*(?:''|public\s*;)/i);

  const rollback = await readFile('migrations/rollback/0018-0020-pre-cutover.sql', 'utf8');
  assert.match(rollback, /drop function if exists public\.app_session_rotate/i);
  assert.doesNotMatch(rollback, /\bcascade\b/i);
});

test('membership RPC rechecks head scope, tier and anti-self-escalation in the transaction', async () => {
  const sql = await readFile('migrations/0020_security_rpcs.sql', 'utf8');
  const definition = sql.match(
    /create or replace function public\.app_membership_change\b[\s\S]*?end \$\$;/i,
  )?.[0];
  assert.ok(definition, 'missing membership workflow RPC');
  assert.match(definition, /s\.aal\s*=\s*2/i);
  assert.match(definition, /pm\.project_id\s*=\s*p_project_id/i);
  assert.match(definition, /p_target_user_id\s*=\s*p_actor_user_id/i);
  assert.match(definition, /p_role\s+not\s+in\s*\(\s*'activist'\s*,\s*'coord'\s*\)/i);
  assert.match(definition, /v_actor_is_ceo/i);
});
