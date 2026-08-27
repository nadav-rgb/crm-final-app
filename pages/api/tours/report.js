import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { tourReportCommandSchema } from '../../../lib/security/schemas.mjs';
import { submitTourReport } from '../../../lib/security/domains/tours.mjs';

const schema = z.object({
  tourId: z.union([z.string().uuid(), z.number().int().positive()]),
  report: tourReportCommandSchema,
}).strict();

export default secureHandler({ method: 'POST', schema, resourceType: 'tour' }, async (context, input) => ({
  tour: await submitTourReport(context, input.tourId, input.report),
}));
