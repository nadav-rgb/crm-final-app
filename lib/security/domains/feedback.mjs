import { SecurityError } from '../errors.mjs';
import { authorize } from '../rbac.mjs';
import { feedbackCreateSchema } from '../schemas.mjs';
import { escapeHtmlText } from './contacts.mjs';

function requireContext(context) {
  if (!context?.userId) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required');
}

function membership(context, projectId) {
  return context?.memberships?.find((entry) => entry.status === 'active' && Number(entry.projectId) === Number(projectId));
}

function onlyActiveMembership(context) {
  const active = context?.memberships?.filter((entry) => entry.status === 'active') ?? [];
  if (active.length !== 1) throw new SecurityError(400, 'PROJECT_REQUIRED', 'An authorized project must be selected');
  return active[0];
}

export async function createFeedbackCommand(context, input, dependencies = {}) {
  requireContext(context);
  const parsed = feedbackCreateSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  const active = dependencies.membership ?? onlyActiveMembership(context);
  return {
    reporter_user_id: context.userId,
    project_id: Number(active.projectId),
    category: parsed.data.category,
    message: parsed.data.message,
    status: 'open',
  };
}

export function assertFeedbackReview(context, row) {
  requireContext(context);
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    return;
  }
  const active = membership(context, row?.project_id);
  if (!active) throw new SecurityError(404, 'NOT_FOUND', 'Feedback was not found');
  if (!authorize(context, 'feedback:review', { projectId: row.project_id })) {
    throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
  }
}

export function toFeedbackDto(context, row) {
  requireContext(context);
  const own = row.reporter_user_id === context.userId;
  if (!own) assertFeedbackReview(context, row);
  return {
    id: row.id,
    projectId: Number(row.project_id),
    reporterUserId: own ? context.userId : row.reporter_user_id,
    category: row.category,
    message: escapeHtmlText(row.message ?? ''),
    status: row.status,
    reviewerNote: escapeHtmlText(row.reviewer_note ?? ''),
    createdAt: row.created_at ?? null,
    reviewedAt: row.reviewed_at ?? null,
  };
}

function dbError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

const COLUMNS = 'id,project_id,reporter_user_id,category,message,status,reviewer_note,created_at,reviewed_at';

export async function listFeedback(context) {
  requireContext(context);
  const { data, error } = await context.db.from('feedback_reports').select(COLUMNS).order('created_at', { ascending: false }).limit(200);
  dbError(error);
  return (data ?? []).map((row) => toFeedbackDto(context, row));
}

export async function createFeedback(context, input) {
  const command = await createFeedbackCommand(context, input);
  const { data, error } = await context.db.from('feedback_reports').insert(command).select(COLUMNS).single();
  dbError(error);
  return toFeedbackDto(context, data);
}

export async function reviewFeedback(context, input) {
  const { data: row, error: readError } = await context.db.from('feedback_reports').select(COLUMNS).eq('id', input.id).maybeSingle();
  dbError(readError);
  if (!row) throw new SecurityError(404, 'NOT_FOUND', 'Feedback was not found');
  assertFeedbackReview(context, row);
  const update = {
    status: input.status,
    reviewed_at: input.status === 'reviewed' ? new Date().toISOString() : null,
  };
  const { data, error } = await context.db.from('feedback_reports').update(update).eq('id', input.id).select(COLUMNS).maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Feedback was not found');
  return toFeedbackDto(context, data);
}
