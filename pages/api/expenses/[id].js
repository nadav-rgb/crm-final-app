import { z } from 'zod';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { deleteExpense } from '../../../lib/security/domains/finance.mjs';

const idSchema = z.union([z.string().uuid(), z.coerce.number().int().positive()]);

export default secureHandler({ method: 'DELETE', resourceType: 'expense' }, async (context, _input, req) => {
  const parsed = idSchema.safeParse(req.query?.id);
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Expense ID is invalid');
  return deleteExpense(context, parsed.data);
});
