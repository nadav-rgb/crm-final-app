import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { getProfile } from '../../../lib/security/domains/governance.mjs';

export default secureHandler({ method: 'GET', resourceType: 'profile' }, async (context, _input, req) => ({
  profile: await getProfile(context, req.query?.userId, req.query?.projectId),
}));
