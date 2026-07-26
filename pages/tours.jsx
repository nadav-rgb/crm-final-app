// pages/tours.jsx — סיורים ("נעים להכיר"). מקביל לבתי מפגש: יצירה (רכז), שיבוץ פעיל
// עם push+התראה, מדריך (פעיל שלנו מהרשימה או מדריך חיצוני בטקסט), משפחה מארחת (תמיד פעיל).
import { useEffect, useState } from 'react';
import Head from 'next/head';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import { fetchToursFromSupabase, upsertTourApi, updateTourApi, cancelTourApi, deleteTourApi, submitTourReportApi, notifyTourCreatedApi } from '../lib/toursSupabase';
import { createDemoNotification } from '../lib/notificationDemo';
import { inProject } from '../lib/projectUtils';
import { formatDateHe } from '../lib/formatDate';

const TODAY = new Date().toISOString().split('T')[0];

const STATUS_LABELS = {
  upcoming:  { label: 'מתוכנן', color: '#6c5ce7', bg: '#f0effe' },
  completed: { label: 'התקיים', color: '#27ae60', bg: '#edfaf1' },
  cancelled: { label: 'בוטל',   color: '#c0392b', bg: '#fdecea' },
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

const MONTH_NAMES_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const WEEKDAY_NAMES_HE = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export default function ToursPage() {
  const { can, currentUser } = useAuth();
  const { activists } = useCrm();
  const [tours, setTours] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingTour, setEditingTour] = useState(null); // הסיור שעורכים כרגע (null = יצירה)
  const [notice, setNotice] = useState(null);           // באנר סיכום אחרי עריכה/ביטול/מחיקה
  const [confirmAction, setConfirmAction] = useState(null); // { mode: 'cancel' | 'delete', tour }
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState('');   // סיבת חסימה שחזרה מהשרת
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [reportingTour, setReportingTour] = useState(null); // הסיור שממלאים עליו דיווח
  const [reportForm, setReportForm] = useState(EMPTY_REPORT);
  const [viewingReport, setViewingReport] = useState(null);  // צפייה בדיווח שהוגש
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const today = new Date();
  const [calendarMonth, setCalendarMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDay, setSelectedDay] = useState(null); // 'YYYY-MM-DD' שנבחר בלוח השנה

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

  // פתיחת הטופס במצב עריכה, ממולא מהסיור הקיים
  function openEdit(tour) {
    setEditingTour(tour);
    setCreating(false);
    setErrors({});
    setNotice(null);
    setSelectedDay(null);
    setForm({
      tourNumber:      tour.tourNumber || '',
      settlement:      tour.settlement || '',
      date:            tour.date ? String(tour.date).slice(0, 10) : '',
      startTime:       tour.startTime || '',
      guideMode:       tour.guideActivistId ? 'activist' : 'external',
      guideActivistId: tour.guideActivistId ? String(tour.guideActivistId) : '',
      guideName:       tour.guideActivistId ? '' : (tour.guideName || ''),
      hostActivistId:  tour.hostActivistId ? String(tour.hostActivistId) : '',
      notes:           tour.notes || '',
    });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeForm() {
    setCreating(false);
    setEditingTour(null);
    setForm(EMPTY_FORM);
    setErrors({});
  }

  async function handleSave() {
    const e = {};
    if (!form.tourNumber.trim()) e.tourNumber = 'מספר סיור חובה';
    if (!form.settlement.trim()) e.settlement = 'יישוב חובה';
    if (!form.date)              e.date       = 'תאריך חובה';
    if (form.guideMode === 'activist' && !form.guideActivistId) e.guide = 'נא לבחור מדריך מהרשימה';
    if (form.guideMode === 'external' && !form.guideName.trim()) e.guide = 'נא להזין שם מדריך';
    if (!form.hostActivistId)    e.host = 'נא לבחור משפחה מארחת';
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    const guideActivist = form.guideMode === 'activist'
      ? guideOptions.find(a => Number(a.id) === Number(form.guideActivistId))
      : null;
    const fields = {
      tourNumber:      form.tourNumber.trim(),
      settlement:      form.settlement.trim(),
      date:            form.date,
      startTime:       form.startTime,
      guideName:       guideActivist ? guideActivist.name : form.guideName.trim(),
      guideActivistId: guideActivist ? Number(guideActivist.id) : null,
      hostActivistId:  Number(form.hostActivistId),
      notes:           form.notes.trim(),
    };

    setBusy(true);

    // עריכה — השרת משווה לשורה הישנה ושולח לנוגעים בדבר *מה* השתנה.
    // שולחים את הסיור המלא כדי לשמר id; השרת מתעלם משדות שאינם ניתנים לעריכה
    // (status / assigned_activists / report) — תיקון פרטים לא דורס שיבוץ או דיווח.
    if (editingTour) {
      const result = await updateTourApi({ ...editingTour, ...fields });
      setBusy(false);
      if (!result) { setErrors({ submit: 'שמירת השינויים נכשלה — נסה שוב' }); return; }
      setTours(prev => prev.map(t => (t.id === result.tour.id ? result.tour : t)));
      setNotice({
        title: `סיור ${result.tour.tourNumber} עודכן`,
        lines: result.changes.map(c => `${c.label}: ${c.from} ← ${c.to}`),
        emptyText: 'לא זוהה שינוי בפרטים — לא נשלחו התראות.',
        notified: result.notified.length,
      });
      closeForm();
      load();
      return;
    }

    const saved = await upsertTourApi({
      ...fields,
      id: `tour-${Date.now()}`,
      assignedActivists: [],
      status: 'upcoming',
      project_id: 2,
    });
    setBusy(false);
    if (!saved) { setErrors({ submit: 'שמירת הסיור נכשלה — נסה שוב' }); return; }

    // התראות (פעמון + push) לכל הנמענים — בצד השרת (admin, עוקף RLS): משפחה מארחת, מדריך,
    // וניהול "נעים להכיר" (מנכ"ל + רכזים/ראשי-פרויקט — כולל הדס לוי ונדב). ראה pages/api/tours/notify.js.
    // (בעבר נוצרו בצד-לקוח ונכשלו לכל נמען שאינו יוצר הסיור, בגלל RLS על notifications.)
    await notifyTourCreatedApi(saved.id);

    closeForm();
    load();
  }

  function openConfirm(mode, tour) {
    setConfirmAction({ mode, tour });
    setCancelReason('');
    setActionError('');
    setSelectedDay(null);
  }

  async function handleCancelTour() {
    const tour = confirmAction?.tour;
    if (!tour) return;
    setBusy(true);
    setActionError('');
    const result = await cancelTourApi(tour.id, cancelReason);
    setBusy(false);
    if (!result) { setActionError('ביטול הסיור נכשל — נסה שוב'); return; }
    setTours(prev => prev.map(t => (t.id === result.tour.id ? result.tour : t)));
    setNotice({ title: `סיור ${result.tour.tourNumber} בוטל`, lines: [], notified: result.notified.length });
    setConfirmAction(null);
    load();
  }

  async function handleDeleteTour() {
    const tour = confirmAction?.tour;
    if (!tour) return;
    setBusy(true);
    setActionError('');
    const result = await deleteTourApi(tour.id);
    setBusy(false);
    // חסימה מכוונת מהשרת (דיווח קיים / לקוחות מקושרים) — נשארים במודאל ומציעים ביטול במקום
    if (!result.ok) { setActionError(result.message); return; }
    setTours(prev => prev.filter(t => t.id !== tour.id));
    setNotice({ title: `סיור ${tour.tourNumber} נמחק`, lines: [], notified: result.notified.length });
    setConfirmAction(null);
    if (editingTour?.id === tour.id) closeForm();
    load();
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
    // התראת "דיווח סיור הוגש" לרכזים נכתבת בצד-שרת (api/tours/report.js, admin key).
    // כאן לא ניתן: broadcast (user_id:null) לא נכתב ל-Supabase כלל, וכתיבה מהדפדפן לנמען אחר לא נשמרת.
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
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#f5f4fb', borderRadius: 10, padding: 3 }}>
            {[{ v: 'list', l: '📋 רשימה' }, { v: 'calendar', l: '📅 לוח שנה' }].map(({ v, l }) => (
              <button key={v} type="button" onClick={() => setViewMode(v)}
                style={{
                  border: 'none', borderRadius: 8, padding: '7px 13px', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer',
                  fontWeight: viewMode === v ? 700 : 400,
                  background: viewMode === v ? '#fff' : 'transparent',
                  color: viewMode === v ? '#6c5ce7' : '#888',
                  boxShadow: viewMode === v ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                }}>
                {l}
              </button>
            ))}
          </div>
          {canManage && (
            <button onClick={() => { if (creating || editingTour) closeForm(); else { setEditingTour(null); setForm(EMPTY_FORM); setErrors({}); setCreating(true); } }}
              style={{ border: 'none', borderRadius: 10, padding: '9px 15px', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer', background: '#6c5ce7', color: '#fff', fontSize: 13 }}>
              {(creating || editingTour) ? 'סגור' : '+ סיור חדש'}
            </button>
          )}
        </div>
      }
    >
      {/* באנר סיכום אחרי עריכה/ביטול/מחיקה — מה קרה ולכמה אנשים נשלחה התראה */}
      {notice && (
        <div style={{ background: '#edfaf1', border: '0.5px solid #a8dcbb', borderRadius: 14, padding: '13px 16px', marginBottom: 16, maxWidth: 620 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1e7a45' }}>✓ {notice.title}</div>
            <button onClick={() => setNotice(null)} aria-label="סגור"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1e7a45', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
          </div>
          {notice.lines.length > 0 && (
            <div style={{ fontSize: 12.5, color: '#4a7d5e', marginTop: 5, lineHeight: 1.75 }}>
              {notice.lines.map(line => <div key={line}>• {line}</div>)}
            </div>
          )}
          {notice.lines.length === 0 && notice.emptyText ? (
            <div style={{ fontSize: 12.5, color: '#4a7d5e', marginTop: 5 }}>{notice.emptyText}</div>
          ) : (
            <div style={{ fontSize: 12.5, color: '#1e7a45', marginTop: 7, fontWeight: 600 }}>
              {notice.notified > 0
                ? `נשלחה התראה ל-${notice.notified} נמענים (פעמון + התראה לנייד).`
                : 'לא נמצאו נמענים להתראה.'}
            </div>
          )}
        </div>
      )}

      {/* טופס יצירת/עריכת סיור */}
      {(creating || editingTour) && (
        <div style={{ background: '#fffaf5', borderRadius: 16, padding: '18px 20px', marginBottom: 18, border: '0.5px solid rgba(108,92,231,0.25)', maxWidth: 620 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#2d1f5e', marginBottom: editingTour ? 4 : 14 }}>
            {editingTour ? `עריכת סיור ${editingTour.tourNumber}` : 'סיור חדש'}
          </div>
          {editingTour && (
            <div style={{ fontSize: 12.5, color: '#8b7fa8', marginBottom: 14, lineHeight: 1.6 }}>
              המשפחה המארחת, המדריך, המשובצים והרכזים יקבלו התראה עם מה שהשתנה.
              השיבוצים והדיווח (אם הוגש) לא ישתנו.
            </div>
          )}
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
              {/* בעריכה אין min — סיור שכבר עבר חייב להיות ניתן לתיקון */}
              <input type="date" className={`form-input ${errors.date ? 'form-error' : ''}`} min={editingTour ? undefined : TODAY}
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
          <div style={{ display: 'flex', gap: 8 }}>
            {editingTour && (
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={closeForm} disabled={busy}>ביטול</button>
            )}
            <button className="btn btn-primary" style={{ flex: 2, cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={handleSave} disabled={busy}>
              {busy ? 'שומר…' : (editingTour ? 'שמור שינויים ועדכן את המשובצים' : 'צור סיור ושלח התראות')}
            </button>
          </div>
        </div>
      )}

      {/* רשימת סיורים */}
      {viewMode === 'list' ? (
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
                activistName={activistName}
                canReport={(canManage || related) && tour.status === 'upcoming'}
                canEdit={canManage}
                onEdit={() => openEdit(tour)}
                onCancel={() => openConfirm('cancel', tour)}
                onDelete={() => openConfirm('delete', tour)}
                onReport={() => { setReportForm(EMPTY_REPORT); setReportingTour(tour); }}
                onViewReport={() => setViewingReport(tour)} />
            );
          })}
        </div>
      ) : (
        <ToursCalendar
          tours={visibleTours}
          calendarMonth={calendarMonth}
          setCalendarMonth={setCalendarMonth}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          activistName={activistName}
        />
      )}

      {/* מודאל פרטי יום נבחר בלוח השנה */}
      {selectedDay && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setSelectedDay(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 22, maxWidth: 460, width: '100%', maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#2d1f5e', marginBottom: 14 }}>{formatDateHe(selectedDay)}</div>
            {(() => {
              const dayTours = visibleTours.filter(t => t.date === selectedDay);
              if (dayTours.length === 0) {
                return <div style={{ color: '#ccc', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>אין סיורים ביום זה</div>;
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dayTours.map(t => {
                    const statusInfo = STATUS_LABELS[t.status] || STATUS_LABELS.upcoming;
                    return (
                      <div key={t.id} style={{ border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>סיור {t.tourNumber} · {t.settlement}</div>
                          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 700, background: statusInfo.bg, color: statusInfo.color }}>
                            {statusInfo.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#888', lineHeight: 1.8 }}>
                          {t.startTime && <div>🕒 שעה: {t.startTime}</div>}
                          <div>🧭 מדריך: {t.guideActivistId ? (activistName(t.guideActivistId) ?? t.guideName) : (t.guideName || '—')}</div>
                          <div>🏠 משפחה מארחת: {activistName(t.hostActivistId) ?? '—'}</div>
                          {t.notes && <div>📝 {t.notes}</div>}
                        </div>
                        {canManage && (
                          <button onClick={() => openEdit(t)} className="btn"
                            style={{ width: '100%', marginTop: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: '#6c5ce7', borderColor: 'rgba(108,92,231,0.35)' }}>
                            ✏️ ערוך פרטי סיור
                          </button>
                        )}
                        {t.status === 'completed' && t.report && (
                          <button onClick={() => { setSelectedDay(null); setViewingReport(t); }} className="btn"
                            style={{ width: '100%', marginTop: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: '#3b6d11', borderColor: '#639922' }}>
                            ✓ צפה בדיווח
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <button className="btn" style={{ width: '100%', marginTop: 14, cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => setSelectedDay(null)}>סגור</button>
          </div>
        </div>
      )}

      {/* מודאל אישור — ביטול או מחיקה */}
      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => !busy && setConfirmAction(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 440, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: confirmAction.mode === 'delete' ? '#c0392b' : '#2d1f5e', marginBottom: 4 }}>
              {confirmAction.mode === 'delete' ? 'מחיקת סיור לצמיתות' : 'ביטול סיור'}
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>
              סיור {confirmAction.tour.tourNumber} · {confirmAction.tour.settlement} · {formatDateHe(confirmAction.tour.date)}
            </div>

            {confirmAction.mode === 'cancel' ? (
              <>
                <div style={{ fontSize: 13, color: '#555', lineHeight: 1.75, marginBottom: 14 }}>
                  הסיור יסומן <b>"בוטל"</b> ויישאר בהיסטוריה. הוא לא ייספר בשכר המדריך,
                  והלקוחות שהגיעו דרכו לא יאבדו את השיוך.
                  <br />המשפחה המארחת, המדריך, המשובצים והרכזים יקבלו התראה.
                </div>
                <label className="form-label">סיבת הביטול (רשות — תופיע בהתראה)</label>
                <input className="form-input" placeholder="למשל: המשפחה המארחת חלתה"
                  value={cancelReason} onChange={e => setCancelReason(e.target.value)} maxLength={200}
                  style={{ width: '100%', marginTop: 4, marginBottom: 14 }} />
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#555', lineHeight: 1.75, marginBottom: 14 }}>
                הסיור יימחק לגמרי ולא ניתן יהיה לשחזר אותו. זה מיועד לסיור שנוצר בטעות או בכפילות.
                <br />אם כבר הוגש עליו דיווח, או שיש לקוחות שהגיעו דרכו — המערכת תחסום את המחיקה ותציע לבטל במקום.
                <br />מי שכבר קיבל "שובצת לסיור" יקבל התראה שהסיור בוטל.
              </div>
            )}

            {actionError && (
              <div style={{ background: '#fdecea', border: '0.5px solid #f0b3ad', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: '#a5342a', lineHeight: 1.7 }}>{actionError}</div>
                {confirmAction.mode === 'delete' && (
                  <button onClick={() => { setActionError(''); setConfirmAction({ mode: 'cancel', tour: confirmAction.tour }); }}
                    style={{ marginTop: 8, border: '1px solid rgba(192,57,43,0.3)', background: '#fff', color: '#c0392b',
                      borderRadius: 8, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    בטל את הסיור במקום
                  </button>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setConfirmAction(null)} disabled={busy}>חזור</button>
              <button
                onClick={confirmAction.mode === 'delete' ? handleDeleteTour : handleCancelTour}
                disabled={busy}
                style={{ flex: 2, border: 'none', borderRadius: 10, padding: '10px 0', fontFamily: 'inherit', fontWeight: 700,
                  cursor: busy ? 'default' : 'pointer', fontSize: 13, color: '#fff', opacity: busy ? 0.6 : 1,
                  background: confirmAction.mode === 'delete' ? '#c0392b' : '#e08a2e' }}>
                {busy ? 'מבצע…' : (confirmAction.mode === 'delete' ? 'מחק לצמיתות' : 'בטל את הסיור ושלח התראה')}
              </button>
            </div>
          </div>
        </div>
      )}

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

function TourCard({ tour, activistName, canReport, canEdit, onEdit, onCancel, onDelete, onReport, onViewReport }) {
  const statusInfo = STATUS_LABELS[tour.status] || STATUS_LABELS.upcoming;
  const isCancelled = tour.status === 'cancelled';

  return (
    <div style={{
      background: '#fff', border: `0.5px solid ${isCancelled ? 'rgba(192,57,43,0.2)' : 'rgba(0,0,0,0.07)'}`,
      borderRadius: 16, padding: 18, boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
      opacity: isCancelled ? 0.72 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>סיור {tour.tourNumber}</div>
          <div style={{ fontSize: 13, color: '#888' }}>{tour.settlement}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          {canEdit && (
            <button onClick={onEdit} title="ערוך פרטי סיור"
              style={{ border: '1px solid rgba(108,92,231,0.3)', background: '#fff', color: '#6c5ce7', borderRadius: 20,
                padding: '3px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              ✏️ ערוך
            </button>
          )}
          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700, background: statusInfo.bg, color: statusInfo.color }}>
            {statusInfo.label}
          </span>
        </div>
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

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {!isCancelled && (
            <button onClick={onCancel}
              style={{ flex: 1, border: '1px solid rgba(192,57,43,0.28)', background: '#fff', color: '#c0392b',
                borderRadius: 10, padding: '7px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              בטל סיור
            </button>
          )}
          <button onClick={onDelete}
            style={{ flex: isCancelled ? 1 : 0, flexBasis: isCancelled ? 'auto' : 90, border: '1px solid rgba(0,0,0,0.1)',
              background: '#fff', color: '#999', borderRadius: 10, padding: '7px 0', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            🗑 מחק
          </button>
        </div>
      )}
    </div>
  );
}

// פורמטרים לתאריך העברי (ICU מובנה ב-Intl — בלי ספרייה חיצונית)
const hebrewDayFormatter   = new Intl.DateTimeFormat('he-u-ca-hebrew-nu-latn', { day: 'numeric' });
const hebrewMonthYearFormatter = new Intl.DateTimeFormat('he-u-ca-hebrew-nu-latn', { month: 'long', year: 'numeric' });
const HEBREW_NUMERALS = { // המרת יום עברי למספרי-אותיות (א, ב...) — קריא יותר מ"14"
  1: 'א', 2: 'ב', 3: 'ג', 4: 'ד', 5: 'ה', 6: 'ו', 7: 'ז', 8: 'ח', 9: 'ט', 10: 'י',
  11: 'יא', 12: 'יב', 13: 'יג', 14: 'יד', 15: 'טו', 16: 'טז', 17: 'יז', 18: 'יח', 19: 'יט', 20: 'כ',
  21: 'כא', 22: 'כב', 23: 'כג', 24: 'כד', 25: 'כה', 26: 'כו', 27: 'כז', 28: 'כח', 29: 'כט', 30: 'ל',
};

// אות/אותיות → תצוגה מסורתית עם גרש/גרשיים (י״ד, ט״ו, כ׳)
function toGematria(letters) {
  if (!letters) return '';
  if (letters.length === 1) return letters + '׳';
  return letters.slice(0, -1) + '״' + letters.slice(-1);
}

function hebrewDayLabel(date) {
  const n = Number(hebrewDayFormatter.format(date));
  return toGematria(HEBREW_NUMERALS[n] || String(n));
}

const CAL_SERIF = "'Frank Ruhl Libre', 'Rubik', serif";
const CAL_STATUS = { upcoming: '#6d4eca', completed: '#2f9e7f', cancelled: '#c0392b' };

// לוח שנה חודשי — "פנקס עברי": נייר חם, ספרות סריף, גוני זהב לשבת, תצוגה גרגוריאני+עברי
function ToursCalendar({ tours, calendarMonth, setCalendarMonth, selectedDay, setSelectedDay, activistName }) {
  const { year, month } = calendarMonth;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const toursByDay = {};
  tours.forEach(t => {
    if (!t.date) return;
    (toursByDay[t.date] ??= []).push(t);
  });

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay(); // 0=ראשון

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // כותרת עברית של החודש — מציג את כל החודשים העבריים שחלים בטווח החודש הגרגוריאני (לרוב 1-2)
  const hebMonthLabel = (() => {
    const startLabel = hebrewMonthYearFormatter.format(new Date(year, month, 1));
    const endLabel = hebrewMonthYearFormatter.format(new Date(year, month, daysInMonth));
    return startLabel === endLabel ? startLabel : `${startLabel.split(' ')[0]}–${endLabel}`;
  })();

  function changeMonth(delta) {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setCalendarMonth({ year: y, month: m });
  }

  function dayStr(d) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const navBtnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 38, height: 38, borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
    border: '1px solid rgba(58,36,155,0.14)', background: '#fff', color: '#3a249b',
    transition: 'all .16s ease',
  };
  function navHover(e, on) {
    e.currentTarget.style.background = on ? '#3a249b' : '#fff';
    e.currentTarget.style.color = on ? '#fff' : '#3a249b';
    e.currentTarget.style.transform = on ? 'scale(1.07)' : 'none';
    e.currentTarget.style.boxShadow = on ? '0 6px 16px -6px rgba(58,36,155,0.5)' : 'none';
  }

  return (
    <>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        @keyframes toursCalUp { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{
        position: 'relative', maxWidth: 760, background: '#fffdf9', borderRadius: 24, overflow: 'hidden',
        border: '1px solid rgba(58,36,155,0.10)',
        boxShadow: '0 30px 60px -30px rgba(42,24,112,0.38), 0 8px 22px -16px rgba(42,24,112,0.22)',
      }}>
        {/* פס עליון בספוק — זהב→סגול */}
        <div style={{ height: 4, background: 'linear-gradient(90deg, #c9a24b, #6d4eca 55%, #3a249b)' }} />

        {/* כותרת — direction:ltr כדי לשלוט בכיוון החיצים: קודם(אחורה)=ימין✦חץ ימינה, הבא(קדימה)=שמאל✦חץ שמאלה */}
        <div style={{ direction: 'ltr', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 24px 14px' }}>
          <button type="button" onClick={() => changeMonth(1)} aria-label="החודש הבא" style={navBtnStyle}
            onMouseEnter={e => navHover(e, true)} onMouseLeave={e => navHover(e, false)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>

          <div style={{ textAlign: 'center', direction: 'rtl' }}>
            <div style={{ fontFamily: CAL_SERIF, fontWeight: 900, fontSize: 27, color: '#2a1870', letterSpacing: '-0.5px', lineHeight: 1.15 }}>
              {MONTH_NAMES_HE[month]} <span style={{ color: '#9184c8', fontWeight: 500 }}>{year}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#a695d4', marginTop: 3, fontWeight: 600, letterSpacing: '0.6px' }}>{hebMonthLabel}</div>
          </div>

          <button type="button" onClick={() => changeMonth(-1)} aria-label="החודש הקודם" style={navBtnStyle}
            onMouseEnter={e => navHover(e, true)} onMouseLeave={e => navHover(e, false)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>

        <div style={{ padding: '0 20px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {WEEKDAY_NAMES_HE.map((w, i) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 12, color: i === 6 ? '#b8891f' : '#b3a9d6', fontWeight: 700, letterSpacing: '0.5px', padding: '6px 0' }}>{w}</div>
            ))}
          </div>
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(58,36,155,0.14), transparent)', marginBottom: 10 }} />

          <div key={`${year}-${month}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 7 }}>
            {cells.map((d, idx) => {
              if (d === null) return <div key={idx} />;
              const ds = dayStr(d);
              const dayTours = toursByDay[ds] || [];
              const hasTours = dayTours.length > 0;
              const isToday = ds === todayStr;
              const isShabbat = idx % 7 === 6;
              const hasUpcoming = dayTours.some(t => t.status === 'upcoming');
              const hasCompleted = dayTours.some(t => t.status === 'completed');
              // יום שכל הסיורים בו בוטלו נצבע אדום — לא ירוק כאילו הם התקיימו
              const accent = hasUpcoming ? CAL_STATUS.upcoming
                : hasCompleted ? CAL_STATUS.completed
                : CAL_STATUS.cancelled;
              const gregDate = new Date(year, month, d);
              return (
                <button key={idx} type="button" onClick={() => hasTours && setSelectedDay(ds)} disabled={!hasTours}
                  style={{
                    position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                    minHeight: 80, padding: '7px 9px 8px', borderRadius: 14, textAlign: 'right', overflow: 'hidden',
                    border: isToday ? '1.5px solid #6d4eca' : `1px solid ${hasTours ? 'rgba(109,78,202,0.18)' : 'rgba(0,0,0,0.05)'}`,
                    background: hasTours
                      ? (hasUpcoming ? 'linear-gradient(158deg, #ece5fb, #fbfaff)'
                        : hasCompleted ? 'linear-gradient(158deg, #e4f3ea, #fafefb)'
                        : 'linear-gradient(158deg, #fbe9e7, #fffafa)')
                      : (isShabbat ? '#fbf5e9' : '#fffdf9'),
                    cursor: hasTours ? 'pointer' : 'default', fontFamily: 'inherit',
                    boxShadow: hasTours ? `0 6px 18px -10px ${accent}` : 'none',
                    transition: 'transform .16s cubic-bezier(.22,1,.36,1), box-shadow .16s',
                    animation: 'toursCalUp .5s cubic-bezier(.22,1,.36,1) both',
                    animationDelay: `${Math.min(idx * 12, 300)}ms`,
                  }}
                  onMouseEnter={e => { if (hasTours) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 14px 26px -12px ${accent}`; } }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = hasTours ? `0 6px 18px -10px ${accent}` : 'none'; }}>

                  {hasTours && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />}

                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontFamily: CAL_SERIF, fontWeight: isToday ? 900 : 700, fontSize: 19, lineHeight: 1, color: isToday ? '#3a249b' : (isShabbat ? '#8a6a1e' : '#33285e') }}>{d}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: isShabbat ? '#c19a45' : '#b0a5d4' }}>{hebrewDayLabel(gregDate)}</span>
                  </div>

                  {hasTours ? (
                    <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.72)', border: `1px solid ${accent}33`, borderRadius: 8, padding: '3px 7px' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0, boxShadow: `0 0 0 3px ${accent}22` }} />
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#4a3f7a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {dayTours.length === 1 ? `סיור ${dayTours[0].tourNumber}` : `${dayTours.length} סיורים`}
                      </span>
                    </div>
                  ) : isToday ? (
                    <span style={{ marginTop: 'auto', fontSize: 9.5, fontWeight: 800, color: '#6d4eca', letterSpacing: '0.5px' }}>היום</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 18, marginTop: 18, fontSize: 12, color: '#9a90bf', borderTop: '1px solid rgba(58,36,155,0.08)', paddingTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: CAL_STATUS.upcoming }} /> מתוכנן</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: CAL_STATUS.completed }} /> התקיים</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: CAL_STATUS.cancelled }} /> בוטל</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#fbf5e9', border: '1px solid #e6d4a8' }} /> שבת</div>
          </div>
        </div>
      </div>
    </>
  );
}
