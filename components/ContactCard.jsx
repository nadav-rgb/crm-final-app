// components/ContactCard.jsx
import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { useAuth } from '../lib/AuthStore';

export default function ContactCard({ contact, fromActivistId }) {
  const { can, currentUser } = useAuth();

  // פעיל רואה נתונים רגישים רק אם הלקוח שייך לפרויקט שלו
  const isOwnProject = can.ownProjectId === null || contact.project_id === can.ownProjectId;
  const showSensitive = can.seeSensitiveData && isOwnProject;

  const borderColors = { 'על סף ניתוק': '#e24b4a', 'דורש חידוש': '#ef9f27', 'קשר מתמשך': '#7f77dd', 'קשר חי': '#639922' };
  const borderColor  = showSensitive ? (borderColors[contact.status] ?? '#e0e0e0') : '#e0e0e0';

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: '0.5px solid #e0e0e0', borderRight: `3px solid ${borderColor}`, marginBottom: 10 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{contact.name}</div>
        </div>
        {showSensitive && <StatusBadge status={contact.status} />}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {contact.city && <span style={{ fontSize: 12, color: '#777' }}>📍 {contact.city}</span>}
        {showSensitive && (
          <span style={{ fontSize: 12, color: '#777' }}>🕐 לפני {contact.days_since_last_contact} ימים</span>
        )}
        {contact.depth && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f5f5f3', color: '#777', border: '0.5px solid #e0e0e0' }}>
            {contact.depth}
          </span>
        )}
      </div>

      {showSensitive && contact.next_action && (
        <div style={{ fontSize: 12, background: '#f5f5f3', borderRadius: 8, padding: '5px 8px', marginBottom: 8, borderRight: `2px solid ${contact.actionOverdue ? '#e24b4a' : '#639922'}`, color: '#555' }}>
          <strong style={{ color: contact.actionOverdue ? '#a32d2d' : '#3b6d11' }}>
            {contact.actionOverdue ? 'באיחור: ' : 'פעולה: '}
          </strong>
          {contact.next_action}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, borderTop: '0.5px solid #f0f0f0', paddingTop: 8 }}>
        <Link
          href={fromActivistId ? `/contact/${contact.id}?from=activist&activistId=${fromActivistId}` : `/contact/${contact.id}`}
          className="btn btn-primary"
          style={{ flex: 1, textAlign: 'center', textDecoration: 'none', display: 'block' }}
        >
          צפייה
        </Link>
        {can.addContact && isOwnProject && (
          <Link href={`/contact/add-interaction/${contact.id}`} className="btn"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}>
            + קשר
          </Link>
        )}
        {can.callContact && isOwnProject && (
          <a href={`tel:${contact.phone}`} className="btn"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none', color: '#3b6d11', borderColor: '#639922' }}>
            📞
          </a>
        )}
      </div>
    </div>
  );
}
