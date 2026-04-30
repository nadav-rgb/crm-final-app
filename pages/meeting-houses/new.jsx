// pages/meeting-houses/new.jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../../components/DesktopLayout';
import { useAuth } from '../../lib/AuthStore';
import { saveManualMeetingHouse } from '../../lib/meetingHousesStorage';

const emptyMeetings = [1, 2, 3, 4].map(num => ({ meetingNumber: num, date: '', startTime: '' }));

export default function NewMeetingHousePage() {
  const router = useRouter();
  const { can } = useAuth();
  const [form, setForm] = useState({
    settlement: '',
    houseNumber: '',
    hostName: '',
    facilitatorName: '',
    status: 'פתוח לשיבוץ',
    meetings: emptyMeetings,
  });
  const [error, setError] = useState('');

  if (!can.seeMeetingHouses) {
    return (
      <DesktopLayout title="הוספת בית מפגש" subtitle="אחדות עכשיו">
        <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>
          <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
          <div>אין הרשאה לדף זה</div>
        </div>
      </DesktopLayout>
    );
  }

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function setMeeting(index, field, value) {
    setForm(prev => ({
      ...prev,
      meetings: prev.meetings.map((meeting, i) => i === index ? { ...meeting, [field]: value } : meeting),
    }));
  }

  function validate() {
    if (!form.settlement.trim()) return 'חובה להזין שם יישוב';
    if (!form.houseNumber.trim()) return 'חובה להזין מספר בית מפגש';
    if (!form.hostName.trim()) return 'חובה להזין שם מארח';
    if (!form.facilitatorName.trim()) return 'חובה להזין שם מנחה';
    const missingMeeting = form.meetings.find(m => !m.date || !m.startTime);
    if (missingMeeting) return `חובה להזין תאריך ושעה למפגש ${missingMeeting.meetingNumber}`;
    return '';
  }

  function handleSubmit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const saved = saveManualMeetingHouse({
      ...form,
      city: form.settlement,
      startDate: form.meetings[0]?.date || '',
      assignedActivists: [],
    });

    if (!saved) {
      setError('לא ניתן לשמור כרגע. נסה לרענן את הדף.');
      return;
    }

    router.push(`/meeting-houses/${saved.id}`);
  }

  return (
    <DesktopLayout title="הוספת בית מפגש" subtitle="אחדות עכשיו · הזנה ידנית לפי המבנה העתידי" backHref="/meeting-houses" backLabel="חזרה לבתי מפגש">
      <form onSubmit={handleSubmit} style={{ maxWidth:900, background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:16, padding:22 }}>
        <div style={{ marginBottom:18, color:'#666', fontSize:13, lineHeight:1.7 }}>
          כאן מזינים ידנית את אותם שדות שבעתיד יוכלו להגיע אוטומטית מטבלת Google Sheets, מטופס Google Forms או ממקור חיצוני אחר.
        </div>

        {error && (
          <div style={{ marginBottom:16, padding:'10px 12px', borderRadius:10, background:'#fff1f1', color:'#a32d2d', fontSize:13, fontWeight:700 }}>
            {error}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(220px,1fr))', gap:14, marginBottom:20 }}>
          <Field label="שם היישוב" value={form.settlement} onChange={value => setField('settlement', value)} placeholder="לדוגמה: ירושלים" />
          <Field label="מספר בית מפגש" value={form.houseNumber} onChange={value => setField('houseNumber', value)} placeholder="לדוגמה: AJ-104" />
          <Field label="שם המארח" value={form.hostName} onChange={value => setField('hostName', value)} placeholder="לדוגמה: משפחת לוי" />
          <Field label="שם המנחה" value={form.facilitatorName} onChange={value => setField('facilitatorName', value)} placeholder="לדוגמה: הרב ישראל כהן" />
        </div>

        <div style={{ fontSize:16, fontWeight:800, color:'#2d1f5e', marginBottom:12 }}>ארבעת מפגשי הבסיס</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:22 }}>
          {form.meetings.map((meeting, index) => (
            <div key={meeting.meetingNumber} style={{ display:'grid', gridTemplateColumns:'90px minmax(160px,1fr) minmax(140px,1fr)', gap:10, alignItems:'end', padding:12, border:'0.5px solid #eee', borderRadius:12, background:'#fafafa' }}>
              <div style={{ fontSize:13, fontWeight:800, color:'#333', paddingBottom:10 }}>מפגש {meeting.meetingNumber}</div>
              <SmallField label="תאריך" type="date" value={meeting.date} onChange={value => setMeeting(index, 'date', value)} />
              <SmallField label="שעת התחלה" type="time" value={meeting.startTime} onChange={value => setMeeting(index, 'startTime', value)} />
            </div>
          ))}
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center' }}>
          <div style={{ fontSize:12, color:'#999', lineHeight:1.6 }}>
            לאחר השמירה ניתן להיכנס לבית המפגש ולשבץ אליו פעיל.
          </div>
          <button type="submit" style={{ border:'none', borderRadius:10, padding:'11px 18px', fontFamily:'inherit', fontWeight:800, cursor:'pointer', background:'#6c5ce7', color:'#fff' }}>
            שמור בית מפגש
          </button>
        </div>
      </form>
    </DesktopLayout>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display:'flex', flexDirection:'column', gap:6, fontSize:13, color:'#555', fontWeight:700 }}>
      {label}
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ border:'1.5px solid #e8e8e8', borderRadius:10, padding:'10px 12px', fontFamily:'inherit', fontSize:13 }} />
    </label>
  );
}

function SmallField({ label, type, value, onChange }) {
  return (
    <label style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12, color:'#666', fontWeight:700 }}>
      {label}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} style={{ border:'1.5px solid #e8e8e8', borderRadius:10, padding:'9px 10px', fontFamily:'inherit', fontSize:13 }} />
    </label>
  );
}
