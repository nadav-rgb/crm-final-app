// pages/contact/[id].jsx
import { useRouter } from 'next/router';
import Link from 'next/link';
import BackLink from '../../components/ui/BackLink';
import CONFIG from '../../data/config';
import getReminders from '../../lib/getReminders';
import StatusBadge from '../../components/StatusBadge';
import DesktopLayout from '../../components/DesktopLayout';
import { timeInSystem } from '../../lib/activistStats';
import { formatDateHe } from '../../lib/formatDate';
import { useCrm } from '../../lib/CrmStore';
import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/AuthStore';
import { getMeetingHouses } from '../../lib/meetingHousesStorage';
import { fetchMeetingHousesFromSupabase } from '../../lib/meetingHousesSupabase';
import { PAID_PROJECT_IDS } from '../../lib/paymentCalc';
import { createInteractionEditedNotification } from '../../lib/notificationDemo';
import { authHeader } from '../../lib/apiAuth';

export default function ContactDetail() {
  const router = useRouter();
  const { id, from, activistId, view, contactId: fromContactId } = router.query;
  const { contacts, interactions, activists, tours, updateContact, deleteContact, updateInteraction, deleteInteraction } = useCrm();
  const { can, activeProject, currentUser } = useAuth();

  // F1 — state לעריכה/מחיקה. חייב להיות לפני כל early return (כללי hooks).
  const [editing, setEditing]     = useState(false);
  const [editForm, setEditForm]   = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [editingInterId, setEditingInterId] = useState(null);
  const [interForm, setInterForm]           = useState(null);
  const [confirmDelInterId, setConfirmDelInterId] = useState(null);
  const [highlightInterId, setHighlightInterId] = useState(null); // הדגשה זמנית לקשר שנפתח מ"הפעילויות שלי"
  // שגיאת עריכה/מחיקת קשר שנכשלה בפועל (403 קשר לא בפרויקט שלך / 500 / רשת — coord/head
  // דרך pages/api/interactions/manage.js). ר' saveEditInteraction/doDeleteInteraction למטה.
  const [toast, setToast] = useState(null);

  // גלילה + הדגשה זמנית לקשר ספציפי — הגעה מ-/my-activities עם ?openInteraction=<id>.
  // מנקה את הפרמטר מיד אחרי הגלילה — אחרת כל עדכון interactions ברקע (למשל סיכום AI שמתעדכן
  // אחרי שכבר עברנו לדף הזה) יפעיל שוב גלילה+הדגשה בלי שהמשתמש עשה כלום.
  useEffect(() => {
    const targetId = router.query.openInteraction;
    if (!targetId) return;
    setHighlightInterId(Number(targetId));
    const el = document.getElementById(`interaction-${targetId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightInterId(null), 2000);
    const { openInteraction, ...restQuery } = router.query;
    router.replace({ pathname: router.pathname, query: restQuery }, undefined, { shallow: true });
    return () => clearTimeout(t);
  }, [router.query.openInteraction, interactions]);

  // בתי מפגש אמיתיים — לבחירת "בית מפגש משויך" בעריכת הלקוח (במקום טקסט חופשי בלבד).
  const [houses, setHouses]   = useState([]);
  const [houseSel, setHouseSel] = useState(''); // מפתח הבית שנבחר, '' = לא נבחר, '__manual__' = הזנה ידנית
  useEffect(() => {
    let active = true;
    (async () => {
      const remote = await fetchMeetingHousesFromSupabase();
      const local  = getMeetingHouses();
      const remoteIds = new Set(remote.map(h => String(h.id)));
      const merged = [...remote, ...local.filter(h => !remoteIds.has(String(h.id)))];
      if (active) setHouses(merged);
    })();
    return () => { active = false; };
  }, []);
  const houseKey = h => `${h.houseNumber}||${h.settlement || h.city || ''}`;

  const contact = contacts.find(c => c.id === Number(id));
  if (!contact) return <DesktopLayout title="לקוח"><div>לקוח לא נמצא</div></DesktopLayout>;

  // בעלות — פעיל רואה/עורך רק לקוח ששייך לו; רכז/ראש-פרויקט/מנכ"ל מוגבלים לפי פרויקט (isOwnProject).
  const isOwner = currentUser?.role !== 'activist' || contact.activist_id === currentUser?.id;
  // תנאי מדויק לכפתורי עריכה/מחיקת-קשר בלבד — לא isOwner (רחב מדי: נכון גם ל-finance,
  // שלא אמור לראות את הכפתורים האלה. ראה docs/superpowers/specs/2026-09-06-coord-interaction-management-and-torani-bonus-eligibility-design.md).
  const canManageInteractions = contact.activist_id === currentUser?.id || ['coord', 'head', 'ceo'].includes(currentUser?.role);

  function openEdit() {
    setEditForm({
      name:                 contact.name || '',
      phone:                contact.phone || '',
      city:                 contact.city || '',
      area:                 contact.area || '',
      gender:               contact.gender || '',
      age:                  contact.age ?? '',
      profession:           contact.profession || '',
      how_met:              contact.how_met || '',
      high_potential:       !!contact.high_potential,
      meeting_place_city:   contact.meeting_place_city || '',
      meeting_place_number: contact.meeting_place_number || '',
      tour_id:              contact.tour_id || '',
      mitzvot:              { ...(contact.mitzvot || {}) }, // סולם מצוות ראשוני — עריכה ישירה
      notes:                contact.notes || '',
    });
    // ברירת מחדל לבחירת בית מפגש: מסמן את הבית התואם אם קיים, אחרת הזנה ידנית (שמירת נתון חופשי קיים)
    const match = houses.find(h => String(h.houseNumber) === String(contact.meeting_place_number) &&
      (h.settlement || h.city || '') === (contact.meeting_place_city || ''));
    setHouseSel(match ? houseKey(match)
      : (contact.meeting_place_city || contact.meeting_place_number) ? '__manual__' : '');
    setEditing(true);
  }

  function setEditMitzvah(name, level) {
    setEditForm(f => ({ ...f, mitzvot: { ...(f.mitzvot || {}), [name]: level } }));
  }

  async function saveEdit() {
    setBusy(true);
    const ageNum = Number(editForm.age);
    await updateContact(contact.id, {
      name:                 editForm.name?.trim() || contact.name,
      phone:                editForm.phone?.trim() || null,
      city:                 editForm.city?.trim() || null,
      area:                 editForm.area?.trim() || null,
      gender:               editForm.gender || null,
      age:                  editForm.age !== '' && Number.isFinite(ageNum) ? ageNum : null,
      profession:           editForm.profession?.trim() || null,
      how_met:              editForm.how_met?.trim() || null,
      high_potential:       !!editForm.high_potential,
      meeting_place_city:   editForm.meeting_place_city?.trim() || null,
      meeting_place_number: editForm.meeting_place_number?.trim() || null,
      ...(contact.project_id === 2 ? { tour_id: editForm.tour_id || null } : {}),
      // סולם מצוות ראשוני — עריכה ישירה של הבסיס (לא דרך "עדכון התקדמות" → לא מזכה בונוס)
      ...(editForm.mitzvot ? { mitzvot: editForm.mitzvot } : {}),
      notes:                editForm.notes?.trim() || null,
    });
    setBusy(false);
    setEditing(false);
  }

  async function doDelete() {
    setBusy(true);
    if (currentUser?.role === 'coord' || currentUser?.role === 'head' || currentUser?.role === 'ceo') {
      const res = await fetch('/api/admin/soft-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ entity: 'contact', id: contact.id, action: 'delete' }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.error || 'המחיקה נכשלה'); setBusy(false); return; }
      // ה-endpoint המיוחס הזה (בניגוד ל-deleteContact הרגיל למטה) לא מעדכן את ה-state המקומי
      // של contacts ב-CrmStore — בלי רענון מלא הלקוח שנמחק ימשיך להופיע ב-/contacts עד רענון
      // ידני. אין ב-CrmStore דרך קיימת לעדכן contacts מבחוץ ל-deleteContact עצמה, אז ניווט קשיח
      // (לא router.push) הוא התיקון המינימלי הנכון: מכריח טעינה מחדש של כל האפליקציה, כולל
      // שליפת contacts טרייה מ-Supabase (שכבר מסננת is_active=true, ר' loadContactsFromSupabase).
      setBusy(false);
      window.location.href = '/contacts';
      return;
    }
    await deleteContact(contact.id);
    setBusy(false);
    router.push('/contacts');
  }

  function openEditInteraction(i) {
    setInterForm({
      type:              i.type || '',
      quality:           i.quality || '',
      duration_minutes:  i.duration_minutes ?? '',
      date:              i.date || '',
      outcome:           i.outcome || '',
      description:       i.description || '',
      notes:             i.notes || '',
    });
    setEditingInterId(i.id);
  }

  async function saveEditInteraction() {
    setBusy(true);
    setToast(null);
    const durNum = Number(interForm.duration_minutes);
    const newDuration = interForm.duration_minutes !== '' && Number.isFinite(durNum) ? durNum : null;
    const original = interactions.find(x => x.id === editingInterId);
    const { error } = await updateInteraction(editingInterId, {
      type:              interForm.type,
      quality:           interForm.quality,
      duration_minutes:  newDuration,
      date:              interForm.date,
      outcome:           interForm.outcome,
      description:       interForm.description?.trim() || '',
      notes:             interForm.notes?.trim() || '',
    });
    setBusy(false);
    // רכז/ראש-פרויקט: הקריאה יכולה היום להיכשל באמת (403 קשר לא בפרויקט שלך / 500 / רשת —
    // ר' pages/api/interactions/manage.js), לא רק להיחסם בשקט ע"י RLS כמו קודם. בלי הבדיקה
    // הזו המודאל היה נסגר וההתראה למטה הייתה נורית גם כשהעדכון בפועל לא נחת ב-DB.
    if (error) {
      setToast({ text: `העריכה לא נשמרה: ${error.message || error || 'שגיאה לא צפויה'}. נסה שוב.` });
      return;
    }
    // שדה שמשפיע על גובה התשלום השתנה — הדשבורד כבר מחשב חי; רק מודיעים לפעיל
    const paymentFieldChanged = original && (
      original.type !== interForm.type ||
      original.quality !== interForm.quality ||
      Number(original.duration_minutes ?? 0) !== Number(newDuration ?? 0)
    );
    if (paymentFieldChanged && PAID_PROJECT_IDS.includes(contact.project_id) && currentUser) {
      createInteractionEditedNotification({ activist: currentUser, contact });
    }
    setEditingInterId(null);
  }

  async function doDeleteInteraction() {
    setBusy(true);
    setToast(null);
    const { error } = await deleteInteraction(confirmDelInterId);
    setBusy(false);
    // ראה הערה מקבילה ב-saveEditInteraction — אותו סיכון בדיוק, אותה בדיקה.
    if (error) {
      setToast({ text: `המחיקה לא בוצעה: ${error.message || error || 'שגיאה לא צפויה'}. נסה שוב.` });
      return;
    }
    setConfirmDelInterId(null);
  }

  const reminders    = getReminders(contact);
  const enriched     = { ...contact, ...reminders };
  const owner         = activists.find(a => a.id === contact.activist_id)
    || (contact.activist_id === currentUser?.id ? currentUser : null);
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
  const backLabel = from === 'activist' && activistId ? 'חזרה לפעיל'
                  : from === 'landing'                 ? 'חזרה למרכז הפעילות'
                  : from === 'personal'                ? 'חזרה לאזור האישי'
                  : from === 'reminders'               ? 'חזרה לתזכורות'
                  : from === 'former'                  ? 'חזרה ללקוחות לשעבר'
                  : 'חזרה ללקוחות';

  const isAchdut    = activeProject?.id === 1;
  const sourceLabel = contact.source ? (CONFIG.contactSources?.[contact.source] ?? contact.source) : '—';
  const timeLabel   = timeInSystem(contact.joined_at);

  // הרשאות — פעיל רואה נתונים רגישים רק על לקוח שלו; רכז/ראש-פרויקט/מנכ"ל לפי פרויקט
  const isOwnProject  = can.ownProjectId === null || contact.project_id === can.ownProjectId;
  const showSensitive = can.seeSensitiveData && isOwnProject && isOwner;
  // F1 (תוקן בביקורת חוצת-משימות) — כפתור *מחיקת* לקוח (לא עריכה): הבעלים (פעיל, מוגבל
  // לפרויקט שלו — ללא שינוי) + רכז/ראש-פרויקט/מנכ"ל (can.manageDeleted) בלי isOwnProject/isOwner —
  // הבדיקה האמיתית לפרויקט כבר נאכפת בצד השרת (assertProjectAccess ב-pages/api/admin/soft-delete.js).
  // אותו דפוס בדיוק כמו canManageInteractions למעלה, לעקביות בין שני סוגי ההרשאות באותו קובץ.
  const canDeleteContact = (can.addContact && isOwnProject && isOwner) || can.manageDeleted;

  return (
    <DesktopLayout
      title={contact.name}
      subtitle={contact.phone}
      backHref={backHref}
      backLabel={backLabel}
      actions={showSensitive ? <StatusBadge status={enriched.status} /> : null}
    >
      {/* שגיאת עריכה/מחיקת קשר — אותו דפוס "toast" בדיוק כמו pages/contact/add-interaction/[id].jsx
          (TOAST_STYLES.block), כדי שכשל אמיתי (403/500/רשת) יוצג ולא רק ייבלע בשקט */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
                      background: '#fff0f0', border: '1px solid #e0a0a0', color: '#c0392b',
                      borderRadius: 14, padding: '12px 18px', maxWidth: 440, width: 'calc(100% - 32px)',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.15)', display: 'flex', gap: 12, alignItems: 'center',
                      fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
          <span style={{ flex: 1, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'inherit', lineHeight: 1 }}>✕</button>
        </div>
      )}
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
                contact.tour_id
                  ? ['סיור', (() => { const t = tours.find(x => x.id === contact.tour_id); return t ? `סיור ${t.tour_number} · ${t.settlement}` : contact.tour_id; })()]
                  : isAchdut
                    ? ['בית מפגש', `${contact.meeting_place_city || '—'} / מס׳ ${contact.meeting_place_number || '—'}`]
                    : ['מאיפה הכרנו', contact.how_met || sourceLabel],
                ['זמן במערכת',     timeLabel],
                ['קשר אחרון',      formatDateHe(contact.last_interaction_date)],
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
                    <BackLink
                      href={`/activists/${owner.id}?from=contact-detail&contactId=${contact.id}`}
                      direction="forward" variant="link" style={{ color: '#534ab7' }}
                    >
                      {owner.name}
                    </BackLink>
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
                {enriched.actionOverdue ? '⚠ באיחור —' : 'לתאריך:'} {formatDateHe(contact.next_action_date)}
              </div>
            </div>
          )}

          {/* כפתורי פעולה */}
          {can.addContact && isOwnProject && isOwner && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href={`/contact/add-interaction/${contact.id}`} className="btn btn-primary"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}>
                + הוסף קשר
              </Link>
              <a href={`https://wa.me/${(contact.phone || '').replace(/\D/g, '').replace(/^0/, '972')}`}
                target="_blank" rel="noopener noreferrer" className="btn"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', color: '#1d8a4e', borderColor: '#25d366' }}>
                💬 וואטסאפ
              </a>
              <a href={`tel:${contact.phone}`} className="btn"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', color: '#3b6d11', borderColor: '#639922' }}>
                📞 התקשר
              </a>
            </div>
          )}

          {/* עדכון התקדמות רוחנית (סרגל מצוות) — כניסה בולטת; הדף קיים אך לא היה נגיש */}
          {can.addContact && isOwnProject && isOwner && (
            <Link href={`/contact/update-mitzvot/${contact.id}`} className="btn"
              style={{ display: 'block', marginTop: 8, textAlign: 'center', textDecoration: 'none',
                       color: '#3a249b', borderColor: '#6d4eca', fontWeight: 600 }}>
              ✡️ עדכון התקדמות רוחנית
            </Link>
          )}

          {/* F1 — עריכה / מחיקת לקוח. עריכה: בעלים בלבד (ללא שינוי). מחיקה: כל מי שעונה
              ל-canDeleteContact (בעלים + רכז/ראש/מנכ"ל) — ר' הגדרתה למעלה. העטיפה החיצונית
              משתמשת ב-canDeleteContact בלבד (לא בביטוי כפול) כי הבעלות כבר כלולה בהגדרתה. */}
          {canDeleteContact && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {can.addContact && isOwnProject && isOwner && (
                <button onClick={openEdit} className="btn"
                  style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✏️ עריכת פרטים
                </button>
              )}
              <button onClick={() => setConfirmDel(true)} className="btn"
                style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit', color: '#a32d2d', borderColor: '#d98a8a' }}>
                🗑️ מחיקה
              </button>
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
                  <div key={i.id} id={`interaction-${i.id}`}
                    style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', marginBottom: 8,
                      border: `0.5px solid ${highlightInterId === i.id ? '#6c5ce7' : '#e0e0e0'}`,
                      boxShadow: highlightInterId === i.id ? '0 0 0 3px rgba(108,92,231,0.18)' : 'none',
                      transition: 'box-shadow 0.3s ease, border-color 0.3s ease' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong style={{ fontSize: 14 }}>{i.type}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: '#aaa' }}>{i.date}</span>
                        {canManageInteractions && (
                          <>
                            <button onClick={() => openEditInteraction(i)} title="עריכת קשר"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1 }}>✏️</button>
                            <button onClick={() => setConfirmDelInterId(i.id)} title="מחיקת קשר"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1 }}>🗑️</button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* תגיות: איכות / משך / תוצאה */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: i.description || (i.ai_summary && currentUser?.role !== 'activist') || i.next_action || i.notes ? 8 : 0 }}>
                      {i.quality && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f0effe', color: '#6c5ce7', fontWeight: 600 }}>{i.quality}</span>}
                      {durationLabel && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#eef6ee', color: '#3b6d11', fontWeight: 600 }}>{durationLabel}</span>}
                      {i.outcome && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f5f5f5', color: '#777', fontWeight: 600 }}>{i.outcome}</span>}
                    </div>

                    {i.description && <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6, marginBottom: 6 }}>{i.description}</div>}

                    {/* סיכום AI — מיועד לרכז/מנהל בלבד; פעילים לא רואים סיכומים */}
                    {i.ai_summary && currentUser?.role !== 'activist' && (
                      <div style={{ fontSize: 12, color: '#444', background: '#faf9ff', border: '0.5px solid #ece9fb', borderRadius: 10, padding: '8px 10px', marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                        <span style={{ fontWeight: 700, color: '#6c5ce7' }}>סיכום: </span>{i.ai_summary}
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

      {/* F1 — מודאל עריכת פרטי לקוח */}
      {editing && editForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => !busy && setEditing(false)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 460, width: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#2d1f5e', marginBottom: 16 }}>עריכת פרטי לקוח</div>
            <label style={{ fontSize: 12, color: '#777' }}>שם</label>
            <input className="input" value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
            <label style={{ fontSize: 12, color: '#777' }}>טלפון</label>
            <input className="input" value={editForm.phone} inputMode="tel"
              onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
              style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>יישוב</label>
                <input className="input" value={editForm.city}
                  onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>אזור</label>
                <input className="input" value={editForm.area}
                  onChange={e => setEditForm(f => ({ ...f, area: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>מגדר</label>
                <select className="input" value={editForm.gender}
                  onChange={e => setEditForm(f => ({ ...f, gender: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4, fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
                  <option value="">—</option>
                  <option value="male">איש</option>
                  <option value="female">אשה</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>גיל</label>
                <input className="input" type="number" min="1" max="120" value={editForm.age}
                  onChange={e => setEditForm(f => ({ ...f, age: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
              </div>
            </div>
            <label style={{ fontSize: 12, color: '#777' }}>עיסוק מקצועי</label>
            <input className="input" value={editForm.profession}
              onChange={e => setEditForm(f => ({ ...f, profession: e.target.value }))}
              style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
            <label style={{ fontSize: 12, color: '#777' }}>מאיפה הכרנו</label>
            <input className="input" value={editForm.how_met}
              onChange={e => setEditForm(f => ({ ...f, how_met: e.target.value }))}
              style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
            {contact.project_id === 2 ? (
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>סיור משויך</label>
                <select className="input" value={editForm.tour_id}
                  onChange={e => setEditForm(f => ({ ...f, tour_id: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4, fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
                  <option value="">— מחוץ לסיורים —</option>
                  {tours.map(t => (
                    <option key={t.id} value={t.id}>סיור {t.tour_number} · {t.settlement} ({t.date})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#777' }}>בית מפגש משויך</label>
                <select className="input" value={houseSel}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__manual__') { setHouseSel('__manual__'); return; }
                    if (v === '') { setHouseSel(''); setEditForm(f => ({ ...f, meeting_place_city: '', meeting_place_number: '' })); return; }
                    const h = houses.find(x => houseKey(x) === v);
                    if (h) setEditForm(f => ({ ...f, meeting_place_city: h.settlement || h.city || '', meeting_place_number: String(h.houseNumber ?? '') }));
                    setHouseSel(v);
                  }}
                  style={{ width: '100%', marginBottom: 8, marginTop: 4, fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
                  <option value="">— ללא בית מפגש —</option>
                  {houses.map(h => (
                    <option key={houseKey(h)} value={houseKey(h)}>בית מפגש {h.houseNumber} · {h.settlement || h.city || ''}</option>
                  ))}
                  <option value="__manual__">הזנה ידנית (עיר + מספר)</option>
                </select>
                {(houseSel === '__manual__' || houses.length === 0) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, color: '#777' }}>יישוב בית המפגש</label>
                      <input className="input" value={editForm.meeting_place_city}
                        onChange={e => setEditForm(f => ({ ...f, meeting_place_city: e.target.value }))}
                        style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: '#777' }}>מספר בית המפגש</label>
                      <input className="input" value={editForm.meeting_place_number}
                        onChange={e => setEditForm(f => ({ ...f, meeting_place_number: e.target.value }))}
                        style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
                    </div>
                  </div>
                )}
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#444', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={editForm.high_potential}
                onChange={e => setEditForm(f => ({ ...f, high_potential: e.target.checked }))} />
              פוטנציאל גבוה
            </label>

            {/* סולם מצוות ראשוני — עריכה ישירה של הבסיס (לתיקון; אינה מזכה בונוס. לעדכון התקדמות עם בונוס יש דף נפרד) */}
            {(editForm.gender === 'male' || editForm.gender === 'female') && (
              <div style={{ background: '#faf9ff', border: '0.5px solid #ece9fb', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6c5ce7', marginBottom: 2 }}>סולם מצוות ראשוני</div>
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>עריכה ישירה של הבסיס — לתיקון בלבד, אינה מזכה בבונוס. לעדכון התקדמות עם בונוס יש דף נפרד.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(editForm.gender === 'male' ? CONFIG.mitzvotMale : CONFIG.mitzvotFemale).map(mitz => {
                    const lvl = editForm.mitzvot?.[mitz] ?? 0;
                    return (
                      <div key={mitz} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#333' }}>{mitz}</span>
                        <select value={lvl} onChange={e => setEditMitzvah(mitz, Number(e.target.value))}
                          style={{ width: 88, padding: '5px 8px', borderRadius: 8, border: `1.5px solid ${lvl > 0 ? '#6c5ce7' : '#e8e8e8'}`, fontSize: 12.5, background: lvl > 0 ? '#f0effe' : '#fafafa', color: lvl > 0 ? '#6c5ce7' : '#999', fontFamily: 'Rubik, sans-serif', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
                          {CONFIG.mitzvotLevels.map(l => <option key={l} value={l}>רמה {l}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <label style={{ fontSize: 12, color: '#777' }}>הערות</label>
            <textarea className="input" value={editForm.notes} rows={3}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              style={{ width: '100%', marginBottom: 16, marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setEditing(false)} disabled={busy}>ביטול</button>
              <button className="btn btn-primary" style={{ flex: 2, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={saveEdit} disabled={busy || !editForm.name.trim()}>{busy ? 'שומר…' : 'שמור'}</button>
            </div>
          </div>
        </div>
      )}

      {/* F1 — אישור מחיקה */}
      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => !busy && setConfirmDel(false)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#a32d2d', marginBottom: 10 }}>מחיקת לקוח</div>
            <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 18 }}>
              למחוק את <strong>{contact.name}</strong> מהרשימה? הלקוח יוסר מהתצוגה (ניתן לשחזור בבסיס הנתונים).
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setConfirmDel(false)} disabled={busy}>ביטול</button>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit', color: '#fff', background: '#a32d2d', borderColor: '#a32d2d' }}
                onClick={doDelete} disabled={busy}>{busy ? 'מוחק…' : 'מחק'}</button>
            </div>
          </div>
        </div>
      )}

      {/* עריכת קשר שדווח */}
      {editingInterId && interForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => !busy && setEditingInterId(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 460, width: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#2d1f5e', marginBottom: 16 }}>עריכת קשר</div>
            <label style={{ fontSize: 12, color: '#777' }}>סוג קשר</label>
            <select className="input" value={interForm.type}
              onChange={e => setInterForm(f => ({ ...f, type: e.target.value }))}
              style={{ width: '100%', marginBottom: 12, marginTop: 4, fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
              {CONFIG.interactionTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {interForm.type !== 'אירוח שבת' && (
              <>
                <label style={{ fontSize: 12, color: '#777' }}>איכות קשר</label>
                <select className="input" value={interForm.quality}
                  onChange={e => setInterForm(f => ({ ...f, quality: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4, fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
                  <option value="">—</option>
                  {CONFIG.interactionQuality.map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>משך (דקות)</label>
                <input className="input" type="number" min="0" value={interForm.duration_minutes}
                  onChange={e => setInterForm(f => ({ ...f, duration_minutes: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#777' }}>תאריך</label>
                <input className="input" type="date" value={interForm.date} max={new Date().toISOString().split('T')[0]}
                  onChange={e => setInterForm(f => ({ ...f, date: e.target.value }))}
                  style={{ width: '100%', marginBottom: 12, marginTop: 4 }} />
              </div>
            </div>
            <label style={{ fontSize: 12, color: '#777' }}>תוצאה</label>
            <select className="input" value={interForm.outcome}
              onChange={e => setInterForm(f => ({ ...f, outcome: e.target.value }))}
              style={{ width: '100%', marginBottom: 12, marginTop: 4, fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}>
              <option value="">—</option>
              {CONFIG.outcomeValues.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <label style={{ fontSize: 12, color: '#777' }}>תיאור המפגש</label>
            <textarea className="input" value={interForm.description} rows={3}
              onChange={e => setInterForm(f => ({ ...f, description: e.target.value }))}
              style={{ width: '100%', marginBottom: 12, marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }} />
            <label style={{ fontSize: 12, color: '#777' }}>הערות</label>
            <textarea className="input" value={interForm.notes} rows={2}
              onChange={e => setInterForm(f => ({ ...f, notes: e.target.value }))}
              style={{ width: '100%', marginBottom: 16, marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setEditingInterId(null)} disabled={busy}>ביטול</button>
              <button className="btn btn-primary" style={{ flex: 2, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={saveEditInteraction} disabled={busy}>{busy ? 'שומר…' : 'שמור'}</button>
            </div>
          </div>
        </div>
      )}

      {/* אישור מחיקת קשר */}
      {confirmDelInterId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => !busy && setConfirmDelInterId(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#a32d2d', marginBottom: 10 }}>מחיקת קשר</div>
            <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 18 }}>
              למחוק את הקשר הזה? הפעולה אינה הפיכה.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => setConfirmDelInterId(null)} disabled={busy}>ביטול</button>
              <button className="btn" style={{ flex: 1, cursor: 'pointer', fontFamily: 'inherit', color: '#fff', background: '#a32d2d', borderColor: '#a32d2d' }}
                onClick={doDeleteInteraction} disabled={busy}>{busy ? 'מוחק…' : 'מחק'}</button>
            </div>
          </div>
        </div>
      )}
    </DesktopLayout>
  );
}
