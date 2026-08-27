import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { notificationEventSchema } from '../../../lib/security/schemas.mjs';
import { enqueueNotificationEvent } from '../../../lib/security/domains/notifications.mjs';

export default secureHandler({ method: 'POST', schema: notificationEventSchema, resourceType: 'notification' }, enqueueNotificationEvent);
