import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { meetingHouseCommandSchema } from '../../../lib/security/schemas.mjs';
import { upsertHouse } from '../../../lib/security/domains/meetings.mjs';

export default secureHandler({ method: 'POST', schema: meetingHouseCommandSchema, resourceType: 'meeting_house' }, async (context, input) => ({
  house: await upsertHouse(context, input),
}));
