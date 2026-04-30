// pages/index.jsx — אזור אישי לפעיל/רכז
import Link from 'next/link';
import getReminders from '../lib/getReminders';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { interactionsLast30, payableInteractionsLast30, getActivistPerformanceLabel } from '../lib/activistStats';

export default function Dashboard() {
  const { contacts, interactions } = useCrm();
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

  const myInteractionsCount = can.addContact
    ? interactionsLast30(currentUser.id, interactions)
    : interactions.filter(i => {
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
        return new Date(i.date) >= cutoff;
      }).length;

  const payableCount = can.addContact
    ? payableInteractionsLast30(currentUser.id, interactions, contacts, activeProject?.id)
    : null;

  const perfLabel = can.addContact && currentUser
    ? getActivistPerformanceLabel(
        activeProject?.id === 2 ? payableCount : myInteractionsCount,
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
      {/* קשרים החודש — הבולט */}
      {can.addContact && (
        <div style={{ display: 'grid', gridTemplateColumns: activeProject?.id === 2 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 14, marginBottom: 24 }}>
          {/* קשרים החודש */}
          <div style={{ background: 'linear-gradient(135deg, #6c5ce7, #a29bfe)', borderRadius: 18, padding: '24px 20px', textAlign: 'center', boxShadow: '0 4px 20px rgba(108,92,231,0.3)', color: '#fff' }}>
            <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>{myInteractionsCount}</div>
            <div style={{ fontSize: 13, marginTop: 8, opacity: 0.85 }}>קשרים החודש</div>
          </div>

          {/* קשרים מזכים — אחדות יהודית בלבד */}
          {activeProject?.id === 2 && (
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { num: visibleContacts.length,  label: 'לקוחות', color: '#6c5ce7' },
          { num: withActions.length,      label: 'פעולות ממתינות', color: '#f39c12' },
          { num: needsRenew.length,       label: 'דורשים חידוש', color: '#e74c3c' },
        ].map(({ num, label, color }) => (
          <div key={label} style={{ background: '#fffaf5', borderRadius: 14, padding: '16px', border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', textAlign: 'center', borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{num}</div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{label}</div>
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
                  <Link href={`/contact/${c.id}?from=personal`} className="btn btn-primary"
                    style={{ flex: 1, textAlign: 'center', textDecoration: 'none', fontSize: 12 }}>
                    צפייה
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </DesktopLayout>
  );
}
