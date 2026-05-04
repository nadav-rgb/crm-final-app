import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthStore';
import { Home, Users, ClipboardList, Bell } from 'lucide-react';

const BG = 'linear-gradient(180deg, rgba(42,24,112,0.97) 0%, rgba(58,36,155,0.94) 52%, rgba(35,20,100,0.97) 100%)';

export default function MobileBottomNav() {
  const router = useRouter();
  const { can } = useAuth();

  const items = [
    { href: '/landing',       icon: <Home         size={22} strokeWidth={1.8} />, label: 'בית' },
    { href: '/contacts',      icon: <Users        size={22} strokeWidth={1.8} />, label: 'לקוחות' },
    ...(can.addContact || can.seeMeetingHouses
      ? [{ href: '/base-meetings', icon: <ClipboardList size={22} strokeWidth={1.8} />, label: 'מפגשים' }]
      : []),
    { href: '/reminders',     icon: <Bell         size={22} strokeWidth={1.8} />, label: 'תזכורות' },
  ];

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: 60,
      background: BG,
      backdropFilter: 'blur(22px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      zIndex: 4000,
      borderTop: '1px solid rgba(255,255,255,0.10)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      direction: 'rtl',
    }}>
      {items.map(item => {
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
    </div>
  );
}
