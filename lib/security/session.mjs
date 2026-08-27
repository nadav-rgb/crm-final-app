import { readSessionCookie } from './cookies.mjs';
import { hashOpaque, openToken, randomOpaque, sealToken } from './crypto.mjs';
import { issueCsrf } from './csrf.mjs';
import { SecurityError } from './errors.mjs';

const HIGH_PRIVILEGE_ROLES = new Set(['ceo', 'head']);
const HIGH_IDLE_SECONDS = 30 * 60;
const HIGH_ABSOLUTE_SECONDS = 12 * 60 * 60;
const STANDARD_IDLE_SECONDS = 8 * 60 * 60;
const STANDARD_ABSOLUTE_SECONDS = 24 * 60 * 60;
const REFRESH_EARLY_MS = 60_000;
const refreshFlights = new Map();

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
  ) {
    throw new SecurityError(500, 'SESSION_CREATE_INVALID', 'Session could not be created');
  }
}

function buildNewSession(input, { env, clock, absoluteExpiresAt, createdAt, idleTimeoutSeconds } = {}) {
  validateInput(input);
  const now = nowFrom(clock);
  const configuredDurations = durations(input.role);
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
    userId: input.userId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenKeyVersion: env.tokenKeyVersion,
    accessTokenExpiresAt: input.accessTokenExpiresAt ? iso(input.accessTokenExpiresAt) : null,
    aal: input.aal,
    authState: input.authState,
    securityVersion: input.securityVersion,
    role: input.role,
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
  if (typeof provider?.refresh !== 'function' || typeof store?.refreshTokens !== 'function') {
    throw invalidSession();
  }
  let flight = refreshFlights.get(record.idHash);
  if (!flight) {
    flight = (async () => {
      const refreshed = await provider.refresh(refreshToken);
      if (!refreshed?.accessToken || !refreshed?.refreshToken || !refreshed?.accessTokenExpiresAt) {
        throw new Error('invalid provider refresh result');
      }
      const next = {
        encryptedAccessToken: sealToken(refreshed.accessToken, env.tokenKeys[env.tokenKeyVersion], env.tokenKeyVersion),
        encryptedRefreshToken: sealToken(refreshed.refreshToken, env.tokenKeys[env.tokenKeyVersion], env.tokenKeyVersion),
        tokenKeyVersion: env.tokenKeyVersion,
        accessTokenExpiresAt: iso(refreshed.accessTokenExpiresAt),
      };
      const updated = await store.refreshTokens(record.idHash, record.encryptedRefreshToken, next);
      if (!updated) {
        const latest = await store.load(record.idHash);
        if (!latest || latest.revokedAt) throw invalidSession();
        return {
          accessToken: openToken(latest.encryptedAccessToken, env.tokenKeys),
          refreshToken: openToken(latest.encryptedRefreshToken, env.tokenKeys),
          accessTokenExpiresAt: latest.accessTokenExpiresAt,
        };
      }
      return { ...refreshed, accessTokenExpiresAt: next.accessTokenExpiresAt };
    })().finally(() => refreshFlights.delete(record.idHash));
    refreshFlights.set(record.idHash, flight);
  }
  return flight;
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
    if (accessTokenExpiresAt && parseTime(accessTokenExpiresAt) <= now.getTime() + REFRESH_EARLY_MS) {
      const refreshed = await refreshProviderTokens(record, refreshToken, dependencies);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      accessTokenExpiresAt = iso(refreshed.accessTokenExpiresAt);
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
      aal: record.aal,
      authState: record.authState,
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
