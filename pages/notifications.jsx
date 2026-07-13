// pages/notifications.jsx
import { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import {
  getNotificationsForUser,
  getNotificationTypeLabel,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '../lib/notificationDemo';

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return value;
  }
}

export default function NotificationsPage() {
  const { currentUser } = useAuth();
  const { baseMeetings } = useCrm();
  const router = useRouter();
  // readTick — חישוב מחדש של הרשימה (והמונה) אחרי סימון "נקרא".
  const [readTick, setReadTick] = useState(0);
  const notifications = useMemo(
    () => getNotificationsForUser(currentUser, baseMeetings),
    [currentUser, baseMeetings, readTick]
  );
  const unreadCount = notifications.filter(n => !n.read).length;

  function handleClick(n) {
    if (!n.read) {
      markNotificationAsRead(n.id, currentUser);
      setReadTick(t => t + 1);
    }
    if (n.link) router.push(n.link);
  }

  function handleMarkAllRead() {
    markAllNotificationsAsRead(notifications, currentUser);
    setReadTick(t => t + 1);
  }

  return (
    <DesktopLayout title="התראות" subtitle="שיבוץ, תזכורות דיווח, תשלומים והתרעות לרכז">
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:16, padding:18, marginBottom:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
            <div style={{ fontSize:16, fontWeight:800, color:'#2d1f5e', marginBottom:6 }}>מרכז ההתראות</div>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead}
                style={{ background:'#f1efff', border:'1px solid rgba(108,92,231,0.25)', borderRadius:10, padding:'7px 14px', fontSize:13, color:'#6c5ce7', fontWeight:800, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                סמן הכל כנקרא
              </button>
            )}
          </div>
          <div style={{ fontSize:13, color:'#777', lineHeight:1.7 }}>
            כאן מרוכזות ההתראות שלך: שיבוץ לבית מפגש, תזכורות למילוי דיווח, דיווחי תשלום והתרעות לרכז. ההתראות נשמרות בענן ומסונכרנות בין המכשירים.
          </div>
          <div style={{ marginTop:12, fontSize:13, color:'#6c5ce7', fontWeight:800 }}>
            {unreadCount} התראות חדשות מתוך {notifications.length}
          </div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {notifications.map(n => (
            <div key={n.id}
              onClick={() => handleClick(n)}
              style={{ background:n.read?'#fff':'#fffaf5', border:`0.5px solid ${n.priority==='high'?'rgba(224,127,55,0.25)':'rgba(0,0,0,0.08)'}`, borderRight:`4px solid ${n.read?'#d9d4ec':(n.priority==='high'?'#f39c12':'#6c5ce7')}`, borderRadius:14, padding:'14px 16px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)', cursor:'pointer', opacity:n.read?0.7:1, transition:'opacity 0.18s, box-shadow 0.18s' }}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 3px 12px rgba(0,0,0,0.08)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'}
            >
              <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:6 }}>
                <div>
                  <span style={{ display:'inline-block', fontSize:11, fontWeight:800, color:n.priority==='high'?'#b06b00':'#6c5ce7', background:n.priority==='high'?'#fff4df':'#f1efff', padding:'3px 9px', borderRadius:999, marginBottom:8 }}>
                    {getNotificationTypeLabel(n.type)}
                  </span>
                  <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                    {!n.read && <span style={{ width:8, height:8, borderRadius:'50%', background:'#e24b4a', flexShrink:0 }} />}
                    <div style={{ fontSize:15, fontWeight:800, color:'#2d1f5e' }}>{n.title}</div>
                  </div>
                </div>
                <div style={{ fontSize:11, color:'#aaa', whiteSpace:'nowrap' }}>{formatDateTime(n.created_at)}</div>
              </div>
              <div style={{ fontSize:13, color:'#555', lineHeight:1.7 }}>{n.body}</div>
            </div>
          ))}

          {notifications.length === 0 && (
            <div style={{ textAlign:'center', padding:60, color:'#bbb', background:'#fff', borderRadius:16 }}>
              <div style={{ fontSize:44, marginBottom:10 }}>🔕</div>
              <div>אין התראות להצגה</div>
            </div>
          )}
        </div>
      </div>
    </DesktopLayout>
  );
}
