// pages/notifications.jsx
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import { getPushStatus, registerPushSubscription } from '../lib/pushClient';
import { isNativeApp, getNativePushPermission, enableNativePush } from '../lib/nativePush';
import { authHeader } from '../lib/apiAuth';
import {
  getNotificationsForUser,
  getNotificationTypeLabel,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '../lib/notificationDemo';

// חיווי + הפעלת התראות במכשיר הנוכחי. הבקשה להרשאה יוצאת רק מלחיצת כפתור
// (מחוות משתמש) — דפדפנים חוסמים בקשות אוטומטיות בטעינת דף, וזו הסיבה
// שחלק גדול מהפעילים מעולם לא נרשמו להתראות.
function DeviceNotificationCard({ currentUser }) {
  const native = isNativeApp(); // אפליקציית Capacitor — משתמש ב-FCM נייטיבי, לא ב-web-push
  const [status, setStatus]   = useState(null);   // null = בטעינה
  const [busy, setBusy]       = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(() => {
    if (native) {
      getNativePushPermission().then(permission => setStatus({ supported: true, native: true, permission }));
    } else {
      getPushStatus().then(setStatus);
    }
  }, [native]);
  useEffect(() => { refresh(); }, [refresh]);

  async function handleEnable() {
    setBusy(true); setMessage('');
    if (native) {
      const permission = await enableNativePush(String(currentUser.id));
      await refresh();
      setMessage(permission === 'granted'
        ? '✅ ההתראות הופעלו במכשיר הזה'
        : 'לא הצלחנו להפעיל — בדוק שההרשאה לא נחסמה בהגדרות המכשיר ונסה שוב');
    } else {
      const sub = await registerPushSubscription(String(currentUser.id));
      await refresh();
      // כשל אפשרי משתי סיבות: ההרשאה נדחתה, או שהשמירה בשרת נכשלה (registerPushSubscription
      // מחזיר null בשני המקרים). מנסחים כך שהמשתמש ידע לבדוק את שניהם.
      setMessage(sub
        ? '✅ ההתראות הופעלו והמכשיר נרשם בשרת'
        : 'לא הצלחנו להפעיל — ייתכן שההרשאה נחסמה בדפדפן, או שהרישום בשרת נכשל. נסה שוב.');
    }
    setBusy(false);
  }

  async function handleTest() {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/push/test', { method: 'POST', headers: { ...(await authHeader()) } });
      const data = await res.json().catch(() => ({}));
      setMessage(res.ok && data.sent > 0
        ? `📨 נשלחה התראת ניסיון ל-${data.devices || 1} מכשירים — בדוק שקיבלת תוך כמה שניות`
        : 'שליחת הניסיון נכשלה — נסה להפעיל מחדש את ההתראות');
    } catch {
      setMessage('שליחת הניסיון נכשלה — בדוק את החיבור לרשת');
    }
    setBusy(false);
  }

  if (!status) return null;

  // "פעיל" = גם הדפדפן רשום וגם *השרת* מכיר את המכשיר. בלי התנאי השני הוצג וי ירוק
  // למכשיר שהשרת לא ידע על קיומו, ולכן לא קיבל שום התראה (ראה lib/pushClient.js).
  const active = native
    ? status.permission === 'granted'
    : status.supported && status.permission === 'granted' && status.subscribed && status.serverRegistered;

  // המקרה המטעה: יש מנוי בדפדפן אבל הוא לא נשמר בשרת. הפעלה מחדש שולחת אותו שוב.
  const localOnly = !native && status.supported && status.permission === 'granted'
    && status.subscribed && !status.serverRegistered;

  let content;
  if (localOnly) {
    content = (
      <>
        <div style={{ fontSize:13, color:'#b06b00', lineHeight:1.7 }}>
          ⚠️ <b>המכשיר הזה לא מחובר לשרת ההתראות.</b> הדפדפן מוכן, אבל הרישום לא נשמר —
          לכן לא הגיעו לכאן התראות. לחיצה אחת מתקנת.
        </div>
        <button onClick={handleEnable} disabled={busy}
          style={{ background:'#6c5ce7', border:'none', borderRadius:10, padding:'9px 18px', fontSize:13, color:'#fff', fontWeight:800, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
          {busy ? 'מחבר…' : '🔄 חבר את המכשיר הזה'}
        </button>
      </>
    );
  } else if (active) {
    content = (
      <>
        <div style={{ fontSize:14, fontWeight:800, color:'#27ae60' }}>✅ התראות פעילות במכשיר זה</div>
        <button onClick={handleTest} disabled={busy}
          style={{ background:'#f1efff', border:'1px solid rgba(108,92,231,0.25)', borderRadius:10, padding:'7px 14px', fontSize:13, color:'#6c5ce7', fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>
          שלח התראת ניסיון
        </button>
      </>
    );
  } else if (native && (status.permission === 'denied')) {
    content = (
      <div style={{ fontSize:13, color:'#b0483f', lineHeight:1.7 }}>
        🚫 ההתראות חסומות לאפליקציה בהגדרות המכשיר. כדי לאפשר: הגדרות המכשיר ← אפליקציות ← מקרבים ← התראות ← אפשר, ואז חזור לכאן.
      </div>
    );
  } else if (native) {
    content = (
      <>
        <div style={{ fontSize:13, color:'#555' }}>התראות כבויות במכשיר זה — הפעל כדי לקבל תזכורות ועדכונים גם כשהאפליקציה סגורה.</div>
        <button onClick={handleEnable} disabled={busy}
          style={{ background:'#6c5ce7', border:'none', borderRadius:10, padding:'9px 18px', fontSize:13, color:'#fff', fontWeight:800, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
          {busy ? 'מפעיל…' : '🔔 הפעל התראות במכשיר זה'}
        </button>
      </>
    );
  } else if (!status.supported && status.isIOS && !status.standalone) {
    content = (
      <div style={{ fontSize:13, color:'#555', lineHeight:1.7 }}>
        📱 <b>באייפון:</b> כדי לקבל התראות יש להוסיף את המערכת למסך הבית — לחץ על כפתור השיתוף בספארי ← "הוסף למסך הבית", פתח את האפליקציה מהמסך הבית וחזור לדף זה.
      </div>
    );
  } else if (!status.supported) {
    content = <div style={{ fontSize:13, color:'#888' }}>הדפדפן במכשיר זה לא תומך בהתראות.</div>;
  } else if (status.permission === 'denied') {
    content = (
      <div style={{ fontSize:13, color:'#b0483f', lineHeight:1.7 }}>
        🚫 ההתראות חסומות למערכת בדפדפן זה. כדי לאפשר: לחץ על סמל המנעול ליד שורת הכתובת ← הרשאות ← התראות ← אפשר, ואז רענן את הדף.
      </div>
    );
  } else {
    content = (
      <>
        <div style={{ fontSize:13, color:'#555' }}>התראות כבויות במכשיר זה — הפעל כדי לקבל תזכורות ועדכונים גם כשהמערכת סגורה.</div>
        <button onClick={handleEnable} disabled={busy}
          style={{ background:'#6c5ce7', border:'none', borderRadius:10, padding:'9px 18px', fontSize:13, color:'#fff', fontWeight:800, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
          {busy ? 'מפעיל…' : '🔔 הפעל התראות במכשיר זה'}
        </button>
      </>
    );
  }

  return (
    <div style={{ background:'#fff', border:'0.5px solid rgba(0,0,0,0.08)', borderRadius:16, padding:18, marginBottom:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        {content}
      </div>
      {message && <div style={{ marginTop:10, fontSize:13, fontWeight:700, color:'#6c5ce7' }}>{message}</div>}
    </div>
  );
}

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
        {currentUser && <DeviceNotificationCard currentUser={currentUser} />}
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
              {/* pre-wrap — גוף התראה מרובה-שורות (למשל סיכום AI) נשמר עם שבירות שורה */}
              <div style={{ fontSize:13, color:'#555', lineHeight:1.7, whiteSpace:'pre-wrap' }}>{n.body}</div>
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
