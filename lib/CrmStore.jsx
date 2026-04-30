// lib/CrmStore.jsx
import { createContext, useContext, useState } from 'react';
import _contacts     from '../data/contacts';
import _interactions from '../data/interactions';
import _messages     from '../data/messages';
import { MITZVOT_BONUS_PER_LEVEL, NEW_PARTICIPANT_BONUS } from './paymentCalc';
import { baseMeetingReports, BASE_MEETING_QUESTIONS } from '../data/base-meetings';
import { advanceReminderStageForReports } from './reminderSchedulerDemo';

const CrmContext = createContext(null);

const BASE_REPORTS_STORAGE_KEY = 'crm_base_meeting_reports_demo_v1';

function loadInitialBaseMeetings() {
  if (typeof window === 'undefined') return baseMeetingReports;
  try {
    const saved = JSON.parse(window.localStorage.getItem(BASE_REPORTS_STORAGE_KEY) || '[]');
    if (!Array.isArray(saved) || saved.length === 0) return baseMeetingReports;
    const byId = new Map(baseMeetingReports.map(report => [String(report.id), report]));
    saved.forEach(report => byId.set(String(report.id), report));
    return Array.from(byId.values());
  } catch (err) {
    console.warn('Could not read base meeting reports from localStorage', err);
    return baseMeetingReports;
  }
}

function persistBaseMeetings(nextReports) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BASE_REPORTS_STORAGE_KEY, JSON.stringify(nextReports));
  } catch (err) {
    console.warn('Could not save base meeting reports to localStorage', err);
  }
}


const PROJECT_NAMES = { 1:'איילת השחר', 2:'אחדות יהודית', 3:'שבת מכל הסיבות', 4:'נפש יהודי' };

export function CrmProvider({ children }) {
  const [contacts,     setContacts]     = useState(_contacts);
  const [interactions, setInteractions] = useState(_interactions);
  const [messages,     setMessages]     = useState(_messages);
  const [mitzvotBonuses, setMitzvotBonuses] = useState([]);
  const [baseMeetings, setBaseMeetings] = useState(loadInitialBaseMeetings); // דיווחי מפגשי בסיס קיימים/שמורים
  const [newParticipantBonuses, setNewParticipantBonuses] = useState([]); // { activist_id, contact_id, contactName, date, month }

  function addInteraction({ id, contact_id, activist_id, type, quality, duration_minutes, outcome, date, time, notes, description, ai_summary, next_action, next_action_date }) {
    const contact = contacts.find(c => c.id === contact_id);
    const newInteraction = {
      id:               id ?? Date.now(),
      contact_id,
      activist_id,
      type,
      quality:          quality ?? '',
      duration_minutes: duration_minutes ?? 0,
      outcome:          outcome ?? 'חיובי',
      date,
      time:             time ?? new Date().toTimeString().slice(0,5),
      notes:            notes ?? '',
      description:      description ?? '',
      ai_summary:       ai_summary ?? '',
      contact_name:     contact?.name ?? '',
      project_id:       contact?.project_id ?? null,
    };
    setInteractions(prev => [newInteraction, ...prev]);

    const interactionDate = new Date(date);
    const today = new Date(); today.setHours(0,0,0,0);
    const diffDays = Math.max(0, Math.floor((today - interactionDate) / 86400000));

    setContacts(prev => prev.map(c => {
      if (c.id !== contact_id) return c;
      return {
        ...c,
        days_since_last_contact: diffDays,
        last_interaction_date:   date,
        next_action:             next_action      !== undefined ? next_action      : c.next_action,
        next_action_date:        next_action_date !== undefined ? next_action_date : c.next_action_date,
      };
    }));
  }

  function addContact(contactData) {
    const newContact = { ...contactData, id: Date.now(), mitzvot: contactData.mitzvot || {}, mitzvot_history: [] };
    setContacts(prev => [newContact, ...prev]);

    // בדיקת הפניה — הבאת משתתף חדש
    if (contactData.referred_by && contactData.activist_id) {
      const referredContact = contacts.find(c => c.id === contactData.referred_by);
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
      setNewParticipantBonuses(prev => [...prev, {
        activist_id:  contactData.activist_id,
        contact_id:   contactData.referred_by,
        contactName:  referredContact?.name ?? '',
        date:         now.toISOString().split('T')[0],
        month:        monthKey,
        amount:       NEW_PARTICIPANT_BONUS,
      }]);
    }
  }

  function updateNextAction(contactId, nextAction, nextActionDate) {
    setContacts(prev => prev.map(c => {
      if (c.id !== contactId) return c;
      return { ...c, next_action: nextAction || null, next_action_date: nextActionDate || null };
    }));
  }

  // עדכון סרגל מצוות — מזהה עליות ומוסיף בונוסים
  function updateMitzvot(contactId, activistId, newMitzvot) {
    setContacts(prev => prev.map(c => {
      if (c.id !== contactId) return c;
      const oldMitzvot = c.mitzvot || {};
      const history    = [...(c.mitzvot_history || [])];
      const bonusesAdded = [];
      const now        = new Date();
      const monthKey   = `${now.getFullYear()}-${now.getMonth()}`;

      for (const [mitzva, newLevel] of Object.entries(newMitzvot)) {
        const oldLevel = oldMitzvot[mitzva] ?? 0;
        const diff     = Number(newLevel) - Number(oldLevel);
        if (diff > 0) {
          history.push({ mitzva, from: oldLevel, to: newLevel, date: now.toISOString().split('T')[0] });
          for (let d = 0; d < diff; d++) {
            bonusesAdded.push({ activist_id: activistId, contact_id: contactId, contactName: c.name, amount: MITZVOT_BONUS_PER_LEVEL, desc: `עליה ב${mitzva} מרמה ${oldLevel+d} ל-${oldLevel+d+1}`, date: now.toISOString().split('T')[0], month: monthKey });
          }
        }
      }

      if (bonusesAdded.length > 0) {
        setMitzvotBonuses(prev => [...prev, ...bonusesAdded]);
      }

      return { ...c, mitzvot: newMitzvot, mitzvot_history: history };
    }));
  }

  function submitBaseMeeting(meetingId, answers, meetingData = {}) {
    setBaseMeetings(prev => {
      const submittedReport = {
        ...meetingData,
        id: meetingId,
        answers,
        submitted: true,
        submitted_at: new Date().toISOString().split('T')[0],
      };

      const exists = prev.some(m => String(m.id) === String(meetingId));
      const next = exists
        ? prev.map(m => String(m.id) === String(meetingId) ? { ...m, ...submittedReport } : m)
        : [submittedReport, ...prev];

      persistBaseMeetings(next);
      return next;
    });
  }


  function upsertBaseMeetingReports(reports = []) {
    setBaseMeetings(prev => {
      const byId = new Map(prev.map(report => [String(report.id), report]));
      reports.forEach(report => {
        if (report && report.id !== undefined && report.id !== null) byId.set(String(report.id), report);
      });
      const next = Array.from(byId.values());
      persistBaseMeetings(next);
      return next;
    });
  }

  function advanceBaseMeetingReminders(predicate = () => true) {
    let resultSummary = { changedCount: 0, notificationsCount: 0 };
    setBaseMeetings(prev => {
      const result = advanceReminderStageForReports(prev, predicate);
      resultSummary = { changedCount: result.changedCount, notificationsCount: result.notificationsCount };
      persistBaseMeetings(result.reports);
      return result.reports;
    });
    return resultSummary;
  }

  function addMessage({ title, body, project_id, currentUser }) {
    setMessages(prev => [{
      id: Date.now(), from_role: currentUser.role, from_name: currentUser.name,
      project_id: project_id ?? null, title, body,
      date: new Date().toISOString().split('T')[0], pinned: false,
    }, ...prev]);
  }

  return (
    <CrmContext.Provider value={{
      contacts, interactions, messages, baseMeetings, BASE_MEETING_QUESTIONS,
      mitzvotBonuses, newParticipantBonuses,
      addInteraction, addContact, updateNextAction, updateMitzvot, addMessage, submitBaseMeeting, upsertBaseMeetingReports, advanceBaseMeetingReminders,
      PROJECT_NAMES,
    }}>
      {children}
    </CrmContext.Provider>
  );
}

export function useCrm() {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error('useCrm must be used inside <CrmProvider>');
  return ctx;
}
