// components/DesktopLayout.jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import { getNotificationsForUser } from '../lib/notificationDemo';

const PROJECTS_LIST = [
  { id: 0, name: 'כל הפרויקטים' },
  { id: 1, name: 'איילת השחר' },
  { id: 2, name: 'אחדות יהודית' },
  { id: 3, name: 'שבת מכל הסיבות' },
  { id: 4, name: 'נפש יהודי' },
];

const BG = 'linear-gradient(160deg, #fff8f0 0%, #fff2e6 50%, #ffead8 100%)';

export default function DesktopLayout({ children, title, subtitle, actions, backHref, backLabel }) {
  const { currentUser, activeProject, filterProject, logout, switchProject, can } = useAuth();
  const { baseMeetings } = useCrm();
  const notifications = getNotificationsForUser(currentUser, baseMeetings);
  const unreadNotifications = notifications.filter(n => !n.read).length;
  const router   = useRouter();
  const [open,         setOpen]         = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [logoHover,    setLogoHover]    = useState(false);

  const isActivist = currentUser?.role === 'activist';
  const roleLabels = { ceo: 'מנכ"ל', head: 'ראש פרויקט', coord: 'רכז', activist: 'פעיל', finance: 'בעל גישה לתשלומים' };

  const currentProjName = isActivist
    ? activeProject?.name
    : filterProject === null ? 'כל הפרויקטים' : PROJECTS_LIST.find(p => p.id === filterProject)?.name;

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG, direction: 'rtl', overflow: 'hidden', position: 'relative' }}>

      {/* ═══ סיידבר — פתיחה איטית ═══ */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: open ? 230 : 62,
          background: 'linear-gradient(180deg, #8b6dd1 0%, #5a4bd1 50%, #4a3bc1 100%)',
          display: 'flex', flexDirection: 'column',
          transition: 'width 0.38s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden', zIndex: 3000,
          boxShadow: open ? '-8px 0 32px rgba(90,75,209,0.22)' : '-2px 0 10px rgba(90,75,209,0.09)',
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseMove={() => { if (!open) setOpen(true); }}
        onMouseLeave={() => setOpen(false)}
      >
        {/* לוגו — רק העיגול, כפתור ניתוק */}
        <div style={{ padding: '16px 0 12px', display: 'flex', alignItems: 'center', paddingRight: open ? 16 : 0, justifyContent: open ? 'flex-start' : 'center', borderBottom: '0.5px solid rgba(255,255,255,0.12)', gap: 10, transition: 'padding 0.35s ease' }}>
          <button
            onClick={logout}
            onMouseEnter={() => setLogoHover(true)}
            onMouseLeave={() => setLogoHover(false)}
            title="יציאה מהמערכת"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: logoHover ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)',
              border: 'none', cursor: 'pointer', color: '#fff',
              fontWeight: 700, fontSize: 15, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s ease',
              transform: logoHover ? 'scale(1.08)' : 'scale(1)',
              fontFamily: 'Heebo, sans-serif',
            }}>
            מ
          </button>
          {open && <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', opacity: open ? 1 : 0, transition: 'opacity 0.2s ease' }}>מקרבים</span>}
        </div>

        {/* ניווט */}
        <div style={{ flex: 1, padding: '10px 0', overflowY: 'auto', overflowX: 'hidden' }}>
          <NavItem href="/landing"     icon="🏠" label="מרכז הפעילות" open={open} active={router.pathname === '/landing'} onActivate={() => setOpen(true)} />
          {can.seeSensitiveData && <NavItem href="/" icon="👤" label="אזור אישי" open={open} active={router.pathname === '/'} highlight onActivate={() => setOpen(true)} />}
          <NavItem href="/contacts"    icon="👥" label="לקוחות"        open={open} active={router.pathname === '/contacts'} onActivate={() => setOpen(true)} />
          {can.seeActivists && <NavItem href="/activists" icon="⭐" label="פעילים" open={open} active={router.pathname === '/activists'} onActivate={() => setOpen(true)} />}
          {(can.seePayments || currentUser?.role !== 'activist') && (
            <NavItem href="/payments" icon="💰" label="דוחות תשלום פעילים" open={open} active={router.pathname === '/payments'} onActivate={() => setOpen(true)} />
          )}
          <NavItem href="/reminders"   icon="🔔" label="תזכורות קשר"   open={open} active={router.pathname === '/reminders'} onActivate={() => setOpen(true)} />
          <NavItem href="/notifications" icon="🔔" label="התראות מערכת" open={open} active={router.pathname === '/notifications'} onActivate={() => setOpen(true)} />
          <NavItem href="/chat" icon="💬" label="צ׳אט פעילים" open={open} active={router.pathname === '/chat'} onActivate={() => setOpen(true)} />
          {can.addContact && <NavItem href="/contacts/add" icon="➕" label="הוסף לקוח" open={open} highlight onActivate={() => setOpen(true)} />}
          {can.addContact && currentUser?.project_id === 2 && (
            <NavItem href="/base-meetings" icon="📋" label="מפגשי בסיס" open={open} active={router.pathname === '/base-meetings'} onActivate={() => setOpen(true)} />
          )}
          {can.seeMeetingHouses && (
            <NavItem href="/meeting-houses" icon="🏘️" label="בתי מפגש" open={open} active={router.pathname.startsWith("/meeting-houses")} onActivate={() => setOpen(true)} />
          )}

          {!isActivist && (
            <>
              <div onClick={() => { setOpen(true); setProjectsOpen(p => !p); }}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', gap: 10, margin: '1px 8px', borderRadius: 10, transition: 'background 0.18s ease' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>📁</span>
                {open && <>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, flex: 1, whiteSpace: 'nowrap', fontWeight: 500 }}>פרויקט</span>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, transition: 'transform 0.2s', transform: projectsOpen ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                </>}
              </div>
              {open && projectsOpen && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  {PROJECTS_LIST.map(p => {
                    const isActive = filterProject === p.id || (p.id === 0 && filterProject === null);
                    return (
                      <div key={p.id} onClick={() => { switchProject(p.id); setOpen(true); setProjectsOpen(false); }}
                        style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontWeight: isActive ? 600 : 400,
                          color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
                          background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                          marginRight: 22, borderRadius: 8, whiteSpace: 'nowrap', transition: 'all 0.15s ease',
                        }}>
                        {isActive ? '◉ ' : '○ '}{p.name}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* פרויקט + משתמש בתחתית */}
        <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.12)' }}>
          {open && (
            <div style={{ padding: '8px 16px', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
              <div style={{ marginBottom: 2 }}>פרויקט פעיל</div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 12 }}>{currentProjName}</div>
            </div>
          )}
          <div style={{ padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              {currentUser?.name?.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            {open && <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.name}</div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>{roleLabels[currentUser?.role]}</div>
              </div>
              <button onClick={logout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: 11, cursor: 'pointer', fontFamily: 'Heebo, sans-serif', transition: 'color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.45)'}>
                יציאה
              </button>
            </>}
          </div>
        </div>
      </div>

      {/* ═══ תוכן ═══ */}
     <div style={{
  flex: 1,
  marginRight: open ? 230 : 62,
  transition: 'margin-right 0.3s ease',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}}>
        {/* כותרת */}
        <div style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', borderBottom: '0.5px solid rgba(0,0,0,0.06)', padding: '16px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, position: 'relative', zIndex: 2000 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {backHref && (
              <Link href={backHref} style={{ textDecoration: 'none' }}>
                <button style={{ padding: '6px 14px', borderRadius: 10, border: '1.5px solid #e8e8e8', background: '#fff', color: '#6c5ce7', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Heebo, sans-serif', transition: 'all 0.18s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f0effe'; e.currentTarget.style.borderColor = '#6c5ce7'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e8e8e8'; }}>
                  {backLabel || '← חזרה'}
                </button>
              </Link>
            )}
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#2d1f5e', letterSpacing: '-0.3px' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: '#b8a8e0', marginTop: 2, fontWeight: 500 }}>{subtitle}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
            <button
              onClick={() => setNotificationsOpen(v => !v)}
              title="התראות מערכת"
              style={{ position: 'relative', width: 40, height: 40, borderRadius: 12, border: '1.5px solid #eee', background: '#fff', cursor: 'pointer', fontSize: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
            >
              🔔
              {unreadNotifications > 0 && (
                <span style={{ position:'absolute', top:-6, left:-6, minWidth:18, height:18, borderRadius:99, background:'#e24b4a', color:'#fff', fontSize:10, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px' }}>
                  {unreadNotifications}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div style={{ position:'fixed', top:74, left:28, width:340, maxHeight:430, overflowY:'auto', background:'#fff', border:'0.5px solid rgba(0,0,0,0.09)', borderRadius:16, boxShadow:'0 22px 70px rgba(0,0,0,0.22)', zIndex:100000, padding:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 8px 10px', borderBottom:'0.5px solid #eee', marginBottom:8 }}>
                  <b style={{ fontSize:14, color:'#2d1f5e' }}>התראות מערכת</b>
                  <Link href="/notifications" style={{ fontSize:12, color:'#6c5ce7', textDecoration:'none', fontWeight:800 }} onClick={() => setNotificationsOpen(false)}>לכל ההתראות</Link>
                </div>
                {notifications.slice(0,5).map(n => (
                  <Link key={n.id} href={n.link || '/notifications'} style={{ textDecoration:'none' }} onClick={() => setNotificationsOpen(false)}>
                    <div style={{ padding:'10px 8px', borderRadius:10, background:n.priority==='high'?'#fff7ec':'#fff', borderBottom:'0.5px solid #f1f1f1' }}>
                      <div style={{ fontSize:13, fontWeight:800, color:'#2d1f5e', marginBottom:3 }}>{n.title}</div>
                      <div style={{ fontSize:12, color:'#666', lineHeight:1.45 }}>{n.body.length > 96 ? n.body.slice(0,96) + '...' : n.body}</div>
                    </div>
                  </Link>
                ))}
                {notifications.length === 0 && <div style={{ textAlign:'center', color:'#aaa', padding:20, fontSize:13 }}>אין התראות</div>}
              </div>
            )}
            {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
          </div>
        </div>

        {/* תוכן */}
        <div className="premium-page-enter" style={{ flex: 1, overflowY: 'auto', padding: '22px 28px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function NavItem({ href, icon, label, open, active, highlight, onActivate }) {
  const [hov, setHov] = useState(false);
  return (
    <Link href={href} style={{ textDecoration: 'none' }} onClick={onActivate}>
      <div className="premium-sidebar-item" style={{
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        cursor: 'pointer', gap: 10, margin: '1px 8px', borderRadius: 10,
        background: active ? 'rgba(255,255,255,0.2)' : hov ? 'rgba(255,255,255,0.1)' : highlight ? 'rgba(255,255,255,0.07)' : 'transparent',
        transition: 'background 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        borderRight: active ? '3px solid rgba(255,255,255,0.6)' : '3px solid transparent',
      }}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
        <span className="premium-sidebar-icon" style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
        {open && <span style={{
          color: highlight ? '#ffd580' : active ? '#fff' : 'rgba(255,255,255,0.8)',
          fontSize: 13, whiteSpace: 'nowrap', fontWeight: active ? 700 : 500,
          opacity: open ? 1 : 0, transition: 'opacity 0.2s ease',
        }}>{label}</span>}
      </div>
    </Link>
  );
}
