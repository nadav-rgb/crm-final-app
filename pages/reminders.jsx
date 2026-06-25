// pages/reminders.jsx — תזכורות קשר
import Link from 'next/link';
import getReminders from '../lib/getReminders';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';

export default function RemindersPage() {
  const { contacts, updateContact } = useCrm();
  const { can, currentUser, filterProject } = useAuth();

  // B2 — סימון משימה כבוצעה: מנקה את next_action ושומר ל-Supabase. הכרטיס נעלם מהרשימה.
  function markDone(contactId) {
    updateContact(contactId, { next_action: null, next_action_date: null });
  }

  let visible = contacts;
  if (can.addContact) {
    visible = contacts.filter(c => c.activist_id === currentUser.id);
  } else if (filterProject !== null) {
    visible = contacts.filter(c => c.project_id === filterProject);
  }

  const enriched = visible
    .map(c => ({ ...c, ...getReminders(c) }))
    .filter(c => !c.isFormer);

  const withActions = enriched
    .filter(c => c.next_action)
    .sort((a, b) => {
      if (a.actionOverdue && !b.actionOverdue) return -1;
      if (!a.actionOverdue && b.actionOverdue) return 1;
      return new Date(a.next_action_date) - new Date(b.next_action_date);
    });

  const statusColors = {
    'קשר חי':       { border: '#27ae60', badge: '#edfaf1', text: '#27ae60' },
    'קשר מתמשך':    { border: '#3498db', badge: '#ebf5fb', text: '#2980b9' },
    'דורש חידוש':   { border: '#f39c12', badge: '#fff8ec', text: '#d68910' },
    'על סף ניתוק':  { border: '#e74c3c', badge: '#fff0f0', text: '#c0392b' },
  };

  return (
    <DesktopLayout title="תזכורות קשר" subtitle={`${withActions.length} פעולות ממתינות`}>
      {withActions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#ccc' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>אין תזכורות ממתינות</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {withActions.map(c => {
            const col = statusColors[c.status] ?? { border: '#e0e0e0', badge: '#f5f5f5', text: '#888' };
            return (
              <div key={c.id} style={{ background: '#fffaf5', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(0,0,0,0.06)', borderRight: `3px solid ${col.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                {c.actionOverdue && (
                  <span style={{ background: '#fff0f0', color: '#c0392b', fontSize: 11, padding: '2px 9px', borderRadius: 20, display: 'inline-block', marginBottom: 6, fontWeight: 700 }}>
                    באיחור
                  </span>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{c.name}</div>
                  <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600, background: col.badge, color: col.text }}>{c.status}</span>
                </div>
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>{c.city}</div>
                <div style={{ fontSize: 13, background: '#f8f7ff', borderRadius: 8, padding: '8px 10px', marginBottom: 10, borderRight: '2px solid #6c5ce7', color: '#444' }}>
                  📌 {c.next_action}
                </div>
                <div style={{ fontSize: 12, color: c.actionOverdue ? '#c0392b' : '#27ae60', fontWeight: 500, marginBottom: 10 }}>
                  {c.actionOverdue ? '⚠ באיחור —' : '📅'} {c.next_action_date}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => markDone(c.id)} className="btn"
                    style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#27ae60', borderColor: '#7cc47c' }}>
                    ✓ בוצע
                  </button>
                  <Link href={`/contact/${c.id}?from=reminders`} className="btn btn-primary"
                    style={{ flex: 1, textAlign: 'center', textDecoration: 'none', fontSize: 13 }}>
                    פתח פרופיל
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DesktopLayout>
  );
}
