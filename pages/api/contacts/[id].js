import { parseJson } from '../../../lib/security/http.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { contactUpdateSchema } from '../../../lib/security/schemas.mjs';
import { getContact, softDeleteContact, toContactDetailDto, updateContact } from '../../../lib/security/domains/contacts.mjs';
import { activeMemberLookup, requireContactsBff } from '../../../lib/security/domains/route-support.mjs';

const handler = secureHandler({
  method: ['GET', 'PATCH', 'DELETE'], schema: contactUpdateSchema, maxBytes: 4_096,
  parseBody: (req, schema, options) => req.method === 'PATCH' ? parseJson(req, schema, options) : undefined,
  resourceType: 'contact',
}, async (context, input, req) => {
  requireContactsBff();
  const id = req.query?.id;
  if (req.method === 'GET') return { contact: toContactDetailDto(context, await getContact(context, id)) };
  if (req.method === 'PATCH') return { contact: await updateContact(context, id, input, { isActiveMember: activeMemberLookup(context) }) };
  return softDeleteContact(context, id);
});

export default handler;
