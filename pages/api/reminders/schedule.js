import { secureHandler } from '../../../lib/security/api-handler.mjs';
import { SecurityError } from '../../../lib/security/errors.mjs';
import { reminderScheduleSchema } from '../../../lib/security/schemas.mjs';
import { getHouse, scheduleReminderCommand } from '../../../lib/security/domains/meetings.mjs';

function times(occurredAt) {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) throw new SecurityError(400, 'VALIDATION_FAILED', 'Meeting date is invalid');
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return [
    ['activist_1', 20 * 60],
    ['activist_2', 31 * 60],
    ['activist_3', 32 * 60 + 30],
    ['coordinator', 33 * 60],
  ].map(([type, hours]) => ({ type, remind_at: new Date(day.getTime() + hours * 60 * 1000).toISOString() }));
}

export default secureHandler({ method: 'POST', schema: reminderScheduleSchema, resourceType: 'meeting_reminder' }, async (context, input) => {
  const { data: report, error } = await context.db.from('base_meeting_reports')
    .select('id,project_id,house_id,actor_user_id,occurred_at').eq('id', input.meetingId).maybeSingle();
  if (error) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: error });
  if (!report) throw new SecurityError(404, 'NOT_FOUND', 'Meeting was not found');
  const house = await getHouse(context, report.house_id);
  const baseKey = (await scheduleReminderCommand(context, report, house, input)).idempotency_key;
  const rows = times(report.occurred_at).map((entry) => ({
    meeting_id: report.id, project_id: report.project_id, recipient_user_id: report.actor_user_id,
    type: entry.type, remind_at: entry.remind_at, idempotency_key: `${baseKey}:${entry.type}`,
  }));
  const { error: insertError } = await context.db.from('meeting_reminders').insert(rows);
  if (insertError?.code === '23505') throw new SecurityError(409, 'REMINDER_CONFLICT', 'Reminder is already scheduled');
  if (insertError) throw new SecurityError(503, 'DATA_UNAVAILABLE', 'Data service is unavailable', { cause: insertError });
  return { scheduled: rows.length };
});
