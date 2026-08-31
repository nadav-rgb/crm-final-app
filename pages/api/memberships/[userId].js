import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { membershipChangeSchema } from '../../../lib/security/schemas.mjs';
import { changeMembership, createGovernanceRpc } from '../../../lib/security/domains/governance.mjs';

const updateSchema = membershipChangeSchema.omit({ userId: true });

export default secureHandler({ method: 'PATCH', schema: updateSchema, resourceType: 'membership' }, async (context, input, req) => {
  const serviceRpc = createGovernanceRpc();
  const command = { ...input, userId: req.query?.userId };
  return changeMembership(context, command, {
    rpc: (derived) => serviceRpc(context, derived),
  });
});
