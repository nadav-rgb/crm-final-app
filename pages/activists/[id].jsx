// pages/activists/[id].jsx
import { useRouter } from 'next/router';
import Link from 'next/link';
import { interactionsLast30, getActivistPerformance, timeInSystem } from '../../lib/activistStats';
import { useCrm } from '../../lib/CrmStore';
import { useAuth } from '../../lib/AuthStore';
import getReminders from '../../lib/getReminders';
import DesktopLayout from '../../components/DesktopLayout';

const PROJECT_NAMES = { 1: 'אחדות יהודית', 2: 'נעים להכיר', 3: 'שבת מכל הסיבות', 4: 'נפש יהודי' };

const perfConfig = {
  high:    { label: 'תפקוד גבוה 🔥', color: '#27ae60', bg: '#edfaf1' },
  active:  { label: 'מתפקד',          color: '#6c5ce7', bg: '#f0effe' },
  dormant: { label: 'רדום',           color: '#888',    bg: '#f5f5f5' },
};

export default function ActivistDetail() {
  const router = useRouter();
  const { id, from, contactId } = router.query;
  const { contacts, interactions, activists } = useCrm();
  const { can, filterProject } = useAuth();

  const activist = activists.find(a => a.id === Number(id));
  if (!activist) return <DesktopLayout title="פעיל"><div>פעיל לא נמצא</div></DesktopLayout>;

  // סוקפינג לפי הפרויקט הנבחר: רכז של פרויקט מסוים רואה רק את הצד שלו
  // אצל פעיל דו-פרויקטלי (לקוחות, פעילות וסטטיסטיקה של אותו פרויקט בלבד).
  const inScope = x => filterProject === null || x.project_id === filterProject;

  const ownedContacts     = contacts.filter(c => c.activist_id === activist.id && inScope(c));
  const scopedInteractions = interactions.filter(i => inScope(i));
  const recentActivity = [...scopedInteractions.filter(i => i.activist_id === activist.id)]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4)
    .map(i => {
      const contact = contacts.find(c => c.id === i.contact_id);
      return { ...i, contactName: contact?.name ?? i.contact_name };
    });

  const performance = getActivistPerformance(activist.id, ownedContacts, scopedInteractions);
  const i30         = interactionsLast30(activist.id, scopedInteractions);
  const perf        = perfConfig[performance] ?? perfConfig.dormant;
  const timeLabel   = timeInSystem(activist.joined_at);

  const backHref  = from === 'contact-detail' && contactId ? `/contact/${contactId}` : '/activists';
  const backLabel = from === 'contact-detail' && contactId ? '← חזרה ללקוח' : '← חזרה לפעילים';

  const enrichedContacts = ownedContacts.map(c => ({ ...c, ...getReminders(c) }));

  // תווית פרויקטים — פעיל דו-פרויקטלי מציג את שניהם
  const projLabel = (activist.project_ids?.length ? activist.project_ids : [activist.project_id])
    .map(p => PROJECT_NAMES[p]).filter(Boolean).join(' · ');

  return (
    <DesktopLayout
      title={activist.name}
      subtitle={projLabel}
      backHref={backHref}
      backLabel={backLabel}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>

        {/* עמודה שמאל — פרטים + פעילות אחרונה */}
        <div>
          {/* פרטים אישיים */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '0.5px solid rgba(0,0,0,0.07)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'linear-gradient(135deg, #6c5ce7, #a29bfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                {activist.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>{activist.name}</div>
                <div style={{ fontSize: 12, color: '#6c5ce7', fontWeight: 600, marginTop: 2 }}>📁 {projLabel}</div>
              </div>
            </div>

            {/* נתוני ביצוע */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <div style={{ background: '#f8f7ff', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#6c5ce7' }}>{i30}</div>
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 2, fontWeight: 500 }}>קשרים (30י')</div>
              </div>
              <div style={{ background: '#f8f7ff', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#6c5ce7' }}>{ownedContacts.length}</div>
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 2, fontWeight: 500 }}>לקוחות</div>
              </div>
            </div>

            {can.seeSensitiveData && (
              <div style={{ background: perf.bg, borderRadius: 10, padding: '8px 12px', textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: perf.color }}>{perf.label}</div>
              </div>
            )}

            {/* פרטים */}
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              {[
                ['טלפון',        activist.phone || '—'],
                ['עיר',          activist.city || '—'],
                ['כתובת',        activist.address || '—'],
                ['גיל',          activist.age ? `${activist.age}` : '—'],
                ['זמן במערכת',   timeLabel],
              ].map(([lbl, val]) => (
                <tr key={lbl} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                  <td style={{ padding: '7px 0', color: '#bbb', fontSize: 12, width: 90, fontWeight: 500 }}>{lbl}</td>
                  <td style={{ padding: '7px 0', color: '#333', fontWeight: 500 }}>{val}</td>
                </tr>
              ))}
            </table>
          </div>

          {/* פעילות אחרונה — עד 4 */}
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>פעילות אחרונה</div>
          {recentActivity.length === 0
            ? <div style={{ background: '#fff', borderRadius: 12, padding: 16, textAlign: 'center', color: '#ccc', fontSize: 13, border: '0.5px solid rgba(0,0,0,0.06)' }}>אין פעילות</div>
            : recentActivity.map(i => (
              <div key={i.id} style={{ background: '#fff', borderRadius: 12, padding: '10px 14px', marginBottom: 8, border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{i.contactName}</div>
                  <span style={{ fontSize: 11, color: '#bbb' }}>{i.date}</span>
                </div>
                <div style={{ fontSize: 12, color: '#6c5ce7', fontWeight: 500 }}>{i.type} · {i.quality}</div>
              </div>
            ))
          }
        </div>

        {/* עמודה ימין — לקוחות */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>לקוחות</div>

          {enrichedContacts.length === 0
            ? <div style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', color: '#ccc', border: '0.5px solid rgba(0,0,0,0.06)' }}>אין לקוחות</div>
            : (
              <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid rgba(0,0,0,0.07)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                {enrichedContacts.map((c, idx) => {
                  const borderColors = { 'על סף ניתוק': '#e24b4a', 'דורש חידוש': '#ef9f27', 'קשר מתמשך': '#7f77dd', 'קשר חי': '#27ae60' };
                  const borderColor  = borderColors[c.status] ?? '#e0e0e0';
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                      borderBottom: idx === enrichedContacts.length - 1 ? 'none' : '0.5px solid #f5f5f5',
                      borderRight: `3px solid ${borderColor}`,
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ flex: '0 0 170px', minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{c.city} · {c.depth}</div>
                      </div>
                      <div style={{ flex: '0 0 80px', fontSize: 12, color: c.days_since_last_contact >= 30 ? '#e24b4a' : '#aaa', fontWeight: c.days_since_last_contact >= 30 ? 600 : 400 }}>
                        {c.days_since_last_contact} ימים
                      </div>
                      <div style={{ flex: '0 0 85px' }}>
                        <span style={{
                          fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap',
                          background: c.status === 'על סף ניתוק' ? '#fff0f0' : c.status === 'דורש חידוש' ? '#fff8ec' : c.status === 'קשר מתמשך' ? '#f0effe' : '#edfaf1',
                          color:      c.status === 'על סף ניתוק' ? '#c0392b' : c.status === 'דורש חידוש' ? '#d68910' : c.status === 'קשר מתמשך' ? '#6c5ce7' : '#27ae60',
                        }}>{c.status}</span>
                      </div>
                      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                        <Link href={`/contact/${c.id}?from=activist&activistId=${activist.id}`} className="btn btn-primary"
                          style={{ textDecoration: 'none', fontSize: 12, padding: '6px 18px' }}>
                          צפייה ←
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      </div>
    </DesktopLayout>
  );
}
