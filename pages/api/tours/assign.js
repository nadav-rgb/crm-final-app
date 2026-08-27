import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { tourAssignmentCommandSchema } from '../../../lib/security/schemas.mjs';
import { assignTour } from '../../../lib/security/domains/tours.mjs';

export default secureHandler({ method: 'POST', schema: tourAssignmentCommandSchema, resourceType: 'tour' }, async (context, input) => ({
  tour: await assignTour(context, input.tourId, input),
}));
