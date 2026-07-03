// lib/reminderSchedulerDemo.js
// Scheduler דמו לתזכורות דיווחי מפגשי בסיס.
// אין כאן cron אמיתי ואין Push אמיתי. זה מדמה את רצף התזכורות: 23:00, 10:00, 11:30, 12:00 לרכז.

import { createDemoNotification, getAchdutNotificationManagers } from './notificationDemo';

export const REMINDER_STAGES = {
  NONE: 0,
  NIGHT_23: 1,
  MORNING_10: 2,
  LAST_1130: 3,
  MANAGER_1200: 4,
};

export function getReminderStatus(report = {}) {
  if (report.submitted) return { label: 'הושלם וננעל', icon: '✅', tone: 'done' };
  const stage = Number(report.reminderStage || 0);
  if (stage === REMINDER_STAGES.NIGHT_23) return { label: 'נשלחה תזכורת 23:00', icon: '🔔', tone: 'warn' };
  if (stage === REMINDER_STAGES.MORNING_10) return { label: 'נשלחה תזכורת 10:00', icon: '🔔', tone: 'warn' };
  if (stage === REMINDER_STAGES.LAST_1130) return { label: 'תזכורת אחרונה 11:30', icon: '⚠️', tone: 'danger' };
  if (stage >= REMINDER_STAGES.MANAGER_1200) return { label: 'דווח לרכז ב-12:00', icon: '❌', tone: 'danger' };
  return { label: 'ממתין לדיווח', icon: '⏳', tone: 'idle' };
}

function buildReportTitle(report) {
  return `בית מפגש ${report.meeting_place_number || report.house_id || ''}, מפגש ${report.meeting_number || ''}`.trim();
}

function createActivistReminder(report, nextStage) {
  const stageTexts = {
    [REMINDER_STAGES.NIGHT_23]: {
      title: 'תזכורת למילוי דיווח מפגש בסיס',
      body: `נא למלא דיווח עבור ${buildReportTitle(report)}. זו תזכורת דמו של 23:00.`,
    },
    [REMINDER_STAGES.MORNING_10]: {
      title: 'תזכורת נוספת למילוי דיווח',
      body: `עדיין לא מולא דיווח עבור ${buildReportTitle(report)}. זו תזכורת דמו של 10:00 בבוקר.`,
    },
    [REMINDER_STAGES.LAST_1130]: {
      title: 'תזכורת אחרונה לפני עדכון רכז',
      body: `דיווח ${buildReportTitle(report)} עדיין חסר. אם לא ימולא עד 12:00, הרכז יקבל התראה.`,
    },
  };

  const text = stageTexts[nextStage];
  if (!text || !report.activist_id) return [];

  return [createDemoNotification({
    id: `base_report_stage_${nextStage}_${report.id}_${Date.now()}`,
    type: 'base_report_reminder',
    title: text.title,
    body: text.body,
    user_id: report.activist_id,
    project_id: 1,
    priority: nextStage >= REMINDER_STAGES.LAST_1130 ? 'high' : 'normal',
    created_at: new Date().toISOString(),
    link: '/base-meetings',
  })];
}

function createManagerEscalation(report) {
  return getAchdutNotificationManagers().map(manager => createDemoNotification({
    id: `base_report_missing_manager_${report.id}_${manager.id}_${Date.now()}`,
    type: 'missing_report',
    title: 'פעיל לא מילא דיווח מפגש בסיס',
    body: `${report.activist_name || 'פעיל'} לא מילא דיווח עבור ${buildReportTitle(report)} עד 12:00.`,
    user_id: manager.id,
    project_id: 1,
    priority: 'high',
    created_at: new Date().toISOString(),
    link: `/meeting-houses/${report.house_id || ''}`,
  }));
}

export function advanceBaseReportReminder(report) {
  if (!report || report.submitted) return { report, notifications: [], changed: false };

  const currentStage = Number(report.reminderStage || 0);
  const nextStage = Math.min(currentStage + 1, REMINDER_STAGES.MANAGER_1200);

  const notifications = nextStage >= REMINDER_STAGES.MANAGER_1200
    ? createManagerEscalation(report)
    : createActivistReminder(report, nextStage);

  return {
    report: {
      ...report,
      reminderStage: nextStage,
      lastReminderAt: new Date().toISOString(),
      escalatedToManager: nextStage >= REMINDER_STAGES.MANAGER_1200,
    },
    notifications,
    changed: true,
  };
}

export function advanceReminderStageForReports(reports = [], predicate = () => true) {
  let changedCount = 0;
  let notificationsCount = 0;

  const nextReports = reports.map(report => {
    if (!predicate(report)) return report;
    const result = advanceBaseReportReminder(report);
    if (result.changed) changedCount += 1;
    notificationsCount += result.notifications.length;
    return result.report;
  });

  return { reports: nextReports, changedCount, notificationsCount };
}
