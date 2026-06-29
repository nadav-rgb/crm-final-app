// components/DesktopLayout.jsx
import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import MobileBottomNav from './MobileBottomNav';
import { getNotificationsForUser, markNotificationAsRead, markAllNotificationsAsRead } from '../lib/notificationDemo';
import {
  Home, User, Users, Calendar, UserPlus,
  ClipboardList, Star, CreditCard, Bell, BellRing,
  MessageSquare, Building2, CheckCircle,
  BarChart2, FolderOpen, LayoutDashboard,
} from 'lucide-react';

const PROJECTS_LIST = [
  { id: 0, name: 'כל הפרויקטים' },
  { id: 1, name: 'אחדות יהודית' },
  { id: 2, name: 'נעים להכיר' },
  { id: 3, name: 'שבת מכל הסיבות' },
  { id: 4, name: 'נפש יהודי' },
];

const BG = 'linear-gradient(148deg, #f5f2ff 0%, #fafaf9 50%, #fffdf5 100%)';

const SIDEBAR_COLLAPSED = 64;
const SIDEBAR_EXPANDED  = 240;
const SIDEBAR_BG = 'linear-gradient(180deg, rgba(42,24,112,0.90) 0%, rgba(58,36,155,0.86) 52%, rgba(35,20,100,0.90) 100%)';
const ICO = { size: 18, strokeWidth: 1.8 };

export default function DesktopLayout({ children, title, subtitle, actions, backHref, backLabel }) {
  const { currentUser, activeProject, filterProject, logout, switchProject, can } = useAuth();
  const { baseMeetings } = useCrm();
  const router = useRouter();
  // readTick — מאלץ חישוב מחדש של ההתראות (והבאדג') אחרי סימון "נקרא", גם בלי ניווט.
  const [readTick, setReadTick] = useState(0);
  const notifications = useMemo(
    () => getNotificationsForUser(currentUser, baseMeetings),
    [currentUser, baseMeetings, readTick]
  );
  const unreadNotifications = notifications.filter(n => !n.read).length;
  const [open,              setOpen]             = useState(false);
  const [projectsOpen,      setProjectsOpen]     = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [logoHover,         setLogoHover]        = useState(false);
  const [isMobile,          setIsMobile]         = useState(false);
  const sidebarRef = useRef(null);
  const closeTimer = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (sidebarRef.current?.matches(':hover')) setOpen(true);
  }, [router.pathname]);

  const isActivist = currentUser?.role === 'activist';
  const roleLabels = { ceo: 'מנכ"ל', head: 'ראש פרויקט', coord: 'רכז', activist: 'פעיל', finance: 'בעל גישה לתשלומים' };

  const currentProjName = isActivist
    ? activeProject?.name
    : filterProject === null ? 'כל הפרויקטים' : PROJECTS_LIST.find(p => p.id === filterProject)?.name;

  function handleNotificationClick(n) {
    markNotificationAsRead(n.id, currentUser);
    setReadTick(t => t + 1);
    setNotificationsOpen(false);
  }

  function handleMarkAllRead() {
    markAllNotificationsAsRead(notifications, currentUser);
    setReadTick(t => t + 1);
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG, direction: 'rtl', overflow: 'hidden', position: 'relative' }}>

      {/* Artistic blurred background image */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <img src="/bg-meeting.jpg" alt="" style={{
          width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center',
          filter: 'blur(7px) saturate(0.82) brightness(1.04)',
          transform: 'scale(1.03)',
          opacity: 0.45,
          display: 'block',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 90% 70% at 48% 46%, rgba(248,246,255,0.52) 0%, transparent 78%), radial-gradient(ellipse 62% 55% at 102% -4%, rgba(124,58,237,0.28) 0%, transparent 62%), radial-gradient(ellipse 52% 42% at -4% 104%, rgba(245,158,11,0.18) 0%, transparent 58%)',
        }} />
      </div>

      {/* ═══ סיידבר ═══ */}
      <div
        ref={sidebarRef}
        style={{
          display: isMobile ? 'none' : 'flex',
          flexDirection: 'column',
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: open ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED,
          background: SIDEBAR_BG,
          backdropFilter: 'blur(22px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
          transition: 'width 0.36s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden', zIndex: 3000,
          boxShadow: open ? '-14px 0 52px rgba(10,4,36,0.60)' : '-5px 0 22px rgba(10,4,36,0.35)',
        }}
        onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); }}
        onMouseLeave={() => { closeTimer.current = setTimeout(() => setOpen(false), 200); }}
      >
        {/* ─── Header ─── */}
        <div style={{ padding: '18px 14px 14px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.08)', gap: 10, flexShrink: 0 }}>
          <button
            onClick={logout}
            onMouseEnter={() => setLogoHover(true)}
            onMouseLeave={() => setLogoHover(false)}
            title="יציאה מהמערכת"
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: logoHover
                ? 'linear-gradient(135deg, rgba(167,139,250,0.52) 0%, rgba(124,92,231,0.58) 100%)'
                : 'linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(109,78,202,0.28) 100%)',
              border: logoHover ? '1px solid rgba(167,139,250,0.6)' : '1px solid rgba(255,255,255,0.12)',
              cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: 15, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.22s ease',
              transform: logoHover ? 'scale(1.06)' : 'scale(1)',
              fontFamily: 'Rubik, sans-serif',
              boxShadow: logoHover ? '0 4px 20px rgba(167,139,250,0.4)' : 'none',
            }}>
            מ
          </button>
          <span style={{
            color: 'rgba(255,255,255,0.88)', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap',
            overflow: 'hidden', maxWidth: open ? 180 : 0, opacity: open ? 1 : 0,
            transition: 'opacity 0.22s ease, max-width 0.32s ease',
          }}>מקרבים</span>
        </div>

        {/* ─── ניווט ─── */}
        <div className="sidebar-nav" style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
          <NavItem href="/landing"        icon={<Home          {...ICO} />} label="מרכז הפעילות"       open={open} active={router.pathname === '/landing'}        onActivate={() => setOpen(true)} />
          {can.seeSensitiveData && (
            <NavItem href="/"             icon={<User          {...ICO} />} label="אזור אישי"           open={open} active={router.pathname === '/'}               highlight onActivate={() => setOpen(true)} />
          )}
          <NavItem href="/contacts"       icon={<Users         {...ICO} />} label="לקוחות"              open={open} active={router.pathname === '/contacts'}        onActivate={() => setOpen(true)} />
          {can.addContact && currentUser?.project_id === 1 && (
            <NavItem href="/my-dashboard" icon={<LayoutDashboard {...ICO} />} label="הדשבורד שלי"        open={open} active={router.pathname === '/my-dashboard'}     onActivate={() => setOpen(true)} />
          )}
          {can.addContact && currentUser?.project_id === 1 && (
            <NavItem href="/today"        icon={<Calendar      {...ICO} />} label="פעולות היום"         open={open} active={router.pathname === '/today'}           onActivate={() => setOpen(true)} />
          )}
          {can.addContact && (
            <NavItem href="/contacts/add" icon={<UserPlus      {...ICO} />} label="הוסף לקוח"          open={open} cta                                             onActivate={() => setOpen(true)} />
          )}
          {(can.addContact || can.seeMeetingHouses) && (
            <NavItem href="/base-meetings" icon={<ClipboardList {...ICO} />} label="מפגשי בסיס"        open={open} active={router.pathname === '/base-meetings'}    onActivate={() => setOpen(true)} />
          )}
          {can.seeActivists && (
            <NavItem href="/activists"    icon={<Star          {...ICO} />} label="פעילים"              open={open} active={router.pathname === '/activists'}        onActivate={() => setOpen(true)} />
          )}
          {can.seePayments && (
            <NavItem href="/payments"     icon={<CreditCard    {...ICO} />} label="דוחות תשלום פעילים" open={open} active={router.pathname === '/payments'}         onActivate={() => setOpen(true)} />
          )}
          <NavItem href="/reminders"      icon={<Bell          {...ICO} />} label="תזכורות קשר"         open={open} active={router.pathname === '/reminders'}        onActivate={() => setOpen(true)} />
          <NavItem href="/notifications"  icon={<BellRing      {...ICO} />} label="התראות מערכת"        open={open} active={router.pathname === '/notifications'}    onActivate={() => setOpen(true)} />
          <NavItem href="/chat"           icon={<MessageSquare {...ICO} />} label="צ׳אט פעילים"         open={open} active={router.pathname === '/chat'}             onActivate={() => setOpen(true)} />
          {(can.seeMeetingHouses || currentUser?.role === 'activist') && (
            <NavItem href="/meeting-houses"
              icon={<Building2 {...ICO} />}
              label="בתי מפגש חדשים"
              open={open}
              active={router.pathname.startsWith('/meeting-houses') && router.pathname !== '/meeting-houses/completed'}
              onActivate={() => setOpen(true)}
            />
          )}
          {can.seeMeetingHouses && (
            <NavItem href="/meeting-houses/completed"
              icon={<CheckCircle {...ICO} />}
              label="בתי מפגש שהסתיימו"
              open={open}
              active={router.pathname === '/meeting-houses/completed'}
              onActivate={() => setOpen(true)}
            />
          )}
          {can.seeMeetingHouseResults && (
            <NavItem href="/meeting-house-results"
              icon={<BarChart2 {...ICO} />}
              label="תוצאות בתי מפגש"
              open={open}
              active={router.pathname === '/meeting-house-results'}
              onActivate={() => setOpen(true)}
            />
          )}

          {!isActivist && (
            <>
              <div
                onClick={() => { setOpen(true); setProjectsOpen(p => !p); }}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', cursor: 'pointer', gap: 10, margin: '2px 6px', borderRadius: 11, transition: 'background 0.2s ease' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.58)', flexShrink: 0 }}>
                  <FolderOpen {...ICO} />
                </span>
                <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, flex: 1, whiteSpace: 'nowrap', fontWeight: 600, lineHeight: '18px', opacity: open ? 1 : 0, transform: open ? 'none' : 'translateX(6px)', transition: 'opacity 0.22s ease, transform 0.22s ease', pointerEvents: open ? 'auto' : 'none' }}>פרויקט</span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, opacity: open ? 1 : 0, transform: !open ? 'translateX(4px)' : projectsOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'opacity 0.22s ease, transform 0.22s ease', pointerEvents: open ? 'auto' : 'none' }}>▼</span>
              </div>
              {open && projectsOpen && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  {PROJECTS_LIST.map(p => {
                    const isActive = filterProject === p.id || (p.id === 0 && filterProject === null);
                    return (
                      <div key={p.id} onClick={() => { switchProject(p.id); setOpen(true); setProjectsOpen(false); }}
                        style={{ padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: isActive ? 600 : 400, color: isActive ? '#c4b5fd' : 'rgba(255,255,255,0.50)', background: isActive ? 'rgba(167,139,250,0.14)' : 'transparent', marginRight: 22, borderRadius: 8, whiteSpace: 'nowrap', transition: 'all 0.15s ease' }}>
                        {isActive ? '◉ ' : '○ '}{p.name}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── תחתית ─── */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          {open && (
            <div style={{ padding: '10px 16px 6px' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 3 }}>פרויקט פעיל</div>
              <div style={{ color: 'rgba(255,255,255,0.80)', fontWeight: 600, fontSize: 12 }}>{currentProjName}</div>
            </div>
          )}
          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #6d4eca 0%, #9c6ef0 100%)', boxShadow: '0 2px 10px rgba(109,78,202,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              {currentUser?.name?.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            {open && <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.name}</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 10 }}>{roleLabels[currentUser?.role]}</div>
              </div>
              <button onClick={logout}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.38)', fontSize: 11, cursor: 'pointer', fontFamily: 'Heebo, sans-serif', transition: 'color 0.18s ease' }}
                onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.85)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.38)'}>
                יציאה
              </button>
            </>}
          </div>
        </div>
      </div>

      {/* ═══ תוכן ═══ */}
      <div style={{ flex: 1, marginRight: isMobile ? 0 : SIDEBAR_COLLAPSED, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* כותרת */}
        <div style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', borderBottom: '0.5px solid rgba(0,0,0,0.06)', padding: isMobile ? '12px 16px' : '16px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, position: 'relative', zIndex: 2000 }}>
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
                <span style={{ position: 'absolute', top: -6, left: -6, minWidth: 18, height: 18, borderRadius: 99, background: '#e24b4a', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                  {unreadNotifications}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div style={{ position: 'fixed', top: 74, left: 28, width: 340, maxHeight: 430, overflowY: 'auto', background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 16, boxShadow: '0 22px 70px rgba(0,0,0,0.22)', zIndex: 100000, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px 10px', borderBottom: '0.5px solid #eee', marginBottom: 8 }}>
                  <b style={{ fontSize: 14, color: '#2d1f5e' }}>התראות מערכת</b>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {unreadNotifications > 0 && (
                      <button onClick={handleMarkAllRead}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: '#6c5ce7', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                        סמן הכל כנקרא
                      </button>
                    )}
                    <Link href="/notifications" style={{ fontSize: 12, color: '#6c5ce7', textDecoration: 'none', fontWeight: 800 }} onClick={() => setNotificationsOpen(false)}>לכל ההתראות</Link>
                  </div>
                </div>
                {notifications.slice(0, 5).map(n => (
                  <Link key={n.id} href={n.link || '/notifications'} style={{ textDecoration: 'none' }} onClick={() => handleNotificationClick(n)}>
                    <div style={{ padding: '10px 8px', borderRadius: 10, background: n.read ? '#fff' : (n.priority === 'high' ? '#fff7ec' : '#f7f5ff'), borderBottom: '0.5px solid #f1f1f1', opacity: n.read ? 0.62 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e24b4a', flexShrink: 0 }} />}
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#2d1f5e' }}>{n.title}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#666', lineHeight: 1.45 }}>{n.body.length > 96 ? n.body.slice(0, 96) + '...' : n.body}</div>
                    </div>
                  </Link>
                ))}
                {notifications.length === 0 && <div style={{ textAlign: 'center', color: '#aaa', padding: 20, fontSize: 13 }}>אין התראות</div>}
              </div>
            )}
            {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
          </div>
        </div>

        {/* תוכן */}
        <div className="premium-page-enter" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 16px 80px' : '22px 28px' }}>
          {children}
        </div>
      </div>

      {isMobile && <MobileBottomNav />}
    </div>
  );
}

function NavItem({ href, icon, label, open, active, highlight, cta, onActivate }) {
  const [hov, setHov] = useState(false);
  return (
    <Link href={href} style={{ textDecoration: 'none' }} onClick={onActivate}>
      <div
        className="premium-sidebar-item"
        style={{
          display: 'flex', alignItems: 'center',
          padding: cta ? '12px 13px' : '10px 13px',
          cursor: 'pointer', gap: 11,
          margin: cta ? '5px 6px' : '2px 6px',
          borderRadius: 11,
          background: active
            ? 'linear-gradient(135deg, rgba(167,139,250,0.26) 0%, rgba(124,92,231,0.20) 100%)'
            : cta
            ? hov
              ? 'linear-gradient(135deg, rgba(42,24,112,0.88) 0%, rgba(109,78,202,0.78) 100%)'
              : 'linear-gradient(135deg, rgba(42,24,112,0.72) 0%, rgba(109,78,202,0.62) 100%)'
            : hov
            ? 'rgba(255,255,255,0.09)'
            : highlight
            ? 'rgba(255,213,128,0.08)'
            : 'transparent',
          boxShadow: active
            ? '0 2px 20px rgba(167,139,250,0.18)'
            : cta
            ? '0 3px 14px rgba(42,24,112,0.32)'
            : 'none',
          borderRight: active ? '2.5px solid #a78bfa' : cta ? '2.5px solid rgba(167,139,250,0.55)' : '2.5px solid transparent',
          transition: 'background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
        }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
      >
        <span
          className="premium-sidebar-icon"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            color: active ? '#c4b5fd' : (cta || hov) ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.58)',
            filter: active ? 'drop-shadow(0 0 5px rgba(196,181,253,0.55))' : cta ? 'drop-shadow(0 0 4px rgba(167,139,250,0.45))' : 'none',
            transition: 'color 0.2s ease, filter 0.2s ease',
          }}
        >{icon}</span>
        <span style={{
          color: cta ? 'rgba(255,255,255,0.96)' : highlight ? '#fde68a' : active ? '#fff' : 'rgba(255,255,255,0.78)',
          fontSize: 14, whiteSpace: 'nowrap',
          fontWeight: (cta || active) ? 700 : 600,
          lineHeight: '18px',
          opacity: open ? 1 : 0,
          transform: open ? 'none' : 'translateX(6px)',
          transition: 'opacity 0.22s ease, transform 0.22s ease, color 0.18s ease',
          pointerEvents: open ? 'auto' : 'none',
        }}>{label}</span>
      </div>
    </Link>
  );
}
