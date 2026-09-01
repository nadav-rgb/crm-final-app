import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { listInteractionsPage } from '../../../lib/security/domains/interactions.mjs';
import { requireContactsBff } from '../../../lib/security/domains/route-support.mjs';

const handler = secureHandler({
  method: 'GET',
  resourceType: 'interaction',
}, async (context, _input, req) => {
  requireContactsBff();
  const page = await listInteractionsPage(context, {
    cursor: Array.isArray(req.query?.cursor) ? undefined : req.query?.cursor,
    limit: Array.isArray(req.query?.limit) ? undefined : req.query?.limit,
  });
  return { interactions: page.items, nextCursor: page.nextCursor };
});

export default handler;
