import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { enqueueNotificationEvent } from '../../../lib/security/domains/notifications.mjs';

export default secureHandler({ method: 'POST', schema: z.object({}).strict(), resourceType: 'notification' }, async (context) => {
  const result = await enqueueNotificationEvent(context, { eventType: 'self_test', resourceId: context.userId });
  return { ...result, sent: 0, web: 0, fcm: 0, devices: 0 };
});
