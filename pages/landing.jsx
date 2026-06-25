// pages/landing.jsx
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import { getNotificationsForUser } from '../lib/notificationDemo';
import Link from 'next/link';
import {
  Home, User, Users, Calendar, UserPlus,
  ClipboardList, Star, CreditCard, Bell, BellRing,
  MessageSquare, Building2, FolderOpen,
} from 'lucide-react';
import MobileBottomNav from '../components/MobileBottomNav';

const TORAH_DEFAULT = 'וְאָהַבְתָּ לְרֵעֲךָ כָּמוֹךָ — זה כלל גדול בתורה. כל מי שמקרב יהודי אחד לאביו שבשמים, כאילו קיים עולם מלא. השבוע נזכור שכל שיחה, כל פגישה, כל חיוך — הם צינור להאיר את עולמם של אחינו.';

const PROJECTS = [
  { id: 0, name: 'כל הפרויקטים' },
  { id: 1, name: 'אחדות יהודית' },
  { id: 2, name: 'נעים להכיר' },
  { id: 3, name: 'שבת מכל הסיבות' },
  { id: 4, name: 'נפש יהודי' },
];

const BG = 'linear-gradient(148deg, #f5f2ff 0%, #fafaf9 50%, #fffdf5 100%)';

// Matches DesktopLayout exactly
const SIDEBAR_BG = 'linear-gradient(180deg, rgba(42,24,112,0.90) 0%, rgba(58,36,155,0.86) 52%, rgba(35,20,100,0.90) 100%)';
const SIDEBAR_COLLAPSED = 64;
const SIDEBAR_EXPANDED  = 240;
const ICO = { size: 18, strokeWidth: 1.8 };

export default function LandingPage() {
  const { currentUser, activeProject, switchProject, logout, can } = useAuth();
  const { contacts, interactions, activists, messages, baseMeetings } = useCrm();
  const router = useRouter();

  const isActivist = currentUser?.role === 'activist';
  const isCeo      = currentUser?.role === 'ceo' || currentUser?.role === 'head';

  const [open,              setOpen]             = useState(false);
  const [projectsOpen,      setProjectsOpen]     = useState(false);
  const [selectedProj,      setSelectedProj]     = useState(isCeo ? 0 : (currentUser?.project_id ?? 0));
  const [torahText,         setTorahText]        = useState(TORAH_DEFAULT);
  const [editingTorah,      setEditingTorah]     = useState(false);
  const [torahDraft,        setTorahDraft]       = useState(TORAH_DEFAULT);
  const [notificationsOpen, setNotificationsOpen]= useState(false);
  const [isMobile,          setIsMobile]         = useState(false);
  const scrollRef  = useRef(null);
  const sidebarRef = useRef(null);
  const closeTimer = useRef(null);
  useEffect(() => { if (sidebarRef.current?.matches(':hover')) setOpen(true); }, []);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const notifications       = getNotificationsForUser(currentUser, baseMeetings);
  const unreadNotifications = notifications.filter(n => !n.read).length;

  // פעילות אחרונה — פעיל רואה רק את הפרויקט שלו, מנכ"ל לפי פרויקט נבחר
  const filteredInteractions = isActivist
    ? interactions.filter(i => {
        const contact = contacts.find(c => c.id === i.contact_id);
        return contact?.project_id === currentUser?.project_id;
      })
    : selectedProj === 0 ? interactions : interactions.filter(i => {
        const contact = contacts.find(c => c.id === i.contact_id);
        return contact?.project_id === selectedProj;
      });

  const filteredContacts = isActivist
    ? contacts.filter(c => c.activist_id === currentUser.id)
    : selectedProj === 0 ? contacts : contacts.filter(c => c.project_id === selectedProj);

  const recentActivity = [...filteredInteractions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(i => {
      const activist = activists.find(a => a.id === i.activist_id);
      const contact  = contacts.find(c => c.id === i.contact_id);
      return { ...i, activistName: activist?.name ?? '—', contactName: contact?.name ?? i.contact_name };
    });

  // גלילה ידנית
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragScrollLeft = useRef(0);
  const mouseDownRef = useRef(false);

  const handleMouseDown = e => {
    mouseDownRef.current = true;
    isDragging.current = false;
    dragStartX.current = e.pageX;
    dragScrollLeft.current = scrollRef.current.scrollLeft;
    scrollRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = e => {
    if (!mouseDownRef.current) return;
    const diff = e.pageX - dragStartX.current;
    if (Math.abs(diff) > 3) isDragging.current = true;
    scrollRef.current.scrollLeft = dragScrollLeft.current - diff;
  };

  const handleMouseUp = () => {
    mouseDownRef.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  };

  const outcomeColor = { 'חיובי': '#3b6d11', 'שלילי': '#a32d2d', 'ניטרלי': '#8b6d3f', 'ממתין למענה': '#854f0b' };
  const outcomeBg    = { 'חיובי': '#eaf3de', 'שלילי': '#fcebeb', 'ניטרלי': '#fdf6ef', 'ממתין למענה': '#faeeda' };

  const stats = [
    { num: filteredContacts.length, label: 'סה"כ לקוחות', color: '#c47a2e', rgb: '196,122,46', href: '/contacts' },
    { num: filteredInteractions.length, label: 'סה"כ קשרים', color: '#8b6d3f', rgb: '139,109,63', href: '/contacts' },
    { num: activists.filter(a => a.role === 'activist' && a.status === 'active').length, label: 'פעילים פעילים', color: '#c47a2e', rgb: '196,122,46', href: can.seeActivists ? '/activists' : null },
    { num: filteredContacts.filter(c => c.days_since_last_contact >= 30).length, label: 'על סף ניתוק', color: '#a32d2d', rgb: '163,45,45', href: '/contacts' },
  ];

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

      {/* ═══ סיידבר — overlay, not push, matches DesktopLayout ═══ */}
      <div
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
          boxShadow: open
            ? '-14px 0 52px rgba(10,4,36,0.60)'
            : '-5px 0 22px rgba(10,4,36,0.35)',
        }}
        ref={sidebarRef}
        onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); }}
        onMouseLeave={() => { closeTimer.current = setTimeout(() => setOpen(false), 200); }}
      >

        {/* ─── Header ─── */}
        <div style={{
          padding: '18px 14px 14px',
          display: 'flex', alignItems: 'center',
          justifyContent: 'flex-start',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          gap: 10,
          flexShrink: 0,
        }}>
          <button
            onClick={logout}
            title="יציאה מהמערכת"
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(109,78,202,0.28) 100%)',
              border: '1px solid rgba(255,255,255,0.12)',
              cursor: 'pointer', color: '#fff',
              fontWeight: 700, fontSize: 15, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.22s ease',
              fontFamily: 'Rubik, sans-serif',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(167,139,250,0.52) 0%, rgba(124,92,231,0.58) 100%)';
              e.currentTarget.style.border = '1px solid rgba(167,139,250,0.6)';
              e.currentTarget.style.transform = 'scale(1.06)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(167,139,250,0.4)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(109,78,202,0.28) 100%)';
              e.currentTarget.style.border = '1px solid rgba(255,255,255,0.12)';
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = 'none';
            }}>
            מ
          </button>
          <span style={{
            color: 'rgba(255,255,255,0.88)',
            fontWeight: 700,
            fontSize: 15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            maxWidth: open ? 180 : 0,
            opacity: open ? 1 : 0,
            transition: 'opacity 0.22s ease, max-width 0.32s ease',
          }}>מקרבים</span>
        </div>

        {/* ─── ניווט ─── */}
        <div className="sidebar-nav" style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
          <SideItem icon={<Home    {...ICO} />} label="מרכז הפעילות" open={open} active />
          {can.seeSensitiveData && (
            <SideItem icon={<User  {...ICO} />} label="אזור אישי"    open={open} onClick={() => router.push('/')} />
          )}
          <SideItem icon={<Users {...ICO} />} label="לקוחות" open={open} onClick={() => router.push('/contacts')} />

          {can.addContact && currentUser?.project_id === 1 && (
            <SideItem icon={<Calendar     {...ICO} />} label="פעולות היום"    open={open} onClick={() => router.push('/today')} />
          )}
          {can.addContact && (
            <SideItem icon={<UserPlus     {...ICO} />} label="הוסף לקוח"      open={open} onClick={() => router.push('/contacts/add')} cta />
          )}
          {(can.addContact || can.seeMeetingHouses) && (
            <SideItem icon={<ClipboardList {...ICO} />} label="מפגשי בסיס"    open={open} onClick={() => router.push('/base-meetings')} />
          )}

          {can.seeActivists && (
            <SideItem icon={<Star         {...ICO} />} label="פעילים"         open={open} onClick={() => router.push('/activists')} />
          )}
          {can.seePayments && (
            <SideItem icon={<CreditCard   {...ICO} />} label="דוחות תשלום"    open={open} onClick={() => router.push('/payments')} />
          )}
          <SideItem icon={<Bell           {...ICO} />} label="תזכורות קשר"    open={open} onClick={() => router.push('/reminders')} />
          <SideItem icon={<BellRing       {...ICO} />} label="התראות מערכת"   open={open} onClick={() => router.push('/notifications')} />
          <SideItem icon={<MessageSquare  {...ICO} />} label="צ׳אט פעילים"    open={open} onClick={() => router.push('/chat')} />
          {(can.seeMeetingHouses || currentUser?.role === 'activist') && (
            <SideItem icon={<Building2    {...ICO} />} label="בתי מפגש"       open={open} onClick={() => router.push('/meeting-houses')} />
          )}

          {/* פרויקטים — רק למנכ"ל וראש פרויקט */}
          {!isActivist && (
            <>
              <div
                onClick={() => { setProjectsOpen(p => !p); if (!open) setOpen(true); }}
                style={{
                  display: 'flex', alignItems: 'center', padding: '10px 13px',
                  cursor: 'pointer', gap: 10, margin: '2px 6px', borderRadius: 11,
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.58)', flexShrink: 0 }}>
                  <FolderOpen {...ICO} />
                </span>
                <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, flex: 1, whiteSpace: 'nowrap', fontWeight: 600, lineHeight: '18px', opacity: open ? 1 : 0, transform: open ? 'none' : 'translateX(6px)', transition: 'opacity 0.22s ease, transform 0.22s ease', pointerEvents: open ? 'auto' : 'none' }}>פרויקט</span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, opacity: open ? 1 : 0, transform: open ? 'none' : 'translateX(4px)', transition: 'opacity 0.22s ease, transform 0.22s ease', pointerEvents: open ? 'auto' : 'none' }}>{projectsOpen ? '▲' : '▼'}</span>
              </div>
              {open && projectsOpen && PROJECTS.map(p => (
                <div key={p.id} onClick={() => { setSelectedProj(p.id); switchProject(p.id); setProjectsOpen(false); }}
                  style={{
                    padding: '7px 14px', fontSize: 13, cursor: 'pointer',
                    color: selectedProj === p.id ? '#c4b5fd' : 'rgba(255,255,255,0.50)',
                    background: selectedProj === p.id ? 'rgba(167,139,250,0.14)' : 'transparent',
                    fontWeight: selectedProj === p.id ? 600 : 400,
                    marginRight: 20, borderRadius: 8, whiteSpace: 'nowrap', transition: 'all 0.15s ease',
                  }}>
                  {selectedProj === p.id ? '◉ ' : '○ '}{p.name}
                </div>
              ))}
            </>
          )}
        </div>

        {/* ─── תחתית ─── */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          {open && (
            <div style={{ padding: '10px 16px 6px' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 3 }}>פרויקט פעיל</div>
              <div style={{ color: 'rgba(255,255,255,0.80)', fontWeight: 600, fontSize: 12 }}>
                {isActivist ? activeProject?.name : selectedProj === 0 ? 'כל הפרויקטים' : PROJECTS.find(p => p.id === selectedProj)?.name}
              </div>
            </div>
          )}
          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6d4eca 0%, #9c6ef0 100%)',
              boxShadow: '0 2px 10px rgba(109,78,202,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {currentUser?.name?.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            {open && <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.name}</div>
              </div>
              <button
                onClick={logout}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.38)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.18s ease' }}
                onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.85)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.38)'}>
                יציאה
              </button>
            </>}
          </div>
        </div>
      </div>

      {/* ═══ תוכן — overlay: always collapsed margin, sidebar overlays on expand ═══ */}
      <div style={{ flex: 1, marginRight: isMobile ? 0 : SIDEBAR_COLLAPSED, overflowY: 'auto', padding: isMobile ? '16px 16px 80px' : '28px 36px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#3d2c1e' }}>מרכז הפעילות</div>
            <div style={{ fontSize: 13, color: '#a08060', marginTop: 4 }}>
              ברוך הבא, {currentUser?.name} · {isActivist ? activeProject?.name : selectedProj === 0 ? 'כל הפרויקטים' : PROJECTS.find(p => p.id === selectedProj)?.name}
            </div>
          </div>

          {/* פעמון התראות */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setNotificationsOpen(v => !v)}
              style={{ position: 'relative', width: 40, height: 40, borderRadius: 12, border: '1.5px solid rgba(196,122,46,0.25)', background: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              🔔
              {unreadNotifications > 0 && (
                <span style={{ position: 'absolute', top: -6, left: -6, minWidth: 18, height: 18, borderRadius: 99, background: '#e24b4a', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                  {unreadNotifications}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div style={{ position: 'absolute', top: 48, left: 0, width: 340, maxHeight: 430, overflowY: 'auto', background: '#fff', border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 16, boxShadow: '0 22px 70px rgba(0,0,0,0.22)', zIndex: 10000, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px 10px', borderBottom: '0.5px solid #eee', marginBottom: 8 }}>
                  <b style={{ fontSize: 14, color: '#2d1f5e' }}>התראות מערכת</b>
                  <Link href="/notifications" style={{ fontSize: 12, color: '#6c5ce7', textDecoration: 'none', fontWeight: 800 }} onClick={() => setNotificationsOpen(false)}>לכל ההתראות</Link>
                </div>
                {notifications.slice(0, 5).map(n => (
                  <Link key={n.id} href={n.link || '/notifications'} style={{ textDecoration: 'none' }} onClick={() => setNotificationsOpen(false)}>
                    <div style={{ padding: '10px 8px', borderRadius: 10, background: n.priority === 'high' ? '#fff7ec' : '#fff', borderBottom: '0.5px solid #f1f1f1' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#2d1f5e', marginBottom: 3 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: '#666', lineHeight: 1.45 }}>{n.body.length > 96 ? n.body.slice(0, 96) + '...' : n.body}</div>
                    </div>
                  </Link>
                ))}
                {notifications.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#aaa', padding: 20, fontSize: 13 }}>אין התראות</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* סטטיסטיקות */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: isMobile ? '10px' : '20px', marginTop: 8, marginBottom: 44 }}>
          {stats.map(({ num, label, color, rgb, href }) => (
            <div
              key={label}
              onClick={href ? () => router.push(href) : undefined}
              style={{
                background: '#ffffff',
                borderRadius: '20px',
                padding: isMobile ? '16px 8px 14px' : '28px 22px 24px',
                boxShadow: `0 0 0 1px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.10), 0 40px 64px rgba(0,0,0,0.06), 0 0 72px 10px rgba(${rgb},0.08)`,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                transition: 'transform 0.28s cubic-bezier(0.34,1.2,0.64,1), box-shadow 0.28s ease',
                cursor: href ? 'pointer' : 'default',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-7px)';
                e.currentTarget.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.07), 0 8px 20px rgba(0,0,0,0.08), 0 28px 52px rgba(0,0,0,0.13), 0 56px 80px rgba(0,0,0,0.07), 0 0 96px 14px rgba(${rgb},0.12)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.10), 0 40px 64px rgba(0,0,0,0.06), 0 0 72px 10px rgba(${rgb},0.08)`;
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, ${color}55)`, borderRadius: '20px 20px 0 0' }} />
              <div style={{ width: 32, height: 32, borderRadius: 10, background: `rgba(${rgb},0.10)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
              </div>
              <div style={{ fontSize: isMobile ? 38 : 64, fontWeight: 800, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{num}</div>
              <div style={{ fontSize: isMobile ? 10 : 12, fontWeight: 500, color: '#94a3b8', letterSpacing: '0.02em', marginTop: isMobile ? 6 : 10, textAlign: 'center' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* פעילות אחרונה */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#3d2c1e', marginBottom: 12 }}>פעילות אחרונה</div>
          <div ref={scrollRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ display: 'flex', gap: 12, overflowX: 'scroll', paddingBottom: 8, cursor: 'grab', scrollbarWidth: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>
            {recentActivity.length === 0
              ? <div style={{ color: '#a08060', fontSize: 13 }}>אין פעילות מתועדת</div>
              : recentActivity.map((item, idx) => (
                <div key={idx}
                  onClick={() => { if (isDragging.current) { isDragging.current = false; return; } router.push(`/contact/${item.contact_id}?from=landing`); }}
                  style={{ minWidth: 170, background: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(196,122,46,0.2)', borderRadius: 12, padding: '14px 16px', flexShrink: 0, cursor: 'pointer', borderTop: `3px solid ${outcomeColor[item.outcome] ?? '#c47a2e'}`, transition: 'transform 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <div style={{ fontSize: 11, color: '#c4a882', marginBottom: 8 }}>{item.date}{item.time ? ` · ${item.time}` : ''}</div>
                  {item.project_id && <div style={{ fontSize: 10, color: '#7c5cbf', marginBottom: 6, fontWeight: 500 }}>📁 {['','אחדות יהודית','נעים להכיר','שבת מכל הסיבות','נפש יהודי'][item.project_id] ?? ''}</div>}
                  <div style={{ fontSize: 11, color: '#a08060', marginBottom: 2 }}>פעיל</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#3d2c1e', marginBottom: 6 }}>{item.activistName}</div>
                  <div style={{ fontSize: 11, color: '#a08060', marginBottom: 2 }}>סוג קשר</div>
                  <div style={{ fontSize: 12, color: '#7c5cbf', marginBottom: 6 }}>{item.type}</div>
                  <div style={{ fontSize: 11, color: '#a08060', marginBottom: 2 }}>לקוח</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#3d2c1e', marginBottom: 8 }}>{item.contactName}</div>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: outcomeBg[item.outcome] ?? '#fdf6ef', color: outcomeColor[item.outcome] ?? '#8b6d3f', fontWeight: 500 }}>
                    {item.quality || item.type}
                  </span>
                </div>
              ))
            }
          </div>
        </div>

        {/* דבר תורה */}
        <div style={{ background: 'rgba(255,255,255,0.75)', borderRadius: 16, padding: '20px 24px', border: '0.5px solid rgba(196,122,46,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#3d2c1e' }}>דבר תורה שבועי</div>
              <div style={{ fontSize: 12, color: '#a08060', marginTop: 2 }}>מפי הרב גרינבוים</div>
            </div>
            {currentUser?.role === 'ceo' && !editingTorah && (
              <button onClick={() => { setTorahDraft(torahText); setEditingTorah(true); }}
                style={{ background: 'rgba(124,92,191,0.1)', border: '0.5px solid rgba(124,92,191,0.3)', color: '#7c5cbf', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                עריכה
              </button>
            )}
          </div>
          {editingTorah ? (
            <>
              <textarea value={torahDraft} onChange={e => setTorahDraft(e.target.value)}
                style={{ width: '100%', minHeight: 100, background: 'rgba(255,255,255,0.8)', border: '0.5px solid rgba(196,122,46,0.3)', borderRadius: 8, padding: 12, color: '#3d2c1e', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit', resize: 'vertical', direction: 'rtl', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => { setTorahText(torahDraft); setEditingTorah(false); }}
                  style={{ background: '#534ab7', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>שמור</button>
                <button onClick={() => setEditingTorah(false)}
                  style={{ background: 'rgba(0,0,0,0.06)', border: 'none', color: '#777', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>ביטול</button>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 15, color: '#5d4030', lineHeight: 2, margin: 0 }}>{torahText}</p>
          )}
        </div>

        {/* הודעות מערכת */}
        {messages && messages.filter(m => m.project_id === null || m.project_id === activeProject?.id).length > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.75)', borderRadius: 16, padding: '20px 24px', border: '0.5px solid rgba(196,122,46,0.2)', marginTop: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#3d2c1e', marginBottom: 14 }}>📢 הודעות מערכת</div>
            {messages
              .filter(m => m.project_id === null || m.project_id === activeProject?.id)
              .map(msg => (
                <div key={msg.id} style={{ borderBottom: '0.5px solid rgba(196,122,46,0.15)', paddingBottom: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#3d2c1e' }}>
                      {msg.pinned && '📌 '}{msg.title}
                    </div>
                    <span style={{ fontSize: 11, color: '#c4a882', whiteSpace: 'nowrap', marginRight: 8 }}>{msg.date}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#7a5c3c', lineHeight: 1.7 }}>{msg.body}</div>
                  <div style={{ fontSize: 11, color: '#c4a882', marginTop: 4 }}>— {msg.from_name}</div>
                </div>
              ))
            }
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>

      {isMobile && <MobileBottomNav />}
    </div>
  );
}

function SideItem({ icon, label, open, onClick, active, highlight, cta }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
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
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        color: active ? '#c4b5fd' : (cta || hov) ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.58)',
        filter: active ? 'drop-shadow(0 0 5px rgba(196,181,253,0.55))' : cta ? 'drop-shadow(0 0 4px rgba(167,139,250,0.45))' : 'none',
        transition: 'color 0.2s ease, filter 0.2s ease',
      }}>{icon}</span>
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
  );
}
