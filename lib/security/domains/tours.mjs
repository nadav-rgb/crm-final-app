import { randomUUID } from 'node:crypto';
import { SecurityError } from '../errors.mjs';
import {
  tourAssignmentCommandSchema, tourCancelCommandSchema, tourCommandSchema,
  tourReportCommandSchema, tourUpdateCommandSchema,
} from '../schemas.mjs';

function membership(context, projectId) {
  return context?.memberships?.find((entry) => entry.status === 'active' && Number(entry.projectId) === Number(projectId));
}

function requireContext(context) {
  if (!context?.userId) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required');
}

function assigned(context, tour) {
  return tour?.guide_user_id === context.userId || tour?.host_user_id === context.userId
    || tour?.assigned_user_ids?.includes(context.userId);
}

export function assertTourAccess(context, action, tour) {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  const active = membership(context, tour?.project_id);
  if (!active) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  if (action === 'delete') {
    if (active.role === 'head' && context.aal >= 2) return;
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  if (['create', 'update', 'assign', 'cancel'].includes(action)) {
    if (active.role === 'coord' || (active.role === 'head' && context.aal >= 2)) return;
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  if (action === 'report') {
    if (active.role === 'activist' && assigned(context, tour)) return;
    if (active.role === 'coord' || (active.role === 'head' && context.aal >= 2)) return;
    throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  }
  if (active.role === 'finance') return;
  if (active.role === 'activist' && !assigned(context, tour)) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
}

export function toTourDto(context, row) {
  requireContext(context);
  const active = membership(context, row.project_id);
  if (active?.role === 'finance') {
    return { id: row.id, projectId: Number(row.project_id), status: row.status, payableCount: row.status === 'completed' ? 1 : 0 };
  }
  assertTourAccess(context, 'read', row);
  return {
    id: row.id, projectId: Number(row.project_id), title: row.tour_number ?? '',
    tourNumber: row.tour_number ?? '', settlement: row.settlement ?? '', date: row.date ?? null,
    startTime: row.start_time ?? '', guideName: row.guide_name ?? '', guideUserId: row.guide_user_id ?? null,
    hostUserId: row.host_user_id ?? null, assignedUserIds: row.assigned_user_ids ?? [], status: row.status,
    notes: row.notes ?? '', report: row.report ?? null,
  };
}

export async function createTourCommand(context, input, options = {}) {
  requireContext(context);
  const parsed = tourCommandSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const managers = context.memberships?.filter((entry) => entry.status === 'active' && ['coord', 'head'].includes(entry.role)) ?? [];
  const requestedProjectId = options.projectId ?? parsed.data.projectId;
  const selected = requestedProjectId === undefined
    ? (managers.length === 1 ? managers[0] : null)
    : managers.find((entry) => Number(entry.projectId) === Number(requestedProjectId));
  const projectId = context.globalRole === 'ceo' && requestedProjectId !== undefined
    ? Number(requestedProjectId)
    : selected?.projectId ?? null;
  if (!Number.isInteger(Number(projectId)) || Number(projectId) <= 0) {
    throw new SecurityError(400, 'PROJECT_REQUIRED', 'An authorized project must be selected');
  }
  assertTourAccess(context, 'create', { project_id: projectId });
  return {
    id: parsed.data.id ?? (options.createId ?? randomUUID)(),
    project_id: projectId, tour_number: parsed.data.tourNumber ?? parsed.data.title,
    settlement: parsed.data.settlement,
    ...(parsed.data.date !== undefined ? { date: parsed.data.date } : {}),
    ...(parsed.data.startTime !== undefined ? { start_time: parsed.data.startTime } : {}),
    ...(parsed.data.guideName !== undefined ? { guide_name: parsed.data.guideName } : {}),
    ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    status: 'upcoming',
  };
}

export async function updateTourCommand(context, tour, input) {
  const parsed = tourUpdateCommandSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  assertTourAccess(context, 'update', tour);
  const mapping = {
    title: 'tour_number', tourNumber: 'tour_number', settlement: 'settlement', date: 'date',
    startTime: 'start_time', guideName: 'guide_name', notes: 'notes',
  };
  return Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [mapping[key], value]));
}

export async function assignTourCommand(context, tour, input, dependencies) {
  const parsed = tourAssignmentCommandSchema.safeParse({ tourId: tour.id, ...input });
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  assertTourAccess(context, 'assign', tour);
  const ids = [...new Set([
    ...parsed.data.assignedUserIds,
    ...(parsed.data.guideUserId ? [parsed.data.guideUserId] : []),
    ...(parsed.data.hostUserId ? [parsed.data.hostUserId] : []),
  ])];
  if (!await dependencies.areActiveMembers(tour.project_id, ids)) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Assignees are invalid');
  }
  return {
    assigned_user_ids: parsed.data.assignedUserIds,
    ...(parsed.data.guideUserId !== undefined ? { guide_user_id: parsed.data.guideUserId } : {}),
    ...(parsed.data.hostUserId !== undefined ? { host_user_id: parsed.data.hostUserId } : {}),
  };
}

export async function submitTourReportCommand(context, tour, input) {
  const parsed = tourReportCommandSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  assertTourAccess(context, 'report', tour);
  if (tour.status === 'cancelled') throw new SecurityError(409, 'TOUR_CANCELLED', 'Cancelled tour cannot be reported');
  return {
    report: parsed.data,
    reported_by_user_id: context.userId,
    reported_at: new Date().toISOString(),
    status: 'completed',
  };
}

export async function cancelTourCommand(context, tour, input) {
  const parsed = tourCancelCommandSchema.safeParse({ tourId: tour.id, ...input });
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  assertTourAccess(context, 'cancel', tour);
  if (tour.status === 'cancelled') throw new SecurityError(409, 'TOUR_ALREADY_CANCELLED', 'Tour is already cancelled');
  return { status: 'cancelled', cancellation_reason: parsed.data.reason ?? null };
}

export async function deleteTourCommand(context, tour, { linkedContacts }) {
  assertTourAccess(context, 'delete', tour);
  if (tour.report || tour.status === 'completed') throw new SecurityError(409, 'TOUR_HAS_REPORT', 'Reported tour cannot be deleted');
  if (linkedContacts > 0) throw new SecurityError(409, 'TOUR_HAS_CONTACTS', 'Tour with linked contacts cannot be deleted');
  return { id: tour.id };
}

function dbError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

const COLUMNS = 'id,project_id,tour_number,settlement,date,start_time,guide_name,guide_user_id,host_user_id,assigned_user_ids,status,notes,report,reported_by_user_id,reported_at,cancellation_reason';

export async function getTour(context, id) {
  requireContext(context);
  const { data, error } = await context.db.from('tours').select(COLUMNS).eq('id', id).maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  return data;
}

export async function listTours(context) {
  requireContext(context);
  const { data, error } = await context.db.from('tours').select(COLUMNS).order('date', { ascending: true });
  dbError(error);
  return (data ?? []).map((row) => toTourDto(context, row));
}

export async function createTour(context, input) {
  const command = await createTourCommand(context, input);
  const { data: project, error: projectError } = await context.db.from('projects')
    .select('id').eq('id', command.project_id).maybeSingle();
  dbError(projectError);
  if (!project) throw new SecurityError(400, 'PROJECT_REQUIRED', 'An authorized project must be selected');
  const { data, error } = await context.db.from('tours').insert(command).select(COLUMNS).single();
  dbError(error);
  return toTourDto(context, data);
}

export async function updateTour(context, id, input) {
  const tour = await getTour(context, id);
  const command = await updateTourCommand(context, tour, input);
  const { data, error } = await context.db.from('tours').update(command).eq('id', id).select(COLUMNS).maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  return toTourDto(context, data);
}

async function areActiveMembers(context, projectId, ids) {
  if (ids.length === 0) return true;
  const { data, error } = await context.db.from('project_memberships').select('user_id')
    .eq('project_id', projectId).eq('status', 'active').in('user_id', ids);
  dbError(error);
  return new Set((data ?? []).map((row) => row.user_id)).size === ids.length;
}

export async function assignTour(context, id, input) {
  const tour = await getTour(context, id);
  const command = await assignTourCommand(context, tour, input, {
    areActiveMembers: (projectId, ids) => areActiveMembers(context, projectId, ids),
  });
  const { data: assigned, error } = await context.db.rpc('app_assign_tour', {
    p_tour_id: String(id),
    p_guide_user_id: command.guide_user_id ?? tour.guide_user_id ?? null,
    p_host_user_id: command.host_user_id ?? tour.host_user_id ?? null,
    p_assigned_user_ids: command.assigned_user_ids,
  });
  dbError(error);
  if (assigned !== true) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  return toTourDto(context, await getTour(context, id));
}

export async function cancelTour(context, id, input) {
  const tour = await getTour(context, id);
  const command = await cancelTourCommand(context, tour, input);
  const { data: cancelled, error } = await context.db.rpc('app_cancel_tour', {
    p_tour_id: String(id),
    p_reason: command.cancellation_reason,
  });
  dbError(error);
  if (cancelled !== true) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  return toTourDto(context, await getTour(context, id));
}

export async function submitTourReport(context, id, input) {
  const tour = await getTour(context, id);
  const command = await submitTourReportCommand(context, tour, input);
  const { data, error } = await context.db.rpc('app_submit_tour_report', {
    p_tour_id: String(id), p_report: command.report,
  });
  dbError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  return toTourDto(context, row);
}

export async function deleteTour(context, id) {
  const tour = await getTour(context, id);
  const { count, error: countError } = await context.db.from('contacts')
    .select('id', { count: 'exact', head: true }).eq('tour_id', id).eq('project_id', tour.project_id);
  dbError(countError);
  await deleteTourCommand(context, tour, { linkedContacts: count ?? 0 });
  const { data, error } = await context.db.rpc('app_delete_tour', { p_tour_id: String(id) });
  dbError(error);
  if (data !== true) throw new SecurityError(404, 'NOT_FOUND', 'Tour was not found');
  return { deleted: true };
}
