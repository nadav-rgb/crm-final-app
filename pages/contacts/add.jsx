// pages/contacts/add.jsx
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../../data/config';
import { useCrm } from '../../lib/CrmStore';
import { useAuth } from '../../lib/AuthStore';
import DesktopLayout from '../../components/DesktopLayout';

const TODAY = new Date().toISOString().split('T')[0];

const EMPTY = {
  name: '', phone: '', city: '', gender: '',
  age: '', profession: '', how_met: '', notes: '',
  next_action: '', next_action_date: '',
  meeting_place_city: '', meeting_place_number: '',
  mitzvot: {},
};

export default function AddContactPage() {
  const router = useRouter();
  const { activeProject, currentUser, can } = useAuth();
  const { addContact } = useCrm();
  const [form,   setForm]   = useState(EMPTY);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (currentUser && !can.addContact) router.replace('/contacts');
  }, [currentUser?.role]);

  if (currentUser && !can.addContact) return null;

  const isAchdut  = activeProject?.id === 2;
  const mitzvotList = form.gender === 'male'   ? CONFIG.mitzvotMale
                    : form.gender === 'female' ? CONFIG.mitzvotFemale
                    : [];

  function set(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'gender') next.mitzvot = {};
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
    if (isAchdut) {
      if (!form.meeting_place_city.trim())   e.meeting_place_city   = 'יישוב בית המפגש חובה';
      if (!form.meeting_place_number.trim()) e.meeting_place_number = 'מספר בית המפגש חובה';
    }
    if (form.gender && mitzvotList.length > 0) {
      const incomplete = mitzvotList.some(mitz => form.mitzvot[mitz] === undefined || form.mitzvot[mitz] === '');
      if (incomplete) e.mitzvot = 'יש למלא את כל שדות סרגל המצוות';
    }
    return e;
  }

  function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    const houseNumber = form.meeting_place_number.trim();
    const houseCity   = form.meeting_place_city.trim();
    addContact({
      ...form,
      activist_id: currentUser.id,
      project_id:  activeProject?.id,
      days_since_last_contact: 0,
      last_interaction_date:   TODAY,
      joined_at:               TODAY,
      ...(isAchdut ? {
        meetingHouseNumber: houseNumber,
        meetingHouseCity:   houseCity,
        meetingHouseKey:    `${houseNumber}_${houseCity}`,
      } : {}),
    });
    router.push('/contacts');
  }

  const cardStyle = { background: '#fffaf5', borderRadius: 14, padding: '18px 20px', marginBottom: 14, border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' };

  return (
    <DesktopLayout title="הוספת לקוח" backHref="/contacts" backLabel="← חזרה ללקוחות">
      <div style={{ maxWidth: 580 }}>

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

        {/* מקור */}
        <div style={cardStyle}>
          {isAchdut ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>בית מפגש</div>
              <label className="form-label">יישוב בית המפגש <span style={{ color: '#e24b4a' }}>*</span></label>
              <input className={`form-input ${errors.meeting_place_city ? 'form-error' : ''}`}
                placeholder="שם היישוב" value={form.meeting_place_city} onChange={e => set('meeting_place_city', e.target.value)}
                style={{ marginBottom: errors.meeting_place_city ? 4 : 14 }} />
              {errors.meeting_place_city && <span className="error-msg" style={{ marginBottom: 10, display: 'block' }}>{errors.meeting_place_city}</span>}

              <label className="form-label">מספר בית המפגש <span style={{ color: '#e24b4a' }}>*</span></label>
              <input className={`form-input ${errors.meeting_place_number ? 'form-error' : ''}`}
                placeholder="מספר" value={form.meeting_place_number} onChange={e => set('meeting_place_number', e.target.value)} />
              {errors.meeting_place_number && <span className="error-msg">{errors.meeting_place_number}</span>}
            </>
          ) : (
            <>
              <label className="form-label">מאיפה הכרנו?</label>
              <input className="form-input" placeholder="ספר בחופשיות..."
                value={form.how_met} onChange={e => set('how_met', e.target.value)} />
            </>
          )}
        </div>

        {/* סרגל מצוות */}
        {form.gender && (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              {form.gender === 'male' ? '🧔 סרגל מצוות — איש' : '👩 סרגל מצוות — אשה'}
            </div>
            <p style={{ fontSize: 12, color: '#bbb', marginBottom: 14, fontWeight: 400 }}>רמה 0–4 לכל מצווה <span style={{ color: '#e24b4a' }}>*</span></p>
            {errors.mitzvot && <span className="error-msg" style={{ display: 'block', marginBottom: 10 }}>{errors.mitzvot}</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mitzvotList.map(mitz => (
                <div key={mitz} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#333' }}>{mitz}</span>
                  <select value={form.mitzvot[mitz] ?? ''} onChange={e => { setMitzvah(mitz, e.target.value !== '' ? Number(e.target.value) : ''); setErrors(prev => ({ ...prev, mitzvot: undefined })); }}
                    style={{ width: 100, padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${form.mitzvot[mitz] === '' || form.mitzvot[mitz] === undefined ? (errors.mitzvot ? '#e24b4a' : '#e8e8e8') : '#6c5ce7'}`, fontSize: 13, background: (form.mitzvot[mitz] !== '' && form.mitzvot[mitz] !== undefined) ? '#f0effe' : '#fafafa', color: (form.mitzvot[mitz] !== '' && form.mitzvot[mitz] !== undefined) ? '#6c5ce7' : '#999', fontFamily: 'Rubik, sans-serif' }}>
                    <option value="">—</option>
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

        {/* פעולה הבאה */}
        <div style={cardStyle}>
          <label className="form-label">פעולה הבאה</label>
          <input className="form-input" placeholder="תיאור הפעולה..."
            value={form.next_action} onChange={e => set('next_action', e.target.value)}
            style={{ marginBottom: form.next_action ? 12 : 0 }} />
          {form.next_action && (
            <>
              <label className="form-label">תאריך יעד</label>
              <input type="date" className="form-input" min={TODAY}
                value={form.next_action_date} onChange={e => set('next_action_date', e.target.value)} />
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <Link href="/contacts" className="btn" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}>ביטול</Link>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit}>שמור לקוח</button>
        </div>
      </div>
    </DesktopLayout>
  );
}
