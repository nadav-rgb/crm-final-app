import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { parseJson } from '../../../lib/security/http.mjs';
import { membershipChangeSchema } from '../../../lib/security/schemas.mjs';
import {
  changeMembership, createGovernanceRpc, listProjectDirectory,
} from '../../../lib/security/domains/governance.mjs';

function dependencies(context) {
  const serviceRpc = createGovernanceRpc();
  return {
    rpc: (command) => serviceRpc(context, command),
  };
}

const handler = secureHandler({
  method: ['GET', 'POST'], schema: membershipChangeSchema, minimumAal: 1, resourceType: 'membership',
  parseBody: (req, schema, options) => req.method === 'POST' ? parseJson(req, schema, options) : undefined,
}, async (context, input, req) => {
  if (req.method === 'GET') {
    const projectId = Number(req.query?.projectId);
    return { profiles: await listProjectDirectory(context, projectId) };
  }
  return changeMembership(context, input, dependencies(context));
});

export default handler;
