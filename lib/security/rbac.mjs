const KNOWN_CAPABILITIES = [
  'contact:read', 'contact:read-sensitive', 'contact:create', 'contact:update', 'contact:delete',
  'interaction:read', 'interaction:create', 'interaction:update', 'interaction:delete',
  'meeting:read', 'meeting:create', 'meeting:update', 'meeting:delete',
  'tour:read', 'tour:create', 'tour:update', 'tour:report', 'tour:delete',
  'finance:read', 'expense:create', 'expense:update', 'expense:delete',
  'report:read', 'report:export', 'feedback:review',
  'membership:manage', 'membership:set-ceo', 'project:manage',
  'notification:target', 'audit:read',
];

export const CAPABILITIES = new Set(KNOWN_CAPABILITIES);

function activeMembership(context, projectId) {
  return context.memberships?.find((membership) => (
    membership.status === 'active' && Number(membership.projectId) === Number(projectId)
  ));
}

function projectIdOf(resource) {
  return resource?.projectId ?? resource?.id ?? null;
}

function elevated(role, aal) {
  return role !== 'head' || aal >= 2;
}

export function authorize(context, capability, resource = {}) {
  if (!context || context.disabledAt || !CAPABILITIES.has(capability)) return false;
  const isCeo = context.globalRole === 'ceo';
  if (isCeo) return context.aal >= 2;

  const projectId = projectIdOf(resource);
  const membership = activeMembership(context, projectId);
  if (!membership) return false;
  const role = membership.role;
  const isOwner = Boolean(resource.assignedUserId === context.userId
    || resource.actorUserId === context.userId
    || resource.userId === context.userId
    || resource.recipientUserId === context.userId
    || resource.assignedUserIds?.includes?.(context.userId));

  switch (capability) {
    case 'contact:read':
    case 'contact:create':
    case 'contact:update':
      return role === 'activist' ? isOwner : ['coord', 'head'].includes(role) && elevated(role, context.aal);
    case 'contact:read-sensitive':
      return role === 'activist' ? isOwner : role === 'coord' || (role === 'head' && context.aal >= 2);
    case 'contact:delete':
      return role === 'head' && context.aal >= 2;
    case 'interaction:read':
    case 'interaction:create':
    case 'interaction:update':
      return role === 'activist' ? isOwner : role === 'coord' || (role === 'head' && context.aal >= 2);
    case 'interaction:delete':
      return (role === 'activist' && isOwner) || (role === 'head' && context.aal >= 2);
    case 'meeting:read':
      return ['coord', 'finance'].includes(role) || (role === 'head' && context.aal >= 2) || (role === 'activist' && isOwner);
    case 'meeting:create':
    case 'meeting:update':
      return role === 'coord' || (role === 'head' && context.aal >= 2);
    case 'meeting:delete':
      return role === 'head' && context.aal >= 2;
    case 'tour:read':
      return role === 'coord' || (role === 'head' && context.aal >= 2) || (role === 'activist' && isOwner);
    case 'tour:create':
    case 'tour:update':
      return role === 'coord' || (role === 'head' && context.aal >= 2);
    case 'tour:report':
      return role === 'activist' && isOwner;
    case 'tour:delete':
      return role === 'head' && context.aal >= 2;
    case 'finance:read':
      return role === 'finance' || (role === 'head' && context.aal >= 2);
    case 'expense:create':
    case 'expense:update':
    case 'expense:delete':
      return role === 'activist' && isOwner;
    case 'report:read':
    case 'report:export':
      return role === 'head' && context.aal >= 2;
    case 'feedback:review':
      return role === 'coord' || (role === 'head' && context.aal >= 2);
    case 'membership:manage':
      return role === 'head' && context.aal >= 2
        && resource.userId !== context.userId
        && ['activist', 'coord'].includes(resource.targetRole);
    case 'membership:set-ceo':
    case 'project:manage':
    case 'audit:read':
      return false;
    case 'notification:target':
      return role === 'coord' || (role === 'head' && context.aal >= 2)
        || (role === 'activist' && resource.recipientUserId === context.userId);
    default:
      return false;
  }
}
