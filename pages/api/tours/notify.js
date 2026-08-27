import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { tourIdCommandSchema } from '../../../lib/security/schemas.mjs';
import { assertTourAccess, getTour } from '../../../lib/security/domains/tours.mjs';

export default secureHandler({ method: 'POST', schema: tourIdCommandSchema, resourceType: 'tour' }, async (context, input) => {
  const tour = await getTour(context, input.tourId);
  assertTourAccess(context, 'update', tour);
  const { data, error } = await context.db.rpc('enqueue_tour_notification', { p_tour_id: tour.id, p_event_type: 'created' });
  if (error) throw new SecurityError(503, 'DEPENDENCY_UNAVAILABLE', 'Notification delivery is unavailable', { cause: error });
  return { notified: Array.isArray(data) ? data : [] };
});
