import { parseJson } from '../../../lib/security/http.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { interactionUpdateSchema } from '../../../lib/security/schemas.mjs';
import { deleteInteraction, updateInteraction } from '../../../lib/security/domains/interactions.mjs';
import { requireContactsBff } from '../../../lib/security/domains/route-support.mjs';

const handler = secureHandler({
  method: ['PATCH', 'DELETE'], schema: interactionUpdateSchema, maxBytes: 16_384,
  parseBody: (req, schema, options) => req.method === 'PATCH' ? parseJson(req, schema, options) : undefined,
  resourceType: 'interaction',
}, async (context, input, req) => {
  requireContactsBff();
  const id = req.query?.id;
  if (req.method === 'PATCH') return { interaction: await updateInteraction(context, id, input) };
  return deleteInteraction(context, id);
});

export default handler;
