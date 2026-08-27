import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { getInteraction } from '../../../lib/security/domains/interactions.mjs';
import { requireContactsBff } from '../../../lib/security/domains/route-support.mjs';

const schema = z.object({
  interactionId: z.union([z.string().uuid(), z.number().int().positive()]),
  kind: z.enum(['summary', 'payment', 'self_payment']),
  amount: z.number().finite().positive().max(1_000_000).optional(),
}).strict();

const handler = secureHandler({ method: 'POST', schema, maxBytes: 1_024, resourceType: 'interaction' },
  async (context, input) => {
    requireContactsBff();
    const interaction = await getInteraction(context, input.interactionId);
    if (input.kind === 'self_payment' && interaction.actor_user_id !== context.userId) {
      throw new SecurityError(403, 'CAPABILITY_DENIED', 'Access is denied');
    }
    const { data, error } = await context.db.rpc('enqueue_interaction_notification', {
      p_interaction_id: interaction.id,
      p_event_type: input.kind,
      p_display_amount: input.amount ?? null,
    });
    if (error) throw new SecurityError(503, 'DEPENDENCY_UNAVAILABLE', 'Notification delivery is unavailable', { cause: error });
    return { notified: Array.isArray(data) ? data : [] };
  });

export default handler;
