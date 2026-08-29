import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { createBonusCancellation } from '../../../lib/security/domains/finance.mjs';
import { bonusCancellationCreateSchema } from '../../../lib/security/schemas.mjs';

export default secureHandler({
  method: 'POST',
  schema: bonusCancellationCreateSchema,
  resourceType: 'bonus_cancellation',
}, async (context, input) => ({ bonusCancellation: await createBonusCancellation(context, input) }));
