import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { reminderCancelSchema } from '../../../lib/security/schemas.mjs';

export default secureHandler({ method: 'POST', schema: reminderCancelSchema, resourceType: 'meeting_reminder' }, async (context, input) => {
  const { data, error } = await context.db.rpc('app_cancel_meeting_reminders', {
    p_meeting_id: String(input.meetingId),
  });
  if (error?.code === '42501') throw new SecurityError(404, 'NOT_FOUND', 'Reminder was not found');
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  return { cancelled: Number(data) > 0 };
});
