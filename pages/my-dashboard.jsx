// pages/my-dashboard.jsx — דשבורד יועץ: מונים חודשיים, התקדמות מול יעד, ושכר משוער.
import { useMemo } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { calcConsultantDashboard } from '../lib/paymentCalc';

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

// צבע מד התקדמות לפי אחוז מהיעד: ירוק < 70% < כתום < 100% ≤ אדום
function barColor(pct) {
  if (pct >= 100) return { bar: '#e74c3c', bg: '#fff0f0', text: '#c0392b' };
  if (pct >= 70)  return { bar: '#f39c12', bg: '#fff8ec', text: '#d68910' };
  return { bar: '#27ae60', bg: '#edfaf1', text: '#27ae60' };
}

function CounterCard({ counter }) {
  const { done, cap, label } = counter;
  const pct = cap > 0 ? Math.min(100, Math.round((done / cap) * 100)) : 0;
  const over = done > cap;
  const col = barColor(cap > 0 ? (done / cap) * 100 : 0);

  return (
    <div style={{ background: '#fff', borderRadius: 18, padding: '20px 22px', border: '0.5px solid rgba(0,0,0,0.07)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#2d1f5e' }}>{label}</span>
        {over && <span style={{ fontSize: 11, fontWeight: 800, color: '#c0392b', background: '#fff0f0', padding: '2px 8px', borderRadius: 999 }}>חריגה</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: col.text, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{done}</span>
        <span style={{ fontSize: 15, color: '#aaa' }}>/ {cap}</span>
      </div>
      <div style={{ height: 9, borderRadius: 999, background: '#f0f0f0', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: col.bar, borderRadius: 999, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
        ביצעת {done} מתוך יעד של {cap} החודש
      </div>
    </div>
  );
}

export default function MyDashboardPage() {
  const { interactions, contacts, mitzvotBonuses, newParticipantBonuses, paymentConfig, expenses } = useCrm();
  const { currentUser } = useAuth();

  const now = new Date();
  const monthName = MONTH_NAMES[now.getMonth()];

  const data = useMemo(() => {
    if (!currentUser) return null;
    // סינון בונוסים ליועץ הנוכחי ולחודש הנוכחי — זהה לעמוד התשלומים של הרכז (כדי שהמספרים יתאימו).
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const myMitzvot = mitzvotBonuses.filter(b => b.activist_id === currentUser.id && b.month === monthKey);
    const myNew     = newParticipantBonuses.filter(b => b.activist_id === currentUser.id && b.month === monthKey);
    return calcConsultantDashboard(currentUser.id, interactions, contacts, myMitzvot, myNew, paymentConfig);
  }, [currentUser, interactions, contacts, mitzvotBonuses, newParticipantBonuses, paymentConfig]);

  if (!data) return <DesktopLayout title="הדשבורד שלי"><div style={{ padding: 40, color: '#aaa' }}>טוען…</div></DesktopLayout>;

  const { counters, total, salaryByType, bonuses, unpaid } = data;

  // החזר הוצאות החודש — מדיווחי הפעיל בעמוד "דיווח הוצאות"
  const monthStartIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const myExpenses = expenses
    .filter(x => Number(x.activist_id) === Number(currentUser?.id) && x.date >= monthStartIso)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const grandTotal = total + myExpenses;

  return (
    <DesktopLayout title="הדשבורד שלי" subtitle={`סיכום חודשי · ${monthName} ${now.getFullYear()}`}>

      {/* מונים */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
        <CounterCard counter={counters.frontal} />
        <CounterCard counter={counters.phoneTorani} />
        <CounterCard counter={counters.multi} />
      </div>

      {/* ווידג'ט שכר */}
      <div style={{ background: 'linear-gradient(135deg,#2a1870,#3a249b)', borderRadius: 20, padding: '24px 26px', color: '#fff', marginBottom: 24 }}>
        <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 4 }}>סה"כ לתשלום החודש (משוער{myExpenses > 0 ? ', כולל החזר הוצאות' : ''})</div>
        <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 18 }}>{grandTotal.toLocaleString()} ₪</div>

        <div style={{ background: 'rgba(255,255,255,0.10)', borderRadius: 14, padding: '14px 16px' }}>
          {salaryByType.length === 0 && bonuses.length === 0 && myExpenses === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.8 }}>טרם נצברו קשרים מזכים החודש.</div>
          ) : (
            <>
              {salaryByType.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', borderBottom: '0.5px solid rgba(255,255,255,0.12)' }}>
                  <span>{s.count} × {s.label}</span>
                  <span style={{ fontWeight: 700 }}>{s.subtotal.toLocaleString()} ₪</span>
                </div>
              ))}
              {bonuses.map((b, i) => (
                <div key={`b${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', borderBottom: '0.5px solid rgba(255,255,255,0.12)', color: '#ffe08a' }}>
                  <span>🎁 {b.desc}</span>
                  <span style={{ fontWeight: 700 }}>{b.amount.toLocaleString()} ₪</span>
                </div>
              ))}
              {myExpenses > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', color: '#a8e6c1' }}>
                  <span>🧾 החזר הוצאות</span>
                  <span style={{ fontWeight: 700 }}>{myExpenses.toLocaleString()} ₪</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* בונוסים שנפתחו */}
      {bonuses.length > 0 && (
        <div style={{ background: '#fffaf0', border: '0.5px solid #f0d98a', borderRadius: 16, padding: '16px 18px', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#b06b00', marginBottom: 8 }}>🏆 בונוסים שזכית בהם החודש</div>
          {bonuses.map((b, i) => (
            <div key={i} style={{ fontSize: 13, color: '#7a5a10', padding: '3px 0' }}>• {b.desc} — {b.amount.toLocaleString()} ₪</div>
          ))}
        </div>
      )}

      {/* קשרים שלא זוכו — שקיפות */}
      {unpaid?.length > 0 && (
        <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.07)', borderRadius: 16, padding: '16px 18px' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#c0392b', marginBottom: 8 }}>קשרים שלא זוכו בתשלום ({unpaid.length})</div>
          {unpaid.map((u, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '6px 0', borderBottom: '0.5px solid #f0f0f0' }}>
              <span><b>{u.contactName || 'לקוח'}</b> <span style={{ color: '#aaa' }}>— {u.desc} ({u.date})</span></span>
              <span style={{ color: '#c0392b', whiteSpace: 'nowrap' }}>{u.reason}</span>
            </div>
          ))}
        </div>
      )}
    </DesktopLayout>
  );
}
