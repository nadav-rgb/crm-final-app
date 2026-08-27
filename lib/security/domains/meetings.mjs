import { createHash } from 'node:crypto';
import { SecurityError } from '../errors.mjs';
import {
  baseReportCommandSchema, meetingHouseCommandSchema, reminderScheduleSchema,
} from '../schemas.mjs';

function activeMembership(context, projectId) {
  return context?.memberships?.find((membership) => (
    membership.status === 'active' && Number(membership.projectId) === Number(projectId)
  ));
}

function requireContext(context) {
  if (!context?.userId) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required');
}

export function assertHouseAccess(context, action, house) {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  const membership = activeMembership(context, house?.project_id);
  if (!membership) throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  if (['assign', 'manage'].includes(action)) {
    if (membership.role === 'coord' || (membership.role === 'head' && context.aal >= 2)) return;
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  if (action === 'report') {
    if (membership.role === 'activist' && house.assigned_user_ids?.includes(context.userId)) return;
    if (membership.role === 'coord' || (membership.role === 'head' && context.aal >= 2)) return;
    throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  }
  if (membership.role === 'activist' && !house.assigned_user_ids?.includes(context.userId)) {
    throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  }
  if (!['activist', 'coord', 'head', 'finance'].includes(membership.role)) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
}

export async function assignHouseCommand(context, house, input, dependencies) {
  assertHouseAccess(context, 'assign', house);
  const ids = input?.assignedUserIds;
  if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Assignees are invalid');
  }
  if (!await dependencies.areActiveMembers(house.project_id, ids)) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Assignees are invalid');
  }
  return { assigned_user_ids: ids };
}

export async function createHouseCommand(context, input, dependencies = {}) {
  requireContext(context);
  const parsed = meetingHouseCommandSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const memberships = context.memberships?.filter((entry) => entry.status === 'active' && ['coord', 'head'].includes(entry.role)) ?? [];
  if (context.globalRole !== 'ceo' && memberships.length !== 1) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  const projectId = dependencies.projectId ?? memberships[0]?.projectId;
  const synthetic = { project_id: projectId, assigned_user_ids: parsed.data.assignedUserIds };
  assertHouseAccess(context, 'manage', synthetic);
  if (!await dependencies.areActiveMembers(projectId, parsed.data.assignedUserIds)) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Assignees are invalid');
  }
  return {
    ...(parsed.data.id !== undefined ? { id: parsed.data.id } : {}),
    project_id: projectId,
    settlement: parsed.data.settlement,
    house_number: parsed.data.houseNumber ?? null,
    city: parsed.data.city ?? parsed.data.settlement,
    host_name: parsed.data.hostName ?? null,
    facilitator_name: parsed.data.facilitatorName ?? null,
    assigned_user_ids: parsed.data.assignedUserIds,
    meetings: parsed.data.meetings,
    notes: parsed.data.notes ?? null,
  };
}

export async function createBaseReportCommand(context, house, input) {
  requireContext(context);
  const parsed = baseReportCommandSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  assertHouseAccess(context, 'report', house);
  return {
    actor_user_id: context.userId,
    project_id: house.project_id,
    house_id: house.id,
    occurred_at: parsed.data.occurredAt,
    notes: parsed.data.notes,
    participant_ids: [...new Set(parsed.data.participantIds.map(String))],
  };
}

export function reminderIdempotencyKey(meetingId, recipientUserId) {
  return createHash('sha256').update(`meeting-reminder\0${meetingId}\0${recipientUserId}`).digest('hex');
}

export async function scheduleReminderCommand(context, report, house, input, options = {}) {
  requireContext(context);
  const parsed = reminderScheduleSchema.safeParse(input);
  if (!parsed.success || String(parsed.data.meetingId) !== String(report.id)) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  }
  if (report.project_id !== house.project_id || report.house_id !== house.id) {
    throw new SecurityError(404, 'NOT_FOUND', 'Meeting was not found');
  }
  if (context.globalRole !== 'ceo' && report.actor_user_id !== context.userId) {
    throw new SecurityError(404, 'NOT_FOUND', 'Meeting was not found');
  }
  const key = reminderIdempotencyKey(report.id, report.actor_user_id);
  if (options.existingKey === key) throw new SecurityError(409, 'REMINDER_CONFLICT', 'Reminder is already scheduled');
  return {
    meeting_id: report.id,
    project_id: report.project_id,
    recipient_user_id: report.actor_user_id,
    idempotency_key: key,
  };
}

export async function cancelReminderCommand(context, reminder) {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
  } else if (reminder.recipient_user_id !== context.userId) {
    throw new SecurityError(404, 'NOT_FOUND', 'Reminder was not found');
  }
  return { id: reminder.id, cancelled_at: new Date().toISOString() };
}

function dbError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

export async function getHouse(context, id) {
  requireContext(context);
  const { data, error } = await context.db.from('meeting_houses')
    .select('id,project_id,settlement,city,host_name,facilitator_name,status,assigned_user_ids,meetings')
    .eq('id', id).maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  return data;
}

export async function listHouses(context) {
  requireContext(context);
  const { data, error } = await context.db.from('meeting_houses')
    .select('id,project_id,house_number,settlement,city,host_name,facilitator_name,status,assigned_user_ids,meetings,created_at')
    .order('created_at', { ascending: false });
  dbError(error);
  return data ?? [];
}

export async function assignHouse(context, houseId, input) {
  const house = await getHouse(context, houseId);
  const areActiveMembers = async (projectId, ids) => {
    if (ids.length === 0) return true;
    const { data, error } = await context.db.from('project_memberships').select('user_id')
      .eq('project_id', projectId).eq('status', 'active').in('user_id', ids);
    dbError(error);
    return new Set((data ?? []).map((row) => row.user_id)).size === ids.length;
  };
  const command = await assignHouseCommand(context, house, input, { areActiveMembers });
  const { data, error } = await context.db.from('meeting_houses').update(command).eq('id', house.id)
    .select('id,project_id,settlement,city,status,assigned_user_ids').maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  return data;
}

export async function upsertHouse(context, input) {
  const areActiveMembers = async (projectId, ids) => {
    if (ids.length === 0) return true;
    const { data, error } = await context.db.from('project_memberships').select('user_id')
      .eq('project_id', projectId).eq('status', 'active').in('user_id', ids);
    dbError(error);
    return (data ?? []).length === ids.length;
  };
  const command = await createHouseCommand(context, input, { areActiveMembers });
  const query = context.db.from('meeting_houses').upsert(command, { onConflict: 'id' })
    .select('id,project_id,settlement,city,status,assigned_user_ids').single();
  const { data, error } = await query;
  dbError(error);
  return data;
}
