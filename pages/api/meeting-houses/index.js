import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { listHouses } from '../../../lib/security/domains/meetings.mjs';

export default secureHandler({ method: 'GET', resourceType: 'meeting_house' }, async (context) => ({
  houses: await listHouses(context),
}));
