import { z } from 'zod';
import { parseJson } from '../../../lib/security/http.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { feedbackCreateSchema } from '../../../lib/security/schemas.mjs';
import { createFeedback, listFeedback, reviewFeedback } from '../../../lib/security/domains/feedback.mjs';

const reviewSchema = z.object({ id: z.string().uuid(), status: z.enum(['open', 'reviewed']) }).strict();

export default secureHandler({
  method: ['GET', 'POST', 'PATCH'], schema: feedbackCreateSchema, maxBytes: 4_096, resourceType: 'feedback',
  parseBody: (req, _schema, options) => req.method === 'GET'
    ? undefined
    : parseJson(req, req.method === 'PATCH' ? reviewSchema : feedbackCreateSchema, options),
}, async (context, input, req) => {
  if (req.method === 'GET') return { feedback: await listFeedback(context) };
  if (req.method === 'PATCH') return { feedback: await reviewFeedback(context, input) };
  return { status: 201, payload: { feedback: await createFeedback(context, input) } };
});
