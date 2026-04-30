// lib/getReminders.js
const getStatus = require('./getStatus');

const CONFIG = {
  thresholds: { warning: 14, urgent: 30, critical: 90, former: 120 }
};

function getReminders(contact) {
  const days   = contact.days_since_last_contact ?? 0;
  const status = getStatus(days);

  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  const actionOverdue = contact.next_action_date
    ? new Date(contact.next_action_date) < today
    : false;

  const actionDue = contact.next_action_date
    ? new Date(contact.next_action_date) <= today
    : false;

  return {
    status,
    isFormer:      days > 120,
    isCritical:    days > 90 && days <= 120,
    isUrgent:      days > 30 && days <= 90,
    needsFollowUp: days > 14,
    actionDue,
    actionOverdue,
  };
}

module.exports = getReminders;
