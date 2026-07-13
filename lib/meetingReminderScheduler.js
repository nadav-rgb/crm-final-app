// lib/meetingReminderScheduler.js — קביעת תזכורות דיווח בצד השרת (server-side בלבד).
//
// הרקע: עד עכשיו תזכורות נקבעו רק כשמישהו פתח את דף base-meetings ביום המפגש עצמו
// (pages/base-meetings.jsx) — כלומר התזכורת הייתה תלויה בדיוק בפעולה שהיא אמורה
// לעורר, ובפועל טבלת meeting_reminders נשארה ריקה מאז ומעולם.
// כאן: ה-cron (send-reminders, רץ כל דקה) קורא ל-ensureRemindersForDate שסורק את
// בתי המפגש ויוצר תזכורות לכל מפגש של אותו יום — בלי תלות בפתיחת דף ע"י אף אחד.
// אידמפוטנטי: מדלג על צירופי מפגש+פעיל שכבר יש להם תזכורות או דיווח שהוגש.
import { createBaseMeetingId } from './baseMeetingUtils';

// אותה קונבנציית אזור-זמן כמו שאר הקוד (UTC+3 קיץ) — ראה api/reminders/schedule.js
function israelTime(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

export function israelToday() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// סורק את בתי המפגש ויוצר תזכורות לכל מפגש בתאריך dateStr (YYYY-MM-DD).
// מחזיר { scheduled } — כמה צירופי מפגש+פעיל קיבלו סט תזכורות חדש.
export async function ensureRemindersForDate(supabase, dateStr) {
  const { data: houses, error: housesErr } = await supabase
    .from('meeting_houses')
    .select('id, assigned_activists, meetings, project_id, status');
  if (housesErr) return { scheduled: 0, error: housesErr.message };

  // כל צירופי (מפגש בתאריך המבוקש × פעיל משובץ)
  const candidates = [];
  for (const house of houses || []) {
    if (house.status === 'completed') continue;
    const activists = Array.isArray(house.assigned_activists) ? house.assigned_activists : [];
    const meetings = Array.isArray(house.meetings) ? house.meetings : [];
    if (!activists.length) continue;
    meetings.forEach((meeting, index) => {
      if (meeting?.date !== dateStr) return;
      const meetingNumber = Number(meeting.meetingNumber || index + 1);
      activists.forEach(activistId => {
        candidates.push({
          meetingId: createBaseMeetingId(house.id, activistId, meetingNumber),
          activistId: String(activistId),
          projectId: house.project_id ?? 1,
        });
      });
    });
  }
  if (!candidates.length) return { scheduled: 0 };

  const meetingIds = [...new Set(candidates.map(c => c.meetingId))];

  // דילוג על מה שכבר קיים: תזכורות שנקבעו (גם ע"י הזרימה הישנה מהקליינט) או דיווח שכבר הוגש
  const { data: existingRems } = await supabase
    .from('meeting_reminders')
    .select('meeting_id, activist_id')
    .in('meeting_id', meetingIds);
  const already = new Set((existingRems || []).map(r => `${r.meeting_id}__${r.activist_id}`));

  const { data: existingReports } = await supabase
    .from('base_meeting_reports')
    .select('id')
    .in('id', meetingIds);
  const reported = new Set((existingReports || []).map(r => String(r.id)));

  const pending = candidates.filter(c =>
    !already.has(`${c.meetingId}__${c.activistId}`) && !reported.has(c.meetingId)
  );
  if (!pending.length) return { scheduled: 0 };

  // רכז לכל פרויקט (אותה סמנטיקה כמו api/reminders/schedule.js — הרכז הראשון בפרויקט)
  const { data: coords } = await supabase
    .from('profiles')
    .select('activist_code, project_id')
    .eq('role', 'coord');
  const coordByProject = {};
  for (const c of coords || []) {
    if (coordByProject[c.project_id] === undefined) coordByProject[c.project_id] = String(c.activist_code);
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const rows = pending.flatMap(c => {
    const base = {
      meeting_id: c.meetingId,
      activist_id: c.activistId,
      coordinator_id: coordByProject[c.projectId] || 'none',
      meeting_date: dateStr,
    };
    return [
      { ...base, remind_at: israelTime(year, month, day,     23,  0).toISOString(), type: 'activist_1' },
      { ...base, remind_at: israelTime(year, month, day + 1, 10,  0).toISOString(), type: 'activist_2' },
      { ...base, remind_at: israelTime(year, month, day + 1, 11, 30).toISOString(), type: 'activist_3' },
      { ...base, remind_at: israelTime(year, month, day + 1, 12,  0).toISOString(), type: 'coordinator' },
    ];
  });

  const { error: insErr } = await supabase.from('meeting_reminders').insert(rows);
  if (insErr) return { scheduled: 0, error: insErr.message };

  return { scheduled: pending.length };
}
