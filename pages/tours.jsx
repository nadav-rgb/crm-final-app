// pages/tours.jsx — סיורים ("נעים להכיר"). מקביל לבתי מפגש: יצירה (רכז), שיבוץ פעיל
// עם push+התראה, מדריך (פעיל שלנו מהרשימה או מדריך חיצוני בטקסט), משפחה מארחת (תמיד פעיל).
import { useEffect, useState } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import { fetchToursFromSupabase, upsertTourApi, updateTourAssignmentsApi, submitTourReportApi } from '../lib/toursSupabase';
import { sendAssignmentPushApi } from '../lib/meetingHousesSupabase';
import { createDemoNotification } from '../lib/notificationDemo';
import { inProject } from '../lib/projectUtils';
import { formatDateHe } from '../lib/formatDate';

const TODAY = new Date().toISOString().split('T')[0];

const STATUS_LABELS = {
  upcoming:  { label: 'מתוכנן', color: '#6c5ce7', bg: '#f0effe' },
  completed: { label: 'התקיים', color: '#27ae60', bg: '#edfaf1' },
};

const EMPTY_FORM = {
  tourNumber: '', settlement: '', date: '', startTime: '',
  guideMode: 'activist', guideActivistId: '', guideName: '',
  hostActivistId: '', notes: '',
};

// דיווח מובנה אחרי סיור — אותם שדות כמו דוח מפגש בסיס (הנחיה→הדרכה)
const GENDER_OPTIONS     = ['רוב גברים (70%+)', 'רוב נשים (70%+)', 'מאוזן (40–60)'];
const RELIGION_OPTIONS   = ['רוב חילונים', 'רוב מסורתיים', 'רוב דתיים', 'רוב חרדים', 'מעורב חזק (אין רוב ברור)'];
const AGE_OPTIONS        = ['רוב צעירים (18–30)', 'רוב ביניים (30–50)', 'רוב מבוגרים (50+)', 'מעורב'];
const DIVERSITY_OPTIONS  = ['מאוד מגוונת', 'די מגוונת', 'די אחידה', 'מאוד אחידה'];
const GUIDING_OPTIONS    = ['מצוינת', 'טובה', 'בינונית', 'דרושה תשומת לב'];
const ATMOSPHERE_OPTIONS = ['משוחררת', 'מתוחה', 'שמחה', 'סקרנית', 'טעונה', 'פתוחה', 'מאתגרת'];
const PROGRESS_OPTIONS   = ['כן מאוד', 'כן מעט', 'עדיין לא ברור', 'לא'];
const CONNECTIONS_OPTIONS = ['כן', 'לא', 'בתהליך'];

const EMPTY_REPORT = {
  arrival_time: '', participant_count: '',
  gender_distribution: '', religious_distribution: '', age_distribution: '', diversity_level: '',
  guiding_quality: '', guiding_notes: '',
  atmosphere: [], group_progress: '',
  personal_connections_status: '', personal_connections_notes: '', general_notes: '',
};

const REPORT_LABELS = {
  arrival_time: 'שעת הגעה', participant_count: 'מספר משתתפים',
  gender_distribution: 'התפלגות מגדרית', religious_distribution: 'התפלגות רמת דתיות',
  age_distribution: 'התפלגות גיל', diversity_level: 'מגוון/הומוגני',
  guiding_quality: 'איכות ההדרכה', guiding_notes: 'פירוט הדרכה',
  atmosphere: 'אווירה', group_progress: 'התקדמות קבוצתית',
  personal_connections_status: 'קידום קשרים אישיים', personal_connections_notes: 'פירוט קשרים',
  general_notes: 'הערות כלליות',
};

export default function ToursPage() {
  const { can, currentUser } = useAuth();
  const { activists } = useCrm();
  const [tours, setTours] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [reportingTour, setReportingTour] = useState(null); // הסיור שממלאים עליו דיווח
  const [reportForm, setReportForm] = useState(EMPTY_REPORT);
  const [viewingReport, setViewingReport] = useState(null);  // צפייה בדיווח שהוגש

  // יצירה/שיבוץ — רק רכז/הנהלה שחברים בנעים להכיר (או מנכ"ל).
  // הדס=כן; נדב=כן; שמעון (אחדות בלבד)=לא.
  const canManage = can.seeMeetingHouses && (currentUser?.role === 'ceo' || inProject(currentUser, 2));

  // סיורים = נעים להכיר → פעילים החברים בפרויקט 2 (כולל דו-פרויקטליים)
  const naimActivists = activists.filter(a => a.role === 'activist' && inProject(a, 2));
  // רשימת המדריכים לבחירה: כל הפעילים (מדריך יכול להיות פעיל מכל פרויקט)
  const guideOptions = activists.filter(a => a.role === 'activist');

  async function load() { setTours(await fetchToursFromSupabase()); }
  useEffect(() => { if (currentUser) load(); }, [currentUser?.id]);

  const visibleTours = tours.filter(t => {
    if (currentUser?.role === 'activist') {
      const uid = Number(currentUser.id);
      return (t.assignedActivists ?? []).some(a => Number(a) === uid) ||
             Number(t.guideActivistId) === uid || Number(t.hostActivistId) === uid;
    }
    return true;
  });

  const activistName = id => activists.find(a => Number(a.id) === Number(id))?.name ?? null;

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  async function handleCreate() {
    const e = {};
    if (!form.tourNumber.trim()) e.tourNumber = 'מספר סיור חובה';
    if (!form.settlement.trim()) e.settlement = 'יישוב חובה';
    if (!form.date)              e.date       = 'תאריך חובה';
    if (form.guideMode === 'activist' && !form.guideActivistId) e.guide = 'נא לבחור מדריך מהרשימה';
    if (form.guideMode === 'external' && !form.guideName.trim()) e.guide = 'נא להזין שם מדריך';
    if (!form.hostActivistId)    e.host = 'נא לבחור משפחה מארחת';
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    setBusy(true);
    const guideActivist = form.guideMode === 'activist'
      ? guideOptions.find(a => Number(a.id) === Number(form.guideActivistId))
      : null;
    const saved = await upsertTourApi({
      id: `tour-${Date.now()}`,
      tourNumber: form.tourNumber.trim(),
      settlement: form.settlement.trim(),
      date: form.date,
      startTime: form.startTime,
      guideName: guideActivist ? guideActivist.name : form.guideName.trim(),
      guideActivistId: guideActivist ? Number(guideActivist.id) : null,
      hostActivistId: Number(form.hostActivistId),
      assignedActivists: [],
      status: 'upcoming',
      notes: form.notes.trim(),
      project_id: 2,
    });
    setBusy(false);
    if (!saved) { setErrors({ submit: 'שמירת הסיור נכשלה — נסה שוב' }); return; }

    // התראה + push למשפחה המארחת ולמדריך (אם הוא פעיל שלנו)
    const dateStr = formatDateHe(saved.date);
    const notifyRoles = [
      { id: saved.hostActivistId, roleLabel: 'המשפחה המארחת' },
      ...(saved.guideActivistId ? [{ id: saved.guideActivistId, roleLabel: 'המדריך' }] : []),
    ];
    for (const { id: aid, roleLabel } of notifyRoles) {
      sendAssignmentPushApi({
        activistId: aid,
        title: 'שובצת לסיור',
        body: `נקבעת בתור ${roleLabel} בסיור ${saved.tourNumber} ב${saved.settlement} בתאריך ${dateStr}.`,
        url: '/tours',
      });
      createDemoNotification({
        id: `tour_role_${saved.id}_${aid}`,
        type: 'assignment',
        title: 'שובצת לסיור',
        body: `נקבעת בתור ${roleLabel} בסיור ${saved.tourNumber} ב${saved.settlement} בתאריך ${dateStr}.`,
        user_id: aid,
        project_id: 2,
        priority: 'high',
        created_at: new Date().toISOString(),
        link: '/tours',
      });
    }

    setForm(EMPTY_FORM);
    setCreating(false);
    load();
  }

  async function handleAssign(tour, activistId) {
    const aid = Number(activistId);
    if (!aid) return;
    const next = [...new Set([...(tour.assignedActivists || []), aid])];
    const updated = await updateTourAssignmentsApi(tour.id, next);
    if (!updated) return;
    setTours(prev => prev.map(t => t.id === tour.id ? updated : t));

    const dateStr = formatDateHe(tour.date);
    // Push אמיתי לטלפון (no-op בטוח אם הפעיל לא רשום להתראות)
    sendAssignmentPushApi({
      activistId: aid,
      title: 'שובצת לסיור',
      body: `שובצת לסיור ${tour.tourNumber} ב${tour.settlement} בתאריך ${dateStr}.`,
      url: '/tours',
    });
    createDemoNotification({
      id: `tour_assignment_${tour.id}_${aid}_${Date.now()}`,
      type: 'assignment',
      title: 'שובצת לסיור',
      body: `שובצת לסיור ${tour.tourNumber} ב${tour.settlement} בתאריך ${dateStr}.`,
      user_id: aid,
      project_id: 2,
      priority: 'high',
      created_at: new Date().toISOString(),
      link: '/tours',
    });
    if (currentUser) {
      createDemoNotification({
        id: `tour_assignment_manager_${tour.id}_${aid}_${Date.now()}`,
        type: 'assignment',
        title: 'שיבוץ נשמר',
        body: `שיבצת את ${activistName(aid) ?? 'פעיל'} לסיור ${tour.tourNumber} ב${tour.settlement}.`,
        user_id: currentUser.id,
        project_id: 2,
        priority: 'normal',
        created_at: new Date().toISOString(),
        link: '/tours',
      });
    }
  }

  async function handleUnassign(tour, activistId) {
    const next = (tour.assignedActivists || []).filter(a => Number(a) !== Number(activistId));
    const updated = await updateTourAssignmentsApi(tour.id, next);
    if (updated) setTours(prev => prev.map(t => t.id === tour.id ? updated : t));
  }

  function setReportField(key, value) {
    setReportForm(prev => ({ ...prev, [key]: value }));
  }

  function reportValid(f) {
    if (!f.arrival_time || !f.participant_count || Number(f.participant_count) <= 0) return false;
    if (!f.gender_distribution || !f.religious_distribution || !f.age_distribution || !f.diversity_level) return false;
    if (!f.guiding_quality || !f.atmosphere?.length || !f.group_progress || !f.personal_connections_status) return false;
    if (['כן', 'בתהליך'].includes(f.personal_connections_status) && !f.personal_connections_notes?.trim()) return false;
    return true;
  }

  async function handleSubmitReport() {
    if (!reportingTour || !reportValid(reportForm)) return;
    setBusy(true);
    const updated = await submitTourReportApi(reportingTour.id, reportForm);
    setBusy(false);
    if (!updated) return;
    setTours(prev => prev.map(t => t.id === updated.id ? updated : t));
    setReportingTour(null);
    // התראה לרכזת: הדיווח הוגש והסיור הסתיים (שכר המדריך נכנס לתשלומים)
    createDemoNotification({
      id: `tour_report_${updated.id}`,
      type: 'system',
      title: 'דיווח סיור הוגש',
      body: `הוגש דיווח על סיור ${updated.tourNumber} ב${updated.settlement} — הסיור סומן כהתקיים.`,
      user_id: null, role: 'coord',
      project_id: 2,
      priority: 'normal',
      created_at: new Date().toISOString(),
      link: '/tours',
    });
  }

  if (!can.seeMeetingHouses && currentUser?.role !== 'activist') {
    return (
      <DesktopLayout title="סיורים">
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div>אין הרשאה לדף זה</div>
        </div>
      </DesktopLayout>
    );
  }

  const inputStyle = { width: '100%', marginBottom: 12, marginTop: 4 };

  return (
    <DesktopLayout
      title="סיורים"
      subtitle={`${visibleTours.length} סיורים · נעים להכיר`}
      actions={canManage ? (
        <button onClick={() => setCreating(v => !v)}
          style={{ border: 'none', borderRadius: 10, padding: '9px 15px', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer', background: '#6c5ce7', color: '#fff', fontSize: 13 }}>
          {creating ? 'סגור' : '+ סיור חדש'}
        </button>
      ) : undefined}
    >
      {/* טופס יצירת סיור */}
      {creating && (
        <div style={{ background: '#fffaf5', borderRadius: 16, padding: '18px 20px', marginBottom: 18, border: '0.5px solid rgba(108,92,231,0.25)', maxWidth: 620 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#2d1f5e', marginBottom: 14 }}>סיור חדש</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">מספר סיור <span style={{ color: '#e24b4a' }}>*</span></label>
              <input className={`form-input ${errors.tourNumber ? 'form-error' : ''}`} placeholder='למשל: NL-101'
                value={form.tourNumber} onChange={e => set('tourNumber', e.target.value)} style={inputStyle} />
              {errors.tourNumber && <span className="error-msg">{errors.tourNumber}</span>}
            </div>
            <div>
              <label className="form-label">יישוב <span style={{ color: '#e24b4a' }}>*</span></label>
              <input className={`form-input ${errors.settlement ? 'form-error' : ''}`} placeholder="שם היישוב"
                value={form.settlement} onChange={e => set('settlement', e.target.value)} style={inputStyle} />
              {errors.settlement && <span className="error-msg">{errors.settlement}</span>}
            </div>
            <div>
              <label className="form-label">תאריך <span style={{ color: '#e24b4a' }}>*</span></label>
              <input type="date" className={`form-input ${errors.date ? 'form-error' : ''}`} min={TODAY}
                value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} />
              {errors.date && <span className="error-msg">{errors.date}</span>}
            </div>
            <div>
              <label className="form-label">שעה</label>
              <input type="time" className="form-input" value={form.startTime}
                onChange={e => set('startTime', e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* מדריך — פעיל שלנו או חיצוני */}
          <label className="form-label">מדריך <span style={{ color: '#e24b4a' }}>*</span></label>
          <div style={{ display: 'flex', gap: 10, margin: '4px 0 10px' }}>
            {[{ v: 'activist', l: 'פעיל שלנו' }, { v: 'external', l: 'מדריך חיצוני' }].map(({ v, l }) => (
              <button key={v} type="button" onClick={() => set('guideMode', v)}
                style={{
                  flex: 1, padding: '9px', borderRadius: 10, cursor: 'pointer', fontSize: 13,
                  border: `1.5px solid ${form.guideMode === v ? '#6c5ce7' : '#e8e8e8'}`,
                  background: form.guideMode === v ? '#f0effe' : '#fafafa',
                  color: form.guideMode === v ? '#6c5ce7' : '#555',
                  fontWeight: form.guideMode === v ? 700 : 400, fontFamily: 'Rubik,sans-serif',
                }}>
                {l}
              </button>
            ))}
          </div>
          {form.guideMode === 'activist' ? (
            <select className="form-input" value={form.guideActivistId}
              onChange={e => set('guideActivistId', e.target.value)} style={{ ...inputStyle, fontFamily: 'inherit' }}>
              <option value="">בחר מדריך מרשימת הפעילים…</option>
              {guideOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <input className="form-input" placeholder="שם המדריך החיצוני"
              value={form.guideName} onChange={e => set('guideName', e.target.value)} style={inputStyle} />
          )}
          {errors.guide && <span className="error-msg" style={{ display: 'block', marginBottom: 8 }}>{errors.guide}</span>}

          {/* משפחה מארחת — תמיד פעיל שלנו */}
          <label className="form-label">משפחה מארחת (פעיל) <span style={{ color: '#e24b4a' }}>*</span></label>
          <select className={`form-input ${errors.host ? 'form-error' : ''}`} value={form.hostActivistId}
            onChange={e => set('hostActivistId', e.target.value)} style={{ ...inputStyle, fontFamily: 'inherit' }}>
            <option value="">בחר פעיל מארח…</option>
            {naimActivists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {errors.host && <span className="error-msg" style={{ display: 'block', marginBottom: 8 }}>{errors.host}</span>}

          <label className="form-label">הערות</label>
          <input className="form-input" placeholder="הערות חופשיות..." value={form.notes}
            onChange={e => set('notes', e.target.value)} style={inputStyle} />

          {errors.submit && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 8 }}>{errors.submit}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleCreate} disabled={busy}>
            {busy ? 'שומר…' : 'צור סיור ושלח התראות'}
          </button>
        </div>
      )}

      {/* רשימת סיורים */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {visibleTours.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14 }}>
            אין סיורים עדיין{can.seeMeetingHouses ? ' — צור סיור חדש בכפתור למעלה' : ''}
          </div>
        ) : visibleTours.map(tour => {
          const uid = Number(currentUser?.id);
          const related = (tour.assignedActivists ?? []).some(a => Number(a) === uid) ||
                          Number(tour.guideActivistId) === uid || Number(tour.hostActivistId) === uid;
          return (
            <TourCard key={tour.id} tour={tour}
              activists={naimActivists}
              activistName={activistName}
              canManage={canManage}
              canReport={(canManage || related) && tour.status !== 'completed'}
              onReport={() => { setReportForm(EMPTY_REPORT); setReportingTour(tour); }}
              onViewReport={() => setViewingReport(tour)}
              onAssign={aid => handleAssign(tour, aid)}
              onUnassign={aid => handleUnassign(tour, aid)} />
          );
        })}
      </div>

      {/* מודאל דיווח אחרי סיור */}
      {reportingTour && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => !busy && setReportingTour(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 520, width: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#2d1f5e', marginBottom: 4 }}>דיווח סיור {reportingTour.tourNumber}</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>{reportingTour.settlement} · {formatDateHe(reportingTour.date)}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">שעת הגעה <span style={{ color: '#e24b4a' }}>*</span></label>
                <input type="time" className="form-input" value={reportForm.arrival_time}
                  onChange={e => setReportField('arrival_time', e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
              </div>
              <div>
                <label className="form-label">מספר משתתפים <span style={{ color: '#e24b4a' }}>*</span></label>
                <input type="number" min="1" className="form-input" value={reportForm.participant_count}
                  onChange={e => setReportField('participant_count', e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
              </div>
            </div>

            {[
              ['gender_distribution', 'התפלגות מגדרית', GENDER_OPTIONS],
              ['religious_distribution', 'התפלגות רמת דתיות', RELIGION_OPTIONS],
              ['age_distribution', 'התפלגות גיל', AGE_OPTIONS],
              ['diversity_level', 'הקבוצה מגוונת או הומוגנית?', DIVERSITY_OPTIONS],
              ['guiding_quality', 'איכות ההדרכה', GUIDING_OPTIONS],
              ['group_progress', 'האם ניכרת התקדמות קבוצתית?', PROGRESS_OPTIONS],
              ['personal_connections_status', 'האם קודמו קשרים אישיים?', CONNECTIONS_OPTIONS],
            ].map(([key, label, options]) => (
              <div key={key}>
                <label className="form-label">{label} <span style={{ color: '#e24b4a' }}>*</span></label>
                <select className="form-input" value={reportForm[key]}
                  onChange={e => setReportField(key, e.target.value)}
                  style={{ width: '100%', marginBottom: 10, fontFamily: 'inherit' }}>
                  <option value="">בחר…</option>
                  {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}

            {reportForm.guiding_quality && (
              <>
                <label className="form-label">פירוט על ההדרכה</label>
                <input className="form-input" value={reportForm.guiding_notes}
                  onChange={e => setReportField('guiding_notes', e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
              </>
            )}

            <label className="form-label">אווירה (אפשר לבחור כמה) <span style={{ color: '#e24b4a' }}>*</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 10px' }}>
              {ATMOSPHERE_OPTIONS.map(o => {
                const on = reportForm.atmosphere.includes(o);
                return (
                  <button key={o} type="button"
                    onClick={() => setReportField('atmosphere', on ? reportForm.atmosphere.filter(x => x !== o) : [...reportForm.atmosphere, o])}
                    style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12.5, cursor: 'pointer', fontFamily: 'Rubik,sans-serif',
                      border: `1.5px solid ${on ? '#6c5ce7' : '#e8e8e8'}`, background: on ? '#f0effe' : '#fafafa',
                      color: on ? '#6c5ce7' : '#666', fontWeight: on ? 700 : 400 }}>
                    {o}
                  </button>
                );
              })}
            </div>

            {['כן', 'בתהליך'].includes(reportForm.personal_connections_status) && (
              <>
                <label className="form-label">פירוט על הקשרים <span style={{ color: '#e24b4a' }}>*</span></label>
                <input className="form-input" value={reportForm.personal_connections_notes}
                  onChange={e => setReportField('personal_connections_notes', e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
              </>
            )}

            <label className="form-label">הערות כלליות</label>
            <textarea className="form-input" rows={2} value={reportForm.general_notes}
              onChange={e => setReportField('general_notes', e.target.value)}
              style={{ width: '100%', marginBottom: 14, fontFamily: 'inherit', resize: 'vertical' }} />

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setReportingTour(null)} disabled={busy}>ביטול</button>
              <button className="btn btn-primary" style={{ flex: 2, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={handleSubmitReport} disabled={busy || !reportValid(reportForm)}>
                {busy ? 'שולח…' : 'שלח דיווח וסמן שהסיור התקיים'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* מודאל צפייה בדיווח שהוגש */}
      {viewingReport?.report && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setViewingReport(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#2d1f5e', marginBottom: 4 }}>דיווח סיור {viewingReport.tourNumber}</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>
              {viewingReport.settlement} · {formatDateHe(viewingReport.date)} · דיווח: {activistName(viewingReport.reportedBy) ?? '—'}
            </div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {Object.entries(REPORT_LABELS).map(([key, label]) => {
                  const val = viewingReport.report[key];
                  if (val === undefined || val === '' || (Array.isArray(val) && !val.length)) return null;
                  return (
                    <tr key={key} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                      <td style={{ padding: '7px 0', color: '#999', width: 150, verticalAlign: 'top' }}>{label}</td>
                      <td style={{ padding: '7px 0' }}>{Array.isArray(val) ? val.join(', ') : String(val)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="btn" style={{ width: '100%', marginTop: 14, cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => setViewingReport(null)}>סגור</button>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}

function TourCard({ tour, activists, activistName, canManage, canReport, onReport, onViewReport, onAssign, onUnassign }) {
  const [selectedId, setSelectedId] = useState('');
  const statusInfo = STATUS_LABELS[tour.status] || STATUS_LABELS.upcoming;
  const available = activists.filter(a => !(tour.assignedActivists || []).some(x => Number(x) === Number(a.id)));

  return (
    <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 18, boxShadow: '0 1px 5px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>סיור {tour.tourNumber}</div>
          <div style={{ fontSize: 13, color: '#888' }}>{tour.settlement}</div>
        </div>
        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700, background: statusInfo.bg, color: statusInfo.color }}>
          {statusInfo.label}
        </span>
      </div>

      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 12 }}>
        {[
          ['📅 תאריך', `${formatDateHe(tour.date)}${tour.startTime ? ` · ${tour.startTime}` : ''}`],
          ['🧭 מדריך', tour.guideActivistId ? `${activistName(tour.guideActivistId) ?? tour.guideName} (פעיל שלנו)` : (tour.guideName || '—')],
          ['🏠 משפחה מארחת', activistName(tour.hostActivistId) ?? '—'],
          ...(tour.notes ? [['📝 הערות', tour.notes]] : []),
        ].map(([lbl, val]) => (
          <tr key={lbl} style={{ borderBottom: '0.5px solid #f5f5f5' }}>
            <td style={{ padding: '6px 0', color: '#999', width: 120 }}>{lbl}</td>
            <td style={{ padding: '6px 0' }}>{val}</td>
          </tr>
        ))}
      </table>

      {/* פעילים משובצים */}
      <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>פעילים משובצים</div>
      {(tour.assignedActivists || []).length === 0 ? (
        <div style={{ fontSize: 13, color: '#ccc', marginBottom: 10 }}>טרם שובצו פעילים</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {tour.assignedActivists.map(aid => (
            <span key={aid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f0effe', color: '#534ab7', borderRadius: 20, padding: '4px 12px', fontSize: 12.5, fontWeight: 600 }}>
              {activistName(aid) ?? `פעיל ${aid}`}
              {canManage && (
                <button onClick={() => onUnassign(aid)} title="הסר"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a7cd8', fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* דיווח אחרי סיור */}
      {canReport && (
        <button onClick={onReport} className="btn btn-primary"
          style={{ width: '100%', marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
          📝 מלא דיווח על הסיור
        </button>
      )}
      {tour.status === 'completed' && tour.report && (
        <button onClick={onViewReport} className="btn"
          style={{ width: '100%', marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#3b6d11', borderColor: '#639922' }}>
          ✓ הסיור התקיים · {tour.report.participant_count} משתתפים — צפה בדיווח
        </button>
      )}

      {/* שיבוץ — רכז בלבד, כל עוד הסיור לא הסתיים */}
      {canManage && tour.status !== 'completed' && available.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1.5px solid #e8e8e8', fontSize: 13, fontFamily: 'Rubik,sans-serif', background: '#fafafa' }}>
            <option value="">בחר פעיל לשיבוץ…</option>
            {available.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={() => { if (selectedId) { onAssign(selectedId); setSelectedId(''); } }}
            disabled={!selectedId}
            style={{ border: 'none', borderRadius: 10, padding: '8px 16px', fontFamily: 'inherit', fontWeight: 700, cursor: selectedId ? 'pointer' : 'default', background: selectedId ? '#6c5ce7' : '#e8e8e8', color: selectedId ? '#fff' : '#aaa', fontSize: 13 }}>
            שבץ
          </button>
        </div>
      )}
    </div>
  );
}
