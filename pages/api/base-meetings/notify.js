import { z } from 'zod';
import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { enqueueNotificationEvent } from '../../../lib/security/domains/notifications.mjs';

const schema = z.object({ reportId: z.union([z.string().uuid(), z.number().int().positive()]) }).strict();

export default secureHandler({ method: 'POST', schema, resourceType: 'base_meeting_report' }, async (context, input) => {
  const { data: report, error } = await context.db.from('base_meeting_reports')
    .select('id,project_id,house_id,actor_user_id').eq('id', input.reportId).maybeSingle();
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  if (!report) throw new SecurityError(404, 'NOT_FOUND', 'Report was not found');
  const membership = context.memberships?.find((entry) => entry.projectId === report.project_id && entry.status === 'active');
  if (context.globalRole !== 'ceo' && report.actor_user_id !== context.userId && !['head', 'coord'].includes(membership?.role)) {
    throw new SecurityError(404, 'NOT_FOUND', 'Report was not found');
  }
  return enqueueNotificationEvent(context, {
    eventType: 'base_meeting_reported', resourceId: report.id,
  });
});
