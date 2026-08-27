import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { tourIdCommandSchema } from '../../../lib/security/schemas.mjs';
import { deleteTour } from '../../../lib/security/domains/tours.mjs';

export default secureHandler({ method: 'POST', schema: tourIdCommandSchema, minimumAal: 2, resourceType: 'tour' }, async (context, input) => (
  deleteTour(context, input.tourId)
));
