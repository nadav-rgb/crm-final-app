// pages/contact/add-interaction/[id].jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import CONFIG from '../../../data/config';
import { useCrm } from '../../../lib/CrmStore';
import { useAuth } from '../../../lib/AuthStore';
import { calcInteractionPayment } from '../../../lib/paymentCalc';
import DesktopLayout from '../../../components/DesktopLayout';
import { summarizeInteractionText } from '../../../lib/aiService';
import { createPaymentInteractionNotifications } from '../../../lib/notificationDemo';
import VoiceInput from '../../../components/VoiceInput';
import users from '../../../data/users';

const TODAY = new Date().toISOString().split('T')[0];

const EMPTY = {
  type: '', quality: '', outcome: 'חיובי', date: TODAY,
  long_enough: null,
  notes: '', description: '', ai_summary: '',
  next_action: '', next_action_date: '',
};

export default function AddInteractionPage() {
  const router    = useRouter();
  const { id }    = router.query;
  const contactId = Number(id);
  const { contacts, interactions, addInteraction } = useCrm();
  const { currentUser, activeProject } = useAuth();
  const contact = contacts.find(c => c.id === contactId);

  const [form,      setForm]      = useState(EMPTY);
  const [errors,    setErrors]    = useState({});
  const [success,   setSuccess]   = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

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

  // אחדות יהודית = project_id 1 ב-Supabase (תיקון מקומי בלבד)
  const isAchdut = activeProject?.id === 1 || contact.project_id === 1;

  // Live payment calculation
  const duration = form.long_enough === 'yes' ? 16 : form.long_enough === 'no' ? 5 : 0;
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
  const payableCheck = (isAchdut && form.type && form.quality && form.long_enough)
    ? calcInteractionPayment(
        { type: form.type, quality: form.quality, duration_minutes: duration },
        previousContactMonthly,
        contact.high_potential,
        previousActivistMonthly
      )
    : null;

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  // Reset quality when switching to וידאו + ידידותי was selected
  function handleTypeChange(t) {
    setForm(prev => ({
      ...prev,
      type: t,
      quality: t === 'וידאו' && prev.quality === 'ידידותי' ? '' : prev.quality,
    }));
    setErrors(prev => ({ ...prev, type: undefined, quality: undefined }));
  }

  function handleVoiceTranscript(text) {
    const updated = form.description ? form.description + '\n' + text : text;
    set('description', updated);
  }

  async function handleAiSummary() {
    if (!form.description) {
      setErrors(prev => ({ ...prev, description: 'כדי להפעיל סיכום AI צריך קודם לכתוב תיאור מפגש' }));
      return;
    }
    setAiLoading(true);
    try {
      const summary = await summarizeInteractionText(form.description, {
        contactName: contact.name, type: form.type, quality: form.quality,
      });
      set('ai_summary', summary);
    } catch (e) {
      setErrors(prev => ({ ...prev, description: `שגיאה: ${e.message}` }));
    } finally {
      setAiLoading(false);
    }
  }

  function validate() {
    const e = {};
    if (!form.type)                              e.type         = 'נא לבחור סוג קשר';
    if (!form.quality)                           e.quality      = 'נא לבחור איכות קשר';
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

    const interactionPayload = {
      id:               Date.now(),
      contact_id:       contactId,
      activist_id:      currentUser.id,
      type:             form.type,
      quality:          form.quality,
      duration_minutes: form.long_enough === 'yes' ? 16 : 5,
      outcome:          form.outcome,
      date:             form.date,
      time:             new Date().toTimeString().slice(0, 5),
      notes:            form.notes.trim(),
      description:      form.description.trim(),
      ai_summary:       form.ai_summary.trim(),
      next_action:      form.next_action.trim(),
      next_action_date: form.next_action_date,
    };

    addInteraction(interactionPayload);

    if (isAchdut && payableCheck) {
      const activist = users.find(u => Number(u.id) === Number(currentUser.id)) || currentUser;
      createPaymentInteractionNotifications({
        interaction: interactionPayload,
        contact,
        activist,
        paymentResult: payableCheck,
      });
    }

    setSuccess(true);
  }

  const card = {
    background: '#fffaf5', borderRadius: 14, padding: '16px 18px', marginBottom: 12,
    border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  };

  if (success) return (
    <DesktopLayout title="קשר נוסף בהצלחה">
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <h2 style={{ marginBottom: 8 }}>הקשר תועד!</h2>
        {isAchdut && payableCheck && (
          <div style={{ fontSize: 14, color: payableCheck.payable ? '#27ae60' : '#888', marginBottom: 8, fontWeight: 700 }}>
            {payableCheck.payable
              ? `✓ קשר מזכה בתשלום — ${payableCheck.amount} ₪`
              : '✗ קשר זה אינו מזכה בתשלום'}
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
      <div style={{ maxWidth: 560 }}>

        {/* סוג קשר */}
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

        {/* איכות קשר */}
        <div style={card}>
          <label className="form-label">איכות הקשר <span style={{ color: '#e24b4a' }}>*</span></label>
          <div className="chip-group">
            {CONFIG.interactionQuality.map(q => {
              const blocked = q === 'ידידותי' && form.type === 'וידאו';
              return (
                <button key={q} type="button"
                  disabled={blocked}
                  title={blocked ? 'וידאו ידידותי אינו זמין' : undefined}
                  className={`chip ${form.quality === q ? 'chip-active' : ''}`}
                  onClick={() => !blocked && set('quality', q)}
                  style={blocked ? { opacity: 0.35, cursor: 'not-allowed' } : {}}>
                  {q}
                </button>
              );
            })}
          </div>
          {form.type === 'וידאו' && (
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
              וידאו ידידותי אינו זמין — ניתן לבחור תורני בלבד
            </div>
          )}
          {errors.quality && <span className="error-msg">{errors.quality}</span>}
        </div>

        {/* משך זמן — אחדות יהודית בלבד */}
        {isAchdut && (
          <div style={card}>
            <label className="form-label">משך זמן הקשר <span style={{ color: '#e24b4a' }}>*</span></label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ v: 'yes', l: 'מעל 15 דקות ✓' }, { v: 'no', l: 'פחות מ-15 דקות' }].map(({ v, l }) => (
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
          <button type="button" onClick={handleAiSummary} disabled={aiLoading}
            style={{ marginTop: 10, border: 'none', borderRadius: 10, padding: '9px 12px', background: aiLoading ? '#e8e8f8' : '#f0effe', color: '#6c5ce7', fontWeight: 800, cursor: aiLoading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {aiLoading ? 'מסכם...' : 'סכם עם AI'}
          </button>
          {form.ai_summary && (
            <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', background: '#fff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '12px', fontFamily: 'inherit', fontSize: 13, color: '#333', lineHeight: 1.7 }}>
              {form.ai_summary}
            </pre>
          )}
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
