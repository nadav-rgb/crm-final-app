// pages/index.jsx — אזור אישי לפעיל/רכז
import Link from 'next/link';
import BackLink from '../components/ui/BackLink';
import { useRouter } from 'next/router';
import getReminders from '../lib/getReminders';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { interactionsThisMonth, payableInteractionsThisMonth, getActivistPerformanceLabel } from '../lib/activistStats';
import { isDerivedInteraction } from '../lib/paymentCalc';

export default function Dashboard() {
  const router = useRouter();
  const { contacts, interactions, paymentConfig } = useCrm();
  const { can, activeProject, currentUser, filterProject } = useAuth();

  let visibleContacts = contacts;
  if (can.addContact) {
    visibleContacts = contacts.filter(c => c.activist_id === currentUser.id);
  } else if (filterProject !== null) {
    visibleContacts = contacts.filter(c => c.project_id === filterProject);
  }

  const enriched     = visibleContacts.map(c => ({ ...c, ...getReminders(c) })).filter(c => !c.isFormer);
  const needsRenew   = enriched.filter(c => c.status === 'דורש חידוש' || c.status === 'על סף ניתוק');
  const withActions  = enriched.filter(c => c.actionDue);

  // "קשרים החודש" = חודש קלנדרי, לא חלון מתגלגל של 30 יום. עד 2026-08 המונה גרר
  // לתוכו את סוף החודש הקודם ולא התאפס ב-1 בחודש (דיווח מוטי גלעד, 2026-08-02).
  // שורות נגזרות ממפגש רב-משתתפים לא נספרות — ראה isOwnReport ב-lib/activistStats.js.
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const myInteractionsCount = can.addContact
    ? interactionsThisMonth(currentUser.id, interactions)
    : interactions.filter(i => !isDerivedInteraction(i) && i.date?.slice(0, 7) === thisMonthKey).length;

  const payableCount = can.addContact
    // paymentConfig חובה — בלעדיו המונה מתמחר לפי ברירות המחדל בקוד ולא לפי payment_config,
    // ואז הוא ועמוד התשלומים חלוקים על מי תפס את המשבצת האחרונה במכסה.
    ? payableInteractionsThisMonth(currentUser.id, interactions, contacts, activeProject?.id, paymentConfig)
    : null;

  const perfLabel = can.addContact && currentUser
    ? getActivistPerformanceLabel(
        activeProject?.id === 1 ? payableCount : myInteractionsCount,
        activeProject?.id
      )
    : null;

return (
  <DesktopLayout
    title="אזור אישי"
    subtitle={`${activeProject?.name} · שלום, ${currentUser?.name}`}
    actions={can.addContact && (
      <Link href="/contacts/add" className="btn btn-primary" style={{ textDecoration: 'none', fontSize: 13 }}>
        + הוסף לקוח
      </Link>
    )}
  >
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      padding: '4px 0 24px'
    }}>
      {/* קשרים החודש — הבולט */}
      {can.addContact && (
        <div style={{ display: 'grid', gridTemplateColumns: activeProject?.id === 1 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 14, marginBottom: 24 }}>
          {/* קשרים החודש */}
          <div style={{ background: 'linear-gradient(135deg, #6c5ce7, #a29bfe)', borderRadius: 18, padding: '24px 20px', textAlign: 'center', boxShadow: '0 4px 20px rgba(108,92,231,0.3)', color: '#fff' }}>
            <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>{myInteractionsCount}</div>
            <div style={{ fontSize: 13, marginTop: 8, opacity: 0.85 }}>קשרים החודש</div>
          </div>

          {/* קשרים מזכים — אחדות יהודית בלבד */}
          {activeProject?.id === 1 && (
            <div style={{ background: 'linear-gradient(135deg, #27ae60, #2ecc71)', borderRadius: 18, padding: '24px 20px', textAlign: 'center', boxShadow: '0 4px 20px rgba(39,174,96,0.3)', color: '#fff' }}>
              <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>{payableCount}</div>
              <div style={{ fontSize: 13, marginTop: 8, opacity: 0.85 }}>קשרים מזכי תשלום</div>
            </div>
          )}

          {/* תואר */}
          {perfLabel && (
            <div style={{ background: perfLabel.bg, borderRadius: 18, padding: '24px 20px', textAlign: 'center', border: `2px solid ${perfLabel.color}` }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: perfLabel.color, lineHeight: 1 }}>
                {perfLabel.label.split(' ').slice(0, -1).join(' ')}
              </div>
              <div style={{ fontSize: 24 }}>{perfLabel.label.split(' ').slice(-1)}</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>דירוג חודשי</div>
            </div>
          )}
        </div>
      )}
{/* סטטיסטיקות */}
<div style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '24px',
  marginTop: 8,
  marginBottom: 44
}}>
  {[
    { num: visibleContacts.length, label: 'לקוחות', color: '#6c5ce7', rgb: '108,92,231', href: '/contacts' },
    { num: withActions.length, label: 'פעולות ממתינות', color: '#f59e0b', rgb: '245,158,11', href: '/reminders' },
    { num: needsRenew.length, label: 'דורשים חידוש', color: '#ef4444', rgb: '239,68,68', href: '/contacts' },
  ].map(({ num, label, color, rgb, href }) => (
    <div
      key={label}
      onClick={() => router.push(href)}
      style={{
        background: '#ffffff',
        borderRadius: '20px',
        padding: '32px 28px 28px',
        boxShadow: `0 0 0 1px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.10), 0 40px 64px rgba(0,0,0,0.06), 0 0 72px 10px rgba(${rgb},0.08)`,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        transition: 'transform 0.28s cubic-bezier(0.34,1.2,0.64,1), box-shadow 0.28s ease',
        cursor: 'pointer',
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
      {/* Thin colored top bar */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 3,
        background: `linear-gradient(90deg, ${color}, ${color}55)`,
        borderRadius: '20px 20px 0 0'
      }} />

      {/* Colored dot badge */}
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 10,
        background: `rgba(${rgb},0.10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
      </div>

      {/* Hero number */}
      <div style={{
        fontSize: 64,
        fontWeight: 800,
        color: '#0f172a',
        lineHeight: 1,
        letterSpacing: '-0.04em',
        fontVariantNumeric: 'tabular-nums'
      }}>
        {num}
      </div>

      {/* Label — clearly secondary */}
      <div style={{
        fontSize: 12,
        fontWeight: 500,
        color: '#94a3b8',
        letterSpacing: '0.02em',
        marginTop: 10
      }}>
        {label}
      </div>
    </div>
  ))}
</div>

      {/* לקוחות דורשים חידוש */}
      {needsRenew.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>דורשים תשומת לב</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginBottom: 24 }}>
            {needsRenew.slice(0, 6).map(c => (
              <div key={c.id} style={{ background: '#fffaf5', borderRadius: 12, padding: '12px 14px', border: '0.5px solid rgba(0,0,0,0.06)', borderRight: `3px solid ${c.status === 'על סף ניתוק' ? '#e74c3c' : '#f39c12'}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: '#aaa' }}>{c.city} · {c.days_since_last_contact} ימים</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  <BackLink href={`/contact/${c.id}?from=personal`} direction="forward"
                    style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>
                    צפייה
                  </BackLink>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  </DesktopLayout>
);
}
