// pages/today.jsx
import CONFIG from '../data/config';
import getReminders from '../lib/getReminders';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';

export default function TodayPage() {
  const { contacts } = useCrm();
  const { can, currentUser, filterProject } = useAuth();

  // פעיל רואה רק את הלקוחות שלו, רכז את הפרויקט, מנכ"ל הכל
  let visibleContacts = contacts;
  if (can.addContact) {
    visibleContacts = contacts.filter(c => c.activist_id === currentUser.id);
  } else if (filterProject !== null && can.seeSensitiveData) {
    visibleContacts = contacts.filter(c => c.project_id === filterProject);
  } else if (!can.addContact && !can.seeSensitiveData && filterProject !== null) {
    visibleContacts = contacts.filter(c => c.project_id === filterProject);
  }

  const enriched = visibleContacts.map(c => ({ ...c, ...getReminders(c) }));

  const todayActions = [...enriched.filter(c => c.actionDue)]
    .sort((a, b) => (a.actionOverdue && !b.actionOverdue) ? -1 : (!a.actionOverdue && b.actionOverdue) ? 1 : 0);

  const needsContact = [...enriched.filter(c => c.needsFollowUp)]
    .sort((a, b) => {
      const w = { ['על סף ניתוק']: 0, ['דורש חידוש']: 1, ['קשר מתמשך']: 2 };
      return (w[a.status] ?? 3) - (w[b.status] ?? 3);
    });

  return (
    <DesktopLayout title="פעולות היום" subtitle={`${todayActions.length} פעולות ממתינות`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

        {/* פעולות מתוזמנות */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>פעולות מתוזמנות</div>
          <div style={{ fontSize: 12, color: '#bbb', marginBottom: 12, fontWeight: 400 }}>לפי תאריך פעולה הבאה</div>
          {todayActions.length === 0
            ? <div style={{ background: '#fffaf5', borderRadius: 14, padding: 24, textAlign: 'center', color: '#ccc', border: '0.5px solid rgba(0,0,0,0.06)', fontSize: 14 }}>אין פעולות ממתינות</div>
            : todayActions.map(c => (
              <div key={c.id} style={{ background: '#fffaf5', borderRadius: 14, padding: '14px 16px', marginBottom: 10, borderRight: `3px solid ${c.actionOverdue ? '#e24b4a' : '#27ae60'}`, border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                {c.actionOverdue && <span style={{ background: '#fff0f0', color: '#c0392b', fontSize: 11, padding: '2px 9px', borderRadius: 20, display: 'inline-block', marginBottom: 6, fontWeight: 700 }}>באיחור</span>}
                <div style={{ fontSize: 12, color: '#bbb', marginBottom: 3, fontWeight: 400 }}>פעולה הבאה</div>
                <div style={{ fontSize: 14, fontWeight: 400, color: '#333' }}>{c.next_action}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4, color: '#1a1a1a' }}>{c.name}</div>
                <div style={{ fontSize: 12, marginTop: 3, color: c.actionOverdue ? '#c0392b' : '#27ae60', fontWeight: 400 }}>
                  {c.actionOverdue ? 'באיחור —' : 'לתאריך:'} {c.next_action_date}
                </div>
              </div>
            ))
          }
        </div>

        {/* דורשים קשר */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>דורשים קשר</div>
          <div style={{ fontSize: 12, color: '#bbb', marginBottom: 12, fontWeight: 400 }}>לפי ימים מאז קשר אחרון</div>
          {needsContact.length === 0
            ? <div style={{ background: '#fffaf5', borderRadius: 14, padding: 24, textAlign: 'center', color: '#ccc', border: '0.5px solid rgba(0,0,0,0.06)', fontSize: 14 }}>כל הלקוחות תקינים</div>
            : needsContact.map(c => {
              const colors = {
                ['על סף ניתוק']: { border: '#e24b4a', badge: '#fff0f0', text: '#c0392b' },
                ['דורש חידוש']:   { border: '#ef9f27', badge: '#fff8ec', text: '#d68910' },
                ['קשר מתמשך']:  { border: '#7f77dd', badge: '#f0effe', text: '#6c5ce7' },
              };
              const col = colors[c.status] ?? { border: '#e0e0e0', badge: '#f5f5f5', text: '#888' };
              return (
                <div key={c.id} style={{ background: '#fffaf5', borderRadius: 14, padding: '12px 16px', marginBottom: 10, borderRight: `3px solid ${col.border}`, border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 2, fontWeight: 400 }}>{c.city} · לפני {c.days_since_last_contact} ימים</div>
                    </div>
                    <span style={{ background: col.badge, color: col.text, fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>{c.status}</span>
                  </div>
                </div>
              );
            })
          }
        </div>
      </div>
    </DesktopLayout>
  );
}
