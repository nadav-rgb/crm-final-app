import { parseJson } from '../../../../lib/security/http.mjs';
import { secureHandler } from '../../../../lib/security/api-handler.mjs';
import { interactionBodySchema } from '../../../../lib/security/schemas.mjs';
import { createInteraction, listContactInteractions } from '../../../../lib/security/domains/interactions.mjs';
import { requireContactsBff } from '../../../../lib/security/domains/route-support.mjs';

const handler = secureHandler({
  method: ['GET', 'POST'], schema: interactionBodySchema, maxBytes: 16_384,
  parseBody: (req, schema, options) => req.method === 'POST' ? parseJson(req, schema, options) : undefined,
  resourceType: 'interaction',
}, async (context, input, req) => {
  requireContactsBff();
  const contactId = req.query?.id;
  if (req.method === 'GET') return { interactions: await listContactInteractions(context, contactId) };
  const interaction = await createInteraction(context, contactId, input);
  return { status: 201, payload: { interaction } };
});

export default handler;
