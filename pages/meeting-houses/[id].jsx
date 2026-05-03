// pages/meeting-houses/[id].jsx
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../../components/DesktopLayout';
import { useAuth } from '../../lib/AuthStore';
import { getMeetingHouseById, updateMeetingHouseAssignments, updateMeetingCompletion } from '../../lib/meetingHousesStorage';
import { createDemoNotification } from '../../lib/notificationDemo';
import activists from '../../data/activists';
import { useCrm } from '../../lib/CrmStore';
import { summarizeMeetingHouseSeriesDemo, generateMeetingNotesAiSummaryDemo } from '../../lib/aiDemo';
import { buildBaseMeetingsFromHouses, getMeetingSeriesReports } from '../../lib/baseMeetingUtils';
import { advanceReminderStageForReports, getReminderStatus } from '../../lib/reminderSchedulerDemo';

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('he-IL');
}

export default function MeetingHouseDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { can, currentUser } = useAuth();
  const { baseMeetings, upsertBaseMeetingReports } = useCrm();

  const [house, setHouse] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [assignedIds, setAssignedIds] = useState([]);
  const [selectedActivistId, setSelectedActivistId] = useState('');
  const [seriesSummary, setSeriesSummary] = useState('');
  const [expandedMeeting, setExpandedMeeting] = useState(null);
  const [draftNotes, setDraftNotes] = useState('');

  useEffect(() => {
    if (!id) return;
    const found = getMeetingHouseById(id);
    setHouse(found || null);
    setAssignedIds(found?.assignedActivists ?? []);
    setLoaded(true);
  }, [id]);

  const achdutActivists = activists.filter(a => a.project_id === 2 && a.role === 'activist' && a.status === 'active');
  const assignedActivists = assignedIds.map(aid => activists.find(a => a.id === aid)).filter(Boolean);
  const availableActivists = achdutActivists.filter(a => !assignedIds.includes(a.id));
  const expandedReports = house ? buildBaseMeetingsFromHouses({
    houses: [{ ...house, assignedActivists: assignedIds }],
    activists,
    existingReports: baseMeetings,
  }) : [];
  const reportsForHouse = house ? getMeetingSeriesReports({ houseId: house.id, reports: expandedReports }) : [];
  const submittedReports = reportsForHouse.filter(report => report.submitted);
  const waitingReports = reportsForHouse.filter(report => !report.submitted);

  // Wait until useEffect has run (router.query may be empty on first render)
  if (!loaded) {
    return (
      <DesktopLayout title="בית מפגש">
        <div style={{ textAlign:'center', padding:60, color:'#ccc', fontSize:14 }}>טוען...</div>
      </DesktopLayout>
    );
  }

  // House not found — show this before the permission check to avoid false denials
  if (!house) {
    return (
      <DesktopLayout title="בית מפגש לא נמצא" backHref="/meeting-houses" backLabel="חזרה לבתי מפגש">
        <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>לא נמצא בית מפגש תואם.</div>
      </DesktopLayout>
    );
  }

  // Robust string-normalised comparisons — avoids number/string mismatch
  const uid = String(currentUser?.id ?? '');
  const isActivistRole = currentUser?.role === 'activist';

  const matchesAssignedId    = String(house.assignedActivistId ?? '') === uid;
  const matchesAssignedArray = (house.assignedActivists ?? []).some(a => String(a) === uid);
  const matchesAssignedIds   = assignedIds.some(a => String(a) === uid);

  const isAssignedActivist   = isActivistRole && (matchesAssignedId || matchesAssignedArray || matchesAssignedIds);
  const hasAccess            = can.seeMeetingHouses || isAssignedActivist;

  if (!hasAccess) {
    return (
      <DesktopLayout title="בתי מפגש">
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div>אין הרשאה לדף זה</div>
        </div>
      </DesktopLayout>
    );
  }

  function persistAssignments(nextAssignedIds) {
    setAssignedIds(nextAssignedIds);
    const updated = updateMeetingHouseAssignments(house.id, nextAssignedIds);
    if (updated) setHouse(updated);
  }

  function assignActivist() {
    const parsedId = Number(selectedActivistId);
    if (!parsedId || assignedIds.includes(parsedId)) return;
    persistAssignments([...assignedIds, parsedId]);
    createDemoNotification({
      id: `manual_assignment_${house.id}_${parsedId}_${Date.now()}`,
      type: 'assignment',
      title: 'שובצת לבית מפגש',
      body: `שובצת לבית מפגש ${house.houseNumber} ב${house.settlement || house.city}. ההודעה נוצרה בדמו מתוך פעולת שיבוץ ידנית.`,
      user_id: parsedId,
      project_id: 2,
      priority: 'high',
      created_at: new Date().toISOString(),
      link: `/meeting-houses/${house.id}`,
    });
    if (currentUser) {
      createDemoNotification({
        id: `manager_assignment_${house.id}_${parsedId}_${currentUser.id}_${Date.now()}`,
        type: 'assignment',
        title: 'שיבוץ פעיל נשמר',
        body: `שיבצת פעיל לבית מפגש ${house.houseNumber}. בדמו זה יוצר התראה פנימית לפעיל.`,
        user_id: currentUser.id,
        project_id: 2,
        priority: 'normal',
        created_at: new Date().toISOString(),
        link: `/meeting-houses/${house.id}`,
      });
    }
    setSelectedActivistId('');
  }

  function removeActivist(activistId) {
    persistAssignments(assignedIds.filter(item => item !== activistId));
  }

  function openMeetingEditor(meetingNumber) {
    const m = house.meetings.find(m => m.meetingNumber === meetingNumber);
    setDraftNotes(m?.notes || '');
    setExpandedMeeting(meetingNumber);
  }

  function handleMarkComplete(meetingNumber) {
    const updated = updateMeetingCompletion(house.id, meetingNumber, { completed: true, notes: draftNotes });
    if (updated) { setHouse(updated); }
    setExpandedMeeting(null);
    setDraftNotes('');
  }

  function runReminderDemoForHouse() {
    const result = advanceReminderStageForReports(
      reportsForHouse,
      report => !report.submitted && String(report.house_id) === String(house.id)
    );
    upsertBaseMeetingReports(result.reports);
    createDemoNotification({
      id: `manager_run_reminders_${house.id}_${Date.now()}`,
      type: 'system',
      title: 'הרצת תזכורות דמו הסתיימה',
      body: `עודכנו ${result.changedCount} משימות דיווח ונוצרו ${result.notificationsCount} התראות דמו.`,
      user_id: currentUser?.id,
      project_id: 2,
      priority: result.changedCount ? 'high' : 'normal',
      created_at: new Date().toISOString(),
      link: `/meeting-houses/${house.id}`,
    });
  }

  const backHref  = house.status === 'completed' ? '/meeting-houses/completed' : '/meeting-houses';
  const backLabel = house.status === 'completed' ? 'חזרה לבתי מפגש שהסתיימו' : 'חזרה לבתי מפגש חדשים';

  return (
    <DesktopLayout title={`בית מפגש ${house.houseNumber}`} subtitle="אחדות יהודית · פרטים, התקדמות מפגשים ושיבוץ פעיל" backHref={backHref} backLabel={backLabel}>
      <div style={{ display:'grid', gridTemplateColumns:'minmax(300px, 1fr) minmax(300px, 1fr)', gap:18 }}>
        <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:16, padding:20 }}>
          <div style={{ fontSize:16, fontWeight:800, color:'#2d1f5e', marginBottom:16 }}>פרטי בית המפגש</div>
          <Info label="מספר בית מפגש" value={house.houseNumber} />
          <Info label="יישוב" value={house.settlement || house.city} />
          <Info label="שם המארח" value={house.hostName} />
          <Info label="שם המנחה" value={house.facilitatorName} />
          <Info label="סטטוס" value={house.status} />

          <button type="button" onClick={() => setSeriesSummary(summarizeMeetingHouseSeriesDemo(house, reportsForHouse))} style={{ marginTop:18, border:'none', borderRadius:10, padding:'9px 12px', background:'#f0effe', color:'#6c5ce7', fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>
            צפה בסיכום AI דמו חכם לכל הסדרה
          </button>

          {seriesSummary && (
            <pre style={{ marginTop:12, whiteSpace:'pre-wrap', background:'#fffaf5', border:'0.5px solid #eee', borderRadius:12, padding:12, fontFamily:'inherit', fontSize:13, color:'#333', lineHeight:1.7 }}>{seriesSummary}</pre>
          )}

          <div style={{ marginTop:22, fontSize:16, fontWeight:800, color:'#2d1f5e', marginBottom:12 }}>סטטוס דיווחי פעילים</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:16 }}>
            <MiniStat label="משימות דיווח" value={reportsForHouse.length} />
            <MiniStat label="דווחו" value={submittedReports.length} />
            <MiniStat label="ממתינים" value={waitingReports.length} />
          </div>

          <button type="button" onClick={runReminderDemoForHouse} disabled={waitingReports.length === 0} style={{ marginBottom:14, border:'none', borderRadius:10, padding:'9px 12px', background:waitingReports.length ? '#ffe8c2' : '#eee', color:waitingReports.length ? '#8a5300' : '#999', fontWeight:900, cursor:waitingReports.length ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>
            הרץ תזכורות דמו לדיווחים חסרים
          </button>

          {reportsForHouse.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:18 }}>
              {reportsForHouse.map(report => {
                const reminderStatus = getReminderStatus(report);
                return (
                  <div key={report.id} style={{ padding:'9px 10px', border:'0.5px solid #eee', borderRadius:10, background:report.submitted?'#f0fdf4': reminderStatus.tone === 'danger' ? '#fff1f1' : '#fffaf5', fontSize:12, lineHeight:1.65 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
                      <b>{report.activist_name || 'פעיל'} · מפגש {report.meeting_number}</b>
                      <span style={{ color:report.submitted?'#27ae60': reminderStatus.tone === 'danger' ? '#c0392b' : '#d68910', fontWeight:800 }}>{reminderStatus.icon} {reminderStatus.label}</span>
                    </div>
                    <div style={{ color:'#999', marginTop:3 }}>תאריך: {formatDate(report.date)} · שעה: {report.start_time || '—'}</div>
                    {report.answers && <div style={{ color:'#666', marginTop:4 }}>{report.answers.slice(0,90)}{report.answers.length > 90 ? '...' : ''}</div>}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop:22, fontSize:16, fontWeight:800, color:'#2d1f5e', marginBottom:12 }}>ארבעת מפגשי הבסיס</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {(house.meetings || []).map(meeting => {
              const isExpanded = expandedMeeting === meeting.meetingNumber;
              const canComplete = !meeting.completed && (meeting.meetingNumber === 1 || house.meetings[meeting.meetingNumber - 2]?.completed);
              const report = reportsForHouse.find(r => Number(r.meeting_number) === meeting.meetingNumber && r.submitted);
              return (
                <div key={meeting.meetingNumber} style={{ border: `0.5px solid ${meeting.completed ? '#27ae60' : '#eee'}`, borderRadius: 12, background: meeting.completed ? '#f0fdf4' : '#fafafa', overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 90px auto', gap: 10, alignItems: 'center', padding: '10px 12px', fontSize: 13 }}>
                    <b style={{ color: meeting.completed ? '#27ae60' : '#333' }}>
                      {meeting.completed ? '✓ ' : ''}מפגש {meeting.meetingNumber}
                    </b>
                    <span style={{ color: '#666' }}>{formatDate(meeting.date)} · {meeting.startTime || '—'}</span>
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: meeting.completed ? '#edfaf1' : '#f0effe', color: meeting.completed ? '#27ae60' : '#6c5ce7', fontWeight: 700, textAlign: 'center' }}>
                      {meeting.completed ? 'הושלם' : 'ממתין'}
                    </span>
                    {!meeting.completed && canComplete && (
                      <button onClick={() => isExpanded ? setExpandedMeeting(null) : openMeetingEditor(meeting.meetingNumber)}
                        style={{ border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer', background: isExpanded ? '#e8e8e8' : '#6c5ce7', color: isExpanded ? '#555' : '#fff' }}>
                        {isExpanded ? 'סגור' : 'סמן'}
                      </button>
                    )}
                  </div>
                  {report?.participant_count !== undefined && (
                    <div style={{ padding: '0 12px 6px', fontSize: 12, color: '#27ae60', fontWeight: 600 }}>
                      👥 {report.participant_count} משתתפים
                    </div>
                  )}
                  {meeting.completed && meeting.notes && (
                    <div style={{ padding: '0 12px 10px', fontSize: 12, color: '#555', lineHeight: 1.6 }}>
                      <span style={{ color: '#aaa' }}>הערות: </span>{meeting.notes}
                    </div>
                  )}
                  {isExpanded && (
                    <div style={{ padding: '0 12px 12px', borderTop: '0.5px solid #eee' }}>
                      <label style={{ display: 'block', fontSize: 12, color: '#888', fontWeight: 700, marginBottom: 6, marginTop: 10 }}>הערות מהמפגש</label>
                      <textarea
                        value={draftNotes}
                        onChange={e => setDraftNotes(e.target.value)}
                        placeholder="תאר בקצרה את המפגש, נושאים שעלו, תחושת קבוצה..."
                        rows={3}
                        style={{ width: '100%', border: '1.5px solid #e8e8e8', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
                      />
                      <button onClick={() => handleMarkComplete(meeting.meetingNumber)}
                        style={{ marginTop: 8, border: 'none', borderRadius: 8, padding: '8px 16px', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: '#27ae60', color: '#fff' }}>
                        ✓ סמן כהושלם
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {isAssignedActivist ? (
          <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:16, padding:20, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
            <div style={{ fontSize:32 }}>⭐</div>
            <div style={{ fontSize:15, fontWeight:800, color:'#2d1f5e' }}>אתה משובץ לבית מפגש זה</div>
            <div style={{ fontSize:13, color:'#aaa', textAlign:'center', lineHeight:1.6 }}>
              {house.houseNumber} · {house.settlement || house.city}
            </div>
          </div>
        ) : (
          <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:16, padding:20 }}>
            <div style={{ fontSize:16, fontWeight:800, color:'#2d1f5e', marginBottom:16 }}>שיבוץ פעילים</div>

            <div style={{ display:'flex', gap:8, marginBottom:16 }}>
              <select value={selectedActivistId} onChange={e => setSelectedActivistId(e.target.value)} style={{ flex:1, border:'1.5px solid #e8e8e8', borderRadius:10, padding:'10px 12px', fontFamily:'inherit', fontSize:13, background:'#fff', color:'#333' }}>
                <option value="">בחר פעיל לשיבוץ</option>
                {availableActivists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button onClick={assignActivist} disabled={!selectedActivistId} style={{ border:'none', borderRadius:10, padding:'10px 16px', fontFamily:'inherit', fontWeight:800, cursor:selectedActivistId?'pointer':'not-allowed', background:selectedActivistId?'#6c5ce7':'#ddd', color:'#fff' }}>
                שבץ פעיל
              </button>
            </div>

            {assignedActivists.length === 0 ? (
              <div style={{ padding:20, textAlign:'center', color:'#aaa', background:'#fafafa', borderRadius:12 }}>אין פעילים משובצים עדיין</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {assignedActivists.map(a => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'10px 12px', border:'0.5px solid #eee', borderRadius:12, background:'#fffaf5' }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:800, color:'#333' }}>{a.name}</div>
                      <div style={{ fontSize:12, color:'#999' }}>{a.phone} · {a.city}</div>
                    </div>
                    <button onClick={() => removeActivist(a.id)} style={{ border:'none', background:'#f7e7e7', color:'#a32d2d', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>
                      הסר
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop:16, fontSize:12, color:'#999', lineHeight:1.6 }}>
              בשלב זה השיבוץ נשמר בדפדפן המקומי לצורך הדגמה. בעתיד אותו מבנה יישמר במסד נתונים ויחובר להתראות לפעילים.
            </div>
          </div>
        )}
      </div>

      {/* AI Summary — מוצג אוטומטית כשכל 4 המפגשים הסתיימו */}
      {house.status === 'completed' && (
        <div style={{ marginTop: 18, background: '#fff', border: '0.5px solid rgba(108,92,231,0.2)', borderRadius: 16, padding: 20, boxShadow: '0 1px 4px rgba(108,92,231,0.06)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#6c5ce7', marginBottom: 14 }}>✨ סיכום AI לארבעת המפגשים</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: '#333', lineHeight: 1.75, margin: 0 }}>
            {generateMeetingNotesAiSummaryDemo(house) || 'לא הוזנו הערות למפגשים.'}
          </pre>
        </div>
      )}
    </DesktopLayout>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ background:'#fafafa', border:'0.5px solid #eee', borderRadius:10, padding:'10px 8px', textAlign:'center' }}>
      <div style={{ fontSize:11, color:'#999', marginBottom:3 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:900, color:'#2d1f5e' }}>{value}</div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:18, padding:'10px 0', borderBottom:'0.5px solid #f0f0f0', fontSize:13 }}>
      <span style={{ color:'#999' }}>{label}</span>
      <span style={{ color:'#333', fontWeight:700, textAlign:'left' }}>{value || '—'}</span>
    </div>
  );
}
