// pages/activists.jsx
import { useState, useEffect } from 'react';
import Link from 'next/link';
import CONFIG from '../data/config';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { interactionsLast30, getActivistPerformance } from '../lib/activistStats';
import ActivistCard from '../components/ActivistCard';
import FilterChips from '../components/FilterChips';
import DesktopLayout from '../components/DesktopLayout';
import { inProject } from '../lib/projectUtils';

const filterOptions = [
  { value: 'all',      label: 'הכל' },
  { value: 'active',   label: 'פעילים' },
  { value: 'inactive', label: 'לא פעילים' },
];

const performanceConfig = {
  high:    { label: 'תפקוד גבוה 🔥', bg: '#eaf3de', color: '#3b6d11' },
  active:  { label: 'מתפקד',          bg: '#eeedfe', color: '#534ab7' },
  dormant: { label: 'רדום',           bg: '#f1efe8', color: '#5f5e5a' },
};

export default function ActivistsPage() {
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('activistsView') || 'grid';
    return 'grid';
  });
  const { contacts, interactions, activists } = useCrm();
  const { can, filterProject } = useAuth();

  useEffect(() => {
    if (typeof window !== 'undefined') sessionStorage.setItem('activistsView', viewMode);
  }, [viewMode]); // 'grid' | 'list'

  if (!can.seeActivists) {
    return <DesktopLayout title="פעילים"><div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>אין הרשאה לדף זה</div></DesktopLayout>;
  }

  // סינון לפי פרויקט — לפי חברות (project_ids), כולל פעילים דו-פרויקטליים
  let displayActivists = activists.filter(a => a.role === 'activist');
  if (filterProject !== null) {
    displayActivists = displayActivists.filter(a => inProject(a, filterProject));
  }

  const filtered = filter === 'all' ? displayActivists : displayActivists.filter(a => a.status === filter);

  return (
    <DesktopLayout title="פעילים" subtitle={`${filtered.length} פעילים`}
      actions={
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <FilterChips options={filterOptions} active={filter} onChange={setFilter} />
          <div style={{ display: 'flex', border: '1.5px solid #e8e8e8', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
            <button onClick={() => setViewMode('grid')}
              style={{ padding: '7px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16,
                background: viewMode === 'grid' ? '#3a249b' : '#fff',
                color:      viewMode === 'grid' ? '#fff'    : '#aaa',
                transition: 'all 0.18s ease' }}>
              ⊞
            </button>
            <button onClick={() => setViewMode('list')}
              style={{ padding: '7px 12px', border: 'none', borderRight: '1.5px solid #e8e8e8', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16,
                background: viewMode === 'list' ? '#3a249b' : '#fff',
                color:      viewMode === 'list' ? '#fff'    : '#aaa',
                transition: 'all 0.18s ease' }}>
              ☰
            </button>
          </div>
        </div>
      }
    >
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {filtered.length === 0
            ? <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14, fontWeight: 500 }}>לא נמצאו פעילים</div>
            : filtered.map(activist => (
              <ActivistCard
                key={activist.id}
                activist={activist}
                contactCount={contacts.filter(c => c.activist_id === activist.id).length}
                interactionCount={interactionsLast30(activist.id, interactions)}
                performance={getActivistPerformance(activist.id, contacts, interactions)}
                canSeeSensitive={can.seeSensitiveData}
                canCancelBonuses={can.cancelBonuses}
                projectId={filterProject}
              />
            ))
          }
        </div>
      )}

      {viewMode === 'list' && (
        <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid rgba(0,0,0,0.07)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          {filtered.length === 0
            ? <div style={{ textAlign: 'center', color: '#ccc', padding: 48, fontSize: 14, fontWeight: 500 }}>לא נמצאו פעילים</div>
            : filtered.map((activist, idx) => (
              <ActivistListRow
                key={activist.id}
                activist={activist}
                contactCount={contacts.filter(c => c.activist_id === activist.id).length}
                interactionCount={interactionsLast30(activist.id, interactions)}
                performance={getActivistPerformance(activist.id, contacts, interactions)}
                canSeeSensitive={can.seeSensitiveData}
                canCancelBonuses={can.cancelBonuses}
                projectId={filterProject}
                last={idx === filtered.length - 1}
              />
            ))
          }
        </div>
      )}
    </DesktopLayout>
  );
}

// ── שורת רשימה ───────────────────────────────────────────────
function ActivistListRow({
  activist, contactCount, interactionCount, performance, canSeeSensitive,
  canCancelBonuses, projectId, last,
}) {
  const isActive = activist.status === 'active';
  const perf = performanceConfig[performance] ?? performanceConfig.dormant;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 16px',
      borderBottom: last ? 'none' : '0.5px solid #f5f5f5',
      opacity: isActive ? 1 : 0.6,
      transition: 'background 0.15s ease',
    }}
      onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* שם + טלפון */}
      <div style={{ flex: '0 0 200px', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activist.name}</div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{activist.phone || '—'}</div>
      </div>

      {/* סטטוס פעיל/לא-פעיל */}
      <div style={{ flex: '0 0 90px' }}>
        <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: isActive ? '#eaf3de' : '#f1efe8', color: isActive ? '#3b6d11' : '#5f5e5a', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {CONFIG.activistStatus[activist.status]}
        </span>
      </div>

      {/* קשרים 30 יום */}
      <div style={{ flex: '0 0 100px', fontSize: 12, color: '#888' }}>
        {interactionCount} קשרים (30י')
      </div>

      {/* לקוחות */}
      <div style={{ flex: '0 0 80px', fontSize: 12, color: '#888' }}>
        {contactCount} לקוחות
      </div>

      {/* ביצוע (רגיש) */}
      {canSeeSensitive && (
        <div style={{ flex: '0 0 110px' }}>
          <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 10, background: perf.bg, color: perf.color, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {perf.label}
          </span>
        </div>
      )}

      {/* כפתורים */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {canSeeSensitive && (
          <a href={`tel:${activist.phone}`} className="btn"
            style={{ textDecoration: 'none', fontSize: 12, padding: '6px 12px', color: '#3b6d11', borderColor: '#639922' }}>
            📞
          </a>
        )}
        {canCancelBonuses && (
          <Link
            href={`/payments/${encodeURIComponent(activist.userId)}${projectId == null ? '' : `?projectId=${encodeURIComponent(projectId)}`}`}
            className="btn"
            style={{ textDecoration: 'none', fontSize: 12, padding: '6px 12px', color: '#8a3b12', borderColor: '#d7a16f' }}
          >
            ביטול בונוס
          </Link>
        )}
        <Link href={`/activists/${activist.id}`} className="btn btn-primary"
          style={{ textDecoration: 'none', fontSize: 12, padding: '6px 20px', minWidth: 80, textAlign: 'center' }}>
          צפייה ←
        </Link>
      </div>
    </div>
  );
}
