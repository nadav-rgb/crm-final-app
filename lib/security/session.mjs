import { readSessionCookie } from './cookies.mjs';
import { hashOpaque, openToken, randomOpaque, sealToken } from './crypto.mjs';
import { issueCsrf } from './csrf.mjs';
import { SecurityError } from './errors.mjs';
import { consumeRateLimit } from './rate-limit.mjs';

const HIGH_PRIVILEGE_ROLES = new Set(['ceo', 'head']);
const HIGH_IDLE_SECONDS = 30 * 60;
const HIGH_ABSOLUTE_SECONDS = 12 * 60 * 60;
const STANDARD_IDLE_SECONDS = 8 * 60 * 60;
const STANDARD_ABSOLUTE_SECONDS = 24 * 60 * 60;
const REFRESH_EARLY_MS = 60_000;
const REFRESH_LIMIT = 3;
const REFRESH_WINDOW_SECONDS = 5 * 60;
const FINGERPRINT = /^[A-Za-z0-9_-]{43}$/;

function nowFrom(clock) {
  const value = clock?.now?.() ?? new Date();
  const result = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
  return result;
}

function requireDependencies({ store, env }) {
  if (
    typeof store?.create !== 'function'
    || typeof store?.load !== 'function'
    || typeof store?.rotate !== 'function'
    || typeof store?.revoke !== 'function'
    || typeof env?.sessionIdPepper !== 'string'
    || !env?.tokenKeys
    || !Number.isSafeInteger(env?.tokenKeyVersion)
  ) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
}

function invalidSession(cause) {
  return new SecurityError(401, 'SESSION_INVALID', 'Session is invalid', { cause });
}

function iso(date) {
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

function durations(role) {
  return HIGH_PRIVILEGE_ROLES.has(role)
    ? { idle: HIGH_IDLE_SECONDS, absolute: HIGH_ABSOLUTE_SECONDS }
    : { idle: STANDARD_IDLE_SECONDS, absolute: STANDARD_ABSOLUTE_SECONDS };
}

function validateInput(input) {
  if (
    typeof input?.userId !== 'string'
    || typeof input?.accessToken !== 'string' || input.accessToken.length < 1
    || typeof input?.refreshToken !== 'string' || input.refreshToken.length < 1
    || ![1, 2].includes(input?.aal)
    || !['active', 'mfa_required', 'recovery'].includes(input?.authState)
    || !Number.isSafeInteger(input?.securityVersion) || input.securityVersion < 1
    || typeof input?.mfaProtected !== 'boolean'
    || (input?.factorFingerprint !== null && input?.factorFingerprint !== undefined
      && !FINGERPRINT.test(input.factorFingerprint))
  ) {
    throw new SecurityError(500, 'SESSION_CREATE_INVALID', 'Session could not be created');
  }
}

function buildNewSession(input, { env, clock, absoluteExpiresAt, createdAt, idleTimeoutSeconds } = {}) {
  const normalized = {
    ...input,
    mfaProtected: input?.mfaProtected ?? HIGH_PRIVILEGE_ROLES.has(input?.role),
    factorFingerprint: input?.factorFingerprint ?? null,
  };
  validateInput(normalized);
  const now = nowFrom(clock);
  const configuredDurations = durations(normalized.mfaProtected ? 'head' : input.role);
  const timeout = idleTimeoutSeconds ?? configuredDurations.idle;
  const absolute = absoluteExpiresAt
    ? new Date(absoluteExpiresAt)
    : new Date(now.getTime() + configuredDurations.absolute * 1_000);
  const idle = new Date(Math.min(now.getTime() + timeout * 1_000, absolute.getTime()));
  const id = randomOpaque(32);
  const idHash = hashOpaque(`session:${id}`, env.sessionIdPepper);
  const session = {
    id,
    idHash,
    userId: normalized.userId,
    accessToken: normalized.accessToken,
    refreshToken: normalized.refreshToken,
    tokenKeyVersion: env.tokenKeyVersion,
    accessTokenExpiresAt: normalized.accessTokenExpiresAt ? iso(normalized.accessTokenExpiresAt) : null,
    aal: normalized.aal,
    authState: normalized.authState,
    securityVersion: normalized.securityVersion,
    role: normalized.role,
    mfaProtected: normalized.mfaProtected,
    factorFingerprint: normalized.factorFingerprint,
    createdAt: createdAt ? iso(createdAt) : now.toISOString(),
    lastSeenAt: now.toISOString(),
    idleTimeoutSeconds: timeout,
    idleExpiresAt: idle.toISOString(),
    absoluteExpiresAt: absolute.toISOString(),
    revokedAt: null,
  };
  issueCsrf(session, env);
  return session;
}

function persistedRecord(session, env) {
  return {
    idHash: session.idHash,
    userId: session.userId,
    encryptedAccessToken: sealToken(session.accessToken, env.tokenKeys[env.tokenKeyVersion], env.tokenKeyVersion),
    encryptedRefreshToken: sealToken(session.refreshToken, env.tokenKeys[env.tokenKeyVersion], env.tokenKeyVersion),
    tokenKeyVersion: env.tokenKeyVersion,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    csrfHash: session.csrfHash,
    aal: session.aal,
    securityVersion: session.securityVersion,
    authState: session.authState,
    mfaProtected: session.mfaProtected,
    factorFingerprint: session.factorFingerprint,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    idleTimeoutSeconds: session.idleTimeoutSeconds,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    revokedAt: null,
    revokeReason: null,
  };
}

export async function createSession(input, dependencies) {
  requireDependencies(dependencies);
  const session = buildNewSession(input, dependencies);
  try {
    await dependencies.store.create(persistedRecord(session, dependencies.env));
    return session;
  } catch (cause) {
    if (cause instanceof SecurityError) throw cause;
    throw new SecurityError(503, 'SESSION_STORE_UNAVAILABLE', 'Session could not be created safely', { cause });
  }
}

function parseTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw invalidSession();
  return time;
}

async function currentProfile(record, loadProfile) {
  if (typeof loadProfile === 'function') return loadProfile(record.userId);
  if (record.currentSecurityVersion !== undefined || record.disabledAt !== undefined) {
    return { securityVersion: record.currentSecurityVersion, disabledAt: record.disabledAt };
  }
  throw new SecurityError(503, 'SESSION_PROFILE_UNAVAILABLE', 'Session validation is unavailable');
}

async function refreshProviderTokens(record, refreshToken, dependencies) {
  const { provider, store, env } = dependencies;
  if (
    typeof provider?.refresh !== 'function'
    || typeof store?.claimRefresh !== 'function'
    || typeof store?.completeRefresh !== 'function'
    || typeof store?.revoke !== 'function'
  ) {
    throw invalidSession();
  }
  await consumeRateLimit(
    `session_refresh:${record.userId}:${record.idHash}`,
    REFRESH_LIMIT,
    REFRESH_WINDOW_SECONDS,
    { store, pepper: env.sessionIdPepper },
  );
  const refreshLockHash = hashOpaque(`refresh-lock:${randomOpaque(32)}`, env.sessionIdPepper);
  const claimed = await store.claimRefresh(
    record.idHash,
    record.encryptedRefreshToken,
    refreshLockHash,
  );
  if (!claimed) {
    const latest = await store.load(record.idHash);
    if (!latest || latest.revokedAt || latest.encryptedRefreshToken === record.encryptedRefreshToken) {
      throw invalidSession();
    }
    return {
      accessToken: openToken(latest.encryptedAccessToken, env.tokenKeys),
      refreshToken: openToken(latest.encryptedRefreshToken, env.tokenKeys),
      accessTokenExpiresAt: latest.accessTokenExpiresAt,
      aal: latest.aal,
      authState: latest.authState,
      mfaProtected: latest.mfaProtected,
      factorFingerprint: latest.factorFingerprint,
    };
  }
  try {
    const refreshed = await provider.refresh(refreshToken);
    if (
      !refreshed?.accessToken || !refreshed?.refreshToken || !refreshed?.accessTokenExpiresAt
      || ![1, 2].includes(refreshed?.aal)
      || ![1, 2].includes(refreshed?.nextAal)
      || !FINGERPRINT.test(refreshed?.factorFingerprint ?? '')
    ) {
      throw new Error('invalid provider refresh result');
    }
    const factorChanged = record.factorFingerprint !== refreshed.factorFingerprint;
    const protectedDowngrade = record.mfaProtected
      && (refreshed.aal !== 2 || refreshed.nextAal !== 2);
    if (factorChanged || protectedDowngrade) {
      await store.revoke(record.idHash, 'provider_assurance_changed');
      throw invalidSession();
    }
    const aal = refreshed.aal === 2 && refreshed.nextAal === 2 ? 2 : 1;
    const authState = record.mfaProtected && aal < 2 ? 'mfa_required' : 'active';
    const next = {
      encryptedAccessToken: sealToken(refreshed.accessToken, env.tokenKeys[env.tokenKeyVersion], env.tokenKeyVersion),
      encryptedRefreshToken: sealToken(refreshed.refreshToken, env.tokenKeys[env.tokenKeyVersion], env.tokenKeyVersion),
      tokenKeyVersion: env.tokenKeyVersion,
      accessTokenExpiresAt: iso(refreshed.accessTokenExpiresAt),
      aal,
      authState,
      mfaProtected: record.mfaProtected,
      factorFingerprint: refreshed.factorFingerprint,
    };
    const updated = await store.completeRefresh(
      record.idHash,
      record.encryptedRefreshToken,
      refreshLockHash,
      next,
    );
    if (!updated) {
      await store.revoke(record.idHash, 'refresh_cas_failed');
      throw invalidSession();
    }
    return {
      ...refreshed,
      accessTokenExpiresAt: next.accessTokenExpiresAt,
      aal,
      authState,
      mfaProtected: record.mfaProtected,
    };
  } catch (cause) {
    if (!cause?.code || cause.code !== 'SESSION_INVALID') {
      await store.revoke(record.idHash, 'provider_refresh_failed');
    }
    throw cause;
  }
}

export async function loadSession(req, dependencies) {
  requireDependencies(dependencies);
  const { store, env, clock, loadProfile } = dependencies;
  try {
    const id = readSessionCookie(req, { production: env.production });
    const idHash = hashOpaque(`session:${id}`, env.sessionIdPepper);
    const record = await store.load(idHash);
    const now = nowFrom(clock);
    if (
      !record || record.revokedAt
      || parseTime(record.idleExpiresAt) <= now.getTime()
      || parseTime(record.absoluteExpiresAt) <= now.getTime()
    ) {
      throw invalidSession();
    }

    const profile = await currentProfile(record, loadProfile);
    if (profile?.disabledAt || profile?.securityVersion !== record.securityVersion) {
      await store.revoke(idHash, profile?.disabledAt ? 'user_disabled' : 'security_version_changed');
      throw invalidSession();
    }

    let accessToken = openToken(record.encryptedAccessToken, env.tokenKeys);
    let refreshToken = openToken(record.encryptedRefreshToken, env.tokenKeys);
    let accessTokenExpiresAt = record.accessTokenExpiresAt ?? null;
    let aal = record.aal;
    let authState = record.authState;
    let mfaProtected = Boolean(record.mfaProtected);
    let factorFingerprint = record.factorFingerprint ?? null;
    if (accessTokenExpiresAt && parseTime(accessTokenExpiresAt) <= now.getTime() + REFRESH_EARLY_MS) {
      const refreshed = await refreshProviderTokens(record, refreshToken, dependencies);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      accessTokenExpiresAt = iso(refreshed.accessTokenExpiresAt);
      aal = refreshed.aal;
      authState = refreshed.authState;
      mfaProtected = Boolean(refreshed.mfaProtected);
      factorFingerprint = refreshed.factorFingerprint ?? null;
    }

    const idleTimeoutSeconds = Number(record.idleTimeoutSeconds);
    if (!Number.isSafeInteger(idleTimeoutSeconds) || idleTimeoutSeconds < 60 || idleTimeoutSeconds > STANDARD_IDLE_SECONDS) {
      throw invalidSession();
    }
    const idleExpiresAt = new Date(Math.min(
      now.getTime() + idleTimeoutSeconds * 1_000,
      parseTime(record.absoluteExpiresAt),
    )).toISOString();
    if (typeof store.touch !== 'function' || !await store.touch(idHash, now.toISOString(), idleExpiresAt)) {
      throw invalidSession();
    }

    return {
      id,
      idHash,
      userId: record.userId,
      accessToken,
      refreshToken,
      tokenKeyVersion: record.tokenKeyVersion,
      accessTokenExpiresAt,
      csrfHash: record.csrfHash,
      aal,
      authState,
      mfaProtected,
      factorFingerprint,
      securityVersion: record.securityVersion,
      createdAt: record.createdAt,
      lastSeenAt: now.toISOString(),
      idleTimeoutSeconds,
      idleExpiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
      revokedAt: null,
    };
  } catch (cause) {
    if (cause instanceof SecurityError && ['SESSION_PROFILE_UNAVAILABLE', 'SESSION_STORE_UNAVAILABLE'].includes(cause.code)) {
      throw cause;
    }
    throw invalidSession(cause);
  }
}

export async function rotateSession(session, reason, dependencies) {
  requireDependencies(dependencies);
  if (!session?.idHash || typeof reason !== 'string' || reason.length < 1 || reason.length > 120) {
    throw invalidSession();
  }
  const next = buildNewSession({
    userId: session.userId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    aal: session.aal,
    authState: session.authState,
    mfaProtected: session.mfaProtected,
    factorFingerprint: session.factorFingerprint,
    securityVersion: session.securityVersion,
    role: session.role,
  }, {
    ...dependencies,
    absoluteExpiresAt: session.absoluteExpiresAt,
    createdAt: session.createdAt,
    idleTimeoutSeconds: session.idleTimeoutSeconds,
  });
  const rotated = await dependencies.store.rotate(
    session.idHash,
    persistedRecord(next, dependencies.env),
    reason,
  );
  if (!rotated) throw invalidSession();
  return next;
}

export async function revokeSession(session, reason, { store }) {
  if (!session?.idHash || typeof store?.revoke !== 'function' || typeof reason !== 'string' || reason.length < 1 || reason.length > 120) {
    throw new SecurityError(500, 'SESSION_REVOKE_INVALID', 'Session could not be revoked safely');
  }
  return Boolean(await store.revoke(session.idHash, reason));
}
