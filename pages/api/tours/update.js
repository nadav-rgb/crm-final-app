import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { tourUpdateCommandSchema } from '../../../lib/security/schemas.mjs';
import { updateTour } from '../../../lib/security/domains/tours.mjs';

const schema = z.object({
  tourId: z.union([z.string().uuid(), z.number().int().positive()]),
  changes: tourUpdateCommandSchema,
}).strict();

export default secureHandler({ method: 'POST', schema, resourceType: 'tour' }, async (context, input) => ({
  tour: await updateTour(context, input.tourId, input.changes), changes: [], notified: [],
}));
