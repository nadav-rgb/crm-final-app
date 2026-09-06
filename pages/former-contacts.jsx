// pages/former-contacts.jsx — לקוחות לשעבר
import Link from 'next/link';
import BackLink from '../components/ui/BackLink';
import getReminders from '../lib/getReminders';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';

export default function FormerContactsPage() {
  const { contacts } = useCrm();
  const { can, currentUser, filterProject } = useAuth();

  let visible = contacts;
  if (can.addContact) {
    visible = contacts.filter(c => c.activist_id === currentUser.id);
  } else if (filterProject !== null) {
    visible = contacts.filter(c => c.project_id === filterProject);
  }

  const former = visible
    .map(c => ({ ...c, ...getReminders(c) }))
    .filter(c => c.isFormer)
    .sort((a, b) => b.days_since_last_contact - a.days_since_last_contact);

  return (
    <DesktopLayout title="לקוחות לשעבר" subtitle={`${former.length} לקוחות`}
      backHref="/contacts" backLabel="חזרה ללקוחות">
      {former.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#ccc' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>אין לקוחות לשעבר</div>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid rgba(0,0,0,0.07)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          {former.map((c, idx) => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              borderBottom: idx === former.length - 1 ? 'none' : '0.5px solid #f5f5f5',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#888' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: '#bbb', marginTop: 2 }}>
                  {c.city} · לפני {c.days_since_last_contact} ימים ללא קשר
                </div>
              </div>
              <Link href={`/contact/add-interaction/${c.id}?returning=true`}
                style={{ textDecoration: 'none' }}>
                <button style={{
                  background: '#edfaf1', border: '1.5px solid #27ae60', color: '#27ae60',
                  borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'Rubik, sans-serif', transition: 'all 0.18s ease',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#27ae60'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#edfaf1'; e.currentTarget.style.color = '#27ae60'; }}>
                  שב לפעילות
                </button>
              </Link>
              <BackLink href={`/contact/${c.id}?from=former`} direction="forward">
                צפייה
              </BackLink>
            </div>
          ))}
        </div>
      )}
    </DesktopLayout>
  );
}
