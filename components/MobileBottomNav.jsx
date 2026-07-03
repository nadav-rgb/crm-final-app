import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthStore';
import {
  Home, Users, ClipboardList, Bell,
  MoreHorizontal, User, Calendar, UserPlus,
  Star, CreditCard, BellRing, MessageSquare,
  Building2, CheckCircle, BarChart2, LogOut,
  LayoutDashboard, Receipt,
} from 'lucide-react';

const BG = 'linear-gradient(180deg, rgba(42,24,112,0.97) 0%, rgba(58,36,155,0.94) 52%, rgba(35,20,100,0.97) 100%)';
const ICO = { size: 20, strokeWidth: 1.8 };

export default function MobileBottomNav() {
  const router = useRouter();
  const { can, currentUser, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const mainItems = [
    { href: '/landing',       icon: <Home        size={22} strokeWidth={1.8} />, label: 'בית' },
    { href: '/contacts',      icon: <Users       size={22} strokeWidth={1.8} />, label: 'לקוחות' },
    ...(can.addContact || can.seeMeetingHouses
      ? [{ href: '/base-meetings', icon: <ClipboardList size={22} strokeWidth={1.8} />, label: 'מפגשים' }]
      : []),
    { href: '/reminders',     icon: <Bell        size={22} strokeWidth={1.8} />, label: 'תזכורות' },
  ];

  const drawerItems = [
    can.seeSensitiveData && { href: '/',                          icon: <User         {...ICO} />, label: 'אזור אישי' },
    (can.addContact && currentUser?.project_id === 1) && { href: '/my-dashboard', icon: <LayoutDashboard {...ICO} />, label: 'הדשבורד שלי' },
    (can.addContact && currentUser?.project_id === 1) && { href: '/today', icon: <Calendar {...ICO} />, label: 'פעולות היום' },
    can.addContact && { href: '/contacts/add',                    icon: <UserPlus     {...ICO} />, label: 'הוסף לקוח' },
    can.seeActivists && { href: '/activists',                     icon: <Star         {...ICO} />, label: 'פעילים' },
    can.seePayments && { href: '/payments',                       icon: <CreditCard   {...ICO} />, label: 'דוחות תשלום' },
    { href: '/expenses',                                          icon: <Receipt      {...ICO} />, label: 'דיווח הוצאות' },
    { href: '/notifications',                                     icon: <BellRing     {...ICO} />, label: 'התראות מערכת' },
    { href: '/chat',                                              icon: <MessageSquare {...ICO} />, label: 'צ׳אט פעילים' },
    (can.seeMeetingHouses || currentUser?.role === 'activist') && { href: '/meeting-houses', icon: <Building2 {...ICO} />, label: 'בתי מפגש חדשים' },
    can.seeMeetingHouses && { href: '/meeting-houses/completed',  icon: <CheckCircle  {...ICO} />, label: 'בתי מפגש שהסתיימו' },
    can.seeMeetingHouseResults && { href: '/meeting-house-results', icon: <BarChart2  {...ICO} />, label: 'תוצאות בתי מפגש' },
  ].filter(Boolean);

  const drawerActive = drawerItems.some(item =>
    router.pathname === item.href ||
    (item.href !== '/landing' && router.pathname.startsWith(item.href))
  );

  return (
    <>
      {/* Backdrop */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            zIndex: 4500,
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', bottom: 60, left: 0, right: 0,
        background: BG,
        borderRadius: '20px 20px 0 0',
        zIndex: 4600,
        transform: drawerOpen ? 'translateY(0)' : 'translateY(105%)',
        transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
        maxHeight: '72vh',
        overflowY: 'auto',
        direction: 'rtl',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -8px 40px rgba(10,4,36,0.55)',
      }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.22)', borderRadius: 99, margin: '12px auto 8px' }} />

        {/* Title */}
        <div style={{ padding: '4px 20px 12px', fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 600, letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          ניווט מהיר
        </div>

        {/* Items */}
        <div style={{ padding: '8px 0 16px' }}>
          {drawerItems.map(item => {
            const active = router.pathname === item.href ||
              (item.href !== '/landing' && router.pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                style={{ textDecoration: 'none' }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '13px 22px',
                  background: active ? 'rgba(167,139,250,0.16)' : 'transparent',
                  borderRight: active ? '3px solid #a78bfa' : '3px solid transparent',
                  transition: 'background 0.15s ease',
                }}>
                  <span style={{
                    color: active ? '#c4b5fd' : 'rgba(255,255,255,0.60)',
                    display: 'flex',
                    filter: active ? 'drop-shadow(0 0 5px rgba(196,181,253,0.5))' : 'none',
                  }}>
                    {item.icon}
                  </span>
                  <span style={{
                    fontSize: 15,
                    color: active ? '#fff' : 'rgba(255,255,255,0.82)',
                    fontWeight: active ? 700 : 500,
                    fontFamily: 'Rubik, sans-serif',
                  }}>
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}

          {/* יציאה — תמיד אחרון */}
          <button
            onClick={() => { setDrawerOpen(false); logout(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '13px 22px', width: '100%',
              background: 'transparent', border: 'none',
              borderRight: '3px solid transparent', cursor: 'pointer',
              fontFamily: 'Rubik, sans-serif', textAlign: 'right',
              borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 4,
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.60)', display: 'flex' }}>
              <LogOut {...ICO} />
            </span>
            <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.82)', fontWeight: 500 }}>
              יציאה
            </span>
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 60,
        background: BG,
        backdropFilter: 'blur(22px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        zIndex: 4700,
        borderTop: '1px solid rgba(255,255,255,0.10)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        direction: 'rtl',
      }}>
        {mainItems.map(item => {
          const active = router.pathname === item.href ||
            (item.href !== '/landing' && router.pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{ textDecoration: 'none', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '6px 0' }}
            >
              <span style={{
                color: active ? '#c4b5fd' : 'rgba(255,255,255,0.50)',
                display: 'flex',
                filter: active ? 'drop-shadow(0 0 5px rgba(196,181,253,0.55))' : 'none',
                transition: 'color 0.2s ease',
              }}>
                {item.icon}
              </span>
              <span style={{
                fontSize: 10,
                color: active ? '#c4b5fd' : 'rgba(255,255,255,0.50)',
                fontWeight: active ? 700 : 500,
                fontFamily: 'Rubik, sans-serif',
                transition: 'color 0.2s ease',
              }}>
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* עוד */}
        <button
          onClick={() => setDrawerOpen(v => !v)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 3, padding: '6px 0',
            background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <span style={{
            color: (drawerOpen || drawerActive) ? '#c4b5fd' : 'rgba(255,255,255,0.50)',
            display: 'flex',
            filter: (drawerOpen || drawerActive) ? 'drop-shadow(0 0 5px rgba(196,181,253,0.55))' : 'none',
            transition: 'color 0.2s ease, transform 0.25s ease',
            transform: drawerOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>
            <MoreHorizontal size={22} strokeWidth={1.8} />
          </span>
          <span style={{
            fontSize: 10,
            color: (drawerOpen || drawerActive) ? '#c4b5fd' : 'rgba(255,255,255,0.50)',
            fontWeight: (drawerOpen || drawerActive) ? 700 : 500,
            fontFamily: 'Rubik, sans-serif',
            transition: 'color 0.2s ease',
          }}>
            עוד
          </span>
        </button>
      </div>
    </>
  );
}
