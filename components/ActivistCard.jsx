// components/ActivistCard.jsx
import BackLink from './ui/BackLink';
import CONFIG from '../data/config';

const performanceConfig = {
  high:    { label: 'תפקוד גבוה 🔥', bg: '#eaf3de', color: '#3b6d11' },
  active:  { label: 'מתפקד',          bg: '#eeedfe', color: '#534ab7' },
  dormant: { label: 'רדום',           bg: '#f1efe8', color: '#5f5e5a' },
};

export default function ActivistCard({ activist, contactCount, interactionCount, performance, canSeeSensitive }) {
  const isActive = activist.status === 'active';
  const perf     = performanceConfig[performance] ?? performanceConfig.dormant;

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #e0e0e0', opacity: isActive ? 1 : 0.6 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{activist.name}</div>
          <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{activist.phone}</div>
        </div>
        <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: isActive ? '#eaf3de' : '#f1efe8', color: isActive ? '#3b6d11' : '#5f5e5a', fontWeight: 500 }}>
          {CONFIG.activistStatus[activist.status]}
        </span>
      </div>

      {/* Stats — 2 ריבועים בלבד */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: '#f5f5f3', borderRadius: 8, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{interactionCount}</div>
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>קשרים (30י')</div>
        </div>

        {canSeeSensitive ? (
          <div style={{ background: perf.bg, borderRadius: 8, padding: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: perf.color, marginTop: 6 }}>{perf.label}</div>
            <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>סטטוס</div>
          </div>
        ) : (
          <div style={{ background: '#f5f5f3', borderRadius: 8, padding: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 500 }}>{contactCount}</div>
            <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>לקוחות</div>
          </div>
        )}
      </div>

      {/* כפתורים */}
      <div style={{ display: 'flex', gap: 6 }}>
        <BackLink href={`/activists/${activist.id}`} direction="forward">
          צפייה בפרופיל
        </BackLink>
        {canSeeSensitive && (
          <a href={`tel:${activist.phone}`} className="btn"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none', color: '#3b6d11', borderColor: '#639922' }}>
            📞
          </a>
        )}
      </div>
    </div>
  );
}
