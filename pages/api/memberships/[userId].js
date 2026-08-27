import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { membershipChangeSchema } from '../../../lib/security/schemas.mjs';
import { changeMembership, createGovernanceRpc } from '../../../lib/security/domains/governance.mjs';

const updateSchema = membershipChangeSchema.omit({ userId: true });

export default secureHandler({ method: 'PATCH', schema: updateSchema, resourceType: 'membership' }, async (context, input, req) => {
  const serviceRpc = createGovernanceRpc();
  const command = { ...input, userId: req.query?.userId };
  return changeMembership(context, command, {
    findMembership: async (projectId, userId) => {
      const { data, error } = await context.db.from('project_memberships').select('role,status')
        .eq('project_id', projectId).eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data;
    },
    countActiveCeos: async () => {
      const { count, error } = await context.db.from('profiles').select('id', { count: 'exact', head: true }).eq('global_role', 'ceo');
      if (error) throw error;
      return count ?? 0;
    },
    rpc: (derived) => serviceRpc(context, derived),
  });
});
