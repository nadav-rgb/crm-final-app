import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { assignHouse } from '../../../lib/security/domains/meetings.mjs';

const schema = z.object({
  houseId: z.union([z.string().uuid(), z.number().int().positive()]),
  assignedUserIds: z.array(z.string().uuid()).max(100),
}).strict();

export default secureHandler({ method: 'POST', schema, resourceType: 'meeting_house' }, async (context, input) => ({
  house: await assignHouse(context, input.houseId, input),
}));
