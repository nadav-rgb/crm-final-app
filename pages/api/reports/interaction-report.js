import { z } from 'zod';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { assertCeoReportAccess } from '../../../lib/security/domains/finance.mjs';
import reportServer from '../../../lib/interactionReportServer';

const { loadScopedInteractionReport } = reportServer;
const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

export default secureHandler({ method: 'GET', minimumAal: 2, resourceType: 'interaction_report' }, async (context, _input, req) => {
  assertCeoReportAccess(context);
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) throw new SecurityError(400, 'VALIDATION_FAILED', 'Report date range is invalid');
  return loadScopedInteractionReport({
    supabase: context.db,
    startDate: parsed.data.from ?? '',
    endDate: parsed.data.to ?? '',
  });
});
