import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { pushEndpointSchema } from '../../../lib/security/schemas.mjs';
import { subscriptionStatus } from '../../../lib/security/domains/notifications.mjs';

export default secureHandler({ method: 'POST', schema: pushEndpointSchema, resourceType: 'push_subscription' }, async (context, input) => (
  subscriptionStatus(context, input.endpoint)
));
