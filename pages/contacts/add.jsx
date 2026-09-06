// pages/contacts/add.jsx
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../../data/config';
import { useCrm } from '../../lib/CrmStore';
import { useAuth } from '../../lib/AuthStore';
import DesktopLayout from '../../components/DesktopLayout';
import { fetchToursFromSupabase } from '../../lib/toursSupabase';
import { authHeader } from '../../lib/apiAuth';

const TODAY = new Date().toISOString().split('T')[0];

const PROJECT_META = {
  1: { name: 'אחדות יהודית', sourceOptions: [{ value: 'meeting_house', label: '🏠 בית מפגש' }, { value: 'external', label: '🌟 מחוץ לבתי המפגש' }], bonusText: '🎁 לקוח שהגיע מחוץ לבתי המפגש מזכה בבונוס משתתף חדש' },
  2: { name: 'נעים להכיר',    sourceOptions: [{ value: 'meeting_house', label: '🚌 דרך סיור' },        { value: 'external', label: '🌟 מחוץ לסיורים' }],       bonusText: '🎁 לקוח שהגיע מחוץ לסיורים מזכה בבונוס משתתף חדש' },
};

const EMPTY = {
  name: '', phone: '', city: '', gender: '',
  age: '', profession: '', notes: '',
  mitzvot: {},
};

// שדות "מקור הלקוח" ברירת מחדל, לכל פרויקט שנבחר
const EMPTY_SOURCE = { source: 'meeting_house', meeting_place_city: '', meeting_place_number: '', tour_id: '', how_met: '' };

export default function AddContactPage() {
  const router = useRouter();
  const { activeProject, currentUser, can } = useAuth();
  const { addContact } = useCrm();
  const [form,   setForm]   = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy,   setBusy]   = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(null); // מערך project_id-ים שסומנו ככפולים, ממתין לאישור המשתמש

  useEffect(() => {
    if (currentUser && !can.addContact) router.replace('/contacts');
  }, [currentUser?.role]);

  // פעיל דו-פרויקטלי: חובה לבחור במפורש לאיזה פרויקט (או שניהם) שייך הלקוח.
  const multiProject = (currentUser?.project_ids?.length ?? 0) > 1;
  const [selectedProjectIds, setSelectedProjectIds] = useState(
    multiProject ? [] : [activeProject?.id].filter(Boolean)
  );
  useEffect(() => {
    if (!multiProject && activeProject?.id) setSelectedProjectIds([activeProject.id]);
  }, [multiProject, activeProject?.id]);

  const [sourceByProject, setSourceByProject] = useState({}); // { [projectId]: {...EMPTY_SOURCE} }
  function ensureSourceFields(projectId) {
    setSourceByProject(prev => prev[projectId] ? prev : { ...prev, [projectId]: { ...EMPTY_SOURCE } });
  }
  function toggleProject(projectId) {
    setSelectedProjectIds(prev => {
      const next = prev.includes(projectId) ? prev.filter(p => p !== projectId) : [...prev, projectId];
      return next;
    });
    ensureSourceFields(projectId);
    setErrors(prev => ({ ...prev, projects: undefined }));
  }
  function setSourceField(projectId, field, value) {
    setSourceByProject(prev => ({ ...prev, [projectId]: { ...(prev[projectId] || EMPTY_SOURCE), [field]: value } }));
    setErrors(prev => ({ ...prev, [`${projectId}_${field}`]: undefined }));
  }

  // נעים להכיר — רשימת הסיורים לקישור הלקוח (רק אם פרויקט 2 נבחר)
  const needsTours = selectedProjectIds.includes(2);
  const [tourOptions, setTourOptions] = useState([]);
  useEffect(() => {
    if (!needsTours) return;
    let active = true;
    fetchToursFromSupabase().then(ts => { if (active) setTourOptions(ts); });
    return () => { active = false; };
  }, [needsTours]);

  // חייב לבוא אחרי כל ה-hooks (כלל React) — אחרת מספר ה-hooks משתנה בין רינדורים
  // אם משתמש שאינו פעיל (coord/ceo) מנווט לכאן ישירות אחרי שה-currentUser נטען.
  if (currentUser && !can.addContact) return null;

  const mitzvotList = form.gender === 'male'   ? CONFIG.mitzvotMale
                    : form.gender === 'female' ? CONFIG.mitzvotFemale
                    : [];

  function set(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // מגדר משתנה → מאתחלים סרגל מצוות ל-0 לכל מצוות המגדר החדש (לא ריק — נדרש שמירה גם בלי לגעת)
      if (field === 'gender') {
        const list = value === 'male' ? CONFIG.mitzvotMale : value === 'female' ? CONFIG.mitzvotFemale : [];
        next.mitzvot = Object.fromEntries(list.map(m => [m, 0]));
      }
      return next;
    });
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function setMitzvah(name, level) {
    setForm(prev => ({ ...prev, mitzvot: { ...prev.mitzvot, [name]: level } }));
  }

  function validate() {
    const e = {};
    if (!form.name.trim())       e.name       = 'שם חובה';
    if (!form.phone.trim())      e.phone      = 'טלפון חובה';
    if (!form.city.trim())       e.city       = 'יישוב חובה';
    if (!form.profession.trim()) e.profession = 'עיסוק מקצועי חובה';
    if (selectedProjectIds.length === 0) e.projects = 'נא לבחור לאיזה פרויקט שייך הלקוח';
    selectedProjectIds.forEach(pid => {
      const sf = sourceByProject[pid] || EMPTY_SOURCE;
      if (pid === 1 && sf.source !== 'external') {
        if (!sf.meeting_place_city.trim())   e[`1_meeting_place_city`]   = 'יישוב בית המפגש חובה';
        if (!sf.meeting_place_number.trim()) e[`1_meeting_place_number`] = 'מספר בית המפגש חובה';
      }
      if (pid === 2 && sf.source !== 'external' && !sf.tour_id) {
        e[`2_tour_id`] = 'נא לבחור את הסיור שדרכו הגיע הלקוח';
      }
    });
    // סרגל מצוות — כל הערכים כבר מאותחלים ל-0 אוטומטית; אין חובה "לגעת" בהם (14).
    return e;
  }

  async function checkDuplicates() {
    const externalProjects = selectedProjectIds.filter(pid => (sourceByProject[pid] || EMPTY_SOURCE).source === 'external');
    if (externalProjects.length === 0) return [];
    const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
    const results = await Promise.all(externalProjects.map(async pid => {
      try {
        const res = await fetch('/api/contacts/check-duplicate', {
          method: 'POST', headers,
          body: JSON.stringify({ phone: form.phone, projectId: pid }),
        });
        const data = await res.json();
        return data?.duplicate ? pid : null;
      } catch { return null; }
    }));
    return results.filter(Boolean);
  }

  async function doSubmit() {
    setBusy(true);
    for (const pid of selectedProjectIds) {
      const sf = sourceByProject[pid] || EMPTY_SOURCE;
      const isAchdut = pid === 1;
      const isNaim   = pid === 2;
      const houseNumber = sf.meeting_place_number.trim();
      const houseCity   = sf.meeting_place_city.trim();
      const payload = {
        ...form,
        activist_id: currentUser.id,
        project_id:  pid,
        source:      sf.source,
        how_met:     sf.how_met,
        meeting_place_city:   sf.meeting_place_city,
        meeting_place_number: sf.meeting_place_number,
        tour_id:     sf.tour_id || null,
        days_since_last_contact: 0,
        last_interaction_date:   TODAY,
        joined_at:               TODAY,
        ...(isAchdut && sf.source !== 'external' ? {
          meetingHouseNumber: houseNumber,
          meetingHouseCity:   houseCity,
          meetingHouseKey:    `${houseNumber}_${houseCity}`,
        } : {}),
        ...(isNaim && sf.source !== 'external' ? { source: 'tour', tour_id: sf.tour_id } : {}),
        ...(sf.source === 'external' ? { meeting_place_city: '', meeting_place_number: '', tour_id: null } : {}),
      };
      const result = await addContact(payload);
      if (result?.error) {
        setBusy(false);
        alert('שגיאה בשמירת הלקוח: ' + (result.error.message || 'אנא נסה שוב'));
        return;
      }
    }
    setBusy(false);
    router.push('/contacts');
  }

  async function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setBusy(true);
    const dupProjects = await checkDuplicates();
    setBusy(false);
    if (dupProjects.length > 0) { setConfirmDuplicate(dupProjects); return; }
    await doSubmit();
  }

  const cardStyle = { background: '#fffaf5', borderRadius: 14, padding: '18px 20px', marginBottom: 14, border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' };

  return (
    <DesktopLayout title="הוספת לקוח" backHref="/contacts" backLabel="חזרה ללקוחות">
      <div style={{ maxWidth: 580 }}>

        {/* בחירת פרויקט — רק לפעיל ששייך ליותר מפרויקט אחד */}
        {multiProject && (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>לאיזה פרויקט שייך הלקוח?</div>
            <p style={{ fontSize: 12, color: '#bbb', marginBottom: 14, fontWeight: 400 }}>ניתן לבחור את שניהם — אם הלקוח שייך לשני הפרויקטים ייווצרו שני רישומים נפרדים</p>
            {errors.projects && <span className="error-msg" style={{ display: 'block', marginBottom: 10 }}>{errors.projects}</span>}
            <div style={{ display: 'flex', gap: 12 }}>
              {(currentUser?.project_ids || []).map(pid => (
                <label key={pid} style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  padding: '10px 16px', borderRadius: 12, flex: 1, justifyContent: 'center',
                  border: `1.5px solid ${selectedProjectIds.includes(pid) ? '#6c5ce7' : '#e8e8e8'}`,
                  background: selectedProjectIds.includes(pid) ? '#f0effe' : '#fafafa',
                  fontWeight: selectedProjectIds.includes(pid) ? 700 : 400,
                  color: selectedProjectIds.includes(pid) ? '#6c5ce7' : '#555',
                  transition: 'all 0.18s ease',
                }}>
                  <input type="checkbox" checked={selectedProjectIds.includes(pid)}
                    onChange={() => toggleProject(pid)} style={{ display: 'none' }} />
                  {PROJECT_META[pid]?.name ?? `פרויקט ${pid}`}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* פרטים אישיים */}
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>פרטים אישיים</div>

          <label className="form-label">שם מלא <span style={{ color: '#e24b4a' }}>*</span></label>
          <input className={`form-input ${errors.name ? 'form-error' : ''}`}
            placeholder="שם ושם משפחה" value={form.name} onChange={e => set('name', e.target.value)}
            style={{ marginBottom: errors.name ? 4 : 14 }} />
          {errors.name && <span className="error-msg" style={{ marginBottom: 10, display: 'block' }}>{errors.name}</span>}

          <label className="form-label">טלפון <span style={{ color: '#e24b4a' }}>*</span></label>
          <input className={`form-input ${errors.phone ? 'form-error' : ''}`}
            placeholder="050-0000000" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
            style={{ marginBottom: errors.phone ? 4 : 14 }} />
          {errors.phone && <span className="error-msg" style={{ marginBottom: 10, display: 'block' }}>{errors.phone}</span>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="form-label">גיל</label>
              <input className="form-input" type="number" min="1" max="120"
                placeholder="גיל" value={form.age} onChange={e => set('age', e.target.value)} />
            </div>
            <div>
              <label className="form-label">עיסוק מקצועי <span style={{ color: '#e24b4a' }}>*</span></label>
              <input className={`form-input ${errors.profession ? 'form-error' : ''}`}
                placeholder="מורה, רופא, עצמאי..." value={form.profession} onChange={e => set('profession', e.target.value)} />
              {errors.profession && <span className="error-msg">{errors.profession}</span>}
            </div>
          </div>

          <label className="form-label">יישוב <span style={{ color: '#e24b4a' }}>*</span></label>
          <input className={`form-input ${errors.city ? 'form-error' : ''}`}
            placeholder="שם היישוב" value={form.city} onChange={e => set('city', e.target.value)}
            style={{ marginBottom: errors.city ? 4 : 0 }} />
          {errors.city && <span className="error-msg">{errors.city}</span>}
        </div>

        {/* מגדר */}
        <div style={cardStyle}>
          <label className="form-label">מגדר</label>
          <div style={{ display: 'flex', gap: 12 }}>
            {[{ value: 'male', label: '👨 איש' }, { value: 'female', label: '👩 אשה' }].map(({ value, label }) => (
              <label key={value} style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                padding: '10px 16px', borderRadius: 12, flex: 1, justifyContent: 'center',
                border: `1.5px solid ${form.gender === value ? '#6c5ce7' : '#e8e8e8'}`,
                background: form.gender === value ? '#f0effe' : '#fafafa',
                fontWeight: form.gender === value ? 700 : 400,
                color: form.gender === value ? '#6c5ce7' : '#555',
                transition: 'all 0.18s ease',
              }}>
                <input type="radio" name="gender" value={value} checked={form.gender === value}
                  onChange={() => set('gender', value)} style={{ display: 'none' }} />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* מקור — כרטיס אחד לכל פרויקט שנבחר */}
        {selectedProjectIds.map(pid => {
          const meta = PROJECT_META[pid];
          if (!meta) return null;
          const sf = sourceByProject[pid] || EMPTY_SOURCE;
          const isAchdut = pid === 1;
          const isNaim   = pid === 2;
          return (
            <div key={pid} style={cardStyle}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>
                מקור הלקוח{multiProject ? ` — ${meta.name}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 12, marginBottom: sf.source === 'external' ? 14 : 18 }}>
                {meta.sourceOptions.map(({ value, label }) => (
                  <label key={value} style={{
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    padding: '10px 16px', borderRadius: 12, flex: 1, justifyContent: 'center',
                    border: `1.5px solid ${sf.source === value ? '#6c5ce7' : '#e8e8e8'}`,
                    background: sf.source === value ? '#f0effe' : '#fafafa',
                    fontWeight: sf.source === value ? 700 : 400,
                    color: sf.source === value ? '#6c5ce7' : '#555',
                    transition: 'all 0.18s ease', fontSize: 13,
                  }}>
                    <input type="radio" name={`source_${pid}`} value={value} checked={sf.source === value}
                      onChange={() => setSourceField(pid, 'source', value)} style={{ display: 'none' }} />
                    {label}
                  </label>
                ))}
              </div>

              {isAchdut && sf.source !== 'external' && (
                <>
                  <label className="form-label">יישוב בית המפגש <span style={{ color: '#e24b4a' }}>*</span></label>
                  <input className={`form-input ${errors['1_meeting_place_city'] ? 'form-error' : ''}`}
                    placeholder="שם היישוב" value={sf.meeting_place_city} onChange={e => setSourceField(1, 'meeting_place_city', e.target.value)}
                    style={{ marginBottom: errors['1_meeting_place_city'] ? 4 : 14 }} />
                  {errors['1_meeting_place_city'] && <span className="error-msg" style={{ marginBottom: 10, display: 'block' }}>{errors['1_meeting_place_city']}</span>}

                  <label className="form-label">מספר בית המפגש <span style={{ color: '#e24b4a' }}>*</span></label>
                  <input className={`form-input ${errors['1_meeting_place_number'] ? 'form-error' : ''}`}
                    placeholder="מספר" value={sf.meeting_place_number} onChange={e => setSourceField(1, 'meeting_place_number', e.target.value)} />
                  {errors['1_meeting_place_number'] && <span className="error-msg">{errors['1_meeting_place_number']}</span>}
                </>
              )}

              {isNaim && sf.source !== 'external' && (
                <>
                  <label className="form-label">הסיור שדרכו הגיע הלקוח <span style={{ color: '#e24b4a' }}>*</span></label>
                  <select className={`form-input ${errors['2_tour_id'] ? 'form-error' : ''}`} value={sf.tour_id}
                    onChange={e => setSourceField(2, 'tour_id', e.target.value)} style={{ width: '100%', fontFamily: 'inherit' }}>
                    <option value="">בחר סיור…</option>
                    {tourOptions.map(t => (
                      <option key={t.id} value={t.id}>סיור {t.tourNumber} · {t.settlement}{t.date ? ` · ${t.date.split('-').reverse().join('/')}` : ''}</option>
                    ))}
                  </select>
                  {errors['2_tour_id'] && <span className="error-msg" style={{ display: 'block', marginTop: 4 }}>{errors['2_tour_id']}</span>}
                </>
              )}

              {sf.source === 'external' && (
                <div style={{ background: '#f2fbf4', border: '0.5px solid rgba(39,174,96,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#1f7a45', marginBottom: (isNaim || (isAchdut && sf.source === 'external')) ? 14 : 0 }}>
                  {meta.bonusText}
                </div>
              )}

              {/* "מאיפה הכרנו" — אחדות: רק כשמחוץ לבית מפגש. נעים להכיר: תמיד (בנוסף לסיור/בונוס) */}
              {(isNaim || (isAchdut && sf.source === 'external')) && (
                <>
                  <label className="form-label">מאיפה הכרנו?</label>
                  <input className="form-input" placeholder="ספר בחופשיות..."
                    value={sf.how_met} onChange={e => setSourceField(pid, 'how_met', e.target.value)} />
                </>
              )}
            </div>
          );
        })}

        {/* סרגל מצוות — כל הערכים מאותחלים אוטומטית ל-0; ניתן לשמור בלי לגעת בהם */}
        {form.gender && (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              {form.gender === 'male' ? '🧔 סרגל מצוות — איש' : '👩 סרגל מצוות — אשה'}
            </div>
            <p style={{ fontSize: 12, color: '#bbb', marginBottom: 14, fontWeight: 400 }}>רמה 0–4 לכל מצווה — ברירת מחדל 0, אין חובה לשנות</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mitzvotList.map(mitz => (
                <div key={mitz} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#333' }}>{mitz}</span>
                  <select value={form.mitzvot[mitz] ?? 0} onChange={e => setMitzvah(mitz, Number(e.target.value))}
                    style={{ width: 100, padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${form.mitzvot[mitz] > 0 ? '#6c5ce7' : '#e8e8e8'}`, fontSize: 13, background: form.mitzvot[mitz] > 0 ? '#f0effe' : '#fafafa', color: form.mitzvot[mitz] > 0 ? '#6c5ce7' : '#999', fontFamily: 'Rubik, sans-serif', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
                    {CONFIG.mitzvotLevels.map(l => <option key={l} value={l}>רמה {l}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* הערות */}
        <div style={cardStyle}>
          <label className="form-label">הערות</label>
          <textarea className="form-textarea" rows={3} placeholder="הערות חופשיות..."
            value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <Link href="/contacts" className="btn" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}>ביטול</Link>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit} disabled={busy}>{busy ? 'שומר…' : 'שמור לקוח'}</button>
        </div>
      </div>

      {/* אישור למרות חשד לכפילות — מונע בונוס כפול על לקוח שכבר קיים במערכת */}
      {confirmDuplicate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => !busy && setConfirmDuplicate(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#b06b00', marginBottom: 10 }}>⚠️ ייתכן שהלקוח כבר קיים</div>
            <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 18 }}>
              נמצא במערכת לקוח קיים עם אותו מספר טלפון{confirmDuplicate.length > 1 ? ' בשני הפרויקטים' : ''}.
              אם זה אכן אותו לקוח, סמן אותו כ"הגיע מבית מפגש/סיור" במקום "מחוץ" — כדי למנוע בונוס כפול על אותו לקוח.
              אם מדובר בלקוח חדש ושונה (למשל טלפון משפחתי משותף), אפשר להמשיך.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setConfirmDuplicate(null)} disabled={busy}>ביטול</button>
              <button className="btn btn-primary" style={{ flex: 2, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => { setConfirmDuplicate(null); doSubmit(); }} disabled={busy}>
                {busy ? 'שומר…' : 'זה בכל זאת לקוח חדש — המשך'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}
