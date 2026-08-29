// pages/base-meetings.jsx — דיווח מפגשי בסיס
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { summarizeReportText } from '../lib/aiService';
import VoiceInput from '../components/VoiceInput';
import { fetchMeetingHousesFromSupabase } from '../lib/meetingHousesSupabase';
import { buildBaseMeetingsFromHouses } from '../lib/baseMeetingUtils';
import { getReminderStatus } from '../lib/reminderSchedulerDemo';
import { notifyBaseMeetingReportApi } from '../lib/notifyApi';

const MEETING_NUMBER_LABELS = { 1:'מפגש ראשון 🌱', 2:'מפגש שני 🌿', 3:'מפגש שלישי 🌳', 4:'מפגש רביעי 🏆' };

const GENDER_OPTIONS     = ['רוב גברים (70%+)', 'רוב נשים (70%+)', 'מאוזן (40–60)'];
const RELIGION_OPTIONS   = ['רוב חילונים', 'רוב מסורתיים', 'רוב דתיים', 'רוב חרדים', 'מעורב חזק (אין רוב ברור)'];
const AGE_OPTIONS        = ['רוב צעירים (18–30)', 'רוב ביניים (30–50)', 'רוב מבוגרים (50+)', 'מעורב'];
const DIVERSITY_OPTIONS  = ['מאוד מגוונת', 'די מגוונת', 'די אחידה', 'מאוד אחידה'];
const FACILITATION_OPTIONS = ['מצוינת', 'טובה', 'בינונית', 'דרושה תשומת לב'];
const ATMOSPHERE_OPTIONS = ['משוחררת', 'מתוחה', 'שמחה', 'סקרנית', 'טעונה', 'פתוחה', 'מאתגרת'];
const PROGRESS_OPTIONS   = ['כן מאוד', 'כן מעט', 'עדיין לא ברור', 'לא'];
const CONNECTIONS_OPTIONS = ['כן', 'לא', 'בתהליך'];

const EMPTY_FORM = {
  arrival_time: '',
  participant_count: '',
  gender_distribution: '',
  religious_distribution: '',
  age_distribution: '',
  diversity_level: '',
  facilitation_quality: '',
  facilitation_notes: '',
  atmosphere: [],
  group_progress: '',
  personal_connections_status: '',
  personal_connections_notes: '',
  general_notes: '',
};

function isFormValid(f) {
  if (!f.arrival_time) return false;
  if (!f.participant_count || Number(f.participant_count) <= 0) return false;
  if (!f.gender_distribution) return false;
  if (!f.religious_distribution) return false;
  if (!f.age_distribution) return false;
  if (!f.diversity_level) return false;
  if (!f.facilitation_quality) return false;
  if (!f.atmosphere || f.atmosphere.length === 0) return false;
  if (!f.group_progress) return false;
  if (!f.personal_connections_status) return false;
  if (['כן', 'בתהליך'].includes(f.personal_connections_status) && !f.personal_connections_notes?.trim()) return false;
  return true;
}

function structuredToText(sa) {
  return [
    `שעת הגעה: ${sa.arrival_time}`,
    `מספר משתתפים: ${sa.participant_count}`,
    `התפלגות מגדרית: ${sa.gender_distribution}`,
    `התפלגות רמת דתיות: ${sa.religious_distribution}`,
    `התפלגות גיל: ${sa.age_distribution}`,
    `מגוון/הומוגני: ${sa.diversity_level}`,
    `איכות הנחייה: ${sa.facilitation_quality}`,
    sa.facilitation_notes?.trim() ? `פירוט הנחייה: ${sa.facilitation_notes}` : null,
    `אווירה: ${Array.isArray(sa.atmosphere) ? sa.atmosphere.join(', ') : sa.atmosphere}`,
    `התקדמות קבוצתית: ${sa.group_progress}`,
    `קידום קשרים אישיים: ${sa.personal_connections_status}`,
    sa.personal_connections_notes?.trim() ? `פירוט קשרים: ${sa.personal_connections_notes}` : null,
    sa.general_notes?.trim() ? `הערות כלליות: ${sa.general_notes}` : null,
  ].filter(Boolean).join('\n');
}

export default function BaseMeetingsPage() {
  const { baseMeetings, submitBaseMeeting, updateBaseMeetingReport, activists } = useCrm();
  const { currentUser, apiFetch } = useAuth();
  const router = useRouter();
  const [houses, setHouses] = useState([]);
  const [housesError, setHousesError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchMeetingHousesFromSupabase(apiFetch);
        if (!active) return;
        setHouses(data);
        setHousesError('');
      } catch {
        if (active) {
          setHouses([]);
          setHousesError('טעינת בתי המפגש נכשלה. לא מוצגים נתוני דמו.');
        }
      }
    })();
    return () => { active = false; };
  }, [apiFetch]);

  const expandedBaseMeetings = useMemo(() => buildBaseMeetingsFromHouses({
    houses,
    activists,
    existingReports: baseMeetings,
  }), [houses, baseMeetings]);

  // בתי המפגש והדיווחים כבר מצומצמים בשרת וב-RLS. הדפדפן אינו שכבת authorization.
  const visibleMeetings = expandedBaseMeetings;

  const [selected,       setSelected]       = useState(null);
  const [form,           setForm]           = useState(EMPTY_FORM);
  const [saved,          setSaved]          = useState(false);
  const [saveError,      setSaveError]      = useState('');
  const [aiSummary,      setAiSummary]      = useState(null);
  const [aiSummaryError, setAiSummaryError] = useState('');
  const [fullReport,     setFullReport]     = useState(null); // מודאל צפייה בדיווח המובנה המלא

  // ניווט עמוק מ"הפעילויות שלי" (?open=<reportId>) — פותח את מודל "דיווח מלא" לדיווח הספציפי.
  // מנקה את הפרמטר מיד אחרי הפתיחה — אחרת כל עדכון baseMeetings/houses (כולל שמירת עריכה!)
  // משנה את expandedBaseMeetings ומפעיל את ה-effect מחדש, שפותח את המודל שוב בכוח אחרי שהמשתמש כבר סגר/שמר.
  useEffect(() => {
    const targetId = router.query.open;
    if (!targetId || expandedBaseMeetings.length === 0) return;
    const match = expandedBaseMeetings.find(m => String(m.id) === String(targetId));
    if (match) setFullReport(match);
    router.replace('/base-meetings', undefined, { shallow: true });
  }, [router.query.open, expandedBaseMeetings]);

  // רישום push עבר ל-PushRegistrationMount הגלובלי (_app.jsx) — נרשם בכל התחברות, לא רק כאן.

  // Schedule reminders for today's pending meetings — הרכז מחושב בצד השרת (ראה api/reminders/schedule).
  useEffect(() => {
    if (!currentUser?.id || visibleMeetings.length === 0) return;
    const today = new Date().toISOString().split('T')[0];
    const pending = visibleMeetings.filter(m => !m.submitted && m.date === today);
    if (!pending.length) return;
    pending.forEach(async meeting => {
      apiFetch('/api/reminders/schedule', { method: 'POST', body: { meetingId: meeting.id } }).catch(() => {});
    });
  }, [visibleMeetings, currentUser]);

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleAtmosphere(option) {
    setForm(prev => {
      const next = prev.atmosphere.includes(option)
        ? prev.atmosphere.filter(o => o !== option)
        : [...prev.atmosphere, option];
      return { ...prev, atmosphere: next };
    });
  }

  function handleOpen(meeting) {
    if (meeting.submitted) return;
    setSelected(meeting);
    setForm(EMPTY_FORM);
    setSaved(false);
    setSaveError('');
    setAiSummary(null);
    setAiSummaryError('');
  }

  // עריכת דיווח שכבר נשלח וננעל — טוען את התשובות הקיימות חזרה לטופס. selected.submitted===true
  // הוא הסימן ל-handleSubmit שמדובר בעדכון ולא בדיווח ראשוני.
  function handleEditSubmitted(meeting) {
    setSelected(meeting);
    setForm(meeting.structured_answers || EMPTY_FORM);
    setFullReport(null);
    setSaved(false);
    setSaveError('');
  }

  function handleVoiceTranscript(text) {
    setField('general_notes', (form.general_notes ? form.general_notes + '\n' : '') + text);
  }

  function openAiSummary(meeting) {
    if (meeting.ai_summary) {
      setAiSummary({ meeting, text: meeting.ai_summary });
      setAiSummaryError('');
      return;
    }
    setAiSummary(null);
    setAiSummaryError('הסיכום החכם אינו זמין לדיווח זה. לא הוצג סיכום דמו.');
  }

  // אחרי שליחת דיווח: סיכום AI + התראה לרכזים/מנהלים — fire-and-forget, לא מעכב את הפעיל.
  // כישלון AI ⇒ ההתראה יוצאת בלי סיכום; הדיווח עצמו כבר נשמר.
  async function finalizeSubmission(meeting) {
    try {
      await summarizeReportText(apiFetch, meeting.id);
      setAiSummaryError('');
    } catch {
      setAiSummaryError('הדיווח נשמר, אך שירות הסיכום החכם אינו זמין כרגע.');
    }

    // התראה + Push עוברים בגבול צד-שרת שגוזר את הנמענים מה-resource המורשה.
    notifyBaseMeetingReportApi(apiFetch, meeting.id).catch(() => {});
  }

  async function handleSubmit() {
    if (!isFormValid(form)) return;
    setSaveError('');
    const sa = { ...form, participant_count: Number(form.participant_count) };
    const textForAi = structuredToText(sa);

    if (selected.submitted) {
      // עריכת דיווח קיים — רק מעדכן את התשובות; לא יוצר התראת "דיווח התקבל" ולא מסכם מחדש
      const { error } = await updateBaseMeetingReport(selected.id, {
        structured_answers: sa,
        answers: textForAi,
        participant_count: Number(form.participant_count),
      });
      if (error) {
        setSaveError('עדכון הדיווח נכשל. הנתונים לא הוחלפו.');
        return;
      }
      setSaved(true);
      setSelected(null);
      return;
    }

    // ממתינים לכתיבה לפני סיכום, התראה וביטול תזכורות. כשל נשאר גלוי בטופס.
    const meeting = selected;
    const { error } = await submitBaseMeeting(meeting.id, textForAi, {
      ...meeting,
      participant_count: Number(form.participant_count),
      structured_answers: sa,
    });
    if (error) {
      setSaveError('שמירת הדיווח נכשלה. לא נשלחו סיכום או התראה.');
      return;
    }
    finalizeSubmission(meeting); // סיכום AI + התראה לרכזים
    // Cancel pending reminders — report was submitted
    apiFetch('/api/reminders/cancel', { method: 'POST', body: { meetingId: selected.id } }).catch(() => {});
    setSaved(true);
    setSelected(null);
  }

  const waitingCount   = visibleMeetings.filter(m => !m.submitted).length;
  const submittedCount = visibleMeetings.filter(m => m.submitted).length;
  const canSubmit      = selected ? isFormValid(form) : false;

  return (
    <DesktopLayout title="דיווח מפגשי בסיס" subtitle="אחדות יהודית · דיווחים לפי בתי מפגש ושיבוצים">
      {housesError && (
        <div role="alert" style={{ marginBottom:14, background:'#fff1f1', color:'#a63230', borderRadius:12, padding:'10px 14px', fontSize:13, fontWeight:700 }}>
          {housesError}
        </div>
      )}
      {(saveError || aiSummaryError) && (
        <div role="alert" style={{ marginBottom:14, background:'#fff1f1', color:'#a63230', borderRadius:12, padding:'10px 14px', fontSize:13, fontWeight:700 }}>
          {saveError || aiSummaryError}
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:18 }}>
        <SummaryCard title="סה״כ מפגשים"   value={visibleMeetings.length} />
        <SummaryCard title="ממתינים לדיווח" value={waitingCount} />
        <SummaryCard title="דווחו וננעלו"   value={submittedCount} />
      </div>

      {saved && (
        <div style={{ marginBottom:14, background:'#edfaf1', border:'0.5px solid rgba(39,174,96,0.2)', color:'#20894b', borderRadius:12, padding:'10px 14px', fontSize:13, fontWeight:800 }}>
          הדיווח נשמר וננעל. מעכשיו הוא מקושר לבית המפגש ולא ניתן לעריכה.
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:14 }}>
        {visibleMeetings.map(meeting => {
          const reminderStatus = getReminderStatus(meeting);
          const sa = meeting.structured_answers;
          return (
            <div key={meeting.id} style={{
              background: meeting.submitted ? '#f8fdf9' : '#fffaf5',
              borderRadius:16, padding:'18px 20px',
              border:`0.5px solid ${meeting.submitted ? 'rgba(39,174,96,0.2)' : 'rgba(0,0,0,0.07)'}`,
              borderTop:`3px solid ${meeting.submitted ? '#27ae60' : '#f39c12'}`,
              boxShadow:'0 1px 4px rgba(0,0,0,0.04)',
              cursor: meeting.submitted ? 'default' : 'pointer',
              transition:'all 0.18s',
            }}
              onMouseEnter={e=>{ if(!meeting.submitted){ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.09)'; }}}
              onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'; }}
              onClick={()=>handleOpen(meeting)}
            >
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700, color:'#1a1a1a', marginBottom:2 }}>
                    {MEETING_NUMBER_LABELS[meeting.meeting_number]}
                  </div>
                  <div style={{ fontSize:12, color:'#aaa' }}>{meeting.date || 'טרם נקבע'}{meeting.start_time ? ` · ${meeting.start_time}` : ''}</div>
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

              {meeting.submitted && (sa || meeting.answers) && (
                <div style={{ fontSize:12, color:'#555', background:'#f0fdf4', borderRadius:8, padding:'8px 10px', marginTop:8, lineHeight:1.7 }}>
                  {sa ? (
                    <>
                      <div>👥 {sa.participant_count} משתתפים · ⏰ {sa.arrival_time}</div>
                      <div>😊 {Array.isArray(sa.atmosphere) ? sa.atmosphere.join(', ') : sa.atmosphere}</div>
                      <div style={{ color:'#888', marginTop:2 }}>הנחייה: {sa.facilitation_quality} · קשרים: {sa.personal_connections_status}</div>
                    </>
                  ) : (
                    <>{meeting.answers.slice(0,120)}{meeting.answers.length>120?'...':''}</>
                  )}
                  <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                    {currentUser?.role !== 'activist' && (
                      <button type="button" onClick={e=>{ e.stopPropagation(); openAiSummary(meeting); }}
                        style={{ border:'none', borderRadius:8, padding:'6px 10px', background:'#f0effe', color:'#6c5ce7', fontWeight:800, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>
                        סיכום
                      </button>
                    )}
                    {sa && (
                      <button type="button" onClick={e=>{ e.stopPropagation(); setFullReport(meeting); }}
                        style={{ border:'none', borderRadius:8, padding:'6px 10px', background:'#eef7ff', color:'#2d7ad6', fontWeight:800, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>
                        צפה בדיווח מלא
                      </button>
                    )}
                    <button type="button" onClick={e=>{ e.stopPropagation(); handleEditSubmitted(meeting); }}
                      style={{ border:'none', borderRadius:8, padding:'6px 10px', background:'#fff4df', color:'#b06b00', fontWeight:800, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>
                      ✏️ עריכה
                    </button>
                  </div>
                </div>
              )}

              {!meeting.submitted && (
                <div style={{ marginTop:10, textAlign:'center', fontSize:13, color:'#d68910', fontWeight:700 }}>
                  לחץ לדיווח ←
                </div>
              )}
            </div>
          );
        })}

        {visibleMeetings.length === 0 && (
          <div style={{ gridColumn:'1/-1', textAlign:'center', padding:60, color:'#ccc' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
            <div>אין כרגע מפגשי בסיס משויכים אליך</div>
            <div style={{ fontSize:12, marginTop:6 }}>כאשר רכז ישבץ אותך לבית מפגש, יופיעו כאן ארבע משימות דיווח.</div>
          </div>
        )}
      </div>

      {/* ─── Form modal ─── */}
      {selected && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={e=>{ if(e.target===e.currentTarget) setSelected(null); }}>
          <div style={{ background:'#fff', borderRadius:20, padding:'28px 28px 24px', maxWidth:640, width:'100%', maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.22)', direction:'rtl' }}>

            {/* Modal title */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
              <div style={{ fontSize:18, fontWeight:800, color:'#2d1f5e' }}>
                {selected.submitted ? '✏️ עריכת דיווח' : MEETING_NUMBER_LABELS[selected.meeting_number]}
              </div>
              <button onClick={()=>setSelected(null)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#bbb', lineHeight:1, padding:4 }}>✕</button>
            </div>
            <div style={{ fontSize:13, color:'#aaa', marginBottom:20 }}>
              {selected.date || 'טרם נקבע'}{selected.start_time ? ` · ${selected.start_time}` : ''}
            </div>

            {/* Auto-info */}
            <div style={{ background:'#f8f7ff', borderRadius:12, padding:'12px 16px', marginBottom:22, border:'0.5px solid rgba(108,92,231,0.15)' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#6c5ce7', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.06em' }}>פרטים אוטומטיים</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 12px', fontSize:12 }}>
                {[
                  ['בית מפגש', `${selected.meeting_place_number} — ${selected.meeting_place_city}`],
                  ['מארח', selected.host_name],
                  ['מנחה', selected.facilitator_name],
                  ['פעיל מדווח', selected.activist_name || currentUser?.name],
                  ['מפגש', `${selected.meeting_number} מתוך 4`],
                  ['תאריך', selected.date || 'טרם נקבע'],
                ].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', gap:6 }}>
                    <span style={{ color:'#aaa', flexShrink:0 }}>{k}:</span>
                    <span style={{ fontWeight:600, color:'#333' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Structured form ── */}
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

              {/* Row: שעת הגעה + מספר משתתפים */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <FLabel label="באיזו שעה בדיוק הגעת?" required>
                  <input type="time" value={form.arrival_time}
                    onChange={e=>setField('arrival_time', e.target.value)}
                    style={inputStyle(!!form.arrival_time)} />
                </FLabel>
                <FLabel label="מספר משתתפים" required>
                  <input type="number" min="1" value={form.participant_count}
                    onChange={e=>setField('participant_count', e.target.value)}
                    placeholder="0"
                    style={inputStyle(!!form.participant_count)} />
                </FLabel>
              </div>

              {/* Row: מגדר + דתיות */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <FLabel label="התפלגות מגדרית" required>
                  <FSelect value={form.gender_distribution} onChange={v=>setField('gender_distribution',v)} options={GENDER_OPTIONS} />
                </FLabel>
                <FLabel label="התפלגות רמת דתיות" required>
                  <FSelect value={form.religious_distribution} onChange={v=>setField('religious_distribution',v)} options={RELIGION_OPTIONS} />
                </FLabel>
              </div>

              {/* Row: גיל + מגוון */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <FLabel label="התפלגות גיל" required>
                  <FSelect value={form.age_distribution} onChange={v=>setField('age_distribution',v)} options={AGE_OPTIONS} />
                </FLabel>
                <FLabel label="עד כמה הקבוצה מגוונת?" required>
                  <FSelect value={form.diversity_level} onChange={v=>setField('diversity_level',v)} options={DIVERSITY_OPTIONS} />
                </FLabel>
              </div>

              {/* הנחייה */}
              <FLabel label="איך הייתה ההנחייה?" required>
                <FSelect value={form.facilitation_quality} onChange={v=>setField('facilitation_quality',v)} options={FACILITATION_OPTIONS} />
              </FLabel>
              <FLabel label="פירוט קצר על ההנחייה">
                <textarea value={form.facilitation_notes} onChange={e=>setField('facilitation_notes',e.target.value)}
                  rows={2} placeholder="אופציונלי..."
                  style={{ ...inputStyle(false), resize:'vertical', minHeight:60, fontFamily:'Rubik,sans-serif' }} />
              </FLabel>

              {/* אווירה — checkboxes */}
              <FLabel label="מה הייתה האווירה הכללית?" required hint="בחר לפחות אחד">
                <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:4 }}>
                  {ATMOSPHERE_OPTIONS.map(opt => {
                    const checked = form.atmosphere.includes(opt);
                    return (
                      <button key={opt} type="button" onClick={()=>toggleAtmosphere(opt)}
                        style={{
                          padding:'6px 14px', borderRadius:20, fontSize:12, fontFamily:'inherit', cursor:'pointer',
                          border:`1.5px solid ${checked ? '#6c5ce7' : '#e0e0e0'}`,
                          background: checked ? '#6c5ce7' : '#fafafa',
                          color: checked ? '#fff' : '#555',
                          fontWeight: checked ? 700 : 400,
                          transition:'all 0.14s ease',
                        }}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </FLabel>

              {/* Row: התקדמות + קשרים */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <FLabel label="האם הקבוצה מתקדמת?" required>
                  <FSelect value={form.group_progress} onChange={v=>setField('group_progress',v)} options={PROGRESS_OPTIONS} />
                </FLabel>
                <FLabel label="האם את/ה מקדם קשרים אישיים?" required>
                  <FSelect value={form.personal_connections_status} onChange={v=>setField('personal_connections_status',v)} options={CONNECTIONS_OPTIONS} />
                </FLabel>
              </div>

              {/* Conditional: פירוט קשרים */}
              {['כן', 'בתהליך'].includes(form.personal_connections_status) && (
                <FLabel label="פירוט קצר על קידום קשרים אישיים" required>
                  <textarea value={form.personal_connections_notes} onChange={e=>setField('personal_connections_notes',e.target.value)}
                    rows={2} placeholder="תאר בקצרה..."
                    style={{ ...inputStyle(!!(form.personal_connections_notes?.trim())), resize:'vertical', minHeight:60, fontFamily:'Rubik,sans-serif' }} />
                </FLabel>
              )}

              {/* הערות כלליות */}
              <FLabel label="הערות כלליות">
                <textarea value={form.general_notes} onChange={e=>setField('general_notes',e.target.value)}
                  rows={3} placeholder="הערות נוספות, תצפיות, בקשות מיוחדות..."
                  style={{ ...inputStyle(false), resize:'vertical', minHeight:72, fontFamily:'Rubik,sans-serif' }} />
                <VoiceInput onTranscript={handleVoiceTranscript} />
              </FLabel>

            </div>

            {/* Actions */}
            <div style={{ display:'flex', gap:10, marginTop:20 }}>
              <button onClick={()=>setSelected(null)}
                style={{ flex:1, padding:'11px', borderRadius:12, border:'1.5px solid #e8e8e8', background:'#fff', color:'#555', fontSize:13, fontWeight:400, cursor:'pointer', fontFamily:'Rubik,sans-serif' }}>
                ביטול
              </button>
              <button onClick={handleSubmit} disabled={!canSubmit}
                style={{ flex:2, padding:'11px', borderRadius:12, border:'none', background: canSubmit ? 'linear-gradient(135deg,#6c5ce7,#a29bfe)' : '#ddd', color: canSubmit ? '#fff' : '#999', fontSize:13, fontWeight:700, cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily:'Rubik,sans-serif', transition:'background 0.18s' }}>
                {selected.submitted ? 'שמור שינויים' : 'שלח ונעל דיווח'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI summary modal */}
      {aiSummary && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={e=>{ if(e.target===e.currentTarget) setAiSummary(null); }}>
          <div style={{ background:'#fff', borderRadius:18, padding:24, maxWidth:560, width:'100%', direction:'rtl' }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:8 }}>סיכום</div>
            <pre style={{ whiteSpace:'pre-wrap', background:'#fffaf5', border:'0.5px solid #eee', borderRadius:12, padding:14, fontFamily:'inherit', lineHeight:1.7, fontSize:13 }}>{aiSummary.text}</pre>
            <button onClick={()=>setAiSummary(null)} style={{ marginTop:12, border:'none', borderRadius:10, padding:'9px 18px', background:'#6c5ce7', color:'#fff', fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>סגור</button>
          </div>
        </div>
      )}

      {/* Full structured report modal — read only */}
      {fullReport && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={e=>{ if(e.target===e.currentTarget) setFullReport(null); }}>
          <div style={{ background:'#fff', borderRadius:18, padding:24, maxWidth:560, width:'100%', maxHeight:'90vh', overflowY:'auto', direction:'rtl' }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>דיווח מלא</div>
            <div style={{ fontSize:12, color:'#aaa', marginBottom:12 }}>
              {MEETING_NUMBER_LABELS[fullReport.meeting_number]} · בית מפגש {fullReport.meeting_place_number} — {fullReport.meeting_place_city}
            </div>

            {/* פרטי המפגש — נדרשים לרכז כדי לזהות מי היה מעורב, לא רק תשובות הטופס */}
            <div style={{ background:'#f8f7ff', borderRadius:12, padding:'12px 16px', marginBottom:14, border:'0.5px solid rgba(108,92,231,0.15)' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#6c5ce7', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.06em' }}>פרטי המפגש</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 12px', fontSize:12 }}>
                {[
                  ['מארח', fullReport.host_name],
                  ['מנחה', fullReport.facilitator_name],
                  ['פעיל מדווח', fullReport.activist_name],
                  ['תאריך', fullReport.date || 'טרם נקבע'],
                ].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', gap:6 }}>
                    <span style={{ color:'#aaa', flexShrink:0 }}>{k}:</span>
                    <span style={{ fontWeight:600, color:'#333' }}>{v || '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            <pre style={{ whiteSpace:'pre-wrap', background:'#f8fbff', border:'0.5px solid #e6eef7', borderRadius:12, padding:14, fontFamily:'inherit', lineHeight:1.8, fontSize:13, color:'#333' }}>
              {fullReport.structured_answers ? structuredToText(fullReport.structured_answers) : (fullReport.answers || 'אין נתונים')}
            </pre>
            <div style={{ display:'flex', gap:8, marginTop:12 }}>
              <button onClick={()=>setFullReport(null)} style={{ flex:1, border:'none', borderRadius:10, padding:'9px 18px', background:'#2d7ad6', color:'#fff', fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>סגור</button>
              <button onClick={()=>handleEditSubmitted(fullReport)} style={{ flex:1, border:'none', borderRadius:10, padding:'9px 18px', background:'#fff4df', color:'#b06b00', fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>✏️ עריכה</button>
            </div>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}

// ── Helper components ──────────────────────────────────────────────

function inputStyle(filled) {
  return {
    width:'100%', padding:'9px 12px', borderRadius:10,
    border:`1.5px solid ${filled ? '#6c5ce7' : '#e0e0e0'}`,
    fontSize:13, fontFamily:'Rubik,sans-serif', boxSizing:'border-box',
    direction:'rtl', background: filled ? '#f8f7ff' : '#fff', outline:'none',
  };
}

function FLabel({ label, required, hint, children }) {
  return (
    <div>
      <div style={{ fontSize:12, fontWeight:700, color:'#444', marginBottom:6 }}>
        {label}
        {required && <span style={{ color:'#e24b4a', marginRight:4 }}>*</span>}
        {hint && <span style={{ color:'#aaa', fontWeight:400, fontSize:11, marginRight:6 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function FSelect({ value, onChange, options }) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{ ...inputStyle(!!value), appearance:'none', cursor:'pointer' }}>
      <option value="">בחר...</option>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
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
