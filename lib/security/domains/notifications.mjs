import { SecurityError } from '../errors.mjs';
import {
  notificationEventSchema, ownedFcmTokenSchema, ownedPushSubscriptionSchema,
} from '../schemas.mjs';
import { dispatchNotificationDelivery } from '../notification-delivery.mjs';
import { escapeHtmlText } from './contacts.mjs';

export { toPushPayload } from '../push-payload.mjs';

function membership(context, projectId) {
  return context?.memberships?.find((entry) => entry.status === 'active' && Number(entry.projectId) === Number(projectId));
}

function requireContext(context) {
  if (!context?.userId) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required');
}

export function normalizeInternalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) {
    throw new SecurityError(400, 'UNSAFE_REDIRECT', 'Internal path is unsafe');
  }
  const parsed = new URL(value, 'https://internal.invalid');
  if (parsed.origin !== 'https://internal.invalid') throw new SecurityError(400, 'UNSAFE_REDIRECT', 'Internal path is unsafe');
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function registerWebSubscriptionCommand(context, input) {
  requireContext(context);
  const parsed = ownedPushSubscriptionSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  return { user_id: context.userId, subscription: parsed.data };
}

export async function registerFcmTokenCommand(context, input) {
  requireContext(context);
  const parsed = ownedFcmTokenSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  return { user_id: context.userId, token: parsed.data.token, platform: parsed.data.platform, updated_at: new Date().toISOString() };
}

export async function notificationEventCommand(context, input, resource) {
  requireContext(context);
  const parsed = notificationEventSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  if (context.globalRole === 'ceo') {
    if (context.aal < 2) throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
  } else if (!membership(context, resource?.projectId)) {
    throw new SecurityError(404, 'NOT_FOUND', 'Resource was not found');
  }
  return {
    actor_user_id: context.userId,
    event_type: parsed.data.eventType,
    resource_id: String(parsed.data.resourceId),
    project_id: Number(resource.projectId),
    url: normalizeInternalPath(resource.url ?? '/notifications'),
  };
}

export function assertNotificationOwner(context, row) {
  requireContext(context);
  if (row?.recipient_user_id !== context.userId) throw new SecurityError(404, 'NOT_FOUND', 'Notification was not found');
}

export function toNotificationDto(context, row) {
  assertNotificationOwner(context, row);
  return {
    id: row.id,
    type: row.type ?? 'system',
    title: escapeHtmlText(row.title ?? 'עדכון'),
    body: escapeHtmlText(row.body ?? ''),
    url: normalizeInternalPath(row.url ?? '/notifications'),
    priority: row.priority ?? 'normal',
    read: Boolean(row.read),
    createdAt: row.created_at ?? null,
  };
}

function dbError(error) {
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
}

export async function saveWebSubscription(context, input) {
  const command = await registerWebSubscriptionCommand(context, input);
  const { data: existing, error: readError } = await context.db.from('push_subscriptions').select('id')
    .eq('user_id', context.userId).eq('subscription->>endpoint', command.subscription.endpoint).maybeSingle();
  dbError(readError);
  const mutation = existing
    ? context.db.from('push_subscriptions').update(command).eq('id', existing.id)
    : context.db.from('push_subscriptions').insert(command);
  const { error } = await mutation;
  dbError(error);
  return { registered: true };
}

export async function saveFcmToken(context, input) {
  const command = await registerFcmTokenCommand(context, input);
  const { error } = await context.db.from('fcm_tokens').upsert(command, { onConflict: 'token' });
  dbError(error);
  return { registered: true };
}

export async function subscriptionStatus(context, endpoint) {
  requireContext(context);
  const { data, error } = await context.db.from('push_subscriptions').select('id')
    .eq('user_id', context.userId).eq('subscription->>endpoint', endpoint).limit(1);
  dbError(error);
  return { registered: (data ?? []).length > 0 };
}

export async function listNotifications(context) {
  requireContext(context);
  const { data, error } = await context.db.from('notifications')
    .select('id,type,title,body,url,priority,read,created_at,recipient_user_id')
    .eq('recipient_user_id', context.userId).order('created_at', { ascending: false }).limit(200);
  dbError(error);
  return (data ?? []).map((row) => toNotificationDto(context, row));
}

export async function markNotificationsRead(context, ids) {
  requireContext(context);
  const unique = [...new Set(ids.map(String))];
  const { data, error } = await context.db.from('notifications').update({ read: true })
    .eq('recipient_user_id', context.userId).in('id', unique).select('id');
  dbError(error);
  return { updated: (data ?? []).length };
}

const RESOURCE_CONFIG = Object.freeze({
  meeting_house_assigned: { table: 'meeting_houses', project: 'project_id', url: (id) => `/meeting-houses/${id}` },
  tour_created: { table: 'tours', project: 'project_id', url: (id) => `/tours?tour=${encodeURIComponent(id)}` },
  tour_updated: { table: 'tours', project: 'project_id', url: (id) => `/tours?tour=${encodeURIComponent(id)}` },
  tour_cancelled: { table: 'tours', project: 'project_id', url: (id) => `/tours?tour=${encodeURIComponent(id)}` },
  tour_reported: { table: 'tours', project: 'project_id', url: (id) => `/tours?tour=${encodeURIComponent(id)}` },
  interaction_created: { table: 'interactions', project: 'project_id', url: () => '/notifications' },
  interaction_summary: { table: 'interactions', project: 'project_id', url: () => '/notifications' },
  interaction_self_payment: { table: 'interactions', project: 'project_id', url: () => '/notifications' },
  interaction_payment: { table: 'interactions', project: 'project_id', url: () => '/notifications' },
  base_meeting_reported: { table: 'base_meeting_reports', project: 'project_id', url: () => '/base-meetings' },
  mitzvot_updated: { table: 'contacts', project: 'project_id', url: (id) => `/contact/${id}` },
});

export async function resolveNotificationEvent(context, input) {
  const parsed = notificationEventSchema.safeParse(input);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Request body is invalid');
  if (parsed.data.eventType === 'self_test') {
    const projectId = context.memberships?.find((entry) => entry.status === 'active')?.projectId;
    if (!projectId && context.globalRole !== 'ceo') throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
    return notificationEventCommand(context, parsed.data, { projectId: projectId ?? 0, url: '/notifications' });
  }
  const config = RESOURCE_CONFIG[parsed.data.eventType];
  const { data, error } = await context.db.from(config.table).select(`id,${config.project}`)
    .eq('id', parsed.data.resourceId).maybeSingle();
  dbError(error);
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Resource was not found');
  return notificationEventCommand(context, parsed.data, {
    projectId: data[config.project], url: config.url(data.id),
  });
}

export async function enqueueNotificationEvent(context, input, { dispatch = dispatchNotificationDelivery } = {}) {
  const command = await resolveNotificationEvent(context, input);
  const { data, error } = await context.db.rpc('app_enqueue_notification_event', {
    p_event_type: command.event_type,
    p_resource_id: command.resource_id,
    p_project_id: command.project_id,
  });
  if (error) throw new SecurityError(503, 'NOTIFICATION_UNAVAILABLE', 'Notification delivery is unavailable', { cause: error });
  return dispatch(data);
}

const INTERACTION_EVENT_BY_KIND = Object.freeze({
  summary: 'interaction_summary',
  self_payment: 'interaction_self_payment',
  payment: 'interaction_payment',
});

export async function enqueueInteractionNotification(context, input, options) {
  const eventType = INTERACTION_EVENT_BY_KIND[input?.kind];
  if (!eventType || (typeof input?.interactionId !== 'string' && typeof input?.interactionId !== 'number')) {
    throw new SecurityError(400, 'VALIDATION_FAILED', 'Interaction notification is invalid');
  }
  return enqueueNotificationEvent(context, {
    eventType,
    resourceId: input.interactionId,
  }, options);
}
