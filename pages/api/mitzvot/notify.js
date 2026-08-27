import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { enqueueNotificationEvent } from '../../../lib/security/domains/notifications.mjs';

const schema = z.object({ contactId: z.union([z.string().uuid(), z.number().int().positive()]) }).strict();

export default secureHandler({ method: 'POST', schema, resourceType: 'notification' }, async (context, input) => (
  enqueueNotificationEvent(context, { eventType: 'mitzvot_updated', resourceId: input.contactId })
));
