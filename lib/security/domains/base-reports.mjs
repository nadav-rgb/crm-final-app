import { z } from 'zod';
import { SecurityError } from '../errors.mjs';

const reportId = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const resourceId = z.union([z.string().uuid(), z.number().int().positive()]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal(''));
const short = z.string().max(500);
const long = z.string().max(8_000);

const structuredAnswers = z.object({
  arrival_time: short.optional(),
  participant_count: z.number().int().min(0).max(10_000).optional(),
  gender_distribution: short.optional(),
  religious_distribution: short.optional(),
  age_distribution: short.optional(),
  diversity_level: short.optional(),
  facilitation_quality: short.optional(),
  facilitation_notes: long.optional(),
  atmosphere: z.array(short).max(20).optional(),
  group_progress: short.optional(),
  personal_connections_status: short.optional(),
  personal_connections_notes: long.optional(),
  general_notes: long.optional(),
}).strict();

const createSchema = z.object({
  id: reportId,
  houseId: resourceId,
  meetingNumber: z.number().int().min(1).max(100),
  date,
  startTime: time,
  structuredAnswers,
  answers: long,
  participantCount: z.number().int().min(0).max(10_000),
}).strict();

const updateSchema = z.object({
  structuredAnswers,
  answers: long,
  participantCount: z.number().int().min(0).max(10_000),
}).strict();

function membership(context, projectId) {
  return context?.memberships?.find((entry) => (
    entry.status === 'active' && Number(entry.projectId) === Number(projectId)
  ));
}

function assertHouseReportAccess(context, house) {
  if (context?.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  const active = membership(context, house?.project_id);
  if (!active) throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  if (active.role === 'activist' && house.assigned_user_ids?.includes(context.userId)) return;
  if (active.role === 'coord') return;
  if (active.role === 'head' && context.aal >= 2) return;
  throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
}

function assertReportAccess(context, report) {
  if (context?.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  if (report.actor_user_id === context?.userId) return;
  const active = membership(context, report?.project_id);
  if (active?.role === 'coord') return;
  if (active?.role === 'head' && context.aal >= 2) return;
  throw new SecurityError(404, 'NOT_FOUND', 'Report was not found');
}

export function createBaseReportCommand(context, house, input, actor) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(Number(actor?.activistCode))) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  }
  assertHouseReportAccess(context, house);
  if (String(parsed.data.houseId) !== String(house.id)) {
    throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  }
  return {
    id: parsed.data.id,
    actor_user_id: context.userId,
    activist_id: Number(actor.activistCode),
    project_id: Number(house.project_id),
    house_id: house.id,
    meeting_number: parsed.data.meetingNumber,
    meeting_place_number: house.house_number ?? null,
    meeting_place_city: house.settlement ?? house.city ?? '',
    host_name: house.host_name ?? '',
    facilitator_name: house.facilitator_name ?? '',
    activist_name: String(actor.actorName ?? '').slice(0, 120),
    date: parsed.data.date,
    start_time: parsed.data.startTime,
    structured_answers: parsed.data.structuredAnswers,
    answers: parsed.data.answers,
    participant_count: parsed.data.participantCount,
    submitted: true,
    submitted_at: String(actor.now ?? new Date().toISOString()).slice(0, 10),
  };
}

export function updateBaseReportCommand(context, existing, input) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  assertReportAccess(context, existing);
  return {
    structured_answers: parsed.data.structuredAnswers,
    answers: parsed.data.answers,
    participant_count: parsed.data.participantCount,
  };
}

export function toBaseReportDto(row) {
  return {
    id: row.id,
    projectId: Number(row.project_id),
    houseId: row.house_id,
    activistCode: row.activist_id,
    meetingNumber: row.meeting_number,
    meetingPlaceNumber: row.meeting_place_number ?? '',
    meetingPlaceCity: row.meeting_place_city ?? '',
    hostName: row.host_name ?? '',
    facilitatorName: row.facilitator_name ?? '',
    activistName: row.activist_name ?? '',
    date: row.date ?? '',
    startTime: row.start_time ?? '',
    structuredAnswers: row.structured_answers ?? null,
    answers: row.answers ?? null,
    participantCount: row.participant_count ?? null,
    aiSummary: row.ai_summary ?? null,
    submitted: Boolean(row.submitted),
    submittedAt: row.submitted_at ?? null,
  };
}

const COLUMNS = 'id,actor_user_id,activist_id,project_id,house_id,meeting_number,meeting_place_number,meeting_place_city,host_name,facilitator_name,activist_name,date,start_time,structured_answers,answers,participant_count,ai_summary,submitted,submitted_at';

function dbError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

export async function listBaseReports(context) {
  const { data, error } = await context.db.from('base_meeting_reports').select(COLUMNS).order('date', { ascending: true });
  dbError(error);
  return (data ?? []).map(toBaseReportDto);
}

export async function createBaseReport(context, input) {
  const { data: house, error: houseError } = await context.db.from('meeting_houses')
    .select('id,project_id,house_number,settlement,city,host_name,facilitator_name,assigned_user_ids')
    .eq('id', input?.houseId).maybeSingle();
  dbError(houseError);
  if (!house) throw new SecurityError(404, 'NOT_FOUND', 'Meeting house was not found');
  const { data: profile, error: profileError } = await context.db.from('profiles')
    .select('id,activist_code,name').eq('id', context.userId).maybeSingle();
  dbError(profileError);
  if (!profile || !Number.isSafeInteger(Number(profile.activist_code))) {
    throw new SecurityError(409, 'PROFILE_MAPPING_REQUIRED', 'User profile mapping is required');
  }
  const command = createBaseReportCommand(context, house, input, {
    activistCode: Number(profile.activist_code), actorName: profile.name,
  });
  const { data, error } = await context.db.from('base_meeting_reports').upsert(command, { onConflict: 'id' })
    .select(COLUMNS).single();
  dbError(error);
  return toBaseReportDto(data);
}

export async function updateBaseReport(context, id, input) {
  if (!reportId.safeParse(id).success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const { data: existing, error: loadError } = await context.db.from('base_meeting_reports')
    .select(COLUMNS).eq('id', id).maybeSingle();
  dbError(loadError);
  if (!existing) throw new SecurityError(404, 'NOT_FOUND', 'Report was not found');
  const command = updateBaseReportCommand(context, existing, input);
  const { data, error } = await context.db.from('base_meeting_reports').update(command).eq('id', id)
    .select(COLUMNS).maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Report was not found');
  return toBaseReportDto(data);
}
