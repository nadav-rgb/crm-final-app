// pages/meeting-houses/index.jsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import DesktopLayout from '../../components/DesktopLayout';
import { useAuth } from '../../lib/AuthStore';
import { getMeetingHouses, importExternalMeetingHousesDemo } from '../../lib/meetingHousesStorage';
import activists from '../../data/activists';

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('he-IL');
}

function getActivistNames(ids) {
  if (!ids?.length) return 'עדיין לא שובצו פעילים';
  return ids.map(id => activists.find(a => a.id === id)?.name).filter(Boolean).join(', ');
}

function getFirstMeeting(house) {
  return house.meetings?.find(m => m.meetingNumber === 1) || house.meetings?.[0] || null;
}

export default function MeetingHousesPage() {
  const { can } = useAuth();
  const [houses, setHouses] = useState([]);
  const [importMessage, setImportMessage] = useState('');

  useEffect(() => {
    setHouses(getMeetingHouses());
  }, []);

  function handleExternalImport() {
    const imported = importExternalMeetingHousesDemo();
    setHouses(getMeetingHouses());
    setImportMessage('יובאו ' + imported.length + ' בתי מפגש מדמו חיצוני. בעתיד הפעולה הזו תוחלף בסנכרון מ-Google Sheets / Forms.');
  }

  if (!can.seeMeetingHouses) {
    return (
      <DesktopLayout title="בתי מפגש" subtitle="אחדות עכשיו">
        <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>
          <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
          <div>אין הרשאה לדף זה</div>
        </div>
      </DesktopLayout>
    );
  }

  return (
    <DesktopLayout
      title="בתי מפגש"
      subtitle="אחדות עכשיו · ניהול בתי מפגש ושיבוץ פעילים"
      actions={(
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={handleExternalImport} style={{ border:'0.5px solid rgba(108,92,231,0.35)', borderRadius:10, padding:'9px 15px', fontFamily:'inherit', fontWeight:800, cursor:'pointer', background:'#fff', color:'#6c5ce7' }}>
            ייבא נתונים חיצוניים דמו
          </button>
          <Link href="/meeting-houses/new" style={{ textDecoration:'none' }}>
            <button style={{ border:'none', borderRadius:10, padding:'9px 15px', fontFamily:'inherit', fontWeight:800, cursor:'pointer', background:'#6c5ce7', color:'#fff' }}>
              הוסף בית מפגש
            </button>
          </Link>
        </div>
      )}
    >
      <div style={{ marginBottom:18, background:'#fffaf5', border:'0.5px solid rgba(0,0,0,0.07)', borderRadius:14, padding:'14px 18px', color:'#6b5a49', fontSize:13, lineHeight:1.7 }}>
        בשלב זה אפשר להזין בית מפגש ידנית בתוך המערכת, או ללחוץ על ייבוא דמו כדי לראות כיצד נתונים שמוקלדים בעתיד ב־Google Sheets / Google Forms ייכנסו אוטומטית לאותו מודול.
        <div style={{ marginTop:8, color:'#8a6b4f' }}>
          המבנה האחיד כולל: יישוב, מספר בית מפגש, מארח, מנחה, ארבעה תאריכים ושעת התחלה לכל מפגש.
        </div>
      </div>

      {importMessage && (
        <div style={{ marginBottom:16, background:'#eefaf2', border:'0.5px solid rgba(22,120,65,0.15)', borderRadius:12, padding:'12px 16px', color:'#1f7a45', fontSize:13, fontWeight:700 }}>
          {importMessage}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:14 }}>
        {houses.map(house => {
          const firstMeeting = getFirstMeeting(house);
          return (
            <Link key={house.id} href={`/meeting-houses/${house.id}`} style={{ textDecoration:'none' }}>
              <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:16, padding:18, minHeight:220, boxShadow:'0 1px 5px rgba(0,0,0,0.04)', cursor:'pointer' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'flex-start', marginBottom:10 }}>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:'#2d1f5e' }}>בית מפגש {house.houseNumber}</div>
                    <div style={{ fontSize:13, color:'#a08060', marginTop:4 }}>{house.settlement || house.city}</div>
                  </div>
                  <span style={{ fontSize:11, padding:'4px 9px', borderRadius:999, background: house.source === 'external-demo' ? '#e9f8ef' : '#f0effe', color: house.source === 'external-demo' ? '#1f7a45' : '#6c5ce7', fontWeight:700, whiteSpace:'nowrap' }}>{house.source === 'external-demo' ? 'יובא חיצונית' : house.status}</span>
                </div>

                <div style={{ fontSize:13, color:'#555', lineHeight:1.9 }}>
                  <div><b>מארח:</b> {house.hostName}</div>
                  <div><b>מנחה:</b> {house.facilitatorName}</div>
                  <div><b>מפגש ראשון:</b> {formatDate(firstMeeting?.date)} · {firstMeeting?.startTime || '—'}</div>
                  <div><b>מספר מפגשים:</b> {house.meetings?.length || 4}</div>
                </div>

                <div style={{ marginTop:14, paddingTop:12, borderTop:'0.5px solid #f0f0f0', fontSize:12, color:'#777', lineHeight:1.6 }}>
                  <b>פעילים משובצים:</b><br />
                  {getActivistNames(house.assignedActivists)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </DesktopLayout>
  );
}
