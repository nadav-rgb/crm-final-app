// pages/meeting-houses/completed.jsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import DesktopLayout from '../../components/DesktopLayout';
import { useAuth } from '../../lib/AuthStore';
import { useCrm } from '../../lib/CrmStore';
import { getMeetingHouses } from '../../lib/meetingHousesStorage';
import { fetchMeetingHousesFromSupabase } from '../../lib/meetingHousesSupabase';
import { generateMeetingNotesAiSummaryDemo, summarizeBaseMeetingDemo } from '../../lib/aiDemo';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('he-IL');
}

export default function CompletedMeetingHousesPage() {
  const { can } = useAuth();
  const { baseMeetings, activists } = useCrm();
  const [houses, setHouses] = useState([]);
  const [selectedHouse, setSelectedHouse] = useState(null);

  // שם פעיל מתוך הרשימה החיה (activist_directory) — לא מנתונים סטטיים.
  const activistName = (id) => activists.find(a => Number(a.id) === Number(id))?.name || `פעיל ${id}`;

  // מקור אמת: Supabase. בתי מפגש דמו ישנים מ-localStorage כ-fallback בלבד (זהה ל-index.jsx).
  useEffect(() => {
    let active = true;
    (async () => {
      const remote = await fetchMeetingHousesFromSupabase();
      const local = getMeetingHouses();
      const remoteIds = new Set(remote.map(h => String(h.id)));
      const merged = [...remote, ...local.filter(h => !remoteIds.has(String(h.id)))];
      if (active) setHouses(merged.filter(h => h.status === 'completed'));
    })();
    return () => { active = false; };
  }, [activists]);

  if (!can.seeMeetingHouses) {
    return (
      <DesktopLayout title="בתי מפגש שהסתיימו">
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div>אין הרשאה לדף זה</div>
        </div>
      </DesktopLayout>
    );
  }

  return (
    <DesktopLayout
      title="בתי מפגש שהסתיימו"
      subtitle={`${houses.length} בתי מפגש שהשלימו את כל 4 המפגשים · אחדות יהודית`}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {houses.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14 }}>
            אין בתי מפגש שהסתיימו · <Link href="/meeting-houses" style={{ color: '#6c5ce7' }}>לבתי מפגש חדשים</Link>
          </div>
        ) : houses.map(house => (
          <CompletedCard key={house.id} house={house} onView={() => setSelectedHouse(house)} activistName={activistName} />
        ))}
      </div>

      {selectedHouse && (
        <CompletedDetailModal
          house={selectedHouse}
          baseMeetings={baseMeetings}
          activistName={activistName}
          onClose={() => setSelectedHouse(null)}
        />
      )}
    </DesktopLayout>
  );
}

function CompletedCard({ house, onView, activistName }) {
  const assignedNames = (house.assignedActivists || []).map(activistName).join(', ');
  const firstDate = house.meetings?.[0]?.date;
  const lastDate  = house.meetings?.[3]?.date;

  return (
    <div
      style={{
        background: '#fff', borderRadius: 16, padding: 18,
        border: '0.5px solid rgba(0,0,0,0.07)', borderRight: '3px solid #27ae60',
        boxShadow: '0 1px 5px rgba(0,0,0,0.04)', cursor: 'pointer',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
      }}
      onClick={onView}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.09)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 5px rgba(0,0,0,0.04)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#2d1f5e' }}>בית מפגש {house.houseNumber}</div>
          <div style={{ fontSize: 12, color: '#a08060', marginTop: 3 }}>📍 {house.settlement || house.city}</div>
        </div>
        <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: '#edfaf1', color: '#27ae60', fontWeight: 700 }}>✓ הסתיים</span>
      </div>

      <div style={{ fontSize: 12, color: '#666', lineHeight: 1.8, marginBottom: 10 }}>
        <div><span style={{ color: '#aaa' }}>מנחה: </span>{house.facilitatorName || '—'}</div>
        <div><span style={{ color: '#aaa' }}>מארח: </span>{house.hostName || '—'}</div>
        {assignedNames && <div><span style={{ color: '#aaa' }}>פעיל: </span>{assignedNames}</div>}
        <div><span style={{ color: '#aaa' }}>תקופה: </span>{formatDate(firstDate)} – {formatDate(lastDate)}</div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[1, 2, 3, 4].map(n => (
          <div key={n} style={{ flex: 1, height: 6, borderRadius: 4, background: '#27ae60' }} />
        ))}
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, color: '#6c5ce7', fontWeight: 600 }}>לחץ לפרטים מלאים →</div>
    </div>
  );
}

function MeetingRow({ meeting, report }) {
  const [showAi, setShowAi] = useState(false);
  const hasAi = Boolean(report?.answers);

  return (
    <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '12px 14px', border: '0.5px solid rgba(39,174,96,0.15)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#2d1f5e' }}>מפגש {meeting.meetingNumber}</span>
        <span style={{ fontSize: 12, color: '#27ae60', fontWeight: 600 }}>✓ {formatDate(meeting.date)} · {meeting.startTime || '—'}</span>
      </div>

      {report?.participant_count !== undefined && (
        <div style={{ fontSize: 12, color: '#27ae60', fontWeight: 600, marginBottom: 4 }}>
          👥 {report.participant_count} משתתפים
        </div>
      )}

      {meeting.notes && (
        <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, marginBottom: hasAi ? 8 : 0 }}>{meeting.notes}</div>
      )}

      {hasAi && (
        <>
          <button
            onClick={() => setShowAi(v => !v)}
            style={{ border: 'none', borderRadius: 8, padding: '5px 10px', background: '#f0effe', color: '#6c5ce7', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, marginTop: 4 }}
          >
            {showAi ? 'סגור סיכום' : '✨ סיכום למפגש'}
          </button>
          {showAi && (
            <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', background: '#fffaf5', border: '0.5px solid #eee', borderRadius: 10, padding: '10px 12px', fontFamily: 'inherit', fontSize: 12, color: '#333', lineHeight: 1.7 }}>
              {summarizeBaseMeetingDemo(report.answers, report)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function CompletedDetailModal({ house, baseMeetings, onClose, activistName }) {
  const aiSummary = generateMeetingNotesAiSummaryDemo(house);
  const assignedNames = (house.assignedActivists || []).map(activistName).join(', ');

  function getReportForMeeting(meetingNumber) {
    return baseMeetings.find(r =>
      (String(r.house_id) === String(house.id) || r.meeting_place_number === house.houseNumber) &&
      Number(r.meeting_number) === Number(meetingNumber) &&
      r.submitted
    ) || null;
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 20, padding: 28, maxWidth: 640, width: '100%', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#2d1f5e' }}>בית מפגש {house.houseNumber}</div>
            <div style={{ fontSize: 13, color: '#27ae60', fontWeight: 600, marginTop: 3 }}>✓ הסתיים · 📍 {house.settlement || house.city}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#bbb', padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {/* Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'מנחה',          value: house.facilitatorName },
            { label: 'מארח',          value: house.hostName },
            { label: 'פעיל',          value: assignedNames || '—' },
            { label: 'מספר מפגשים',   value: '4/4' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: '#f8f7ff', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#2d1f5e' }}>{value || '—'}</div>
            </div>
          ))}
        </div>

        {/* Meeting history with participant count + per-meeting AI */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 10 }}>
          היסטוריית מפגשים
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
          {house.meetings.map(m => (
            <MeetingRow key={m.meetingNumber} meeting={m} report={getReportForMeeting(m.meetingNumber)} />
          ))}
        </div>

        {/* Full AI Summary */}
        <div style={{ background: '#f8f7ff', border: '0.5px solid rgba(108,92,231,0.2)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#6c5ce7', marginBottom: 10 }}>✨ סיכום לכל הסדרה</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12, color: '#333', lineHeight: 1.75, margin: 0 }}>
            {aiSummary || 'לא הוזנו הערות למפגשים.'}
          </pre>
        </div>

        {/* Link to full detail page */}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link href={`/meeting-houses/${house.id}`} style={{ color: '#6c5ce7', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
            לדף הבית מפגש המלא →
          </Link>
        </div>
      </div>
    </div>
  );
}
