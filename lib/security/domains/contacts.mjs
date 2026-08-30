import { SecurityError } from '../errors.mjs';
import { authorize } from '../rbac.mjs';
import { contactCreateSchema, contactUpdateSchema } from '../schemas.mjs';

const LIST_COLUMNS = 'id,name,city,is_active,assigned_user_id,next_action_date,project_id';
const DETAIL_COLUMNS = `${LIST_COLUMNS},activist_id,phone,area,depth,profession,age,gender,high_potential,days_since_last_contact,last_interaction_date,next_action,source,joined_at,notes,how_met,mitzvot,mitzvot_history,is_graduate,referred_by,meeting_place_city,meeting_place_number,tour_id,meetingHouseCity,meetingHouseNumber,meetingHouseKey`;

const CONTACT_FIELD_MAP = Object.freeze({
  name: 'name', phone: 'phone', city: 'city', area: 'area', depth: 'depth',
  profession: 'profession', age: 'age', gender: 'gender', highPotential: 'high_potential',
  daysSinceLastContact: 'days_since_last_contact', lastInteractionDate: 'last_interaction_date',
  nextAction: 'next_action', nextActionDate: 'next_action_date', source: 'source',
  joinedAt: 'joined_at', notes: 'notes', howMet: 'how_met', mitzvot: 'mitzvot',
  mitzvotHistory: 'mitzvot_history', isGraduate: 'is_graduate', referredBy: 'referred_by',
  meetingPlaceCity: 'meeting_place_city', meetingPlaceNumber: 'meeting_place_number',
  meetingHouseCity: 'meetingHouseCity', meetingHouseNumber: 'meetingHouseNumber',
  meetingHouseKey: 'meetingHouseKey', tourId: 'tour_id',
});

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
    status: row.is_active === false ? 'inactive' : 'active',
    assignedUserId: row.assigned_user_id,
    nextActionAt: row.next_action_date ?? null,
    projectId: Number(row.project_id),
  };
}

export function toContactDetailDto(context, row) {
  assertContactAccess(context, 'read-sensitive', row);
  return {
    ...toContactListDto(row),
    phone: row.phone ?? null,
    activistCode: row.activist_id == null ? null : Number(row.activist_id),
    area: escapeHtmlText(row.area ?? ''),
    depth: escapeHtmlText(row.depth ?? ''),
    profession: escapeHtmlText(row.profession ?? ''),
    age: row.age ?? null,
    gender: row.gender ?? null,
    highPotential: Boolean(row.high_potential),
    daysSinceLastContact: Number(row.days_since_last_contact ?? 0),
    lastInteractionDate: row.last_interaction_date ?? null,
    nextAction: escapeHtmlText(row.next_action ?? ''),
    source: escapeHtmlText(row.source ?? ''),
    joinedAt: row.joined_at ?? null,
    notes: escapeHtmlText(row.notes ?? ''),
    howMet: escapeHtmlText(row.how_met ?? ''),
    mitzvot: row.mitzvot ?? {},
    mitzvotHistory: row.mitzvot_history ?? [],
    isGraduate: Boolean(row.is_graduate),
    referredBy: row.referred_by ?? null,
    meetingPlaceCity: escapeHtmlText(row.meeting_place_city ?? ''),
    meetingPlaceNumber: escapeHtmlText(row.meeting_place_number ?? ''),
    meetingHouseCity: escapeHtmlText(row.meetingHouseCity ?? ''),
    meetingHouseNumber: escapeHtmlText(row.meetingHouseNumber ?? ''),
    meetingHouseKey: escapeHtmlText(row.meetingHouseKey ?? ''),
    tourId: row.tour_id ?? null,
  };
}

function selectedCreateScope(context, requestedProjectId) {
  const active = context?.memberships?.filter((entry) => (
    entry.status === 'active' && entry.role !== 'finance'
  )) ?? [];
  if (requestedProjectId !== undefined) {
    if (context.globalRole === 'ceo') return { projectId: requestedProjectId, role: 'ceo' };
    const selected = active.find((entry) => Number(entry.projectId) === Number(requestedProjectId));
    if (selected) return selected;
    throw new SecurityError(400, 'PROJECT_REQUIRED', 'An authorized project must be selected');
  }
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
  const selected = dependencies.membership ?? selectedCreateScope(context, parsed.data.projectId);
  const row = { project_id: selected.projectId, assigned_user_id: context.userId };
  assertContactAccess(context, 'create', row);

  let assignee = context.userId;
  if (selected.role !== 'activist' && parsed.data.assignedUserId) {
    await assertAssignable(selected.projectId, parsed.data.assignedUserId, dependencies);
    assignee = parsed.data.assignedUserId;
  } else if (selected.role === 'activist' && parsed.data.assignedUserId && parsed.data.assignedUserId !== context.userId) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  }

  const command = {
    project_id: selected.projectId,
    assigned_user_id: assignee,
  };
  for (const [apiField, dbField] of Object.entries(CONTACT_FIELD_MAP)) {
    if (parsed.data[apiField] !== undefined) command[dbField] = parsed.data[apiField];
  }
  return command;
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
  for (const [apiField, dbField] of Object.entries(CONTACT_FIELD_MAP)) {
    if (parsed.data[apiField] !== undefined) command[dbField] = parsed.data[apiField];
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
  const { data: project, error: projectError } = await context.db.from('projects')
    .select('id').eq('id', command.project_id).maybeSingle();
  queryError(projectError);
  if (!project) throw new SecurityError(400, 'PROJECT_REQUIRED', 'An authorized project must be selected');
  const { data, error } = await context.db.from('contacts').insert(command).select(DETAIL_COLUMNS).single();
  queryError(error);
  return toContactDetailDto(context, data);
}

export async function updateContact(context, id, input, dependencies = {}) {
  const existing = await getContact(context, id);
  const command = await updateContactCommand(context, existing, input, dependencies);
  if (command.assigned_user_id !== undefined) {
    const assignedUserId = command.assigned_user_id;
    delete command.assigned_user_id;
    const { data: reassigned, error: reassignError } = await context.db.rpc('app_reassign_contact', {
      p_contact_id: String(id),
      p_assigned_user_id: assignedUserId,
    });
    queryError(reassignError);
    if (reassigned !== true) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  }
  if (command.tour_id !== undefined) {
    const tourId = command.tour_id;
    delete command.tour_id;
    const { data: linked, error: linkError } = await context.db.rpc('app_link_contact_tour', {
      p_contact_id: String(id),
      p_tour_id: tourId,
    });
    queryError(linkError);
    if (linked !== true) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  }
  if (Object.keys(command).length === 0) {
    const updated = await getContact(context, id);
    return toContactDetailDto(context, updated);
  }
  const { data, error } = await context.db.from('contacts').update(command).eq('id', id)
    .select(DETAIL_COLUMNS).maybeSingle();
  queryError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  return toContactDetailDto(context, data);
}

export async function softDeleteContact(context, id) {
  const existing = await getContact(context, id);
  assertContactAccess(context, 'delete', existing);
  const { data, error } = await context.db.rpc('app_soft_delete_contact', { p_contact_id: String(id) });
  queryError(error);
  if (data !== true) throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  return { deleted: true };
}

export function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export async function checkDuplicateContact(context, input, dependencies) {
  requireContext(context);
  const projectId = Number(input?.projectId);
  const phone = normalizePhone(input?.phone);
  if (phone.length < 7) throw new SecurityError(400, 'VALIDATION_FAILED', 'Phone number is invalid');
  if (typeof dependencies?.consumeRate !== 'function') {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
  const rate = await dependencies.consumeRate({
    kind: 'duplicate_lookup',
    key: `${context.userId}:${projectId}:${dependencies.ipKey ?? 'unknown'}`,
    limit: 20,
    windowSeconds: 5 * 60,
  });
  if (!rate?.allowed) throw new SecurityError(429, 'RATE_LIMITED', 'Too many requests');
  if (context.globalRole !== 'ceo' && !membership(context, projectId)) return { duplicate: false };
  try {
    return { duplicate: Boolean(await dependencies.lookup({ projectId, phoneSuffix: phone.slice(-8) })) };
  } catch (cause) {
    throw new SecurityError(503, 'DEPENDENCY_UNAVAILABLE', 'Duplicate check is unavailable', { cause });
  }
}
