import { z } from 'zod';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { listPayments } from '../../../lib/security/domains/finance.mjs';

const querySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  projectId: z.coerce.number().int().positive().optional(),
}).strict();

export default secureHandler({ method: 'GET', resourceType: 'payment' }, async (context, _input, req) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Payment query is invalid');
  return { payments: await listPayments(context, parsed.data) };
});
