import { getServerEnv } from '../env.mjs';
import { SecurityError } from '../errors.mjs';

export function requireContactsBff() {
  const env = getServerEnv();
  if (!env.securityBffContactsEnabled) {
    throw new SecurityError(503, 'FEATURE_DISABLED', 'This operation is not enabled');
  }
  return env;
}

export function activeMemberLookup(context) {
  return async (projectId, userId) => {
    const { data, error } = await context.db.from('project_memberships').select('user_id')
      .eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
    return Boolean(data);
  };
}
