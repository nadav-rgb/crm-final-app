import { SecurityError } from './errors.mjs';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from './env.mjs';
import { createSupabaseSessionStore } from './session-store.mjs';
import {
  createSession as createOpaqueSession,
  loadSession as loadOpaqueSession,
  revokeSession as revokeOpaqueSession,
  rotateSession as rotateOpaqueSession,
} from './session.mjs';
import { consumeRateLimit } from './rate-limit.mjs';
import { productionCookie, readSessionCookie } from './cookies.mjs';

const MFA_ROLES = new Set(['ceo', 'head']);
const GENERIC_AUTH_ERROR = Object.freeze({
  status: 401,
  code: 'AUTH_INVALID',
  message: 'Username or password is incorrect',
});

function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().toLocaleLowerCase('he-IL').replace(/\s+/g, ' ').slice(0, 160);
}

function authInvalid(cause) {
  return new SecurityError(
    GENERIC_AUTH_ERROR.status,
    GENERIC_AUTH_ERROR.code,
    GENERIC_AUTH_ERROR.message,
    { cause },
  );
}

function canonicalRole(profile) {
  if (profile.globalRole === 'ceo' || profile.role === 'ceo') return 'ceo';
  return profile.role ?? profile.projects?.[0]?.role ?? null;
}

function publicUser(profile) {
  const projects = (profile.projects ?? []).map((project) => ({
    id: Number(project.id),
    name: project.name,
    role: project.role,
  }));
  const role = canonicalRole(profile);
  const primaryProject = projects[0]?.id ?? null;
  return {
    userId: profile.userId,
    id: profile.activistCode ?? profile.userId,
    activistCode: profile.activistCode ?? null,
    name: profile.name,
    role,
    project_id: primaryProject,
    project_ids: projects.map((project) => project.id),
  };
}

function publicSession(session, profile) {
  const user = publicUser(profile);
  return {
    ok: true,
    cookieValue: session.id,
    csrfToken: session.csrfToken,
    authState: session.authState,
    aal: session.aal,
    user,
    profile: user,
    projects: (profile.projects ?? []).map((project) => ({
      id: Number(project.id), name: project.name, role: project.role,
    })),
  };
}

async function auditSafe(audit, event) {
  if (typeof audit?.append !== 'function') {
    throw new SecurityError(503, 'AUDIT_UNAVAILABLE', 'Authentication is temporarily unavailable');
  }
  await audit.append(event);
}

export function createAuthService({ identityStore, provider, sessions, rateLimiter, audit, clock = { now: () => new Date() } }) {
  if (
    typeof identityStore?.resolve !== 'function'
    || typeof identityStore?.loadProfile !== 'function'
    || typeof provider?.signInWithPassword !== 'function'
    || typeof sessions?.create !== 'function'
    || typeof sessions?.load !== 'function'
    || typeof sessions?.rotate !== 'function'
    || typeof sessions?.revoke !== 'function'
    || typeof rateLimiter?.consume !== 'function'
  ) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }

  async function consume(kind, key, limit, windowSeconds) {
    const result = await rateLimiter.consume({ kind, key, limit, windowSeconds });
    if (!result?.allowed) {
      await auditSafe(audit, {
        action: `${kind}.rate_limited`, resourceType: 'auth', result: 'denied',
        reasonCode: 'RATE_LIMITED', metadata: { retryAfterSeconds: result?.retryAfterSeconds ?? 0 },
      });
      throw new SecurityError(429, 'RATE_LIMITED', 'Too many attempts. Try again later');
    }
  }

  async function login({ username, password, ipKey = 'unknown' }) {
    const normalizedUsername = normalizeUsername(username);
    await consume('login', `${ipKey}:${normalizedUsername || 'invalid'}`, 5, 15 * 60);
    const identity = normalizedUsername ? await identityStore.resolve(normalizedUsername) : null;
    let providerSession;
    try {
      providerSession = await provider.signInWithPassword({
        email: identity?.email ?? 'unknown-auth-identity@invalid.example',
        password: typeof password === 'string' ? password : '',
      });
      if (!identity || providerSession?.userId !== identity.userId) throw new Error('identity mismatch');
    } catch (cause) {
      await auditSafe(audit, {
        action: 'auth.login', resourceType: 'auth', result: 'denied',
        reasonCode: 'AUTH_INVALID', metadata: {},
      });
      throw authInvalid(cause);
    }

    let profile;
    try {
      profile = typeof provider.loadSelf === 'function'
        ? await provider.loadSelf(providerSession.accessToken, identity.userId)
        : await identityStore.loadProfile(identity.userId, providerSession.accessToken);
      if (!profile || profile.userId !== identity.userId || profile.disabledAt) throw new Error('profile unavailable');
    } catch (cause) {
      await auditSafe(audit, {
        actorUserId: identity.userId, action: 'auth.login', resourceType: 'auth',
        result: 'denied', reasonCode: 'AUTH_INVALID', metadata: {},
      });
      throw authInvalid(cause);
    }

    const role = canonicalRole(profile);
    const aal = providerSession.aal === 2 ? 2 : 1;
    const authState = MFA_ROLES.has(role) && aal < 2 ? 'mfa_required' : 'active';
    const session = await sessions.create({
      userId: identity.userId,
      accessToken: providerSession.accessToken,
      refreshToken: providerSession.refreshToken,
      accessTokenExpiresAt: providerSession.accessTokenExpiresAt,
      aal,
      authState,
      securityVersion: profile.securityVersion,
      role,
    });
    try {
      await auditSafe(audit, {
        actorUserId: identity.userId, effectiveRole: role,
        action: 'auth.login', resourceType: 'auth', result: 'success',
        reasonCode: authState === 'mfa_required' ? 'MFA_REQUIRED' : null,
        sessionRef: session.idHash?.slice(0, 16), metadata: {},
      });
    } catch (cause) {
      await sessions.revoke(session, 'audit_unavailable');
      throw cause;
    }
    const response = publicSession(session, profile);
    if (authState === 'mfa_required' && typeof provider.listMfaFactors === 'function') {
      response.mfaFactors = await provider.listMfaFactors(session);
    }
    return response;
  }

  async function getSession(cookieValue) {
    return sessions.load(cookieValue);
  }

  async function resume(cookieValue) {
    const session = await sessions.load(cookieValue);
    const profile = await identityStore.loadProfile(session.userId, session.accessToken);
    if (!profile || profile.disabledAt || profile.securityVersion !== session.securityVersion) {
      await sessions.revoke(session, 'profile_changed');
      throw new SecurityError(401, 'SESSION_INVALID', 'Session is invalid');
    }
    const rotated = await sessions.rotate(session, {}, 'session_resume');
    const response = publicSession(rotated, profile);
    if (rotated.authState === 'mfa_required' && typeof provider.listMfaFactors === 'function') {
      response.mfaFactors = await provider.listMfaFactors(rotated);
    }
    return response;
  }

  async function logout(session) {
    const revoked = await sessions.revoke(session, 'logout');
    await auditSafe(audit, {
      actorUserId: session.userId, action: 'auth.logout', resourceType: 'auth',
      result: revoked ? 'success' : 'denied', reasonCode: revoked ? null : 'SESSION_INVALID',
      sessionRef: session.idHash?.slice(0, 16), metadata: {},
    });
    return revoked;
  }

  async function enrollMfa(session) {
    if (!['mfa_required', 'active'].includes(session?.authState)) throw authInvalid();
    return provider.enrollMfa(session);
  }

  async function challengeMfa(session, factorId) {
    if (!['mfa_required', 'active'].includes(session?.authState)) throw authInvalid();
    return provider.challengeMfa(session, factorId);
  }

  async function verifyMfa(session, input) {
    if (!['mfa_required', 'active'].includes(session?.authState)) {
      throw new SecurityError(403, 'AUTH_SCOPE_DENIED', 'Authentication scope is not permitted');
    }
    await consume('mfa', session.userId, 5, 10 * 60);
    let verified;
    try {
      verified = await provider.verifyMfa(session, input);
      if (verified?.aal !== 2) throw new Error('AAL2 not achieved');
    } catch (cause) {
      await auditSafe(audit, {
        actorUserId: session.userId, action: 'auth.mfa.verify', resourceType: 'auth',
        result: 'denied', reasonCode: 'MFA_INVALID', metadata: {},
      });
      throw new SecurityError(401, 'MFA_INVALID', 'Verification code is invalid', { cause });
    }
    const rotated = await sessions.rotate(session, {
      accessToken: verified.accessToken,
      refreshToken: verified.refreshToken,
      accessTokenExpiresAt: verified.accessTokenExpiresAt ?? session.accessTokenExpiresAt,
      aal: 2,
      authState: 'active',
    }, 'mfa_verified');
    await auditSafe(audit, {
      actorUserId: session.userId, action: 'auth.mfa.verify', resourceType: 'auth',
      result: 'success', sessionRef: rotated.idHash?.slice(0, 16), metadata: {},
    });
    return {
      ok: true, cookieValue: rotated.id, csrfToken: rotated.csrfToken,
      authState: 'active', aal: 2,
    };
  }

  async function requestPasswordReset({ username, ipKey = 'unknown' }) {
    const normalizedUsername = normalizeUsername(username);
    await consume('password_reset', `${ipKey}:${normalizedUsername || 'invalid'}`, 3, 60 * 60);
    const identity = normalizedUsername ? await identityStore.resolve(normalizedUsername) : null;
    if (identity) {
      try { await provider.requestPasswordReset(identity.email); } catch { /* generic response */ }
    }
    await auditSafe(audit, {
      action: 'auth.password_reset.request', resourceType: 'auth', result: 'success', metadata: {},
    });
    return { ok: true, message: 'If the account exists, recovery instructions were sent' };
  }

  async function authorizeRecoverySession(recoveryToken, requestedScope = 'password:complete') {
    if (requestedScope !== 'password:complete') {
      throw new SecurityError(403, 'AUTH_SCOPE_DENIED', 'Authentication scope is not permitted');
    }
    const providerSession = await provider.exchangeRecoveryToken(recoveryToken);
    const profile = await identityStore.loadProfile(providerSession.userId, providerSession.accessToken);
    if (!profile || profile.disabledAt) throw authInvalid();
    return sessions.create({
      userId: providerSession.userId,
      accessToken: providerSession.accessToken,
      refreshToken: providerSession.refreshToken,
      accessTokenExpiresAt: providerSession.accessTokenExpiresAt,
      aal: 1,
      authState: 'recovery',
      securityVersion: profile.securityVersion,
      role: canonicalRole(profile),
    });
  }

  async function completePasswordReset(session, password) {
    if (session?.authState !== 'recovery') {
      throw new SecurityError(403, 'AUTH_SCOPE_DENIED', 'Authentication scope is not permitted');
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new SecurityError(400, 'VALIDATION_FAILED', 'Request validation failed');
    }
    await provider.updatePassword(session, password);
    await identityStore.bumpSecurityVersion(session.userId);
    if (typeof sessions.revokeAll !== 'function') {
      await sessions.revoke(session, 'password_changed');
    } else {
      await sessions.revokeAll(session.userId, 'password_changed');
    }
    await auditSafe(audit, {
      actorUserId: session.userId, action: 'auth.password_reset.complete',
      resourceType: 'auth', result: 'success', metadata: {},
    });
    return { ok: true };
  }

  return Object.freeze({
    login, getSession, resume, logout, enrollMfa, challengeMfa, verifyMfa,
    requestPasswordReset, authorizeRecoverySession, completePasswordReset,
  });
}

function unwrap(data) {
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

function serverClient(url, key, accessToken) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

async function checkedRpc(client, name, parameters) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw error;
  return data;
}

function createSupabaseProvider(env) {
  async function authenticatedClient(session) {
    const client = serverClient(env.supabaseUrl, env.supabasePublishableKey);
    const { data, error } = await client.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
    if (error || !data?.session) throw error ?? new Error('provider session unavailable');
    return client;
  }

  return Object.freeze({
    async signInWithPassword(credentials) {
      const client = serverClient(env.supabaseUrl, env.supabasePublishableKey);
      const { data, error } = await client.auth.signInWithPassword(credentials);
      if (error || !data?.session || !data?.user) throw error ?? new Error('provider login failed');
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) throw assurance.error;
      return {
        userId: data.user.id,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        accessTokenExpiresAt: new Date(data.session.expires_at * 1_000).toISOString(),
        aal: assurance.data?.currentLevel === 'aal2' ? 2 : 1,
      };
    },
    async loadSelf(accessToken, expectedUserId) {
      const client = serverClient(env.supabaseUrl, env.supabasePublishableKey, accessToken);
      const [profileResult, membershipsResult] = await Promise.all([
        client.from('profiles')
          .select('id,activist_code,name,global_role,security_version,disabled_at')
          .eq('id', expectedUserId).single(),
        client.from('project_memberships')
          .select('project_id,role,status,projects(id,name)')
          .eq('user_id', expectedUserId).eq('status', 'active'),
      ]);
      if (profileResult.error || membershipsResult.error || !profileResult.data) {
        throw profileResult.error ?? membershipsResult.error ?? new Error('profile unavailable');
      }
      const profile = profileResult.data;
      const projects = (membershipsResult.data ?? []).map((membership) => ({
        id: membership.project_id,
        name: membership.projects?.name,
        role: membership.role,
      }));
      return {
        userId: profile.id,
        activistCode: profile.activist_code,
        name: profile.name,
        globalRole: profile.global_role,
        role: profile.global_role === 'ceo' ? 'ceo' : projects[0]?.role,
        securityVersion: profile.security_version,
        disabledAt: profile.disabled_at,
        projects,
      };
    },
    async refresh(refreshToken) {
      const client = serverClient(env.supabaseUrl, env.supabasePublishableKey);
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data?.session) throw error ?? new Error('provider refresh failed');
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        accessTokenExpiresAt: new Date(data.session.expires_at * 1_000).toISOString(),
      };
    },
    async enrollMfa(session) {
      const client = await authenticatedClient(session);
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp' });
      if (error) throw error;
      return { factorId: data.id, qrCode: data.totp?.qr_code };
    },
    async listMfaFactors(session) {
      const client = await authenticatedClient(session);
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      return (data?.totp ?? [])
        .filter((factor) => factor.status === 'verified')
        .map((factor) => ({ id: factor.id, type: 'totp' }));
    },
    async challengeMfa(session, factorId) {
      const client = await authenticatedClient(session);
      const { data, error } = await client.auth.mfa.challenge({ factorId });
      if (error) throw error;
      return { challengeId: data.id };
    },
    async verifyMfa(session, input) {
      const client = await authenticatedClient(session);
      const { data, error } = await client.auth.mfa.verify(input);
      if (error || !data) throw error ?? new Error('MFA verification failed');
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error || !sessionResult.data?.session) throw sessionResult.error ?? new Error('AAL2 session missing');
      return {
        aal: 2,
        accessToken: sessionResult.data.session.access_token,
        refreshToken: sessionResult.data.session.refresh_token,
        accessTokenExpiresAt: new Date(sessionResult.data.session.expires_at * 1_000).toISOString(),
      };
    },
    async requestPasswordReset(email) {
      const client = serverClient(env.supabaseUrl, env.supabasePublishableKey);
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: env.passwordResetRedirectUrl });
      if (error) throw error;
      return true;
    },
    async exchangeRecoveryToken(tokenHash) {
      const client = serverClient(env.supabaseUrl, env.supabasePublishableKey);
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      if (error || !data?.session || !data?.user) throw error ?? new Error('recovery token invalid');
      return {
        userId: data.user.id,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        accessTokenExpiresAt: new Date(data.session.expires_at * 1_000).toISOString(),
        aal: 1,
      };
    },
    async updatePassword(session, password) {
      const client = await authenticatedClient(session);
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      return true;
    },
  });
}

let defaultRuntime;

export function getDefaultAuthRuntime() {
  if (defaultRuntime) return defaultRuntime;
  const env = getServerEnv();
  if (!env.securityBffAuthEnabled) {
    throw new SecurityError(503, 'AUTH_DISABLED', 'Authentication is not enabled');
  }
  const serviceClient = serverClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const provider = createSupabaseProvider(env);
  const dbStore = createSupabaseSessionStore({ client: serviceClient });
  const sessionEnv = {
    sessionIdPepper: env.sessionIdPepper,
    tokenKeys: env.sessionTokenKeys,
    tokenKeyVersion: env.sessionTokenKeyVersion,
    production: env.nodeEnv === 'production',
  };
  const sessionDependencies = { store: dbStore, env: sessionEnv, provider };
  const sessions = {
    create: (input) => createOpaqueSession(input, sessionDependencies),
    load: (cookieValue) => loadOpaqueSession({
      cookies: { [env.nodeEnv === 'production' ? productionCookie.name : 'mekarvim_session']: cookieValue },
    }, sessionDependencies),
    rotate: (session, patch, reason) => rotateOpaqueSession({ ...session, ...patch }, reason, sessionDependencies),
    revoke: (session, reason) => revokeOpaqueSession(session, reason, { store: dbStore }),
    revokeAll: async () => true,
  };
  const identityStore = {
    async resolve(username) {
      const resolved = unwrap(await checkedRpc(serviceClient, 'app_identity_resolve', { p_normalized_username: username }));
      return resolved ? { userId: resolved.user_id, email: resolved.login_email } : null;
    },
    loadProfile: (userId, accessToken) => provider.loadSelf(accessToken, userId),
    async bumpSecurityVersion(userId) {
      return checkedRpc(serviceClient, 'app_user_security_invalidate', {
        p_user_id: userId, p_reason: 'password_changed',
      });
    },
  };
  const rateLimiter = {
    consume: ({ kind, key, limit, windowSeconds }) => consumeRateLimit(
      `${kind}:${key}`, limit, windowSeconds,
      { store: dbStore, pepper: env.sessionIdPepper },
    ),
  };
  const audit = {
    append: (event) => checkedRpc(serviceClient, 'app_audit_append', {
      p_actor_user_id: event.actorUserId ?? null,
      p_effective_role: event.effectiveRole ?? null,
      p_project_id: event.projectId ?? null,
      p_action: event.action,
      p_resource_type: event.resourceType,
      p_resource_id: event.resourceId ?? null,
      p_result: event.result,
      p_reason_code: event.reasonCode ?? null,
      p_correlation_id: event.correlationId ?? null,
      p_session_ref: event.sessionRef ?? null,
      p_metadata: event.metadata ?? {},
    }),
  };
  const service = createAuthService({ identityStore, provider, sessions, rateLimiter, audit });
  defaultRuntime = Object.freeze({ service, env, sessions });
  return defaultRuntime;
}

export async function loadAuthSession(req) {
  const runtime = getDefaultAuthRuntime();
  const rawId = readSessionCookie(req, { production: runtime.env.nodeEnv === 'production' });
  return runtime.service.getSession(rawId);
}
