import { getServerEnv } from '../env.mjs';
import { SecurityError } from '../errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireContactsBff() {
  const env = getServerEnv();
  if (!env.securityBffContactsEnabled) {
    throw new SecurityError(503, 'FEATURE_DISABLED', 'This operation is not enabled');
  }
  return env;
}

export function activeMemberLookup(context) {
  return (projectId, userId) => projectMembersAreActive(context, projectId, [userId]);
}

export async function projectMembersAreActive(context, projectId, userIds) {
  const scopedProjectId = Number(projectId);
  if (!Number.isSafeInteger(scopedProjectId) || scopedProjectId <= 0
    || !Array.isArray(userIds) || userIds.length > 100) return false;
  if (userIds.length === 0) return true;
  if (userIds.some((userId) => typeof userId !== 'string' || !UUID.test(userId))) return false;
  const ids = [...new Set(userIds.map((userId) => userId.toLowerCase()))];
  if (ids.length !== userIds.length || ids.some((id) => !id)) return false;
  const { data, error } = await context.db.rpc('app_project_members_are_active', {
    p_project_id: scopedProjectId, p_user_ids: ids,
  });
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  return data === true;
}
