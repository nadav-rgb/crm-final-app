import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { tourIdCommandSchema } from '../../../lib/security/schemas.mjs';
import { assertTourAccess, getTour } from '../../../lib/security/domains/tours.mjs';
import { enqueueNotificationEvent } from '../../../lib/security/domains/notifications.mjs';

export default secureHandler({ method: 'POST', schema: tourIdCommandSchema, resourceType: 'tour' }, async (context, input) => {
  const tour = await getTour(context, input.tourId);
  assertTourAccess(context, 'update', tour);
  return enqueueNotificationEvent(context, {
    eventType: 'tour_created', resourceId: tour.id,
  });
});
