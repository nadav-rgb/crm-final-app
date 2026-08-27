// Server-only scheduler boundary. The service client may execute only the audited,
// idempotent RPC; it must never perform service-role business table CRUD here.
export function israelToday(clock = Date) {
  return new clock(clock.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function ensureRemindersForDate(serviceClient, dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr)) || typeof serviceClient?.rpc !== 'function') {
    return { scheduled: 0, error: 'scheduler unavailable' };
  }
  const { data, error } = await serviceClient.rpc('app_schedule_meeting_reminders', { p_meeting_date: dateStr });
  if (error) return { scheduled: 0, error: 'scheduler unavailable' };
  const scheduled = Number(data);
  return { scheduled: Number.isSafeInteger(scheduled) && scheduled >= 0 ? scheduled : 0 };
}
