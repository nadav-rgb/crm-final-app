import { randomUUID } from 'node:crypto';
import { loadAuthSession } from './auth-service.mjs';
import { createUserSupabase } from './supabase-user.mjs';
import { SecurityError } from './errors.mjs';

function correlationId(req) {
  const value = req?.headers?.['x-request-id'];
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : randomUUID();
}

async function loadIdentityWithUserDb(userId, accessToken) {
  const db = createUserSupabase(accessToken);
  const [profileResult, membershipsResult] = await Promise.all([
    db.from('profiles').select('id,global_role,security_version,disabled_at').eq('id', userId).single(),
    db.from('project_memberships').select('project_id,role,status').eq('user_id', userId).eq('status', 'active'),
  ]);
  if (profileResult.error || membershipsResult.error || !profileResult.data) {
    throw new SecurityError(401, 'SESSION_INVALID', 'Session is invalid');
  }
  return {
    userId: profileResult.data.id,
    globalRole: profileResult.data.global_role,
    securityVersion: profileResult.data.security_version,
    disabledAt: profileResult.data.disabled_at,
    memberships: (membershipsResult.data ?? []).map((membership) => ({
      projectId: membership.project_id, role: membership.role, status: membership.status,
    })),
  };
}

export async function resolveRequestContext(req, {
  minimumAal = 1,
  loadSession = loadAuthSession,
  loadIdentity = loadIdentityWithUserDb,
  createDb = createUserSupabase,
} = {}) {
  const session = await loadSession(req);
  if (!session || session.authState !== 'active') {
    const code = session?.authState === 'mfa_required' ? 'MFA_REQUIRED' : 'SESSION_INVALID';
    throw new SecurityError(code === 'MFA_REQUIRED' ? 403 : 401, code, code === 'MFA_REQUIRED' ? 'Multi-factor authentication is required' : 'Session is invalid');
  }
  if (!Number.isSafeInteger(minimumAal) || ![1, 2].includes(minimumAal)) {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
  if (session.aal < minimumAal) {
    throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
  }
  const identity = await loadIdentity(session.userId, session.accessToken);
  if (
    !identity || identity.userId !== session.userId || identity.disabledAt
    || identity.securityVersion !== session.securityVersion
  ) {
    throw new SecurityError(401, 'SESSION_INVALID', 'Session is invalid');
  }
  const memberships = (identity.memberships ?? []).filter((membership) => membership.status === 'active').map((membership) => ({
    projectId: Number(membership.projectId), role: membership.role, status: 'active',
  }));
  return Object.freeze({
    requestId: correlationId(req),
    userId: session.userId,
    globalRole: identity.globalRole ?? null,
    memberships,
    disabledAt: null,
    aal: session.aal,
    session,
    db: createDb(session.accessToken),
  });
}
