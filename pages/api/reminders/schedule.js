// pages/api/reminders/schedule.js — schedules 4 reminders for a meeting
// Times are in Israel Standard Time (UTC+3):
//   activist_1  → same day  23:00 IST
//   activist_2  → next day  10:00 IST
//   activist_3  → next day  11:30 IST
//   coordinator → next day  12:00 IST (only if report not filled)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';

function israelTime(year, month, day, hour, minute) {
  // Israel is UTC+3 (summer) — subtract 3 hours to get UTC
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { meetingId, activistId, coordinatorId, meetingDate } = req.body;
  if (!meetingId || !activistId || !meetingDate) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const supabase = getSupabaseAdmin();

  // Skip if reminders already exist for this meeting
  const { data: existing } = await supabase
    .from('meeting_reminders')
    .select('id')
    .eq('meeting_id', meetingId)
    .eq('activist_id', activistId)
    .limit(1);

  if (existing?.length > 0) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const [year, month, day] = meetingDate.split('-').map(Number);
  const coordId = coordinatorId || 'none';

  const base = { meeting_id: meetingId, activist_id: activistId, coordinator_id: coordId, meeting_date: meetingDate };

  const rows = [
    { ...base, remind_at: israelTime(year, month, day,     23,  0).toISOString(), type: 'activist_1' },
    { ...base, remind_at: israelTime(year, month, day + 1, 10,  0).toISOString(), type: 'activist_2' },
    { ...base, remind_at: israelTime(year, month, day + 1, 11, 30).toISOString(), type: 'activist_3' },
    { ...base, remind_at: israelTime(year, month, day + 1, 12,  0).toISOString(), type: 'coordinator' },
  ];

  const { error } = await supabase.from('meeting_reminders').insert(rows);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true, scheduled: rows.length });
}
