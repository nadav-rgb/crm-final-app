import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { getInteraction } from '../../../lib/security/domains/interactions.mjs';
import { enqueueInteractionNotification } from '../../../lib/security/domains/notifications.mjs';
import { requireContactsBff } from '../../../lib/security/domains/route-support.mjs';

const schema = z.object({
  interactionId: z.union([z.string().uuid(), z.number().int().positive()]),
  kind: z.enum(['summary', 'payment', 'self_payment']),
}).strict();

const handler = secureHandler({ method: 'POST', schema, maxBytes: 1_024, resourceType: 'interaction' },
  async (context, input) => {
    requireContactsBff();
    const interaction = await getInteraction(context, input.interactionId);
    if (input.kind === 'self_payment' && interaction.actor_user_id !== context.userId) {
      throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
    }
    return enqueueInteractionNotification(context, {
      interactionId: interaction.id, kind: input.kind,
    });
  });

export default handler;
