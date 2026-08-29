import { parseJson } from '../../../lib/security/http.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { expenseCreateSchema } from '../../../lib/security/schemas.mjs';
import { createExpense, listExpenses } from '../../../lib/security/domains/finance.mjs';

export default secureHandler({
  method: ['GET', 'POST'], schema: expenseCreateSchema, maxBytes: 4_096, resourceType: 'expense',
  parseBody: (req, schema, options) => req.method === 'POST' ? parseJson(req, schema, options) : undefined,
}, async (context, input, req) => req.method === 'GET'
  ? { expenses: await listExpenses(context) }
  : { status: 201, payload: { expense: await createExpense(context, input) } });
