import { resolveRequestContext } from '../../../lib/security/request-context.mjs';

function legacyProfile(context) {
  const membership = context.memberships?.[0];
  return {
    role: context.globalRole === 'ceo' ? 'ceo' : membership?.role ?? null,
    project_id: membership?.projectId ?? null,
    user_id: context.userId,
    name: null,
  };
}

export async function requireAuth(req) {
  try {
    const context = await resolveRequestContext(req);
    return { ok: true, user: { id: context.userId }, profile: legacyProfile(context), context };
  } catch (error) {
    return { ok: false, status: error?.status ?? 401, error: error?.publicMessage ?? 'Authentication is required' };
  }
}

export async function requireWriteRole(req) {
  const result = await requireAuth(req);
  if (!result.ok) return result;
  const role = result.profile.role;
  const allowed = role === 'ceo' || role === 'coord' || (role === 'head' && result.context.aal >= 2);
  return allowed ? result : { ok: false, status: 403, error: 'Access is denied' };
}
