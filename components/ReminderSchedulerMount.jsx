// components/ReminderSchedulerMount.jsx
// Zero-render mount point for the automatic reminder trigger.
// Place inside CrmProvider + AuthProvider. Renders null.
// Runs checkAndFireReminders once per hour per session, on login.

import { useEffect } from 'react';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import { checkAndFireReminders } from '../lib/reminderTrigger';

export default function ReminderSchedulerMount() {
  const { currentUser } = useAuth();
  const { baseMeetings, upsertBaseMeetingReports } = useCrm();

  useEffect(() => {
    if (!currentUser) return;
    if (typeof window === 'undefined') return;
    checkAndFireReminders(baseMeetings, upsertBaseMeetingReports);
  }, [currentUser]); // re-evaluate on login/logout; guard prevents duplicate fires

  return null;
}
