import { createClient } from '@supabase/supabase-js';
import { SecurityError } from '../errors.mjs';
import { getServerEnv } from '../env.mjs';
import { membershipChangeSchema } from '../schemas.mjs';

function activeMembership(context, projectId) {
  return context?.memberships?.find((membership) => (
    membership.status === 'active' && Number(membership.projectId) === Number(projectId)
  ));
}

function requireContext(context) {
  if (!context?.userId) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required');
}

export function assertDirectoryAccess(context, projectId) {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  if (!activeMembership(context, projectId)) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
}

export function projectDirectoryDto(context, rows) {
  requireContext(context);
  const authorized = context.globalRole === 'ceo'
    ? rows
    : rows.filter((project) => activeMembership(context, project.id));
  return authorized.map((project) => ({ id: Number(project.id), name: project.name }));
}

export function profileDirectoryDto(context, profile, membershipRows = []) {
  requireContext(context);
  const self = profile.id === context.userId;
  const roles = context.memberships?.filter((entry) => entry.status === 'active').map((entry) => entry.role) ?? [];
  if (context.globalRole !== 'ceo' && roles.every((role) => role === 'activist') && !self) {
    throw new SecurityError(404, 'NOT_FOUND', 'Profile was not found');
  }
  const base = { userId: profile.id, name: profile.name, activistCode: profile.activist_code ?? null };
  if (self || roles.includes('finance')) return base;
  return {
    ...base,
    memberships: membershipRows.map((membership) => ({
      projectId: Number(membership.project_id), role: membership.role, status: membership.status,
    })),
  };
}

export async function changeMembershipCommand(context, input) {
  requireContext(context);
  const parsed = membershipChangeSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const command = {
    targetUserId: parsed.data.userId,
    projectId: parsed.data.projectId,
    role: parsed.data.role,
    status: parsed.data.status,
  };
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return command;
  }
  const membership = activeMembership(context, command.projectId);
  if (
    context.aal < 2 || membership?.role !== 'head' || command.targetUserId === context.userId
    || !['activist', 'coord'].includes(command.role)
  ) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  return command;
}

export async function changeMembership(context, input, dependencies) {
  const command = await changeMembershipCommand(context, input);
  const existing = await dependencies.findMembership(command.projectId, command.targetUserId);
  if (existing?.role === command.role && existing?.status === command.status) {
    throw new SecurityError(409, 'MEMBERSHIP_CONFLICT', 'Membership already has that state');
  }
  if (command.role === 'ceo' && command.status !== 'active') {
    const count = await dependencies.countActiveCeos();
    if (count <= 1) throw new SecurityError(409, 'LAST_CEO_REQUIRED', 'At least one active CEO is required');
  }
  const changed = await dependencies.rpc(command);
  if (!changed) throw new SecurityError(409, 'MUTATION_REJECTED', 'Membership change was rejected');
  return { changed: true };
}

export async function listProjects(context) {
  requireContext(context);
  const { data, error } = await context.db.from('projects').select('id,name').order('name');
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  return projectDirectoryDto(context, data ?? []);
}

export async function listProjectDirectory(context, projectId) {
  assertDirectoryAccess(context, projectId);
  const { data, error } = await context.db.from('project_memberships')
    .select('project_id,role,status,profiles!inner(id,name,activist_code)')
    .eq('project_id', projectId).eq('status', 'active');
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  const rows = context.globalRole === 'ceo' || context.memberships?.some((entry) => ['head', 'coord', 'finance'].includes(entry.role))
    ? (data ?? [])
    : (data ?? []).filter((row) => row.profiles?.id === context.userId);
  return rows.map((row) => profileDirectoryDto(context, row.profiles, [row]));
}

export async function getProfile(context, userId) {
  requireContext(context);
  if (context.globalRole !== 'ceo' && userId !== context.userId) {
    const manager = context.memberships?.some((entry) => entry.status === 'active' && ['head', 'coord', 'finance'].includes(entry.role));
    if (!manager) throw new SecurityError(404, 'NOT_FOUND', 'Profile was not found');
  }
  const { data, error } = await context.db.from('profiles').select('id,name,activist_code').eq('id', userId).maybeSingle();
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Profile was not found');
  return profileDirectoryDto(context, data);
}

export function createGovernanceRpc() {
  const env = getServerEnv();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new SecurityError(503, 'GOVERNANCE_UNAVAILABLE', 'Governance changes are unavailable');
  }
  const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return async (context, command) => {
    const { data, error } = await client.rpc('app_membership_change', {
      p_actor_session_hash: context.session.idHash,
      p_actor_user_id: context.userId,
      p_target_user_id: command.targetUserId,
      p_project_id: command.projectId,
      p_role: command.role,
      p_status: command.status,
    });
    if (error) throw new SecurityError(503, 'GOVERNANCE_UNAVAILABLE', 'Governance changes are unavailable', { cause: error });
    return Boolean(data);
  };
}
