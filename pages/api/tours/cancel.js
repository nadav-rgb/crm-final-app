import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { tourCancelCommandSchema } from '../../../lib/security/schemas.mjs';
import { cancelTour } from '../../../lib/security/domains/tours.mjs';

export default secureHandler({ method: 'POST', schema: tourCancelCommandSchema, resourceType: 'tour' }, async (context, input) => ({
  tour: await cancelTour(context, input.tourId, input),
}));
