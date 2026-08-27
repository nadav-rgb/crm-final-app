import { parseJson } from '../../../lib/security/http.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { tourCommandSchema } from '../../../lib/security/schemas.mjs';
import { createTour, listTours } from '../../../lib/security/domains/tours.mjs';

export default secureHandler({
  method: ['GET', 'POST'], schema: tourCommandSchema, resourceType: 'tour',
  parseBody: (req, schema, options) => req.method === 'POST' ? parseJson(req, schema, options) : undefined,
}, async (context, input, req) => {
  if (req.method === 'GET') return { tours: await listTours(context) };
  return { status: 201, payload: { tour: await createTour(context, input) } };
});
