// pages/my-activities.jsx — הפעילויות שלי: פיד מאוחד של דיווחי קשר ומפגשי בסיס לפעיל.
// הנתונים מגיעים מ-useCrm וכבר מסוננים לפעיל ב-RLS; כאן מסננים שוב הגנתית לפי activist_id.
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../components/DesktopLayout';
import FilterChips from '../components/FilterChips';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';

const PERIOD_OPTIONS = [
  { value: 'daily',   label: 'יומי' },
  { value: 'weekly',  label: 'שבועי' },
  { value: 'monthly', label: 'חודשי' },
  { value: 'yearly',  label: 'שנתי' },
];
const PERIOD_LABELS = { daily: 'היום', weekly: 'השבוע', monthly: 'החודש', yearly: 'השנה' };

// תחילת תקופה קלנדרית (לא חלון מתגלגל): היום / מתחילת השבוע (יום ראשון) / מתחילת החודש / מתחילת השנה
function periodStart(period, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'daily')  return d;
  if (period === 'weekly') { d.setDate(d.getDate() - d.getDay()); return d; } // השבוע מתחיל ביום ראשון
  if (period === 'yearly') return new Date(d.getFullYear(), 0, 1);
  return new Date(d.getFullYear(), d.getMonth(), 1); // monthly — ברירת מחדל
}

const TYPE_ICONS     = { 'פרונטלי': '🤝', 'טלפוני': '📞', 'וידאו': '🎥', 'אירוח שבת': '🍷' };
const OUTCOME_COLORS = { 'חיובי': '#27ae60', 'שלילי': '#e74c3c', 'ניטרלי': '#8b6d3f', 'ממתין למענה': '#f39c12' };
const BRAND = '#3a249b';

export default function MyActivitiesPage() {
  const router = useRouter();
  const { interactions, baseMeetings } = useCrm();
  const { currentUser } = useAuth();
  const isActivist = currentUser?.role === 'activist';

  const [period, setPeriod] = useState('monthly'); // ברירת מחדל: חודשי
  const [viewMode, setViewMode] = useState(() => {   // דפוס זהה ל-contacts.jsx, מפתח משלו
    if (typeof window !== 'undefined') return sessionStorage.getItem('myActivitiesView') || 'grid';
    return 'grid';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') sessionStorage.setItem('myActivitiesView', viewMode);
  }, [viewMode]);

  // הדף מיועד לפעילים בלבד — תפקידים אחרים מוחזרים לדף הבית
  useEffect(() => {
    if (currentUser && !isActivist) router.replace('/landing');
  }, [currentUser?.role]);

  const feed = useMemo(() => {
    if (!currentUser) return [];
    const start = periodStart(period);
    const items = [];
    interactions
      .filter(i => i.activist_id === currentUser.id && i.date && new Date(i.date) >= start)
      .forEach(i => items.push({
        key: `i-${i.id}`, kind: 'interaction', rawId: i.id, contactId: i.contact_id,
        date: i.date, time: i.time || '',
        type: i.type, quality: i.quality, outcome: i.outcome,
        duration: i.duration_minutes,
        title: i.contact_name || 'לקוח',
      }));
    baseMeetings
      // מפגש בלי תאריך מתוזמן (date:'') עדיין נספר — לפי תאריך השליחה (submitted_at)
      .map(m => ({ ...m, _when: m.date || (m.submitted_at ? String(m.submitted_at).slice(0, 10) : '') }))
      .filter(m => Number(m.activist_id) === Number(currentUser.id) && m.submitted && m._when && new Date(m._when) >= start)
      .forEach(m => items.push({
        key: `b-${m.id}`, kind: 'baseMeeting', rawId: m.id,
        date: m._when, time: m.start_time || '',
        title: m.meeting_place_city
          ? `בית מפגש ${m.meeting_place_city}${m.meeting_place_number ? ` ${m.meeting_place_number}` : ''}`
          : `מפגש בסיס${m.meeting_number ? ` מס' ${m.meeting_number}` : ''}`,
        meetingNumber: m.meeting_number,
        participants: m.participant_count,
      }));
    return items.sort((a, b) =>
      new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`)
    );
  }, [interactions, baseMeetings, currentUser, period]);

  if (currentUser && !isActivist) {
    return (
      <DesktopLayout title="הפעילויות שלי">
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div>אין הרשאה לדף זה</div>
        </div>
      </DesktopLayout>
    );
  }

  const interactionCount = feed.filter(x => x.kind === 'interaction').length;
  const meetingCount     = feed.filter(x => x.kind === 'baseMeeting').length;

  return (
    <DesktopLayout title="הפעילויות שלי" subtitle={`${feed.length} פעילויות ${PERIOD_LABELS[period]}`}>
      {/* שורת כלים: תקופה + מצב תצוגה */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <FilterChips options={PERIOD_OPTIONS} active={period} onChange={setPeriod} />
        {/* טוגל תצוגה — זהה ל-contacts.jsx */}
        <div style={{ display: 'flex', border: '1.5px solid #e8e8e8', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          <button onClick={() => setViewMode('grid')}
            style={{ padding: '7px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16,
              background: viewMode === 'grid' ? BRAND : '#fff',
              color:      viewMode === 'grid' ? '#fff' : '#aaa',
              transition: 'all 0.18s ease' }}>⊞</button>
          <button onClick={() => setViewMode('list')}
            style={{ padding: '7px 12px', border: 'none', borderRight: '1.5px solid #e8e8e8', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16,
              background: viewMode === 'list' ? BRAND : '#fff',
              color:      viewMode === 'list' ? '#fff' : '#aaa',
              transition: 'all 0.18s ease' }}>☰</button>
        </div>
      </div>

      {/* מוני סיכום */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="stat-box"><div className="stat-num">{feed.length}</div><div className="stat-lbl">סה"כ פעילויות {PERIOD_LABELS[period]}</div></div>
        <div className="stat-box"><div className="stat-num">{interactionCount}</div><div className="stat-lbl">דיווחי קשר</div></div>
        <div className="stat-box"><div className="stat-num">{meetingCount}</div><div className="stat-lbl">מפגשי בסיס</div></div>
      </div>

      {/* תצוגת ריבועים */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {feed.length === 0
            ? <div className="empty-state" style={{ gridColumn: '1/-1' }}>אין פעילויות בתקופה זו</div>
            : feed.map(item => <ActivityCard key={item.key} item={item} router={router} />)
          }
        </div>
      )}

      {/* תצוגת רשימה */}
      {viewMode === 'list' && (
        <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid rgba(0,0,0,0.07)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          {feed.length === 0
            ? <div className="empty-state">אין פעילויות בתקופה זו</div>
            : feed.map((item, idx) => <ActivityRow key={item.key} item={item} last={idx === feed.length - 1} router={router} />)
          }
        </div>
      )}
    </DesktopLayout>
  );
}

// קישור לפרטים המלאים: קשר → דף הלקוח (גלילה לכרטיס); מפגש בסיס → מודל "דיווח מלא" ב-/base-meetings
function detailHref(item) {
  return item.kind === 'interaction'
    ? `/contact/${item.contactId}?openInteraction=${item.rawId}`
    : `/base-meetings?open=${item.rawId}`;
}

function Pill({ text, color = '#6c5ce7', bg = 'rgba(108,92,231,0.08)' }) {
  return (
    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 600, color, background: bg, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

// ── כרטיס ריבוע ──────────────────────────────────────────────
function ActivityCard({ item, router }) {
  const isMeeting = item.kind === 'baseMeeting';
  const accent = isMeeting ? BRAND : (OUTCOME_COLORS[item.outcome] ?? '#3498db');
  return (
    <div onClick={() => router.push(detailHref(item))}
      style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(0,0,0,0.07)', borderRight: `3px solid ${accent}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: isMeeting ? BRAND : '#6c5ce7' }}>
          {isMeeting ? '🏠 מפגש בסיס' : `${TYPE_ICONS[item.type] ?? '💬'} ${item.type ?? 'קשר'}`}
        </span>
        <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>{item.date}{item.time ? ` · ${item.time.slice(0, 5)}` : ''}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>{item.title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {item.quality && <Pill text={item.quality} />}
        {item.outcome && !isMeeting && <Pill text={item.outcome} color={OUTCOME_COLORS[item.outcome] ?? '#6c5ce7'} bg="rgba(0,0,0,0.04)" />}
        {item.duration ? <Pill text={`${item.duration} דק'`} color="#888" bg="#f5f5f5" /> : null}
        {isMeeting && item.meetingNumber ? <Pill text={`מפגש מס' ${item.meetingNumber}`} /> : null}
        {isMeeting && item.participants ? <Pill text={`${item.participants} משתתפים`} color="#27ae60" bg="#edfaf1" /> : null}
      </div>
    </div>
  );
}

// ── שורת רשימה ───────────────────────────────────────────────
function ActivityRow({ item, last, router }) {
  const isMeeting = item.kind === 'baseMeeting';
  const accent = isMeeting ? BRAND : (OUTCOME_COLORS[item.outcome] ?? '#3498db');
  return (
    <div
      onClick={() => router.push(detailHref(item))}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 16px',
        borderBottom: last ? 'none' : '0.5px solid #f5f5f5',
        borderRight: `3px solid ${accent}`,
        transition: 'background 0.15s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ flex: '0 0 130px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
        {item.date}{item.time ? ` · ${item.time.slice(0, 5)}` : ''}
      </div>
      <div style={{ flex: '0 0 110px', fontSize: 12, fontWeight: 700, color: isMeeting ? BRAND : '#6c5ce7', whiteSpace: 'nowrap' }}>
        {isMeeting ? '🏠 מפגש בסיס' : `${TYPE_ICONS[item.type] ?? '💬'} ${item.type ?? 'קשר'}`}
      </div>
      <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: 14, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {item.title}
      </div>
      <div style={{ flex: '0 0 auto', display: 'flex', gap: 6 }}>
        {item.quality && <Pill text={item.quality} />}
        {item.outcome && !isMeeting && <Pill text={item.outcome} color={OUTCOME_COLORS[item.outcome] ?? '#6c5ce7'} bg="rgba(0,0,0,0.04)" />}
        {isMeeting && item.participants ? <Pill text={`${item.participants} משתתפים`} color="#27ae60" bg="#edfaf1" /> : null}
      </div>
    </div>
  );
}
