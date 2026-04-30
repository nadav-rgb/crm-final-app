// pages/contacts.jsx
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../data/config';
import getReminders from '../lib/getReminders';
import { timeInSystem } from '../lib/activistStats';
import FilterChips from '../components/FilterChips';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';

const statusWeight = {
  ['על סף ניתוק']: 0,
  ['דורש חידוש']:   1,
  ['קשר מתמשך']:  2,
  ['קשר חי']:       3,
};

const filterOptions = [
  { value: 'all',                  label: 'הכל' },
  { value: 'על סף ניתוק', label: 'על סף ניתוק' },
  { value: 'דורש חידוש',   label: 'דורש חידוש' },
  { value: 'קשר מתמשך',  label: 'קשר מתמשך' },
  { value: 'קשר חי',       label: 'קשר חי' },
];

const PROJECT_NAMES = { 1: 'איילת השחר', 2: 'אחדות יהודית', 3: 'שבת מכל הסיבות', 4: 'נפש יהודי' };

export default function ContactsPage() {
  const router = useRouter();
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('contactsView') || 'grid';
    return 'grid';
  });

  // שמירת מצב תצוגה
  useEffect(() => {
    if (typeof window !== 'undefined') sessionStorage.setItem('contactsView', viewMode);
  }, [viewMode]); // 'grid' | 'list'
  const { contacts } = useCrm();
  const { can, currentUser, filterProject } = useAuth();

  let visibleContacts = contacts;
  if (can.addContact) {
    visibleContacts = contacts.filter(c => c.activist_id === currentUser.id);
  } else if (filterProject !== null) {
    visibleContacts = contacts.filter(c => c.project_id === filterProject);
  }

  const enriched = visibleContacts.map(c => ({ ...c, ...getReminders(c) })).filter(c => !c.isFormer);
  const formerCount = visibleContacts.map(c => ({ ...c, ...getReminders(c) })).filter(c => c.isFormer).length;
  const q        = search.toLowerCase();
  const searched = q ? enriched.filter(c => [c.name, c.phone, c.city].some(v => v && v.toLowerCase().includes(q))) : enriched;
  const filtered = filter === 'all' ? searched : searched.filter(c => c.status === filter);
  const sorted   = [...filtered].sort((a, b) => {
    const w = (statusWeight[a.status] ?? 3) - (statusWeight[b.status] ?? 3);
    return w !== 0 ? w : b.days_since_last_contact - a.days_since_last_contact;
  });

  const criticalCount = enriched.filter(c => c.isCritical).length;

  return (
    <DesktopLayout
      title="לקוחות"
      subtitle={`${sorted.length} לקוחות${criticalCount > 0 ? ` · ${criticalCount} קריטיים` : ''}`}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {formerCount > 0 && (
            <Link href="/former-contacts" style={{ textDecoration: 'none' }}>
              <button style={{ padding: '7px 14px', borderRadius: 10, border: '1.5px solid #e8e8e8', background: '#fff', color: '#888', fontSize: 13, cursor: 'pointer', fontFamily: 'Rubik, sans-serif' }}>
                לקוחות לשעבר ({formerCount})
              </button>
            </Link>
          )}
          {can.addContact && (
            <Link href="/contacts/add" className="btn btn-primary" style={{ textDecoration: 'none', fontSize: 13 }}>
              + הוסף לקוח
            </Link>
          )}
        </div>
      }
    >
      {/* שורת כלים */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#bbb', fontSize: 16 }}>⌕</span>
          <input type="text" placeholder="חיפוש לקוח..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ paddingRight: 36 }} />
        </div>

        {/* מצב תצוגה */}
        <div style={{ display: 'flex', border: '1.5px solid #e8e8e8', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          <button onClick={() => setViewMode('grid')}
            style={{ padding: '7px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16,
              background: viewMode === 'grid' ? '#6c5ce7' : '#fff',
              color:      viewMode === 'grid' ? '#fff'    : '#aaa',
              transition: 'all 0.18s ease' }}>
            ⊞
          </button>
          <button onClick={() => setViewMode('list')}
            style={{ padding: '7px 12px', border: 'none', borderRight: '1.5px solid #e8e8e8', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16,
              background: viewMode === 'list' ? '#6c5ce7' : '#fff',
              color:      viewMode === 'list' ? '#fff'    : '#aaa',
              transition: 'all 0.18s ease' }}>
            ☰
          </button>
        </div>
      </div>

      {/* פילטרים */}
      {can.seeSensitiveData && (
        <div style={{ marginBottom: 16 }}>
          <FilterChips options={filterOptions} active={filter} onChange={setFilter} />
        </div>
      )}

      {/* תצוגת ריבועים */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {sorted.length === 0
            ? <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14, fontWeight: 500 }}>לא נמצאו לקוחות</div>
            : sorted.map(c => <GridCard key={c.id} contact={c} can={can} viewMode={viewMode} />)
          }
        </div>
      )}

      {/* תצוגת רשימה */}
      {viewMode === 'list' && (
        <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid rgba(0,0,0,0.07)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          {sorted.length === 0
            ? <div style={{ textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14, fontWeight: 500 }}>לא נמצאו לקוחות</div>
            : sorted.map((c, idx) => <ListRow key={c.id} contact={c} can={can} last={idx === sorted.length - 1} viewMode={viewMode} />)
          }
        </div>
      )}
    </DesktopLayout>
  );
}

// ── כרטיס ריבוע ──────────────────────────────────────────────
function GridCard({ contact, can, viewMode }) {
  const borderColors = { 'קשר חי': '#27ae60', 'קשר מתמשך': '#3498db', 'דורש חידוש': '#f39c12', 'על סף ניתוק': '#e74c3c' };
  const borderColor  = can.seeSensitiveData ? (borderColors[contact.status] ?? '#e0e0e0') : '#e0e0e0';
  const projName     = PROJECT_NAMES[contact.project_id] ?? '—';
  const timeLabel    = timeInSystem(contact.joined_at);

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(0,0,0,0.07)', borderRight: `3px solid ${borderColor}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', transition: 'transform 0.18s ease, box-shadow 0.18s ease' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.09)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{contact.name}</div>
        {can.seeSensitiveData && <StatusPill status={contact.status} />}
      </div>
      <div style={{ fontSize: 11, color: '#6c5ce7', marginBottom: 6, fontWeight: 600 }}>📁 {projName}</div>
      <div style={{ fontSize: 12, color: '#999', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {contact.city && <span>📍 {contact.city}</span>}
        <span>🕐 {timeLabel}</span>
        {can.seeSensitiveData && <span style={{ color: contact.days_since_last_contact >= 30 ? '#e24b4a' : '#999' }}>⏱ {contact.days_since_last_contact} ימים</span>}
      </div>
      {can.seeSensitiveData && contact.next_action && (
        <div style={{ fontSize: 11, background: '#f8f7ff', borderRadius: 8, padding: '5px 9px', marginBottom: 8, color: '#6c5ce7', borderRight: '2px solid #6c5ce7' }}>
          📌 {contact.next_action}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '0.5px solid #f0f0f0' }}>
        <Link href={`/contact/${contact.id}?from=contacts&view=${viewMode}`} className="btn btn-primary"
          style={{ flex: 1, textAlign: 'center', textDecoration: 'none', fontSize: 12 }}>
          צפייה
        </Link>
        {can.addContact && (
          <Link href={`/contact/add-interaction/${contact.id}`} className="btn"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none', fontSize: 12 }}>
            + קשר
          </Link>
        )}
        {can.callContact && (
          <a href={`tel:${contact.phone}`} className="btn"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none', color: '#27ae60', borderColor: '#27ae60', fontSize: 12 }}>
            📞
          </a>
        )}
      </div>
    </div>
  );
}

// ── שורת רשימה ───────────────────────────────────────────────
function ListRow({ contact, can, last, viewMode }) {
  const borderColors = { 'קשר חי': '#27ae60', 'קשר מתמשך': '#3498db', 'דורש חידוש': '#f39c12', 'על סף ניתוק': '#e74c3c' };
  const borderColor  = can.seeSensitiveData ? (borderColors[contact.status] ?? '#e0e0e0') : '#e0e0e0';
  const projName     = PROJECT_NAMES[contact.project_id] ?? '—';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 16px',
      borderBottom: last ? 'none' : '0.5px solid #f5f5f5',
      borderRight: `3px solid ${borderColor}`,
      transition: 'background 0.15s ease',
    }}
      onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* שם */}
      <div style={{ flex: '0 0 180px', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.name}</div>
        <div style={{ fontSize: 11, color: '#6c5ce7', fontWeight: 600, marginTop: 1 }}>{projName}</div>
      </div>

      {/* עיר */}
      <div style={{ flex: '0 0 100px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
        {contact.city || '—'}
      </div>

      {/* ימים */}
      {can.seeSensitiveData && (
        <div style={{ flex: '0 0 80px', fontSize: 12, color: contact.days_since_last_contact >= 30 ? '#e24b4a' : '#888', fontWeight: contact.days_since_last_contact >= 30 ? 600 : 400 }}>
          {contact.days_since_last_contact} ימים
        </div>
      )}

      {/* סטטוס */}
      {can.seeSensitiveData && (
        <div style={{ flex: '0 0 90px' }}>
          <StatusPill status={contact.status} />
        </div>
      )}

      {/* כפתורים */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {can.addContact && (
          <Link href={`/contact/add-interaction/${contact.id}`} className="btn"
            style={{ textDecoration: 'none', fontSize: 12, padding: '6px 12px' }}>
            + קשר
          </Link>
        )}
        {can.callContact && (
          <a href={`tel:${contact.phone}`} className="btn"
            style={{ textDecoration: 'none', fontSize: 12, padding: '6px 12px', color: '#27ae60', borderColor: '#27ae60' }}>
            📞
          </a>
        )}
        <Link href={`/contact/${contact.id}?from=contacts&view=${viewMode}`} className="btn btn-primary"
          style={{ textDecoration: 'none', fontSize: 12, padding: '6px 20px', minWidth: 80, textAlign: 'center' }}>
          צפייה →
        </Link>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    'על סף ניתוק':    { bg: '#fff0f0', color: '#c0392b' },
    'דורש חידוש':     { bg: '#fff8ec', color: '#d68910' },
    'קשר מתמשך': { bg: '#f0effe', color: '#6c5ce7' },
    'קשר חי':     { bg: '#edfaf1', color: '#27ae60' },
  };
  const s = map[status] ?? { bg: '#f5f5f5', color: '#888' };
  return (
    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}
