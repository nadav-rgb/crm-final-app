// lib/reminderTrigger.js
// Automatic time-based trigger for base meeting report reminders.
// Reads current time against each report's meeting date and advances
// reminderStage through the 4-stage sequence defined in reminderSchedulerDemo.js.
// No external delivery — notifications land in the in-app store only.

import { advanceBaseReportReminder, REMINDER_STAGES } from './reminderSchedulerDemo';

const GUARD_KEY = 'reminders_last_check_at';
const GUARD_INTERVAL_MS = 60 * 60 * 1000; // re-check at most once per hour

function parseLocalDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

function threshold(meetingDate, offsetDays, hours, minutes) {
  const d = new Date(meetingDate.getTime());
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// Returns the stage the report *should* be at given the current time.
// Returns null if the report should be skipped entirely.
function computeExpectedStage(report, now) {
  if (report.submitted) return null;
  const meetingDate = parseLocalDate(report.date);
  if (!meetingDate) return null;

  const t23   = threshold(meetingDate, 0, 23,  0);  // same day  23:00
  const t10   = threshold(meetingDate, 1, 10,  0);  // next day  10:00
  const t1130 = threshold(meetingDate, 1, 11, 30);  // next day  11:30
  const t12   = threshold(meetingDate, 1, 12,  0);  // next day  12:00 — escalation

  if (now >= t12)   return REMINDER_STAGES.MANAGER_1200;
  if (now >= t1130) return REMINDER_STAGES.LAST_1130;
  if (now >= t10)   return REMINDER_STAGES.MORNING_10;
  if (now >= t23)   return REMINDER_STAGES.NIGHT_23;
  return REMINDER_STAGES.NONE;
}

export function checkAndFireReminders(baseMeetings, upsertBaseMeetingReports) {
  if (typeof window === 'undefined') return;

  // Run-once guard — skip if checked less than GUARD_INTERVAL_MS ago
  const lastCheck = window.localStorage.getItem(GUARD_KEY);
  const now = new Date();
  if (lastCheck && (now.getTime() - new Date(lastCheck).getTime()) < GUARD_INTERVAL_MS) return;

  const updatedReports = [];

  (baseMeetings || []).forEach(report => {
    const expectedStage = computeExpectedStage(report, now);
    if (expectedStage === null) return;

    const currentStage = Number(report.reminderStage ?? 0);
    if (currentStage >= expectedStage) return;

    // Advance one stage at a time so each stage's notification fires correctly
    let current = { ...report };
    for (let target = currentStage + 1; target <= expectedStage; target++) {
      const result = advanceBaseReportReminder(current);
      if (result.changed) current = result.report;
    }
    updatedReports.push(current);
  });

  if (updatedReports.length > 0) {
    upsertBaseMeetingReports(updatedReports);
  }

  window.localStorage.setItem(GUARD_KEY, now.toISOString());
}
