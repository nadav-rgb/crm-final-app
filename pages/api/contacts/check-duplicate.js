import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { duplicateContactSchema } from '../../../lib/security/schemas.mjs';
import { checkDuplicateContact } from '../../../lib/security/domains/contacts.mjs';
import { requireContactsBff } from '../../../lib/security/domains/route-support.mjs';

const handler = secureHandler({
  method: 'POST', schema: duplicateContactSchema, maxBytes: 1_024, resourceType: 'contact',
}, async (context, input) => {
  requireContactsBff();
  return checkDuplicateContact(context, input, {
    lookup: async ({ projectId, phoneSuffix }) => {
      const { data, error } = await context.db.rpc('check_contact_duplicate', {
        p_project_id: projectId,
        p_phone_suffix: phoneSuffix,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
});

export default handler;
