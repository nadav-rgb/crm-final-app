// pages/landing.jsx
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import activists from '../data/activists';
import Link from 'next/link';

const TORAH_DEFAULT = 'וְאָהַבְתָּ לְרֵעֲךָ כָּמוֹךָ — זה כלל גדול בתורה. כל מי שמקרב יהודי אחד לאביו שבשמים, כאילו קיים עולם מלא. השבוע נזכור שכל שיחה, כל פגישה, כל חיוך — הם צינור להאיר את עולמם של אחינו.';

const PROJECTS = [
  { id: 0, name: 'כל הפרויקטים' },
  { id: 1, name: 'איילת השחר' },
  { id: 2, name: 'אחדות יהודית' },
  { id: 3, name: 'שבת מכל הסיבות' },
  { id: 4, name: 'נפש יהודי' },
];

const BG = 'linear-gradient(160deg, #fff8f0 0%, #fff2e6 50%, #ffead8 100%)';

export default function LandingPage() {
  const { currentUser, activeProject, switchProject, logout, can } = useAuth();
  const { contacts, interactions, messages } = useCrm();
  const router = useRouter();

  const isActivist = currentUser?.role === 'activist';
  const isCeo      = currentUser?.role === 'ceo' || currentUser?.role === 'head';

  const [open,         setOpen]        = useState(false);
  const [projectsOpen, setProjectsOpen]= useState(false);
  const [selectedProj, setSelectedProj]= useState(isCeo ? 0 : (currentUser?.project_id ?? 0));
  const [torahText,    setTorahText]   = useState(TORAH_DEFAULT);
  const [editingTorah, setEditingTorah]= useState(false);
  const [torahDraft,   setTorahDraft]  = useState(TORAH_DEFAULT);
  const scrollRef = useRef(null);

  // פעילות אחרונה — פעיל רואה רק את הפרויקט שלו, מנכ"ל לפי פרויקט נבחר
  const filteredInteractions = isActivist
    ? interactions.filter(i => {
        const contact = contacts.find(c => c.id === i.contact_id);
        return contact?.project_id === currentUser?.project_id;
      })
    : selectedProj === 0 ? interactions : interactions.filter(i => {
        const contact = contacts.find(c => c.id === i.contact_id);
        return contact?.project_id === selectedProj;
      });

  const filteredContacts = isActivist
    ? contacts.filter(c => c.activist_id === currentUser.id)
    : selectedProj === 0 ? contacts : contacts.filter(c => c.project_id === selectedProj);

  const recentActivity = [...filteredInteractions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(i => {
      const activist = activists.find(a => a.id === i.activist_id);
      const contact  = contacts.find(c => c.id === i.contact_id);
      return { ...i, activistName: activist?.name ?? '—', contactName: contact?.name ?? i.contact_name };
    });

  // גלילה ידנית
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragScrollLeft = useRef(0);
  const mouseDownRef = useRef(false);

  const handleMouseDown = e => {
    mouseDownRef.current = true;
    isDragging.current = false;
    dragStartX.current = e.pageX;
    dragScrollLeft.current = scrollRef.current.scrollLeft;
    scrollRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = e => {
    if (!mouseDownRef.current) return;
    const diff = e.pageX - dragStartX.current;
    if (Math.abs(diff) > 3) isDragging.current = true;
    scrollRef.current.scrollLeft = dragScrollLeft.current - diff;
  };

  const handleMouseUp = () => {
    mouseDownRef.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  };

  const outcomeColor = { 'חיובי': '#3b6d11', 'שלילי': '#a32d2d', 'ניטרלי': '#8b6d3f', 'ממתין למענה': '#854f0b' };
  const outcomeBg    = { 'חיובי': '#eaf3de', 'שלילי': '#fcebeb', 'ניטרלי': '#fdf6ef', 'ממתין למענה': '#faeeda' };

  const stats = [
    { num: filteredContacts.length, label: 'סה"כ לקוחות', color: '#c47a2e', rgb: '196,122,46' },
    { num: filteredInteractions.length, label: 'סה"כ קשרים', color: '#8b6d3f', rgb: '139,109,63' },
    { num: activists.filter(a => a.role !== 'manager' && a.status === 'active').length, label: 'פעילים פעילים', color: '#c47a2e', rgb: '196,122,46' },
    { num: filteredContacts.filter(c => c.days_since_last_contact >= 30).length, label: 'על סף ניתוק', color: '#a32d2d', rgb: '163,45,45' },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG, direction: 'rtl', overflow: 'hidden', position: 'relative' }}>

      {/* ═══ סיידבר ═══ */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: open ? 220 : 60,
          background: 'linear-gradient(180deg, #8b6dd1 0%, #5a4bd1 50%, #4a3bc1 100%)',
          display: 'flex', flexDirection: 'column',
          transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden', zIndex: 100,
          boxShadow: '-4px 0 20px rgba(83,74,183,0.15)',
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (!projectsOpen) setOpen(false); }}
      >
        {/* לוגו — לחיצה מנתקת */}
        <div style={{ padding: '14px 0 12px', display: 'flex', alignItems: 'center', paddingRight: open ? 14 : 0, justifyContent: open ? 'flex-start' : 'center', borderBottom: '0.5px solid rgba(255,255,255,0.12)', gap: 10, transition: 'padding 0.35s ease' }}>
          <button onClick={logout} title="יציאה מהמערכת"
            style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: 15, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', fontFamily: 'Rubik, sans-serif' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.35)'; e.currentTarget.style.transform = 'scale(1.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; e.currentTarget.style.transform = 'scale(1)'; }}>
            מ
          </button>
          {open && <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>מקרבים</span>}
        </div>

        {/* ניווט */}
        <div style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
          {can.seeSensitiveData && <SideItem icon="👤" label="אזור אישי"      open={open} onClick={() => router.push('/')} />}
          <SideItem icon="🏠" label="מרכז הפעילות" open={open} active />
          <SideItem icon="👥" label="לקוחות"        open={open} onClick={() => router.push('/contacts')} />
          {can.seeActivists  && <SideItem icon="⭐" label="פעילים"      open={open} onClick={() => router.push('/activists')} />}
          <SideItem icon="🔔" label="תזכורות קשר"  open={open} onClick={() => router.push('/reminders')} />
          {can.addContact    && <SideItem icon="➕" label="הוסף לקוח"   open={open} onClick={() => router.push('/contacts/add')} highlight />}
          {can.seeMeetingHouses && <SideItem icon="🏘️" label="בתי מפגש" open={open} onClick={() => router.push("/meeting-houses")} />}

          {/* פרויקטים — רק למנכ"ל וראש פרויקט */}
          {!isActivist && (
            <>
              <div onClick={() => { setProjectsOpen(p => !p); if (!open) setOpen(true); }}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', cursor: 'pointer', gap: 10, margin: '1px 6px', borderRadius: 8 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>📁</span>
                {open && <>
                  <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13, flex: 1, whiteSpace: 'nowrap' }}>פרויקט</span>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>{projectsOpen ? '▲' : '▼'}</span>
                </>}
              </div>
              {open && projectsOpen && PROJECTS.map(p => (
                <div key={p.id} onClick={() => { setSelectedProj(p.id); switchProject(p.id); setProjectsOpen(false); }}
                  style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: selectedProj === p.id ? '#fff' : 'rgba(255,255,255,0.55)', background: selectedProj === p.id ? 'rgba(255,255,255,0.15)' : 'transparent', marginRight: 20, borderRadius: 6, whiteSpace: 'nowrap' }}>
                  {selectedProj === p.id ? '◉ ' : '○ '}{p.name}
                </div>
              ))}
            </>
          )}
        </div>

        {/* פרויקט + משתמש בתחתית */}
        <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.15)' }}>
          {open && (
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              <div>פרויקט פעיל</div>
              <div style={{ color: '#fff', fontWeight: 500, fontSize: 12, marginTop: 2 }}>
                {isActivist ? activeProject?.name : selectedProj === 0 ? 'כל הפרויקטים' : PROJECTS.find(p => p.id === selectedProj)?.name}
              </div>
            </div>
          )}
          <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
              {currentUser?.name?.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            {open && <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.name}</div>
              </div>
              <button onClick={logout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>יציאה</button>
            </>}
          </div>
        </div>
      </div>

      {/* ═══ תוכן ═══ */}
      <div style={{ flex: 1, marginRight: open ? 220 : 60, overflowY: 'auto', padding: '28px 36px', transition: 'margin-right 0.35s cubic-bezier(0.4, 0, 0.2, 1)' }}>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#3d2c1e' }}>מרכז הפעילות</div>
          <div style={{ fontSize: 13, color: '#a08060', marginTop: 4 }}>
            ברוך הבא, {currentUser?.name} · {isActivist ? activeProject?.name : selectedProj === 0 ? 'כל הפרויקטים' : PROJECTS.find(p => p.id === selectedProj)?.name}
          </div>
        </div>

        {/* סטטיסטיקות */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginTop: 8, marginBottom: 44 }}>
          {stats.map(({ num, label, color, rgb }) => (
            <div
              key={label}
              style={{
                background: '#ffffff',
                borderRadius: '20px',
                padding: '28px 22px 24px',
                boxShadow: `0 0 0 1px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.10), 0 40px 64px rgba(0,0,0,0.06), 0 0 72px 10px rgba(${rgb},0.08)`,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                transition: 'transform 0.28s cubic-bezier(0.34,1.2,0.64,1), box-shadow 0.28s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-7px)';
                e.currentTarget.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.07), 0 8px 20px rgba(0,0,0,0.08), 0 28px 52px rgba(0,0,0,0.13), 0 56px 80px rgba(0,0,0,0.07), 0 0 96px 14px rgba(${rgb},0.12)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.10), 0 40px 64px rgba(0,0,0,0.06), 0 0 72px 10px rgba(${rgb},0.08)`;
              }}
            >
              {/* Thin colored top bar */}
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 3,
                background: `linear-gradient(90deg, ${color}, ${color}55)`,
                borderRadius: '20px 20px 0 0'
              }} />

              {/* Colored dot badge */}
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: `rgba(${rgb},0.10)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12
              }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
              </div>

              {/* Hero number */}
              <div style={{
                fontSize: 64,
                fontWeight: 800,
                color: '#0f172a',
                lineHeight: 1,
                letterSpacing: '-0.04em',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {num}
              </div>

              {/* Label — clearly secondary */}
              <div style={{
                fontSize: 12,
                fontWeight: 500,
                color: '#94a3b8',
                letterSpacing: '0.02em',
                marginTop: 10
              }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* פעילות אחרונה */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#3d2c1e', marginBottom: 12 }}>פעילות אחרונה</div>
          <div ref={scrollRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ display: 'flex', gap: 12, overflowX: 'scroll', paddingBottom: 8, cursor: 'grab', scrollbarWidth: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>
            {recentActivity.length === 0
              ? <div style={{ color: '#a08060', fontSize: 13 }}>אין פעילות מתועדת</div>
              : recentActivity.map((item, idx) => (
                <div key={idx}
                  onClick={() => { if (isDragging.current) { isDragging.current = false; return; } router.push(`/contact/${item.contact_id}?from=landing`); }}
                  style={{ minWidth: 170, background: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(196,122,46,0.2)', borderRadius: 12, padding: '14px 16px', flexShrink: 0, cursor: 'pointer', borderTop: `3px solid ${outcomeColor[item.outcome] ?? '#c47a2e'}`, transition: 'transform 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <div style={{ fontSize: 11, color: '#c4a882', marginBottom: 8 }}>{item.date}{item.time ? ` · ${item.time}` : ''}</div>
                  {item.project_id && <div style={{ fontSize: 10, color: '#7c5cbf', marginBottom: 6, fontWeight: 500 }}>📁 {['','איילת השחר','אחדות יהודית','שבת מכל הסיבות','נפש יהודי'][item.project_id] ?? ''}</div>}
                  <div style={{ fontSize: 11, color: '#a08060', marginBottom: 2 }}>פעיל</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#3d2c1e', marginBottom: 6 }}>{item.activistName}</div>
                  <div style={{ fontSize: 11, color: '#a08060', marginBottom: 2 }}>סוג קשר</div>
                  <div style={{ fontSize: 12, color: '#7c5cbf', marginBottom: 6 }}>{item.type}</div>
                  <div style={{ fontSize: 11, color: '#a08060', marginBottom: 2 }}>לקוח</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#3d2c1e', marginBottom: 8 }}>{item.contactName}</div>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: outcomeBg[item.outcome] ?? '#fdf6ef', color: outcomeColor[item.outcome] ?? '#8b6d3f', fontWeight: 500 }}>
                    {item.quality || item.type}
                  </span>
                </div>
              ))
            }
          </div>
        </div>

        {/* דבר תורה */}
        <div style={{ background: 'rgba(255,255,255,0.75)', borderRadius: 16, padding: '20px 24px', border: '0.5px solid rgba(196,122,46,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#3d2c1e' }}>דבר תורה שבועי</div>
              <div style={{ fontSize: 12, color: '#a08060', marginTop: 2 }}>מפי הרב גרינבוים</div>
            </div>
            {currentUser?.role === 'ceo' && !editingTorah && (
              <button onClick={() => { setTorahDraft(torahText); setEditingTorah(true); }}
                style={{ background: 'rgba(124,92,191,0.1)', border: '0.5px solid rgba(124,92,191,0.3)', color: '#7c5cbf', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                עריכה
              </button>
            )}
          </div>
          {editingTorah ? (
            <>
              <textarea value={torahDraft} onChange={e => setTorahDraft(e.target.value)}
                style={{ width: '100%', minHeight: 100, background: 'rgba(255,255,255,0.8)', border: '0.5px solid rgba(196,122,46,0.3)', borderRadius: 8, padding: 12, color: '#3d2c1e', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit', resize: 'vertical', direction: 'rtl', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => { setTorahText(torahDraft); setEditingTorah(false); }}
                  style={{ background: '#534ab7', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>שמור</button>
                <button onClick={() => setEditingTorah(false)}
                  style={{ background: 'rgba(0,0,0,0.06)', border: 'none', color: '#777', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>ביטול</button>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 15, color: '#5d4030', lineHeight: 2, margin: 0 }}>{torahText}</p>
          )}
        </div>

        {/* הודעות מערכת */}
        {messages && messages.filter(m => m.project_id === null || m.project_id === activeProject?.id).length > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.75)', borderRadius: 16, padding: '20px 24px', border: '0.5px solid rgba(196,122,46,0.2)', marginTop: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#3d2c1e', marginBottom: 14 }}>📢 הודעות מערכת</div>
            {messages
              .filter(m => m.project_id === null || m.project_id === activeProject?.id)
              .map(msg => (
                <div key={msg.id} style={{ borderBottom: '0.5px solid rgba(196,122,46,0.15)', paddingBottom: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#3d2c1e' }}>
                      {msg.pinned && '📌 '}{msg.title}
                    </div>
                    <span style={{ fontSize: 11, color: '#c4a882', whiteSpace: 'nowrap', marginRight: 8 }}>{msg.date}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#7a5c3c', lineHeight: 1.7 }}>{msg.body}</div>
                  <div style={{ fontSize: 11, color: '#c4a882', marginTop: 4 }}>— {msg.from_name}</div>
                </div>
              ))
            }
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function SideItem({ icon, label, open, onClick, active, highlight }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', cursor: 'pointer', gap: 10, margin: '1px 6px', borderRadius: 8, background: active ? 'rgba(255,255,255,0.18)' : hov ? 'rgba(255,255,255,0.1)' : highlight ? 'rgba(255,255,255,0.08)' : 'transparent', transition: 'background 0.15s' }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      {open && <span style={{ color: highlight ? '#ffd580' : active ? '#fff' : 'rgba(255,255,255,0.82)', fontSize: 13, whiteSpace: 'nowrap', fontWeight: active ? 500 : 400 }}>{label}</span>}
    </div>
  );
}
