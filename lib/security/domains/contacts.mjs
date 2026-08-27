import { SecurityError } from '../errors.mjs';
import { authorize } from '../rbac.mjs';
import { contactCreateSchema, contactUpdateSchema } from '../schemas.mjs';

const LIST_COLUMNS = 'id,name,city,status,assigned_user_id,next_action_at,project_id';
const DETAIL_COLUMNS = `${LIST_COLUMNS},phone,notes,mitzvot,mitzvot_history`;

function membership(context, projectId) {
  return context?.memberships?.find((entry) => (
    entry.status === 'active' && Number(entry.projectId) === Number(projectId)
  ));
}

function resourceOf(row) {
  return {
    id: row?.id,
    projectId: row?.project_id,
    assignedUserId: row?.assigned_user_id,
  };
}

function requireContext(context) {
  if (!context?.userId) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required');
  if (context.globalRole === 'ceo' && context.aal < 2) {
    throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
  }
}

export function assertContactAccess(context, action, row) {
  requireContext(context);
  const capability = `contact:${action}`;
  if (context.globalRole === 'ceo') {
    if (!authorize(context, capability, resourceOf(row))) {
      throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
    }
    return;
  }

  const active = membership(context, row?.project_id);
  if (!active) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  if (active.role === 'finance') throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  if (active.role === 'activist' && row?.assigned_user_id !== context.userId) {
    throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  }
  if (!authorize(context, capability, resourceOf(row))) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
}

export function escapeHtmlText(value) {
  if (value === null || value === undefined) return value;
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function toContactListDto(row) {
  return {
    id: row.id,
    name: escapeHtmlText(row.name),
    city: escapeHtmlText(row.city ?? ''),
    status: row.status ?? 'active',
    assignedUserId: row.assigned_user_id,
    nextActionAt: row.next_action_at ?? null,
  };
}

export function toContactDetailDto(context, row) {
  assertContactAccess(context, 'read-sensitive', row);
  return {
    ...toContactListDto(row),
    phone: row.phone ?? null,
    notes: escapeHtmlText(row.notes ?? ''),
    mitzvot: row.mitzvot ?? {},
    mitzvotHistory: row.mitzvot_history ?? [],
  };
}

function firstActiveMembership(context) {
  const active = context?.memberships?.filter((entry) => entry.status === 'active') ?? [];
  if (active.length !== 1) {
    throw new SecurityError(400, 'PROJECT_REQUIRED', 'An authorized project must be selected');
  }
  return active[0];
}

async function assertAssignable(projectId, userId, dependencies) {
  if (!userId) return;
  if (typeof dependencies.isActiveMember !== 'function') {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
  if (!await dependencies.isActiveMember(projectId, userId)) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Assignee is not an active project member');
  }
}

export async function createContactCommand(context, input, dependencies = {}) {
  requireContext(context);
  const parsed = contactCreateSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const selected = dependencies.membership ?? firstActiveMembership(context);
  const row = { project_id: selected.projectId, assigned_user_id: context.userId };
  assertContactAccess(context, 'create', row);

  let assignee = context.userId;
  if (selected.role !== 'activist' && parsed.data.assignedUserId) {
    await assertAssignable(selected.projectId, parsed.data.assignedUserId, dependencies);
    assignee = parsed.data.assignedUserId;
  } else if (selected.role === 'activist' && parsed.data.assignedUserId && parsed.data.assignedUserId !== context.userId) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  }

  return {
    project_id: selected.projectId,
    assigned_user_id: assignee,
    name: parsed.data.name,
    phone: parsed.data.phone ?? null,
    city: parsed.data.city ?? null,
    notes: parsed.data.notes ?? null,
  };
}

export async function updateContactCommand(context, existing, input, dependencies = {}) {
  requireContext(context);
  const parsed = contactUpdateSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  assertContactAccess(context, 'update', existing);
  const active = membership(context, existing.project_id);
  if (active?.role === 'activist' && parsed.data.assignedUserId !== undefined) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  }

  const command = {};
  for (const key of ['name', 'phone', 'city', 'notes']) {
    if (parsed.data[key] !== undefined) command[key] = parsed.data[key];
  }
  if (parsed.data.assignedUserId !== undefined) {
    await assertAssignable(existing.project_id, parsed.data.assignedUserId, dependencies);
    command.assigned_user_id = parsed.data.assignedUserId;
  }
  return command;
}

function queryError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

export async function listContacts(context) {
  requireContext(context);
  const roles = context.memberships?.filter((m) => m.status === 'active').map((m) => m.role) ?? [];
  if (context.globalRole !== 'ceo' && (roles.length === 0 || roles.every((role) => role === 'finance'))) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  const { data, error } = await context.db.from('contacts').select(LIST_COLUMNS).eq('is_active', true);
  queryError(error);
  return (data ?? []).map(toContactListDto);
}

export async function getContact(context, id) {
  requireContext(context);
  const { data, error } = await context.db.from('contacts').select(DETAIL_COLUMNS)
    .eq('id', id).eq('is_active', true).maybeSingle();
  queryError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  return data;
}

export async function createContact(context, input, dependencies = {}) {
  const command = await createContactCommand(context, input, dependencies);
  const { data, error } = await context.db.from('contacts').insert(command).select(DETAIL_COLUMNS).single();
  queryError(error);
  return toContactDetailDto(context, data);
}

export async function updateContact(context, id, input, dependencies = {}) {
  const existing = await getContact(context, id);
  const command = await updateContactCommand(context, existing, input, dependencies);
  const { data, error } = await context.db.from('contacts').update(command).eq('id', id)
    .select(DETAIL_COLUMNS).maybeSingle();
  queryError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  return toContactDetailDto(context, data);
}

export async function softDeleteContact(context, id) {
  const existing = await getContact(context, id);
  assertContactAccess(context, 'delete', existing);
  const { data, error } = await context.db.from('contacts').update({ is_active: false }).eq('id', id).select('id').maybeSingle();
  queryError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  return { deleted: true };
}

export function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export async function checkDuplicateContact(context, input, dependencies) {
  requireContext(context);
  const projectId = Number(input?.projectId);
  if (context.globalRole !== 'ceo' && !membership(context, projectId)) return { duplicate: false };
  const phone = normalizePhone(input?.phone);
  if (phone.length < 7) throw new SecurityError(400, 'VALIDATION_FAILED', 'Phone number is invalid');
  try {
    return { duplicate: Boolean(await dependencies.lookup({ projectId, phoneSuffix: phone.slice(-8) })) };
  } catch (cause) {
    throw new SecurityError(503, 'DEPENDENCY_UNAVAILABLE', 'Duplicate check is unavailable', { cause });
  }
}

