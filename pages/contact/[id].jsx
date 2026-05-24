// pages/contact/[id].jsx
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../../data/config';
import activists from '../../data/activists';
import getReminders from '../../lib/getReminders';
import StatusBadge from '../../components/StatusBadge';
import DesktopLayout from '../../components/DesktopLayout';
import { timeInSystem } from '../../lib/activistStats';
import { useCrm } from '../../lib/CrmStore';
import { useState } from 'react';
import { useAuth } from '../../lib/AuthStore';

export default function ContactDetail() {
  const router = useRouter();
  const { id, from, activistId, view, contactId: fromContactId } = router.query;
  const { contacts, interactions } = useCrm();
  const { can, activeProject } = useAuth();

  const contact = contacts.find(c => c.id === Number(id));
  if (!contact) return <DesktopLayout title="לקוח"><div>לקוח לא נמצא</div></DesktopLayout>;

  const reminders    = getReminders(contact);
  const enriched     = { ...contact, ...reminders };
  // מפת בטא מקומית מינימלית: activist_code → שם (fallback ל-data/activists)
  const BETA_ACTIVIST_NAMES = { 11: 'רפאל רייטן', 12: 'מוטי גלעד', 13: 'מוטי שטרלינג', 14: 'חדווה מור יוסף' };
  const ownerFallback = activists.find(a => a.id === contact.activist_id);
  const ownerName     = BETA_ACTIVIST_NAMES[contact.activist_id] ?? ownerFallback?.name ?? null;
  const owner         = ownerName ? { id: contact.activist_id, name: ownerName } : null;
  const contactInter = [...interactions.filter(i => i.contact_id === contact.id)]
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // ניווט חזרה
  const backHref  = from === 'activist' && activistId ? `/activists/${activistId}`
                  : from === 'contact-detail'            ? `/contact/${fromContactId}`
                  : from === 'landing'                   ? '/landing'
                  : from === 'personal'                  ? '/'
                  : from === 'reminders'                 ? '/reminders'
                  : from === 'former'                    ? '/former-contacts'
                  : `/contacts${view ? `?view=${view}` : ''}`;
  const backLabel = from === 'activist' && activistId ? '← חזרה לפעיל'
                  : from === 'landing'                 ? '← חזרה למרכז הפעילות'
                  : from === 'personal'                ? '← חזרה לאזור האישי'
                  : from === 'reminders'               ? '← חזרה לתזכורות'
                  : from === 'former'                  ? '← חזרה ללקוחות לשעבר'
                  : '← חזרה ללקוחות';

  const isAchdut    = activeProject?.id === 2;
  const sourceLabel = contact.source ? (CONFIG.contactSources?.[contact.source] ?? contact.source) : '—';
  const timeLabel   = timeInSystem(contact.joined_at);

  // הרשאות — פעיל רואה נתונים רגישים רק בפרויקט שלו
  const isOwnProject  = can.ownProjectId === null || contact.project_id === can.ownProjectId;
  const showSensitive = can.seeSensitiveData && isOwnProject;

  return (
    <DesktopLayout
      title={contact.name}
      subtitle={contact.phone}
      backHref={backHref}
      backLabel={backLabel}
      actions={showSensitive ? <StatusBadge status={enriched.status} /> : null}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>

        {/* עמודה שמאל — פרטים */}
        <div>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '0.5px solid #e0e0e0', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#eeedfe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 500, color: '#534ab7' }}>
                {contact.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 500 }}>{contact.name}</div>
                <div style={{ fontSize: 13, color: '#777' }}>{contact.phone}</div>
              </div>
            </div>

            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              {[
                ['יישוב',          contact.city || '—'],
                ['אזור',           contact.area || '—'],
                isAchdut
                  ? ['בית מפגש', `${contact.meeting_place_city || '—'} / מס׳ ${contact.meeting_place_number || '—'}`]
                  : ['מאיפה הכרנו', contact.how_met || sourceLabel],
                ['זמן במערכת',     timeLabel],
                ['קשר אחרון',      contact.last_interaction_date || '—'],
                ...(showSensitive ? [['ימים מאז קשר', `${contact.days_since_last_contact} ימים`]] : []),
                ...(contact.gender     ? [['מגדר',             contact.gender === 'male' ? 'איש' : 'אשה']] : []),
                ...(contact.age        ? [['גיל',               `${contact.age}`]] : []),
                ...(contact.profession ? [['עיסוק מקצועי',      contact.profession]] : []),
              ].map(([lbl, val]) => (
                <tr key={lbl} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                  <td style={{ padding: '7px 0', color: '#999', width: 110 }}>{lbl}</td>
                  <td style={{ padding: '7px 0' }}>{val}</td>
                </tr>
              ))}

              {/* פעיל אחראי — כפתור לפרופיל */}
              <tr style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                <td style={{ padding: '7px 0', color: '#999' }}>פעיל אחראי</td>
                <td style={{ padding: '7px 0' }}>
                  {owner ? (
                    <Link
                      href={`/activists/${owner.id}?from=contact-detail&contactId=${contact.id}`}
                      style={{ color: '#534ab7', textDecoration: 'none', fontWeight: 500 }}
                    >
                      {owner.name} ←
                    </Link>
                  ) : '—'}
                </td>
              </tr>
            </table>
          </div>

          {/* פעולה הבאה */}
          {showSensitive && contact.next_action && (
            <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #e0e0e0', borderRight: `3px solid ${enriched.actionOverdue ? '#e24b4a' : '#639922'}`, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>פעולה הבאה</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{contact.next_action}</div>
              <div style={{ fontSize: 12, marginTop: 6, color: enriched.actionOverdue ? '#a32d2d' : '#3b6d11', fontWeight: enriched.actionOverdue ? 500 : 400 }}>
                {enriched.actionOverdue ? '⚠ באיחור —' : 'לתאריך:'} {contact.next_action_date}
              </div>
            </div>
          )}

          {/* כפתורי פעולה */}
          {can.addContact && isOwnProject && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href={`/contact/add-interaction/${contact.id}`} className="btn btn-primary"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}>
                + הוסף קשר
              </Link>
              <a href={`tel:${contact.phone}`} className="btn"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', color: '#3b6d11', borderColor: '#639922' }}>
                📞 התקשר
              </a>
            </div>
          )}
        </div>

        {/* עמודה ימין — היסטוריה */}
        <div>
          {contact.notes && (
            <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #e0e0e0', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#777', marginBottom: 6 }}>הערות</div>
              <div style={{ fontSize: 14 }}>{contact.notes}</div>
            </div>
          )}

          {showSensitive && (
            <>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10, color: '#1a1a1a' }}>היסטוריית קשרים</div>
              {contactInter.length === 0
                ? <div style={{ background: '#fff', borderRadius: 12, padding: 20, textAlign: 'center', color: '#aaa', border: '0.5px solid #e0e0e0' }}>אין קשרים מתועדים</div>
                : contactInter.map(i => {
                  const durationLabel = i.duration_minutes == null ? null
                    : i.duration_minutes >= 15 ? 'מעל 15 דקות' : 'פחות מ-15 דקות';
                  return (
                  <div key={i.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', marginBottom: 8, border: '0.5px solid #e0e0e0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong style={{ fontSize: 14 }}>{i.type}</strong>
                      <span style={{ fontSize: 12, color: '#aaa' }}>{i.date}</span>
                    </div>

                    {/* תגיות: איכות / משך / תוצאה */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: i.description || i.ai_summary || i.next_action || i.notes ? 8 : 0 }}>
                      {i.quality && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f0effe', color: '#6c5ce7', fontWeight: 600 }}>{i.quality}</span>}
                      {durationLabel && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#eef6ee', color: '#3b6d11', fontWeight: 600 }}>{durationLabel}</span>}
                      {i.outcome && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f5f5f5', color: '#777', fontWeight: 600 }}>{i.outcome}</span>}
                    </div>

                    {i.description && <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6, marginBottom: 6 }}>{i.description}</div>}

                    {i.ai_summary && (
                      <div style={{ fontSize: 12, color: '#444', background: '#faf9ff', border: '0.5px solid #ece9fb', borderRadius: 10, padding: '8px 10px', marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                        <span style={{ fontWeight: 700, color: '#6c5ce7' }}>סיכום AI: </span>{i.ai_summary}
                      </div>
                    )}

                    {i.notes && <div style={{ fontSize: 12, color: '#777', marginBottom: 6 }}>📝 {i.notes}</div>}

                    {i.next_action && (
                      <div style={{ fontSize: 12, color: '#3b6d11', borderTop: '0.5px solid #f0f0f0', paddingTop: 6 }}>
                        <strong>פעולה הבאה:</strong> {i.next_action}{i.next_action_date ? ` · ${i.next_action_date}` : ''}
                      </div>
                    )}
                  </div>
                  );
                })
              }
            </>
          )}
        </div>
      </div>
    </DesktopLayout>
  );
}

function NextActionButton({ contactId, currentNextAction, currentNextDate }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(currentNextAction || '');
  const [date,   setDate]   = useState(currentNextDate || '');
  const { updateNextAction } = useCrm();
  const TODAY = new Date().toISOString().split('T')[0];

  function handleSave() {
    if (updateNextAction) updateNextAction(contactId, action, date);
    setOpen(false);
  }

  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', padding: '9px', borderRadius: 12, border: '1.5px solid #6c5ce7',
        background: '#f0effe', color: '#6c5ce7', fontSize: 13, fontWeight: 700,
        cursor: 'pointer', fontFamily: 'Rubik, sans-serif', transition: 'all 0.18s ease',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = '#6c5ce7'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#f0effe'; e.currentTarget.style.color = '#6c5ce7'; }}>
        📅 {currentNextAction ? 'עדכן פעולה הבאה' : 'הגדר פעולה הבאה'}
      </button>
      {open && (
        <div style={{ marginTop: 8, background: '#fffaf5', borderRadius: 12, padding: 14, border: '0.5px solid rgba(0,0,0,0.06)' }}>
          <label className="form-label">תיאור הפעולה</label>
          <input className="form-input" value={action} onChange={e => setAction(e.target.value)}
            placeholder="למשל: לתאם פגישה..." style={{ marginBottom: 10 }} />
          <label className="form-label">תאריך יעד</label>
          <input type="date" className="form-input" value={date} min={TODAY}
            onChange={e => setDate(e.target.value)} style={{ marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setOpen(false)}>ביטול</button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}>שמור</button>
          </div>
        </div>
      )}
    </div>
  );
}
