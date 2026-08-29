// pages/meeting-houses/index.jsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import DesktopLayout from '../../components/DesktopLayout';
import { useAuth } from '../../lib/AuthStore';
import { fetchMeetingHousesFromSupabase, updateAssignmentsApi, sendAssignmentPushApi } from '../../lib/meetingHousesSupabase';
import { useCrm } from '../../lib/CrmStore';
import { inProject } from '../../lib/projectUtils';

const STATUS_LABELS = {
  upcoming: { label: 'לפני תחילה', color: '#6c5ce7', bg: '#f0effe' },
  active:   { label: 'פעיל',        color: '#27ae60', bg: '#edfaf1' },
  completed:{ label: 'הסתיים',      color: '#aaa',    bg: '#f5f5f5' },
};

export default function MeetingHousesPage() {
  const { can, currentUser, apiFetch } = useAuth();
  const { activists } = useCrm();

  // ניהול בתי מפגש (יצירה/ייבוא) — רק רכז/הנהלה שחברים באחדות יהודית (או מנכ"ל).
  // רכזת נעים-להכיר רואה אך לא פותחת כאן.
  const canManage = can.seeMeetingHouses && (currentUser?.role === 'ceo' || inProject(currentUser, 1));
  const [houses, setHouses] = useState([]);
  const [loadError, setLoadError] = useState('');

  // מקור הפעילים האמיתי — activist_directory (דרך useCrm).
  // בתי מפגש = אחדות יהודית → רק פעילים החברים בפרויקט 1 (כולל דו-פרויקטליים).
  const activistPool = activists.filter(a => a.role === 'activist' && inProject(a, 1));

  async function loadHouses() {
    return fetchMeetingHousesFromSupabase(apiFetch);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const authorized = await loadHouses();
        if (active) {
          setHouses(authorized);
          setLoadError('');
        }
      } catch {
        if (active) {
          setHouses([]);
          setLoadError('טעינת בתי המפגש נכשלה. לא מוצגים נתוני דמו.');
        }
      }
    })();
    return () => { active = false; };
  }, [currentUser]);

  const activeHouses = houses.filter(h => {
    if (h.status === 'completed') return false;
    if (currentUser?.role === 'activist') {
      const uid = String(currentUser.userId ?? '');
      return (h.assignedActivists ?? []).some(a => String(a) === uid) ||
             String(h.assignedActivistId ?? '') === uid;
    }
    return true;
  });

  async function handleAssign(houseId, activistId) {
    const activist = activistPool.find(a => String(a.id) === String(activistId));
    if (!activist?.userId) return;
    const updated = await updateAssignmentsApi(apiFetch, houseId, [activist.userId]);
    if (!updated) return;
    setHouses(await loadHouses());
    if (!activist) return;

    // Push אמיתי לטלפון של הפעיל (no-op בטוח אם לא נרשם להתראות).
    sendAssignmentPushApi(apiFetch, { houseId }).catch(() => {});
  }

  if (!can.seeMeetingHouses && currentUser?.role !== 'activist') {
    return (
      <DesktopLayout title="בתי מפגש חדשים">
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div>אין הרשאה לדף זה</div>
        </div>
      </DesktopLayout>
    );
  }

  return (
    <DesktopLayout
      title="בתי מפגש חדשים"
      subtitle={`${activeHouses.length} בתי מפגש פעילים · אחדות יהודית`}
      actions={canManage ? (
        <Link href="/meeting-houses/new" style={{ textDecoration: 'none' }}>
          <button style={{ border: 'none', borderRadius: 10, padding: '9px 15px', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer', background: '#6c5ce7', color: '#fff', fontSize: 13 }}>
            + הוסף בית מפגש
          </button>
        </Link>
      ) : undefined}
    >
      {loadError && <div role="alert" style={{ marginBottom:14, color:'#a63230', background:'#fff1f1', borderRadius:12, padding:'10px 14px', fontWeight:700 }}>{loadError}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {activeHouses.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14 }}>
            אין בתי מפגש פעילים · <Link href="/meeting-houses/completed" style={{ color: '#6c5ce7' }}>לצפייה בבתי מפגש שהסתיימו</Link>
          </div>
        ) : activeHouses.map(house => (
          <HouseCard
            key={house.id}
            house={house}
            activists={activistPool}
            onAssign={(activistId) => handleAssign(house.id, activistId)}
          />
        ))}
      </div>
    </DesktopLayout>
  );
}

function HouseCard({ house, activists = [], onAssign }) {
  const [selectedId, setSelectedId] = useState('');
  const completedCount = house.meetings.filter(m => m.completed).length;
  const statusInfo = STATUS_LABELS[house.status] || STATUS_LABELS.upcoming;
  const assignedId = house.assignedActivistId ?? house.assignedActivists?.[0];
  const assignedActivist = activists.find(a => String(a.userId ?? a.id) === String(assignedId));
  const availableActivists = activists.filter(a => !(house.assignedActivists || []).some(x => String(x) === String(a.userId ?? a.id)));
  const firstMeeting = house.meetings?.[0];

  function doAssign() {
    const id = Number(selectedId);
    if (!id) return;
    onAssign(id);
    setSelectedId('');
  }

  return (
    <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: 18, boxShadow: '0 1px 5px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#2d1f5e' }}>בית מפגש {house.houseNumber}</div>
          <div style={{ fontSize: 12, color: '#a08060', marginTop: 3 }}>📍 {house.settlement || house.city}</div>
        </div>
        <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: statusInfo.bg, color: statusInfo.color, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {statusInfo.label}
        </span>
      </div>

      {/* Info */}
      <div style={{ fontSize: 12, color: '#666', lineHeight: 1.8, marginBottom: 10 }}>
        <div><span style={{ color: '#aaa' }}>מנחה: </span>{house.facilitatorName || '—'}</div>
        <div><span style={{ color: '#aaa' }}>מארח: </span>{house.hostName || '—'}</div>
        <div><span style={{ color: '#aaa' }}>מפגש ראשון: </span>{firstMeeting?.date ? new Date(firstMeeting.date).toLocaleDateString('he-IL') : '—'}</div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600 }}>התקדמות מפגשים</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: completedCount > 0 ? '#27ae60' : '#6c5ce7' }}>{completedCount}/4</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 3, 4].map(n => (
            <div key={n} style={{ flex: 1, height: 6, borderRadius: 4, background: n <= completedCount ? '#27ae60' : '#e8e8e8' }} />
          ))}
        </div>
      </div>

      {/* Activist */}
      <div style={{ background: '#fafafa', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>פעיל משובץ</div>
        {assignedActivist ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: '#2d1f5e' }}>⭐ {assignedActivist.name}</div>
        ) : (
          <div style={{ fontSize: 12, color: '#ccc' }}>לא שובץ עדיין</div>
        )}
      </div>

      {/* Assign dropdown */}
      {availableActivists.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            style={{ flex: 1, border: '1.5px solid #e8e8e8', borderRadius: 8, padding: '7px 10px', fontFamily: 'inherit', fontSize: 12, color: '#333', background: '#fff' }}
          >
            <option value="">שבץ פעיל...</option>
            {availableActivists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            onClick={doAssign}
            disabled={!selectedId}
            style={{ border: 'none', borderRadius: 8, padding: '7px 14px', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, cursor: selectedId ? 'pointer' : 'not-allowed', background: selectedId ? '#6c5ce7' : '#ddd', color: '#fff' }}
          >
            שבץ
          </button>
        </div>
      )}

      {/* Actions */}
      <Link href={`/meeting-houses/${house.id}`} style={{ textDecoration: 'none' }}>
        <button style={{ width: '100%', border: '1.5px solid #6c5ce7', borderRadius: 10, padding: '9px', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer', background: '#fff', color: '#6c5ce7', transition: 'all 0.15s ease' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#6c5ce7'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#6c5ce7'; }}>
          פרטים מלאים
        </button>
      </Link>
    </div>
  );
}
