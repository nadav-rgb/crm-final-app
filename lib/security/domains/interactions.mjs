import { SecurityError } from '../errors.mjs';
import { authorize } from '../rbac.mjs';
import { interactionCreateSchema, interactionUpdateSchema } from '../schemas.mjs';
import { assertContactAccess, escapeHtmlText, getContact } from './contacts.mjs';

const INTERACTION_COLUMNS = 'id,contact_id,actor_user_id,activist_id,project_id,date,time,type,quality,duration_minutes,outcome,notes,description,ai_summary,next_action,next_action_date,participants';

export function sanitizeParticipants(values) {
  if (Array.isArray(values)) {
    if (values.length > 100) throw new SecurityError(400, 'VALIDATION_FAILED', 'Participants are invalid');
    return [...new Set(values.map((value) => typeof value === 'number' ? value : String(value)))];
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Participants are invalid');
  }
  return structuredClone(values);
}

export function sanitizeInternalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\u0000-\u001f\\]/.test(value)) {
    throw new SecurityError(400, 'UNSAFE_REDIRECT', 'Internal path is unsafe');
  }
  const parsed = new URL(value, 'https://internal.invalid');
  if (parsed.origin !== 'https://internal.invalid') {
    throw new SecurityError(400, 'UNSAFE_REDIRECT', 'Internal path is unsafe');
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function toInteractionDto(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    activistCode: row.activist_id == null ? null : Number(row.activist_id),
    occurredAt: row.occurred_at ?? (row.date ? `${row.date}T${row.time ?? '00:00'}:00` : null),
    date: row.date ?? row.occurred_at?.slice(0, 10) ?? null,
    time: row.time ?? row.occurred_at?.slice(11, 16) ?? null,
    type: escapeHtmlText(row.type),
    quality: escapeHtmlText(row.quality ?? ''),
    durationMinutes: Number(row.duration_minutes ?? 0),
    outcome: escapeHtmlText(row.outcome ?? ''),
    notes: escapeHtmlText(row.notes ?? ''),
    description: escapeHtmlText(row.description ?? ''),
    aiSummary: escapeHtmlText(row.ai_summary ?? ''),
    nextAction: escapeHtmlText(row.next_action ?? ''),
    nextActionDate: row.next_action_date ?? null,
    participants: row.participants && typeof row.participants === 'object' ? row.participants : {},
  };
}

export async function createInteractionCommand(context, contact, input) {
  const parsed = interactionCreateSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  if (String(parsed.data.contactId) !== String(contact.id)) {
    throw new SecurityError(404, 'NOT_FOUND', 'Contact was not found');
  }
  assertContactAccess(context, 'read', contact);
  const resource = {
    projectId: contact.project_id,
    assignedUserId: contact.assigned_user_id,
    actorUserId: context.userId,
  };
  if (!authorize(context, 'interaction:create', resource)) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  const occurredDate = parsed.data.date ?? parsed.data.occurredAt.slice(0, 10);
  const occurredTime = parsed.data.time ?? parsed.data.occurredAt?.slice(11, 16) ?? '00:00';
  return {
    contact_id: contact.id,
    actor_user_id: context.userId,
    project_id: contact.project_id,
    date: occurredDate,
    time: occurredTime,
    type: parsed.data.type,
    quality: parsed.data.quality ?? null,
    duration_minutes: parsed.data.durationMinutes ?? 0,
    outcome: parsed.data.outcome ?? null,
    notes: parsed.data.notes ?? null,
    description: parsed.data.description ?? null,
    ai_summary: parsed.data.aiSummary ?? null,
    next_action: parsed.data.nextAction ?? null,
    next_action_date: parsed.data.nextActionDate ?? null,
    participants: parsed.data.participants
      ? sanitizeParticipants(parsed.data.participants)
      : sanitizeParticipants(parsed.data.participantIds ?? []),
  };
}

function queryError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

export async function listContactInteractions(context, contactId) {
  const contact = await getContact(context, contactId);
  assertContactAccess(context, 'read', contact);
  const { data, error } = await context.db.from('interactions').select(INTERACTION_COLUMNS)
    .eq('contact_id', contact.id).order('date', { ascending: false }).order('time', { ascending: false });
  queryError(error);
  return (data ?? []).map(toInteractionDto);
}

export async function createInteraction(context, contactId, input) {
  const contact = await getContact(context, contactId);
  const command = await createInteractionCommand(context, contact, { ...input, contactId });
  const { data, error } = await context.db.from('interactions').insert(command).select(INTERACTION_COLUMNS).single();
  queryError(error);
  return toInteractionDto(data);
}

export async function getInteraction(context, id) {
  const { data, error } = await context.db.from('interactions').select(INTERACTION_COLUMNS)
    .eq('id', id).maybeSingle();
  queryError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Interaction was not found');
  const resource = { projectId: data.project_id, actorUserId: data.actor_user_id };
  if (!authorize(context, 'interaction:read', resource)) {
    throw new SecurityError(404, 'NOT_FOUND', 'Interaction was not found');
  }
  return data;
}

export async function updateInteraction(context, id, input) {
  const existing = await getInteraction(context, id);
  if (!authorize(context, 'interaction:update', { projectId: existing.project_id, actorUserId: existing.actor_user_id })) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  const parsed = interactionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  }
  const mapping = {
    type: 'type', quality: 'quality', notes: 'notes', date: 'date', time: 'time',
    durationMinutes: 'duration_minutes', outcome: 'outcome', description: 'description',
    aiSummary: 'ai_summary', nextAction: 'next_action', nextActionDate: 'next_action_date',
  };
  const allowed = Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [mapping[key], value]),
  );
  const { data, error } = await context.db.from('interactions').update(allowed).eq('id', id)
    .select(INTERACTION_COLUMNS).maybeSingle();
  queryError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Interaction was not found');
  return toInteractionDto(data);
}

export async function deleteInteraction(context, id) {
  const existing = await getInteraction(context, id);
  const active = context.memberships?.find((entry) => (
    entry.status === 'active' && Number(entry.projectId) === Number(existing.project_id)
  ));
  const managerDelete = (context.globalRole === 'ceo' && context.aal >= 2)
    || (active?.role === 'head' && context.aal >= 2);
  if (!managerDelete) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
  const { data, error } = await context.db.rpc('app_delete_interaction', { p_interaction_id: String(id) });
  queryError(error);
  if (data !== true) throw new SecurityError(404, 'NOT_FOUND', 'Interaction was not found');
  return { deleted: true };
}
