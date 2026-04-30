// pages/activists.jsx
import { useState } from 'react';
import CONFIG from '../data/config';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { interactionsLast30, getActivistPerformance } from '../lib/activistStats';
import ActivistCard from '../components/ActivistCard';
import FilterChips from '../components/FilterChips';
import DesktopLayout from '../components/DesktopLayout';
import activists from '../data/activists';

const filterOptions = [
  { value: 'all',      label: 'הכל' },
  { value: 'active',   label: 'פעילים' },
  { value: 'inactive', label: 'לא פעילים' },
];

export default function ActivistsPage() {
  const [filter, setFilter] = useState('all');
  const { contacts, interactions } = useCrm();
  const { can, filterProject } = useAuth();

  if (!can.seeActivists) {
    return <DesktopLayout title="פעילים"><div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>אין הרשאה לדף זה</div></DesktopLayout>;
  }

  // סינון לפי פרויקט
  let displayActivists = activists.filter(a => a.role !== 'manager');
  if (filterProject !== null) {
    displayActivists = displayActivists.filter(a => a.project_id === filterProject);
  }

  const filtered = filter === 'all' ? displayActivists : displayActivists.filter(a => a.status === filter);

  return (
    <DesktopLayout title="פעילים" subtitle={`${filtered.length} פעילים`}
      actions={<FilterChips options={filterOptions} active={filter} onChange={setFilter} />}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {filtered.map(activist => (
          <ActivistCard
            key={activist.id}
            activist={activist}
            contactCount={contacts.filter(c => c.activist_id === activist.id).length}
            interactionCount={interactionsLast30(activist.id, interactions)}
            performance={getActivistPerformance(activist.id, contacts, interactions)}
            canSeeSensitive={can.seeSensitiveData}
          />
        ))}
      </div>
    </DesktopLayout>
  );
}
