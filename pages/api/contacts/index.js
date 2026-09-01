import { parseJson } from '../../../lib/security/http.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { contactCreateSchema } from '../../../lib/security/schemas.mjs';
import { createContact, listContactsPage } from '../../../lib/security/domains/contacts.mjs';
import { activeMemberLookup, requireContactsBff } from '../../../lib/security/domains/route-support.mjs';

const handler = secureHandler({
  method: ['GET', 'POST'], schema: contactCreateSchema, maxBytes: 65_536,
  parseBody: (req, schema, options) => req.method === 'POST' ? parseJson(req, schema, options) : undefined,
  resourceType: 'contact',
}, async (context, input, req) => {
  requireContactsBff();
  if (req.method === 'GET') {
    const page = await listContactsPage(context, {
      cursor: Array.isArray(req.query?.cursor) ? undefined : req.query?.cursor,
      limit: Array.isArray(req.query?.limit) ? undefined : req.query?.limit,
    });
    return { contacts: page.items, nextCursor: page.nextCursor };
  }
  const contact = await createContact(context, input, { isActiveMember: activeMemberLookup(context) });
  return { status: 201, payload: { contact } };
});

export default handler;
