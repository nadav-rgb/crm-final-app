// pages/base-meetings.jsx — דיווח מפגשי בסיס
import { useEffect, useMemo, useState } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { summarizeBaseMeetingDemo } from '../lib/aiDemo';
import { createBaseMeetingSubmittedNotifications } from '../lib/notificationDemo';
import { getMeetingHouses } from '../lib/meetingHousesStorage';
import { buildBaseMeetingsFromHouses } from '../lib/baseMeetingUtils';
import { getReminderStatus } from '../lib/reminderSchedulerDemo';
import activists from '../data/activists';

const MEETING_NUMBER_LABELS = { 1:'מפגש ראשון 🌱', 2:'מפגש שני 🌿', 3:'מפגש שלישי 🌳', 4:'מפגש רביעי 🏆' };

export default function BaseMeetingsPage() {
  const { baseMeetings, BASE_MEETING_QUESTIONS, submitBaseMeeting } = useCrm();
  const { currentUser } = useAuth();
  const [houses, setHouses] = useState([]);

  useEffect(() => {
    setHouses(getMeetingHouses());
  }, []);

  const expandedBaseMeetings = useMemo(() => buildBaseMeetingsFromHouses({
    houses,
    activists,
    existingReports: baseMeetings,
  }), [houses, baseMeetings]);

  const visibleMeetings = expandedBaseMeetings.filter(meeting => {
    if (currentUser?.role === 'activist') return Number(meeting.activist_id) === Number(currentUser?.id);
    if (currentUser?.role === 'ceo') return true;
    if (['head', 'finance'].includes(currentUser?.role) && Number(currentUser?.project_id) === 2) return true;
    return Number(meeting.activist_id) === Number(currentUser?.id);
  });

  const [selected, setSelected] = useState(null);
  const [answers,  setAnswers]  = useState('');
  const [saved,    setSaved]    = useState(false);
  const [aiSummary, setAiSummary] = useState(null);

  function handleOpen(meeting) {
    if (meeting.submitted) return;
    setSelected(meeting);
    setAnswers('');
    setSaved(false);
    setAiSummary(null);
  }

  function openAiSummary(meeting) {
    if (!meeting?.answers) return;
    setAiSummary({ meeting, text: summarizeBaseMeetingDemo(meeting.answers, meeting) });
  }

  function handleSubmit() {
    if (!answers.trim()) return;
    submitBaseMeeting(selected.id, answers.trim(), selected);
    createBaseMeetingSubmittedNotifications({ meeting: selected, activistName: currentUser?.name });
    setSaved(true);
    setSelected(null);
  }

  const waitingCount = visibleMeetings.filter(m => !m.submitted).length;
  const submittedCount = visibleMeetings.filter(m => m.submitted).length;

  return (
    <DesktopLayout title="דיווח מפגשי בסיס" subtitle="אחדות יהודית · דיווחים לפי בתי מפגש ושיבוצים">
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:18 }}>
        <SummaryCard title="סה״כ מפגשים" value={visibleMeetings.length} />
        <SummaryCard title="ממתינים לדיווח" value={waitingCount} />
        <SummaryCard title="דווחו וננעלו" value={submittedCount} />
      </div>

      {saved && (
        <div style={{ marginBottom:14, background:'#edfaf1', border:'0.5px solid rgba(39,174,96,0.2)', color:'#20894b', borderRadius:12, padding:'10px 14px', fontSize:13, fontWeight:800 }}>
          הדיווח נשמר וננעל. מעכשיו הוא מקושר לבית המפגש ולא ניתן לעריכה בדמו.
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:14 }}>
        {visibleMeetings.map(meeting => (
          <div key={meeting.id} style={{
            background: meeting.submitted ? '#f8fdf9' : '#fffaf5',
            borderRadius:16, padding:'18px 20px',
            border:`0.5px solid ${meeting.submitted ? 'rgba(39,174,96,0.2)' : 'rgba(0,0,0,0.07)'}`,
            borderTop:`3px solid ${meeting.submitted ? '#27ae60' : '#f39c12'}`,
            boxShadow:'0 1px 4px rgba(0,0,0,0.04)',
            cursor: meeting.submitted ? 'default' : 'pointer',
            transition:'all 0.18s',
          }}
            onMouseEnter={e=>{ if(!meeting.submitted) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.09)'; }}}
            onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'; }}
            onClick={()=>handleOpen(meeting)}
          >
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'#1a1a1a', marginBottom:2 }}>
                  {MEETING_NUMBER_LABELS[meeting.meeting_number]}
                </div>
                <div style={{ fontSize:12, color:'#aaa' }}>{meeting.date || 'טרם נקבע'} {meeting.start_time ? `· ${meeting.start_time}` : ''}</div>
              </div>
              <span style={{
                fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:700,
                background: meeting.submitted ? '#edfaf1' : '#fff8ec',
                color: meeting.submitted ? '#27ae60' : '#d68910',
              }}>
                {meeting.submitted ? '✓ דווח וננעל' : 'ממתין לדיווח'}
              </span>
            </div>

            <div style={{ fontSize:12, color:'#777', marginBottom:8, lineHeight:1.75 }}>
              <div>📍 בית מפגש מס׳ {meeting.meeting_place_number} — {meeting.meeting_place_city}</div>
              <div>👤 מארח: {meeting.host_name}</div>
              <div>📖 מנחה: {meeting.facilitator_name}</div>
              <div>🧑‍💼 פעיל: {meeting.activist_name || currentUser?.name}</div>
            </div>

            {meeting.submitted && meeting.answers && (
              <div style={{ fontSize:12, color:'#555', background:'#f0fdf4', borderRadius:8, padding:'8px 10px', marginTop:8, lineHeight:1.6 }}>
                {meeting.answers.slice(0,120)}{meeting.answers.length>120?'...':''}
                <button type="button" onClick={(e)=>{ e.stopPropagation(); openAiSummary(meeting); }} style={{ display:'block', marginTop:8, border:'none', borderRadius:8, padding:'6px 10px', background:'#f0effe', color:'#6c5ce7', fontWeight:800, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>
                  סיכום AI דמו חכם
                </button>
              </div>
            )}

            {!meeting.submitted && (
              <div style={{ marginTop:10, textAlign:'center', fontSize:13, color:'#d68910', fontWeight:700 }}>
                לחץ לדיווח ←
              </div>
            )}
          </div>
        ))}

        {visibleMeetings.length === 0 && (
          <div style={{ gridColumn:'1/-1', textAlign:'center', padding:60, color:'#ccc' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
            <div>אין כרגע מפגשי בסיס משויכים אליך</div>
            <div style={{ fontSize:12, marginTop:6 }}>כאשר רכז ישבץ אותך לבית מפגש, יופיעו כאן ארבע משימות דיווח.</div>
          </div>
        )}
      </div>

      {selected && (
        <div style={{
          position:'fixed', top:0, left:0, right:0, bottom:0,
          background:'rgba(0,0,0,0.5)', zIndex:1000,
          display:'flex', alignItems:'center', justifyContent:'center',
          padding:24,
        }} onClick={e=>{ if(e.target===e.currentTarget) setSelected(null); }}>
          <div style={{
            background:'#fff', borderRadius:20, padding:'28px', maxWidth:560, width:'100%',
            maxHeight:'90vh', overflowY:'auto',
            boxShadow:'0 20px 60px rgba(0,0,0,0.2)',
            direction:'rtl',
          }}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:4 }}>
              {MEETING_NUMBER_LABELS[selected.meeting_number]}
            </div>
            <div style={{ fontSize:13, color:'#aaa', marginBottom:20 }}>{selected.date || 'טרם נקבע'} {selected.start_time ? `· ${selected.start_time}` : ''}</div>

            <div style={{ background:'#f8f7ff', borderRadius:12, padding:'14px 16px', marginBottom:20, border:'0.5px solid rgba(108,92,231,0.15)' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#6c5ce7', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>פרטים אוטומטיים</div>
              {[
                ['מספר בית מפגש', `${selected.meeting_place_number} — ${selected.meeting_place_city}`],
                ['מארח', selected.host_name],
                ['מנחה', selected.facilitator_name],
                ['פעיל מדווח', selected.activist_name || currentUser?.name],
                ['מספר מפגש', `${selected.meeting_number} מתוך 4`],
                ['תאריך ושעה', `${selected.date || 'טרם נקבע'}${selected.start_time ? ` · ${selected.start_time}` : ''}`],
              ].map(([k,v])=>(
                <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:6 }}>
                  <span style={{ color:'#aaa' }}>{k}</span>
                  <span style={{ fontWeight:600, color:'#333' }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#555', marginBottom:10 }}>שאלות לדיווח:</div>
              {BASE_MEETING_QUESTIONS.map((q,i)=>(
                <div key={i} style={{ fontSize:12, color:'#777', marginBottom:6, paddingRight:12, borderRight:'2px solid #6c5ce7' }}>
                  {i+1}. {q}
                </div>
              ))}
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:13, fontWeight:700, color:'#555', display:'block', marginBottom:8 }}>
                דיווח <span style={{ color:'#e24b4a' }}>*</span>
              </label>
              <textarea value={answers} onChange={e=>setAnswers(e.target.value)}
                placeholder="כתוב את הדיווח שלך כאן..."
                style={{ width:'100%', minHeight:140, padding:'12px', borderRadius:12, border:'1.5px solid #ebebeb', fontSize:14, fontFamily:'Rubik,sans-serif', resize:'vertical', direction:'rtl', boxSizing:'border-box' }} />
            </div>

            <div style={{ display:'flex', gap:10 }}>
              <button onClick={()=>setSelected(null)} style={{ flex:1, padding:'10px', borderRadius:12, border:'1.5px solid #e8e8e8', background:'#fff', color:'#555', fontSize:13, fontWeight:400, cursor:'pointer', fontFamily:'Rubik,sans-serif' }}>
                ביטול
              </button>
              <button onClick={handleSubmit} disabled={!answers.trim()}
                style={{ flex:2, padding:'10px', borderRadius:12, border:'none', background:answers.trim()?'linear-gradient(135deg,#6c5ce7,#a29bfe)':'#ccc', color:'#fff', fontSize:13, fontWeight:700, cursor:answers.trim()?'pointer':'not-allowed', fontFamily:'Rubik,sans-serif' }}>
                שלח ונעל דיווח
              </button>
            </div>
          </div>
        </div>
      )}

      {aiSummary && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={e=>{ if(e.target===e.currentTarget) setAiSummary(null); }}>
          <div style={{ background:'#fff', borderRadius:18, padding:24, maxWidth:560, width:'100%', direction:'rtl' }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:8 }}>סיכום AI דמו חכם</div>
            <pre style={{ whiteSpace:'pre-wrap', background:'#fffaf5', border:'0.5px solid #eee', borderRadius:12, padding:14, fontFamily:'inherit', lineHeight:1.7, fontSize:13 }}>{aiSummary.text}</pre>
            <button onClick={()=>setAiSummary(null)} style={{ marginTop:12, border:'none', borderRadius:10, padding:'9px 18px', background:'#6c5ce7', color:'#fff', fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>סגור</button>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.07)', borderRadius:14, padding:'14px 16px' }}>
      <div style={{ fontSize:12, color:'#999', marginBottom:5 }}>{title}</div>
      <div style={{ fontSize:24, fontWeight:900, color:'#2d1f5e' }}>{value}</div>
    </div>
  );
}
