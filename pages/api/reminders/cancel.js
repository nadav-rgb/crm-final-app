import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { reminderCancelSchema } from '../../../lib/security/schemas.mjs';
import { cancelReminderCommand } from '../../../lib/security/domains/meetings.mjs';

export default secureHandler({ method: 'POST', schema: reminderCancelSchema, resourceType: 'meeting_reminder' }, async (context, input) => {
  const { data: reminder, error } = await context.db.from('meeting_reminders')
    .select('id,project_id,recipient_user_id,meeting_id').eq('meeting_id', input.meetingId)
    .eq('recipient_user_id', context.userId).is('cancelled_at', null).limit(1).maybeSingle();
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  if (!reminder) throw new SecurityError(404, 'NOT_FOUND', 'Reminder was not found');
  const command = await cancelReminderCommand(context, reminder);
  const { data, error: updateError } = await context.db.from('meeting_reminders')
    .update({ cancelled_at: command.cancelled_at }).eq('id', reminder.id).select('id').maybeSingle();
  if (updateError) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: updateError });
  if (!data) throw new SecurityError(404, 'NOT_FOUND', 'Reminder was not found');
  return { cancelled: true };
});
