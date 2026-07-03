// pages/expenses.jsx — דיווחי הוצאות. פעיל מדווח (בלי קבלות) ורואה את שלו;
// רכז/מנכ"ל/כספים (can.seePayments) רואים את כולם לחודש הנוכחי.
import { useEffect, useMemo, useState } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { useCrm } from '../lib/CrmStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import { formatDateHe } from '../lib/formatDate';

const TODAY = new Date().toISOString().split('T')[0];
const MONTH_START = TODAY.slice(0, 8) + '01';
const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const EMPTY = { date: TODAY, amount: '', description: '' };

export default function ExpensesPage() {
  const { currentUser, can } = useAuth();
  const { activists } = useCrm();
  const [expenses, setExpenses] = useState([]);
  const [form,     setForm]     = useState(EMPTY);
  const [errors,   setErrors]   = useState({});
  const [busy,     setBusy]     = useState(false);
  const [loadErr,  setLoadErr]  = useState('');

  const isActivist = currentUser?.role === 'activist';
  const seesAll    = can.seePayments;

  async function load() {
    const supabase = getSupabaseClient();
    let q = supabase.from('expenses').select('*').gte('date', MONTH_START).order('date', { ascending: false });
    if (!seesAll) q = q.eq('activist_id', currentUser.id);
    const { data, error } = await q;
    if (error) { setLoadErr(error.message); return; }
    setLoadErr('');
    setExpenses(data || []);
  }

  useEffect(() => { if (currentUser) load(); }, [currentUser?.id]);

  async function handleSubmit() {
    const e = {};
    const amountNum = Number(form.amount);
    if (!form.date)                                  e.date        = 'נא לבחור תאריך';
    if (form.date > TODAY)                           e.date        = 'תאריך לא יכול להיות בעתיד';
    if (!form.amount || !(amountNum > 0))            e.amount      = 'נא להזין סכום תקין';
    if (!form.description.trim())                    e.description = 'נא לתאר את ההוצאה';
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    setBusy(true);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('expenses').insert({
      activist_id: currentUser.id,
      project_id:  currentUser.project_id ?? null,
      date:        form.date,
      amount:      amountNum,
      description: form.description.trim(),
    });
    setBusy(false);
    if (error) { setErrors({ description: `שגיאה בשמירה: ${error.message}` }); return; }
    setForm(EMPTY);
    setErrors({});
    load();
  }

  async function handleDelete(id) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (!error) setExpenses(prev => prev.filter(x => x.id !== id));
  }

  const total = useMemo(() => expenses.reduce((s, x) => s + Number(x.amount || 0), 0), [expenses]);
  const activistName = id => activists.find(a => a.id === id)?.name ?? `פעיל ${id}`;
  const monthName = MONTH_NAMES[new Date().getMonth()];

  const card = { background: '#fffaf5', borderRadius: 14, padding: '16px 18px', marginBottom: 12, border: '0.5px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' };

  return (
    <DesktopLayout title="דיווח הוצאות" subtitle={`${monthName} · ${seesAll ? 'כל הפעילים' : 'ההוצאות שלי'}`}>
      <div style={{ maxWidth: 620 }}>

        {/* סיכום חודשי */}
        <div style={{ background: 'linear-gradient(135deg,#6c5ce7,#a29bfe)', borderRadius: 16, padding: '18px 22px', marginBottom: 18, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>סה"כ הוצאות {monthName}</div>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{total.toLocaleString()} ₪</div>
          </div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>{expenses.length} דיווחים</div>
        </div>

        {loadErr && (
          <div style={{ background: '#fff0f0', border: '0.5px solid #e0a0a0', borderRadius: 12, padding: '12px 16px', color: '#c0392b', fontSize: 13, marginBottom: 14 }}>
            שגיאה בטעינת הוצאות: {loadErr}
          </div>
        )}

        {/* טופס דיווח — לפעיל */}
        {isActivist && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>דיווח הוצאה חדשה</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label className="form-label">תאריך <span style={{ color: '#e24b4a' }}>*</span></label>
                <input type="date" className={`form-input ${errors.date ? 'form-error' : ''}`} max={TODAY}
                  value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                {errors.date && <span className="error-msg">{errors.date}</span>}
              </div>
              <div>
                <label className="form-label">סכום (₪) <span style={{ color: '#e24b4a' }}>*</span></label>
                <input type="number" min="1" className={`form-input ${errors.amount ? 'form-error' : ''}`}
                  placeholder="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                {errors.amount && <span className="error-msg">{errors.amount}</span>}
              </div>
            </div>
            <label className="form-label">תיאור ההוצאה <span style={{ color: '#e24b4a' }}>*</span></label>
            <input className={`form-input ${errors.description ? 'form-error' : ''}`}
              placeholder="למשל: נסיעות, כיבוד לאירוח..."
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            {errors.description && <span className="error-msg" style={{ display: 'block' }}>{errors.description}</span>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={handleSubmit} disabled={busy}>
              {busy ? 'שומר…' : '+ דווח הוצאה'}
            </button>
          </div>
        )}

        {/* רשימת הוצאות */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
            הוצאות {monthName}
          </div>
          {expenses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#ccc', fontSize: 14 }}>אין דיווחי הוצאות החודש</div>
          ) : expenses.map(x => (
            <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '0.5px solid #f0f0f0' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{x.description}</div>
                <div style={{ fontSize: 12, color: '#aaa' }}>
                  {formatDateHe(x.date)}{seesAll ? ` · ${activistName(x.activist_id)}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#6c5ce7', whiteSpace: 'nowrap' }}>{Number(x.amount).toLocaleString()} ₪</div>
              {x.activist_id === currentUser?.id && (
                <button onClick={() => handleDelete(x.id)} title="מחק"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d98a8a', fontSize: 15, padding: 4 }}>🗑️</button>
              )}
            </div>
          ))}
        </div>

      </div>
    </DesktopLayout>
  );
}
