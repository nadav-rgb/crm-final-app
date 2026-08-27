import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { ownedPushSubscriptionSchema } from '../../../lib/security/schemas.mjs';
import { saveWebSubscription } from '../../../lib/security/domains/notifications.mjs';

export default secureHandler({ method: 'POST', schema: ownedPushSubscriptionSchema, resourceType: 'push_subscription' }, saveWebSubscription);
