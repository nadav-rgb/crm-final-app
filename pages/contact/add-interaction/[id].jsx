// pages/contact/add-interaction/[id].jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../../../data/config';
import { useCrm } from '../../../lib/CrmStore';
import { useAuth } from '../../../lib/AuthStore';
import { calcInteractionPayment, PAID_PROJECT_IDS } from '../../../lib/paymentCalc';
import DesktopLayout from '../../../components/DesktopLayout';
import { summarizeInteractionText } from '../../../lib/aiService';
import { createPaymentInteractionNotifications, createInteractionSummaryNotifications, createDemoNotification } from '../../../lib/notificationDemo';
import VoiceInput from '../../../components/VoiceInput';

const TODAY = new Date().toISOString().split('T')[0];

const EMPTY = {
  type: '', quality: '', outcome: 'חיובי', date: TODAY,
  long_enough: null,
  notes: '', description: '', ai_summary: '',
  next_action: '', next_action_date: '',
  multi: false, participant_count: '', // מפגש רב משתתפים — קומפוננטה נפרדת
};

export default function AddInteractionPage() {
  const router    = useRouter();
  const { id }    = router.query;
  const contactId = Number(id);
  const { contacts, interactions, addInteraction, updateInteraction, paymentConfig } = useCrm();
  const { currentUser, activeProject } = useAuth();
  const contact = contacts.find(c => c.id === contactId);

  const [form,      setForm]      = useState(EMPTY);
  const [errors,    setErrors]    = useState({});
  const [success,   setSuccess]   = useState(false);
  const [toast,     setToast]     = useState(null); // התראת תקרה/בונוס

  if (!contact) {
    return <DesktopLayout title="הוסף קשר"><div style={{ padding: 40, color: '#aaa' }}>לקוח לא נמצא</div></DesktopLayout>;
  }

  // Security: activist can only report for their own contact
  if (currentUser?.role === 'activist' && contact.activist_id !== currentUser.id) {
    return (
      <DesktopLayout title="הוספת קשר" backHref={`/contact/${contactId}`} backLabel="← חזרה">
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 15 }}>אין הרשאה — לא ניתן לדווח קשר עבור לקוח שאינו שלך</div>
        </div>
      </DesktopLayout>
    );
  }

  // פרויקט בתשלום: אחדות יהודית (1) או נעים להכיר (2) — כללי תשלום זהים, תקרות משותפות.
  // השם isAchdut נשמר היסטורית; המשמעות בפועל = "פרויקט מזכה בתשלום".
  const isAchdut = PAID_PROJECT_IDS.includes(activeProject?.id) || PAID_PROJECT_IDS.includes(contact.project_id);

  // משך מזכה — נגזר מהקונפיג (MIN_DURATION+1) ולא מספר קבוע, כדי שיתאים תמיד לסף שהמנוע אוכף.
  const MIN_DUR = paymentConfig.MIN_DURATION ?? 15;
  const QUALIFYING_DUR = MIN_DUR + 1;

  // Live payment calculation
  const duration = form.long_enough === 'yes' ? QUALIFYING_DUR : form.long_enough === 'no' ? 5 : 0;
  const currentMonthKey = form.date?.slice(0, 7);
  const previousContactMonthly = interactions.filter(i =>
    i.contact_id === contactId &&
    i.activist_id === currentUser?.id &&
    i.date?.slice(0, 7) === currentMonthKey
  );
  const previousActivistMonthly = interactions.filter(i =>
    i.activist_id === currentUser?.id &&
    i.date?.slice(0, 7) === currentMonthKey
  );
  const isShabbat = form.type === 'אירוח שבת';
  // "רב משתתפים" עבר לקומפוננטה נפרדת (toggleMulti) — לא מוצג עוד כאיכות רגילה כדי למנוע כפילות.
  const qualityOptions = CONFIG.interactionQuality;
  const QUALITY_LABELS = { [CONFIG.interactionQualityMulti]: 'מפגש רב משתתפים' };
  const payableCheck = (isAchdut && form.type && (form.quality || isShabbat) && form.long_enough)
    ? calcInteractionPayment(
        { type: form.type, quality: form.quality, duration_minutes: duration },
        previousContactMonthly,
        contact.high_potential,
        previousActivistMonthly,
        paymentConfig
      )
    : null;

  // חריגה מתקרת-ערוץ חודשית — נגזרת ישירות מהחלטת המנוע (payableCheck), כך שתמיד עקבית איתו.
  // המנוע מחזיר reason עם המילה "חודשית" / "רב-משתתפים" כשהקשר נדחה בגלל תקרת ערוץ.
  const monthlyCapExceeded = isAchdut && payableCheck && !payableCheck.payable &&
    /חודשית|רב-משתתפים/.test(payableCheck.reason || '');

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function handleTypeChange(t) {
    set('type', t);
    // אירוח שבת — אין איכות קשר (תעריף קבוע); מנקים בחירה קודמת
    if (t === 'אירוח שבת') set('quality', '');
    // "רב משתתפים" רלוונטי רק לפרונטלי — מנקים אם עברו לסוג אחר
    else if (t !== 'פרונטלי' && form.quality === CONFIG.interactionQualityMulti) set('quality', '');
  }

  // מפגש רב משתתפים — קומפוננטה נפרדת. מאחורי הקלעים זהו קשר פרונטלי באיכות "רב משתתפים"
  // (מלגה קבועה 300 ₪ עם תקרה חודשית — ראה lib/paymentCalc.js), כדי לשמר את מנוע התשלום.
  function toggleMulti(on) {
    setForm(prev => ({
      ...prev,
      multi:   on,
      type:    on ? 'פרונטלי' : '',
      quality: on ? CONFIG.interactionQualityMulti : '',
    }));
    setErrors({});
  }

  function handleVoiceTranscript(text) {
    const updated = form.description ? form.description + '\n' + text : text;
    set('description', updated);
  }

  function validate() {
    const e = {};
    if (form.multi) {
      if (!form.participant_count || Number(form.participant_count) < 2) e.participant_count = 'נא לציין מספר משתתפים (2 ומעלה)';
    } else {
      if (!form.type)                            e.type         = 'נא לבחור סוג קשר';
      if (!form.quality && !isShabbat)           e.quality      = 'נא לבחור איכות קשר';
    }
    if (!form.description?.trim())               e.description  = 'תיאור המפגש הוא שדה חובה';
    if (!form.date)                              e.date         = 'נא לבחור תאריך';
    if (form.date > TODAY)                       e.date         = 'תאריך לא יכול להיות בעתיד';
    if (isAchdut && !form.long_enough)           e.long_enough  = 'נא לציין משך הקשר';
    if (!form.next_action?.trim())               e.next_action  = 'נא לתאר את הפעולה הבאה';
    if (!form.next_action_date)                  e.next_action_date = 'נא לבחור תאריך יעד';
    return e;
  }

  function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    // צבירת הודעות התראה — כדי שחריגת-תקרה ובונוס באותו דיווח לא ידרסו זה את זה.
    const messages = [];

    // חריגה מתקרת הערוץ החודשית (נגזר מהמנוע)
    if (monthlyCapExceeded) {
      if (paymentConfig.CAP_EXCEED_BLOCKS) {
        setToast({ kind: 'block', text: `שים לב: עברת את גג המפגשים המאושר לחודש זה עבור סוג פעילות זה. הדיווח נחסם.` });
        return; // חסימה — לפי דגל הקונפיג
      }
      messages.push({ kind: 'warn', text: `שים לב: עברת את גג המפגשים המאושר לחודש זה עבור סוג פעילות זה. הקשר יישמר אך לא יזכה בתשלום.` });
    }

    // מפגש רב משתתפים — משמרים את מספר המשתתפים בתוך ההערות (אין עמודה ייעודית ב-interactions).
    const notesFinal = form.multi
      ? `👥 מפגש רב משתתפים · ${form.participant_count} משתתפים${form.notes.trim() ? `\n${form.notes.trim()}` : ''}`
      : form.notes.trim();

    const interactionPayload = {
      id:               Date.now(),
      contact_id:       contactId,
      activist_id:      currentUser.id,
      type:             form.type,
      quality:          form.quality,
      duration_minutes: duration,
      outcome:          form.outcome,
      date:             form.date,
      time:             new Date().toTimeString().slice(0, 5),
      notes:            notesFinal,
      description:      form.description.trim(),
      ai_summary:       form.ai_summary.trim(),
      next_action:      form.next_action.trim(),
      next_action_date: form.next_action_date,
    };

    addInteraction(interactionPayload);

    // סיכום AI אוטומטי — מיועד לרכז בלבד (הפעיל לא רואה אותו). fire-and-forget:
    // לא חוסם את השמירה, וכשל AI מאבד רק את הסיכום — הקשר כבר נשמר.
    summarizeInteractionText(interactionPayload.description, {
      contactName: contact.name, type: form.type, quality: form.quality,
    }).then(summary => {
      if (!summary) return;
      updateInteraction(interactionPayload.id, { ai_summary: summary });
      createInteractionSummaryNotifications({ activistName: currentUser?.name, contact, summary });
    }).catch(() => {});

    if (isAchdut && payableCheck) {
      createPaymentInteractionNotifications({
        interaction: interactionPayload,
        contact,
        activist: currentUser,
        paymentResult: payableCheck,
      });
    }

    // התראת בונוס עומק-לקוח — 4 / 6 מפגשי לימוד מצטברים מול אותו לקוח (תואם למנוע התשלום).
    if (isAchdut) {
      const isLearning = form.quality === 'תורני' && (form.type === 'פרונטלי' || form.type === 'וידאו') && duration >= MIN_DUR;
      if (isLearning) {
        const priorLearning = previousContactMonthly.filter(i =>
          i.quality === 'תורני' && (i.type === 'פרונטלי' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= MIN_DUR).length;
        const count = priorLearning + 1;
        let msg = null, amount = 0;
        if (count === 6)      { msg = `מצוין! הגעת ל-6 מפגשים עם ${contact.name}. הנך זכאי לבונוס משופר!`; amount = paymentConfig.LEARNING_BONUS[6]; }
        else if (count === 4) { msg = `כל הכבוד! הגעת ל-4 מפגשים עם ${contact.name}. הנך זכאי לבונוס!`;      amount = paymentConfig.LEARNING_BONUS[4]; }
        if (msg) {
          messages.push({ kind: 'bonus', text: msg });
          // מפתח-חודש ב-id כדי שכל אבן-דרך חודשית תישמר כהתראה נפרדת (לא תידרס בין חודשים).
          createDemoNotification({
            id: `loyalty-bonus-${count}-${contactId}-${currentUser.id}-${currentMonthKey}`,
            type: 'paid_interaction',
            title: count === 6 ? '🏆 בונוס משופר!' : '🎁 בונוס!',
            body: `${msg} (${amount.toLocaleString()} ₪)`,
            user_id: currentUser.id,
            project_id: 1,
            priority: 'high',
            link: '/my-dashboard',
          });
        }
      }
    }

    // הצגת התראה משולבת (בונוס גובר ויזואלית; חריגת-תקרה מצורפת אם קיימת).
    if (messages.length > 0) {
      const bonusMsg = messages.find(m => m.kind === 'bonus');
      const warnMsg  = messages.find(m => m.kind === 'warn');
      if (bonusMsg && warnMsg) setToast({ kind: 'bonus', text: `${bonusMsg.text}\n${warnMsg.text}` });
      else setToast(messages[0]);
    }

    setSuccess(true);
  }

  const card = {
    background: '#fffaf5', borderRadius: 14, padding: '16px 18px', marginBottom: 12,
    border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  };

  const TOAST_STYLES = {
    bonus: { bg: '#fffaf0', border: '#f0d98a', color: '#b06b00' },
    warn:  { bg: '#fff8ec', border: '#f3c77a', color: '#d68910' },
    block: { bg: '#fff0f0', border: '#e0a0a0', color: '#c0392b' },
  };
  const toastEl = toast ? (
    <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
                  background: (TOAST_STYLES[toast.kind] || TOAST_STYLES.warn).bg,
                  border: `1px solid ${(TOAST_STYLES[toast.kind] || TOAST_STYLES.warn).border}`,
                  color: (TOAST_STYLES[toast.kind] || TOAST_STYLES.warn).color,
                  borderRadius: 14, padding: '12px 18px', maxWidth: 440, width: 'calc(100% - 32px)',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.15)', display: 'flex', gap: 12, alignItems: 'center',
                  fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
      <span style={{ flex: 1, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{toast.text}</span>
      <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'inherit', lineHeight: 1 }}>✕</button>
    </div>
  ) : null;

  if (success) return (
    <DesktopLayout title="קשר נוסף בהצלחה">
      {toastEl}
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <h2 style={{ marginBottom: 8 }}>הקשר תועד!</h2>
        {isAchdut && payableCheck && (
          <div style={{ fontSize: 14, color: payableCheck.payable ? '#27ae60' : '#888', marginBottom: 8, fontWeight: 700 }}>
            {payableCheck.payable
              ? `✓ קשר מזכה בתשלום — ${payableCheck.amount} ₪`
              : `✗ ${payableCheck.reason || 'קשר זה אינו מזכה בתשלום'}`}
          </div>
        )}
        <p style={{ fontSize: 14, color: '#aaa', marginBottom: 28 }}>הקשר עם {contact.name} נשמר.</p>
        <Link href={`/contact/${contactId}`} className="btn btn-primary" style={{ textDecoration: 'none', padding: '10px 24px' }}>
          חזרה לפרופיל הלקוח
        </Link>
      </div>
    </DesktopLayout>
  );

  return (
    <DesktopLayout title={`קשר חדש — ${contact.name}`} backHref={`/contact/${contactId}`} backLabel="← חזרה">
      {toastEl}
      <div style={{ maxWidth: 560 }}>

        {/* אופי הדיווח — קשר עם לקוח בודד או מפגש רב משתתפים (קומפוננטה נפרדת) */}
        <div style={card}>
          <label className="form-label">אופי הדיווח</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            {[{ v: false, l: '👤 קשר עם לקוח' }, { v: true, l: '👥 מפגש רב משתתפים' }].map(({ v, l }) => (
              <button key={String(v)} type="button" onClick={() => toggleMulti(v)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 12, cursor: 'pointer',
                  border: `1.5px solid ${form.multi === v ? '#6c5ce7' : '#e8e8e8'}`,
                  background: form.multi === v ? '#f0effe' : '#fafafa',
                  color: form.multi === v ? '#6c5ce7' : '#555',
                  fontWeight: form.multi === v ? 700 : 400,
                  fontFamily: 'Rubik,sans-serif', fontSize: 13, transition: 'all 0.18s',
                }}>
                {l}
              </button>
            ))}
          </div>
          {form.multi && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, color: '#6c5ce7', fontWeight: 700, marginBottom: 10 }}>
                פרונטלי · רב משתתפים · מלגה קבועה 300 ₪ (תקרה חודשית)
              </div>
              <label className="form-label">מספר משתתפים <span style={{ color: '#e24b4a' }}>*</span></label>
              <input type="number" min="2" className={`form-input ${errors.participant_count ? 'form-error' : ''}`}
                placeholder="כמה משתתפים היו במפגש?" value={form.participant_count}
                onChange={e => set('participant_count', e.target.value)} />
              {errors.participant_count && <span className="error-msg">{errors.participant_count}</span>}
            </div>
          )}
        </div>

        {/* סוג קשר — לקשר עם לקוח בודד בלבד */}
        {!form.multi && (
        <div style={card}>
          <label className="form-label">סוג קשר <span style={{ color: '#e24b4a' }}>*</span></label>
          <div className="chip-group">
            {CONFIG.interactionTypes.map(t => (
              <button key={t} type="button"
                className={`chip ${form.type === t ? 'chip-active' : ''}`}
                onClick={() => handleTypeChange(t)}>
                {t}
              </button>
            ))}
          </div>
          {errors.type && <span className="error-msg">{errors.type}</span>}
        </div>
        )}

        {/* איכות קשר — לא רלוונטי לאירוח שבת (תעריף קבוע) ולא למפגש רב משתתפים */}
        {!form.multi && !isShabbat && (
        <div style={card}>
          <label className="form-label">איכות הקשר <span style={{ color: '#e24b4a' }}>*</span></label>
          <div className="chip-group">
            {qualityOptions.map(q => (
              <button key={q} type="button"
                className={`chip ${form.quality === q ? 'chip-active' : ''}`}
                onClick={() => set('quality', q)}>
                {QUALITY_LABELS[q] ?? q}
              </button>
            ))}
          </div>
          {errors.quality && <span className="error-msg">{errors.quality}</span>}
        </div>
        )}

        {/* משך זמן — אחדות יהודית בלבד */}
        {isAchdut && (
          <div style={card}>
            <label className="form-label">משך זמן הקשר <span style={{ color: '#e24b4a' }}>*</span></label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ v: 'yes', l: `מעל ${MIN_DUR} דקות ✓` }, { v: 'no', l: `פחות מ-${MIN_DUR} דקות` }].map(({ v, l }) => (
                <button key={v} type="button" onClick={() => set('long_enough', v)}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 12, cursor: 'pointer',
                    border: `1.5px solid ${form.long_enough === v ? '#6c5ce7' : '#e8e8e8'}`,
                    background: form.long_enough === v ? '#f0effe' : '#fafafa',
                    color: form.long_enough === v ? '#6c5ce7' : '#555',
                    fontWeight: form.long_enough === v ? 700 : 400,
                    fontFamily: 'Rubik,sans-serif', fontSize: 13, transition: 'all 0.18s',
                  }}>
                  {l}
                </button>
              ))}
            </div>
            {errors.long_enough && <span className="error-msg">{errors.long_enough}</span>}
            {payableCheck && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: payableCheck.payable ? '#edfaf1' : '#f5f5f5', color: payableCheck.payable ? '#27ae60' : '#888' }}>
                {payableCheck.payable
                  ? `✓ קשר מזכה בתשלום — ${payableCheck.amount} ₪`
                  : `✗ ${payableCheck.reason || 'לא מזכה בתשלום'}`}
              </div>
            )}
          </div>
        )}

        {/* תאריך */}
        <div style={card}>
          <label className="form-label">תאריך <span style={{ color: '#e24b4a' }}>*</span></label>
          <input type="date" className={`form-input ${errors.date ? 'form-error' : ''}`}
            value={form.date} max={TODAY} onChange={e => set('date', e.target.value)} />
          {errors.date && <span className="error-msg">{errors.date}</span>}
        </div>

        {/* תיאור המפגש */}
        <div style={card}>
          <label className="form-label">תיאור המפגש <span style={{ color: '#e24b4a' }}>*</span></label>
          <textarea className={`form-textarea ${errors.description ? 'form-error' : ''}`} rows={4}
            placeholder="תאר את המפגש בפירוט — מי הלקוח, מה דובר, מה הפוטנציאל..."
            value={form.description} onChange={e => set('description', e.target.value)} />
          {errors.description && <span className="error-msg">{errors.description}</span>}
          <VoiceInput onTranscript={handleVoiceTranscript} />
        </div>

        {/* פעולה הבאה — חובה תמיד */}
        <div style={card}>
          <label className="form-label">פעולה הבאה <span style={{ color: '#e24b4a' }}>*</span></label>
          <input type="text" className={`form-input ${errors.next_action ? 'form-error' : ''}`}
            placeholder="למשל: לתאם פגישה..."
            value={form.next_action} onChange={e => set('next_action', e.target.value)}
            style={{ marginBottom: 10 }} />
          {errors.next_action && <span className="error-msg">{errors.next_action}</span>}
          <label className="form-label">תאריך יעד <span style={{ color: '#e24b4a' }}>*</span></label>
          <input type="date" className={`form-input ${errors.next_action_date ? 'form-error' : ''}`}
            value={form.next_action_date} min={TODAY}
            onChange={e => set('next_action_date', e.target.value)} />
          {errors.next_action_date && <span className="error-msg">{errors.next_action_date}</span>}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setForm(EMPTY)}>נקה</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit}>שמור קשר</button>
        </div>

      </div>
    </DesktopLayout>
  );
}
