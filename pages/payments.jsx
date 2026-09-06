// pages/payments.jsx — עמוד תשלומים (רכז/הנהלה; פרויקטים בתשלום: אחדות יהודית + נעים להכיר)
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { calcMonthlyPayment, resolvePeriod } from '../lib/paymentCalc';
import { exportPayrollXlsx } from '../lib/payrollExcel';
import { deriveActivityByType, exportCombinedActivityXlsx } from '../lib/activityByTypeExcel';
import { inProject, inAnyPaidProject } from '../lib/projectUtils';
import { getSupabaseClient } from '../lib/supabaseClient';
// activists מגיע מ-CrmStore (Supabase) — לא מקובץ סטטי, כך ה-IDs תואמים ל-activist_id בקשרים

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const PROJECT_LABELS = { 1: 'אחדות יהודית', 2: 'נעים להכיר' };

// 18 החודשים האחרונים (כולל הנוכחי) לבחירה בסלקטור. הדוח החודשי מופק אחרי סוף החודש,
// ולכן חייבת להיות גישה לחודשים קודמים ולא רק ל"עכשיו".
function buildMonthOptions(count = 18) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth(), label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` };
  });
}

export default function PaymentsPage() {
  const { contacts, interactions, mitzvotBonuses, newParticipantBonuses, toraniBonuses, activists, paymentConfig, expenses, tours } = useCrm();
  const { currentUser, can, filterProject } = useAuth();
  const router = useRouter();
  const [viewMode, setViewMode] = useState('grid');
  const [exporting, setExporting] = useState(false); // exceljs נטענת ב-import דינמי — הכפתור ננעל בזמן הטעינה
  const [exportingActivity, setExportingActivity] = useState(false); // אותו נעילה, לכפתור ייצוא הפעילות המרוכז
  const [cancelledBonuses, setCancelledBonuses] = useState([]); // שורות bonus_cancellations החודש — נחוץ לחישוב מדויק של הסכומים ברשימה

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  // חודש הדיווח הנבחר. ברירת מחדל: החודש הנוכחי; ניתן לבחור חודש קודם (ראה buildMonthOptions).
  const [period, setPeriod] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  // שחזור החודש הנבחר בחזרה מדף הפירוט (/payments/[id]?y=&m=). router.query ריק ברינדור הראשון.
  useEffect(() => {
    if (!router.isReady) return;
    const y = Number(router.query.y), m = Number(router.query.m);
    if (Number.isInteger(y) && Number.isInteger(m) && m >= 0 && m <= 11) setPeriod({ year: y, month: m });
  }, [router.isReady, router.query.y, router.query.m]);

  // רשאים לצפות: כל מי ש-AuthStore מאשר (רכז, מנכ"ל, כספים, ראש פרויקט)
  const canView = can.seePayments;

  const loadCancelledBonuses = useCallback(async () => {
    if (!canView) return;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('bonus_cancellations').select('*');
    if (error) { console.error('Failed to load bonus cancellations', error); return; }
    setCancelledBonuses(Array.isArray(data) ? data : []);
  }, [canView]);

  useEffect(() => { loadCancelledBonuses(); }, [loadCancelledBonuses]);

  const cancelledBonusKeys = useMemo(() => new Set(cancelledBonuses.map(b => b.bonus_key)), [cancelledBonuses]);

  const { year, month, monthKey, startIso, endIso } = resolvePeriod(period);

  // לחיצה על כרטיס פעיל → דף פירוט תשלום ייעודי (pages/payments/[id].jsx), באותו חודש נבחר
  const openActivist = (activistId) => router.push(`/payments/${activistId}?y=${year}&m=${month}`);

  // פעילים בפרויקטים בתשלום (אחדות/נעים להכיר), מסוננים לפי הפרויקט הנבחר בסרגל.
  // פעיל דו-פרויקטלי מופיע פעם אחת — הסכום שלו מאוחד משני הפרויקטים (תקרות משותפות).
  const achdutActivists = useMemo(() => activists.filter(a =>
    a.role === 'activist' && inAnyPaidProject(a) &&
    (filterProject === null || inProject(a, filterProject))
  ), [activists, filterProject]);

  // חישוב תשלומים לכל פעיל (+ החזר הוצאות בחודש הנבחר — מדווח בעמוד "דיווח הוצאות").
  // הוצאות וסיורים מסוננים בטווח [startIso, endIso) — חסם עליון חובה, אחרת דוח של חודש
  // קודם היה סופח אליו גם הוצאות של החודשים שאחריו.
  const paymentData = useMemo(() => achdutActivists.map(activist => {
    const myMitzvotBonuses = mitzvotBonuses.filter(b => b.activist_id === activist.id && b.month === monthKey);
    const myNewBonuses     = newParticipantBonuses.filter(b => b.activist_id === activist.id && b.month === monthKey);
    const myToraniBonuses  = toraniBonuses.filter(b => b.activist_id === activist.id && b.month === monthKey);
    const result = calcMonthlyPayment(activist.id, interactions, contacts, myMitzvotBonuses, myNewBonuses, paymentConfig, cancelledBonusKeys, { year, month }, myToraniBonuses);
    const expensesTotal = expenses
      .filter(x => Number(x.activist_id) === Number(activist.id) && x.date >= startIso && x.date < endIso)
      .reduce((s, x) => s + Number(x.amount || 0), 0);
    // שכר הדרכת סיורים — 750₪ (config) לכל סיור שהתקיים בחודש הנבחר כשהפעיל הוא המדריך
    const guidedCount = tours.filter(t =>
      t.status === 'completed' &&
      Number(t.guide_activist_id) === Number(activist.id) &&
      t.date >= startIso && t.date < endIso
    ).length;
    const guidePay = guidedCount * (paymentConfig.TOUR_GUIDE_RATE ?? 750);
    return { activist, ...result, expensesTotal, guidePay, guidedCount, grandTotal: result.total + expensesTotal + guidePay };
  }), [achdutActivists, interactions, contacts, mitzvotBonuses, newParticipantBonuses, toraniBonuses, paymentConfig, expenses, tours, cancelledBonusKeys, monthKey, startIso, endIso, year, month]);

  if (!canView) return (
    <DesktopLayout title="דוחות תשלום פעילים">
      <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
        <div>אין הרשאה לדף זה</div>
      </div>
    </DesktopLayout>
  );

  const totalAll = paymentData.reduce((s, d) => s + d.grandTotal, 0);
  const currentMonthName = MONTH_NAMES[month];
  const scopeLabel = filterProject === null ? 'כל הפרויקטים' : (PROJECT_LABELS[filterProject] ?? 'פרויקטים בתשלום');
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth();

  return (
    <DesktopLayout title="דוחות תשלום פעילים" subtitle={`${scopeLabel} · ${currentMonthName} ${year}`}>

      {/* בחירת חודש דיווח — הדוח מופק בדרך כלל אחרי סוף החודש, ולכן ברירת המחדל (החודש
          הנוכחי) לא מספיקה. בחירת חודש קודם מחשבת מחדש הכל: קשרים, בונוסים, הוצאות וסיורים. */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <label htmlFor="payment-month" style={{ fontSize:13, fontWeight:700, color:'#555' }}>חודש הדיווח:</label>
        <select
          id="payment-month"
          value={`${year}-${month}`}
          onChange={e => {
            const [y, m] = e.target.value.split('-').map(Number);
            setPeriod({ year: y, month: m });
          }}
          style={{ fontFamily:'Rubik,sans-serif', fontSize:13.5, fontWeight:600, padding:'8px 12px', borderRadius:10, border:'1.5px solid #e0dcf5', background:'#fff', color:'#3a249b', cursor:'pointer', appearance: 'none', WebkitAppearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%239a9aa5' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'left 10px center', paddingLeft: 30 }}
        >
          {monthOptions.map(o => (
            <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
          ))}
        </select>
        {!isCurrentMonth && (
          <span style={{ fontSize:12, color:'#7a6cc4', background:'#f0effe', borderRadius:8, padding:'5px 10px', fontWeight:600 }}>
            מציג חודש סגור
          </span>
        )}
      </div>

      {/* סיכום כולל */}
      <div style={{ background:'linear-gradient(135deg,#6c5ce7,#a29bfe)', borderRadius:16, padding:'20px 24px', marginBottom:20, color:'#fff', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:13, opacity:0.8, marginBottom:4 }}>סה"כ תשלומים {currentMonthName} {year}</div>
          <div style={{ fontSize:36, fontWeight:700 }}>{totalAll.toLocaleString()} ₪</div>
        </div>
        <div style={{ fontSize:13, opacity:0.7 }}>{achdutActivists.length} פעילים פעילים</div>
      </div>

      {/* כפתורי תצוגה */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#555' }}>פירוט לפי פעיל</div>
        <div style={{ display:'flex', border:'1.5px solid #e8e8e8', borderRadius:10, overflow:'hidden' }}>
          <button onClick={()=>setViewMode('grid')} style={{ padding:'7px 12px', border:'none', cursor:'pointer', fontSize:16, background:viewMode==='grid'?'#6c5ce7':'#fff', color:viewMode==='grid'?'#fff':'#aaa', transition:'all 0.18s' }}>⊞</button>
          <button onClick={()=>setViewMode('list')} style={{ padding:'7px 12px', border:'none', borderRight:'1.5px solid #e8e8e8', cursor:'pointer', fontSize:16, background:viewMode==='list'?'#6c5ce7':'#fff', color:viewMode==='list'?'#fff':'#aaa', transition:'all 0.18s' }}>☰</button>
        </div>
      </div>

      {/* תצוגת ריבועים */}
      {viewMode === 'grid' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:12, marginBottom:24 }}>
          {paymentData.map(({ activist, total, breakdown, unpaid, expensesTotal, guidePay, guidedCount, grandTotal }) => (
            <div key={activist.id} style={{ background:'#fffaf5', borderRadius:14, padding:'16px', border:'0.5px solid rgba(0,0,0,0.07)', boxShadow:'0 1px 4px rgba(0,0,0,0.04)', cursor:'pointer', transition:'all 0.18s' }}
              onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.09)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'; }}
              onClick={()=>openActivist(activist.id)}
            >
              <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{activist.name}</div>
              <div style={{ fontSize:12, color:'#aaa', marginBottom:12 }}>{breakdown.filter(b=>b.type==='קשר').length} קשרים מזכים</div>
              <div style={{ fontSize:28, fontWeight:700, color:'#6c5ce7' }}>{grandTotal.toLocaleString()} ₪</div>
              {guidePay > 0 && (
                <div style={{ fontSize:11.5, color:'#1b6ca8', marginTop:4, fontWeight:600 }}>🧭 כולל {guidedCount} × הדרכת סיור — {guidePay.toLocaleString()} ₪</div>
              )}
              {expensesTotal > 0 && (
                <div style={{ fontSize:11.5, color:'#1f7a45', marginTop:4, fontWeight:600 }}>🧾 כולל החזר הוצאות {expensesTotal.toLocaleString()} ₪</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* תצוגת רשימה */}
      {viewMode === 'list' && (
        <div style={{ background:'#fff', borderRadius:16, border:'0.5px solid rgba(0,0,0,0.07)', overflow:'hidden', marginBottom:24 }}>
          {paymentData.map(({ activist, total, breakdown, unpaid, expensesTotal, guidePay, guidedCount, grandTotal }, idx) => (
            <div key={activist.id}
              style={{ display:'flex', alignItems:'center', padding:'13px 18px', borderBottom:idx===paymentData.length-1?'none':'0.5px solid #f5f5f5', cursor:'pointer', transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='#fafafa'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}
              onClick={()=>openActivist(activist.id)}
            >
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>{activist.name}</div>
                <div style={{ fontSize:12, color:'#aaa' }}>{breakdown.length} קשרים מזכים{guidePay > 0 ? ` · 🧭 ${guidedCount} הדרכות` : ''}{expensesTotal > 0 ? ` · 🧾 הוצאות ${expensesTotal.toLocaleString()} ₪` : ''}</div>
              </div>
              <div style={{ fontSize:22, fontWeight:700, color:'#6c5ce7' }}>{grandTotal.toLocaleString()} ₪</div>
            </div>
          ))}
          {/* שורה תחתונה — סיכום */}
          <div style={{ display:'flex', alignItems:'center', padding:'13px 18px', background:'#f0effe', fontWeight:700 }}>
            <div style={{ flex:1, fontSize:14, color:'#6c5ce7' }}>סה"כ</div>
            <div style={{ fontSize:22, color:'#6c5ce7' }}>{totalAll.toLocaleString()} ₪</div>
          </div>
        </div>
      )}

      {/* כפתורי ייצוא — txt מפורט (פירוט לפי לקוח + קשרים שלא זוכו), xlsx רזה לחשבות,
          ו-xlsx פעילות-לפי-סוג מרוכז לכל הפעילים */}
      <div style={{ textAlign:'left', display:'flex', gap:10, justifyContent:'flex-start' }}>
        <button
          onClick={async () => {
            if (exporting) return;
            setExporting(true);
            try {
              await exportPayrollXlsx(paymentData, currentMonthName, year);
            } catch (err) {
              console.error('Excel export failed', err);
              alert('ייצוא האקסל נכשל. נסה שוב, ואם זה חוזר — צלם את המסך ודווח ב"תקלות והצעות".');
            } finally {
              setExporting(false);
            }
          }}
          disabled={exporting || paymentData.length === 0}
          style={{ background: exporting || paymentData.length === 0 ? '#b7b0e8' : 'linear-gradient(135deg,#1f7a45,#2ecc71)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:700, cursor: exporting || paymentData.length === 0 ? 'default' : 'pointer', fontFamily:'Rubik,sans-serif', boxShadow:'0 2px 8px rgba(31,122,69,0.25)' }}
        >
          {exporting ? '⏳ מייצא…' : `📊 ייצוא לאקסל ${currentMonthName} ${year}`}
        </button>
        <button
          onClick={() => {
            const lines = [`דוח פעילות לתשלום — ${currentMonthName} ${year}`, '='.repeat(40), ''];
            paymentData.forEach(({ activist, total, breakdown, unpaid, expensesTotal, guidePay, guidedCount, grandTotal }) => {
              lines.push(`${activist.name}: ${grandTotal.toLocaleString()} ₪`);
              breakdown.forEach(b => lines.push(`  • ${b.contactName} — ${b.desc}: ${b.amount} ₪`));
              if (guidePay > 0) lines.push(`  • הדרכת סיורים (${guidedCount}): ${guidePay.toLocaleString()} ₪`);
              if (expensesTotal > 0) lines.push(`  • החזר הוצאות: ${expensesTotal.toLocaleString()} ₪`);
              if (unpaid?.length) {
                lines.push(`  קשרים שלא זוכו:`);
                unpaid.forEach(u => lines.push(`    ✗ ${u.contactName} — ${u.desc} (${u.date}): ${u.reason}`));
              }
              lines.push('');
            });
            lines.push('='.repeat(40));
            lines.push(`סה"כ: ${totalAll.toLocaleString()} ₪`);
            const blob = new Blob([lines.join('\n')], { type:'text/plain;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = `דוח-תשלום-${currentMonthName}-${year}.txt`;
            a.click(); URL.revokeObjectURL(url);
          }}
          style={{ background:'linear-gradient(135deg,#6c5ce7,#a29bfe)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'Rubik,sans-serif', boxShadow:'0 2px 8px rgba(108,92,231,0.25)' }}
        >
          📄 דוח פעילות לתשלום {currentMonthName} {year}
        </button>
        <button
          onClick={async () => {
            if (exportingActivity) return;
            setExportingActivity(true);
            try {
              const activistsData = paymentData.map(({ activist, breakdown, unpaid, expensesTotal, guidePay }) => ({
                activistName: activist.name,
                data: deriveActivityByType({ breakdown, unpaid }, expensesTotal, guidePay, paymentConfig),
              }));
              await exportCombinedActivityXlsx(activistsData, currentMonthName, year);
            } catch (err) {
              console.error('Combined activity export failed', err);
              alert('ייצוא הפעילות המרוכז נכשל. נסה שוב.');
            } finally {
              setExportingActivity(false);
            }
          }}
          disabled={exportingActivity || paymentData.length === 0}
          style={{ background: exportingActivity || paymentData.length === 0 ? '#b7b0e8' : 'linear-gradient(135deg,#1f7a45,#2ecc71)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:700, cursor: exportingActivity || paymentData.length === 0 ? 'default' : 'pointer', fontFamily:'Rubik,sans-serif', boxShadow:'0 2px 8px rgba(31,122,69,0.25)' }}
        >
          {exportingActivity ? '⏳ מייצא…' : `📋 ייצוא פעילות לכל הפעילים`}
        </button>
      </div>

    </DesktopLayout>
  );
}
