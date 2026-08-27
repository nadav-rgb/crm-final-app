import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { listProjects } from '../../../lib/security/domains/governance.mjs';

export default secureHandler({ method: 'GET', resourceType: 'project' }, async (context) => ({
  projects: await listProjects(context),
}));
