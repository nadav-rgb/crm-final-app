// pages/activists/[id].jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import BackLink from '../../components/ui/BackLink';
import { interactionsLast30, getActivistPerformance, timeInSystem } from '../../lib/activistStats';
import { useCrm } from '../../lib/CrmStore';
import { useAuth } from '../../lib/AuthStore';
import { authHeader } from '../../lib/apiAuth';
import getReminders from '../../lib/getReminders';
import DesktopLayout from '../../components/DesktopLayout';

// שליחת התראה יזומה לפעיל (רכז/ראש-פרויקט/מנכ"ל). נשלחת גם למכשירים (push)
// וגם לפעמון (bell:true) — כך שההודעה מגיעה גם לפעיל בלי מכשיר רשום.
function SendNotificationBox({ activist }) {
  const [open, setOpen]       = useState(false);
  const [title, setTitle]     = useState('');
  const [body, setBody]       = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState('');

  async function handleSend() {
    if (!title.trim() || !body.trim()) { setResult('יש למלא כותרת ותוכן'); return; }
    setSending(true); setResult('');
    try {
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          activistId: String(activist.id),
          title: title.trim(),
          body: body.trim(),
          url: '/notifications',
          bell: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(`השליחה נכשלה (${data.error || res.status})`);
      } else if (data.sent > 0) {
        setResult(`✅ נשלח: ${data.sent} מכשירים + הפעמון במערכת`);
        setTitle(''); setBody('');
      } else {
        setResult('✅ נשמר בפעמון. לפעיל אין מכשיר רשום להתראות — ההודעה תופיע לו בכניסה הבאה למערכת');
        setTitle(''); setBody('');
      }
    } catch {
      setResult('השליחה נכשלה — בדוק את החיבור לרשת');
    }
    setSending(false);
  }

  const inputStyle = { width:'100%', border:'1px solid rgba(0,0,0,0.12)', borderRadius:10, padding:'9px 12px', fontSize:13, fontFamily:'inherit', color:'#333', outline:'none', boxSizing:'border-box' };

  return (
    <div style={{ background:'#fff', borderRadius:16, padding:'16px 20px', border:'0.5px solid rgba(0,0,0,0.07)', boxShadow:'0 1px 4px rgba(0,0,0,0.04)', marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
        <div style={{ fontSize:14, fontWeight:800, color:'#2d1f5e' }}>🔔 שליחת התראה לפעיל</div>
        <button onClick={() => { setOpen(o => !o); setResult(''); }}
          style={{ background:open?'#f5f5f5':'#6c5ce7', border:'none', borderRadius:10, padding:'7px 16px', fontSize:12, color:open?'#666':'#fff', fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>
          {open ? 'סגור' : 'שלח התראה'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת (למשל: תזכורת חשובה)" style={inputStyle} maxLength={80} />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="תוכן ההודעה…" rows={3} style={{ ...inputStyle, resize:'vertical' }} maxLength={400} />
          <button onClick={handleSend} disabled={sending}
            style={{ alignSelf:'flex-start', background:'#6c5ce7', border:'none', borderRadius:10, padding:'9px 22px', fontSize:13, color:'#fff', fontWeight:800, cursor:sending?'wait':'pointer', fontFamily:'inherit', opacity:sending?0.7:1 }}>
            {sending ? 'שולח…' : 'שלח עכשיו'}
          </button>
        </div>
      )}
      {result && <div style={{ marginTop:10, fontSize:13, fontWeight:700, color: result.startsWith('✅') ? '#27ae60' : '#b0483f', lineHeight:1.6 }}>{result}</div>}
    </div>
  );
}

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
  const { can, filterProject, currentUser } = useAuth();
  const canSendNotification = ['coord', 'head', 'ceo'].includes(currentUser?.role);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  // רק רכז/ראש-פרויקט/מנכ"ל יכולים לצפות בפרטי פעיל אחר (תואם ל-can.seeActivists בעמוד הרשימה).
  if (!can.seeActivists) {
    return <DesktopLayout title="פעיל"><div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>אין הרשאה לדף זה</div></DesktopLayout>;
  }

  const activist = activists.find(a => a.id === Number(id));
  if (!activist) return <DesktopLayout title="פעיל"><div>פעיל לא נמצא</div></DesktopLayout>;

  async function doDeleteActivist() {
    setBusy(true);
    const res = await fetch('/api/admin/soft-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ entity: 'activist', id: activist.id, action: 'delete' }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { alert(body.error || 'המחיקה נכשלה'); return; }
    router.push('/activists');
  }

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
  const backLabel = from === 'contact-detail' && contactId ? 'חזרה ללקוח' : 'חזרה לפעילים';

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
          {canSendNotification && <SendNotificationBox activist={activist} />}

          {can.manageDeleted && (
            <button onClick={() => setConfirmDel(true)} className="btn"
              style={{ width: '100%', marginBottom: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#a32d2d', borderColor: '#d98a8a' }}>
              🗑️ מחיקת פעיל
            </button>
          )}

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
                        <BackLink href={`/contact/${c.id}?from=activist&activistId=${activist.id}`} direction="forward">
                          צפייה
                        </BackLink>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      </div>

      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}
          onClick={() => setConfirmDel(false)}>
          <div style={{ padding: 24, maxWidth: 380, background: '#fff', borderRadius: 16 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginTop: 0 }}>
              למחוק את <strong>{activist.name}</strong>? כל אנשי הקשר שלו ({ownedContacts.length}) יוסתרו יחד איתו.
              ניתן לשחזר תוך 90 יום דרך סל המיחזור.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmDel(false)} disabled={busy}>ביטול</button>
              <button className="btn" style={{ background: '#a32d2d', color: '#fff' }} disabled={busy} onClick={doDeleteActivist}>מחק</button>
            </div>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}
