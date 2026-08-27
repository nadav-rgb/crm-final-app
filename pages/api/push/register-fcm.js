import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { ownedFcmTokenSchema } from '../../../lib/security/schemas.mjs';
import { saveFcmToken } from '../../../lib/security/domains/notifications.mjs';

export default secureHandler({ method: 'POST', schema: ownedFcmTokenSchema, resourceType: 'push_token' }, saveFcmToken);
