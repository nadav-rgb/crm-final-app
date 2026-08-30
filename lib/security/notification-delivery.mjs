import { SecurityError } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_EVENTS = new Set([
  'base_report_reminder', 'missing_report', 'next_action_due', 'tour_created', 'tour_sheet_sync',
]);

function assertDeliveryId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new SecurityError(503, 'NOTIFICATION_UNAVAILABLE', 'Notification delivery is unavailable');
  }
  return value;
}

export async function dispatchNotificationDelivery(deliveryId, dependencies = {}) {
  const safeDeliveryId = assertDeliveryId(deliveryId);
  let { serviceClient, sendWeb, sendFcm } = dependencies;
  if (!serviceClient) {
    serviceClient = (await import('../supabaseAdmin.js')).getSupabaseAdmin();
  }
  if (!sendWeb || !sendFcm) {
    const [webModule, fcmModule] = await Promise.all([
      import('../webPushSend.js'), import('../fcmAdmin.js'),
    ]);
    sendWeb ??= webModule.sendWebPushToUser;
    sendFcm ??= fcmModule.sendFcmToUser;
  }
  const { data, error } = await serviceClient.rpc('app_claim_notification_delivery', {
    p_delivery_id: safeDeliveryId,
  });
  if (error || !Array.isArray(data)) {
    throw new SecurityError(503, 'NOTIFICATION_UNAVAILABLE', 'Notification delivery is unavailable', { cause: error });
  }

  let web = 0;
  let fcm = 0;
  let devices = 0;
  await Promise.all(data.map(async (row) => {
    if (!UUID.test(String(row?.user_id ?? ''))) {
      throw new SecurityError(503, 'NOTIFICATION_UNAVAILABLE', 'Notification delivery is unavailable');
    }
    const options = { priority: row.priority === 'high' ? 'high' : 'normal' };
    const [webResult, fcmResult] = await Promise.all([
      sendWeb(serviceClient, row.user_id, options),
      sendFcm(serviceClient, row.user_id, options),
    ]);
    web += Number(webResult?.sent) || 0;
    fcm += Number(fcmResult?.sent) || 0;
    devices += Number(webResult?.devices) || 0;
  }));

  return { queued: data.length, sent: web + fcm, web, fcm, devices };
}

export async function enqueueServiceNotificationEvent(serviceClient, {
  eventType, resourceId, projectId = null,
}, dependencies = {}) {
  if (
    !serviceClient || typeof serviceClient.rpc !== 'function'
    || !SERVICE_EVENTS.has(eventType)
    || !['string', 'number'].includes(typeof resourceId)
    || String(resourceId).trim() === ''
    || (projectId !== null && !Number.isSafeInteger(Number(projectId)))
  ) {
    throw new SecurityError(500, 'NOTIFICATION_CONFIG_INVALID', 'Notification delivery is unavailable');
  }
  const { data, error } = await serviceClient.rpc('app_enqueue_notification_event', {
    p_event_type: eventType,
    p_resource_id: String(resourceId),
    p_project_id: projectId === null ? null : Number(projectId),
  });
  if (error) {
    throw new SecurityError(503, 'NOTIFICATION_UNAVAILABLE', 'Notification delivery is unavailable', { cause: error });
  }
  return dispatchNotificationDelivery(data, { ...dependencies, serviceClient });
}
