// pages/payments.jsx — דוח תשלומים מצרפי לכספים/ראש פרויקט/מנכ"ל.
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../components/DesktopLayout';
import { useAuth } from '../lib/AuthStore';
import { exportPayrollXlsx } from '../lib/payrollExcel';
import { deriveActivityByTypeFromPayment, exportCombinedActivityXlsx } from '../lib/activityByTypeExcel';

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
  const { can, filterProject, apiFetch } = useAuth();
  const router = useRouter();
  const [viewMode, setViewMode] = useState('grid');
  const [exporting, setExporting] = useState(false); // exceljs נטענת ב-import דינמי — הכפתור ננעל בזמן הטעינה
  const [exportingActivity, setExportingActivity] = useState(false);
  const [paymentRows, setPaymentRows] = useState([]);
  const [loadError, setLoadError] = useState('');

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

  // רשאים לצפות: כספים, ראש פרויקט עם AAL2 ומנכ"ל עם AAL2. השרת מאמת מחדש.
  const canView = can.seePayments;

  const { year, month } = period;
  const periodKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  // לחיצה על כרטיס פעיל → דף פירוט תשלום ייעודי (pages/payments/[id].jsx), באותו חודש נבחר
  const openActivist = (activistId) => {
    const query = new URLSearchParams({ y: String(year), m: String(month) });
    if (filterProject != null) query.set('projectId', String(filterProject));
    router.push(`/payments/${encodeURIComponent(activistId)}?${query}`);
  };

  useEffect(() => {
    if (!canView) return;
    let active = true;
    const query = new URLSearchParams({ period: periodKey });
    if (filterProject != null) query.set('projectId', String(filterProject));
    apiFetch(`/api/payments?${query}`, { method: 'GET' })
      .then((result) => { if (active) { setPaymentRows(result.payments || []); setLoadError(''); } })
      .catch(() => { if (active) { setPaymentRows([]); setLoadError('טעינת נתוני התשלום נכשלה.'); } });
    return () => { active = false; };
  }, [canView, filterProject, periodKey, apiFetch]);

  const paymentData = useMemo(() => paymentRows.map((row) => ({
    payment: row,
    activist: { id: row.userId, name: row.name },
    total: row.activityTotal + row.bonusTotal,
    breakdown: [
      row.activityTotal > 0 ? { type: 'קשר', amount: row.activityTotal } : null,
      row.bonusTotal > 0 ? { type: 'בונוס', amount: row.bonusTotal } : null,
    ].filter(Boolean),
    expensesTotal: row.expenseTotal, guidePay: row.tourTotal, grandTotal: row.grandTotal,
  })), [paymentRows]);

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
          style={{ fontFamily:'Rubik,sans-serif', fontSize:13.5, fontWeight:600, padding:'8px 12px', borderRadius:10, border:'1.5px solid #e0dcf5', background:'#fff', color:'#3a249b', cursor:'pointer' }}
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
        <div style={{ fontSize:13, opacity:0.7 }}>{paymentData.length} פעילים בדוח</div>
      </div>

      {loadError && <div role="alert" style={{ color:'#a63230', marginBottom:14 }}>{loadError}</div>}

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
          {paymentData.map(({ activist, total, breakdown, unpaid, expensesTotal, guidePay, grandTotal }) => (
            <div key={activist.id} style={{ background:'#fffaf5', borderRadius:14, padding:'16px', border:'0.5px solid rgba(0,0,0,0.07)', boxShadow:'0 1px 4px rgba(0,0,0,0.04)', cursor:'pointer', transition:'all 0.18s' }}
              onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.09)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'; }}
              onClick={()=>openActivist(activist.id)}
            >
              <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{activist.name}</div>
              <div style={{ fontSize:12, color:'#aaa', marginBottom:12 }}>דוח תשלום מצרפי</div>
              <div style={{ fontSize:28, fontWeight:700, color:'#6c5ce7' }}>{grandTotal.toLocaleString()} ₪</div>
              {guidePay > 0 && (
                <div style={{ fontSize:11.5, color:'#1b6ca8', marginTop:4, fontWeight:600 }}>🧭 כולל שכר הדרכת סיורים — {guidePay.toLocaleString()} ₪</div>
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
          {paymentData.map(({ activist, total, breakdown, unpaid, expensesTotal, guidePay, grandTotal }, idx) => (
            <div key={activist.id}
              style={{ display:'flex', alignItems:'center', padding:'13px 18px', borderBottom:idx===paymentData.length-1?'none':'0.5px solid #f5f5f5', cursor:'pointer', transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='#fafafa'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}
              onClick={()=>openActivist(activist.id)}
            >
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>{activist.name}</div>
                <div style={{ fontSize:12, color:'#aaa' }}>{breakdown.length} רכיבי תשלום{guidePay > 0 ? ' · 🧭 הדרכת סיורים' : ''}{expensesTotal > 0 ? ` · 🧾 הוצאות ${expensesTotal.toLocaleString()} ₪` : ''}</div>
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

      {/* כפתורי ייצוא — txt מפורט (פירוט לפי לקוח + קשרים שלא זוכו) ו-xlsx רזה לחשבות */}
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
            paymentData.forEach(({ activist, payment, expensesTotal, guidePay, grandTotal }) => {
              const activity = deriveActivityByTypeFromPayment(payment);
              lines.push(`${activist.name}: ${grandTotal.toLocaleString()} ₪`);
              activity.typeRows.filter(row => row.count > 0)
                .forEach(row => lines.push(`  • ${row.label}: ${row.count} · ${row.total.toLocaleString()} ₪`));
              activity.bonusRows.forEach(row => lines.push(`  • ${row.label}: ${row.count} · ${row.amount.toLocaleString()} ₪`));
              if (guidePay > 0) lines.push(`  • הדרכת סיורים: ${guidePay.toLocaleString()} ₪`);
              if (expensesTotal > 0) lines.push(`  • החזר הוצאות: ${expensesTotal.toLocaleString()} ₪`);
              if (activity.unpaidCount > 0) {
                lines.push('  קשרים שלא זוכו:');
                activity.unpaidByReason.forEach(row => lines.push(`    ✗ ${row.reason}: ${row.count}`));
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
              const activistsData = paymentData.map(({ activist, payment }) => ({
                activistName: activist.name,
                data: deriveActivityByTypeFromPayment(payment),
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
          style={{ background: exportingActivity || paymentData.length === 0 ? '#b7b0e8' : 'linear-gradient(135deg,#1f7a45,#2ecc71)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:700, cursor:exportingActivity || paymentData.length === 0?'default':'pointer', fontFamily:'Rubik,sans-serif' }}
        >
          {exportingActivity ? '⏳ מייצא…' : '📋 ייצוא פעילות לכל הפעילים'}
        </button>
      </div>

    </DesktopLayout>
  );
}
