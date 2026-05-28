// pages/payments.jsx — עמוד תשלומים (אחדות יהודית — רכז בלבד)
import { useState, useMemo } from 'react';
import DesktopLayout from '../components/DesktopLayout';
import { useCrm } from '../lib/CrmStore';
import { useAuth } from '../lib/AuthStore';
import { calcMonthlyPayment } from '../lib/paymentCalc';
import activists from '../data/activists';

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

export default function PaymentsPage() {
  const { contacts, interactions, mitzvotBonuses, newParticipantBonuses } = useCrm();
  const { currentUser, can } = useAuth();
  const [viewMode, setViewMode] = useState('grid');
  const [selectedReport, setSelectedReport] = useState(null);

  // רשאים לצפות: כל מי ש-AuthStore מאשר (רכז, מנכ"ל, כספים, ראש פרויקט)
  const canView = can.seePayments;

  if (!canView) return (
    <DesktopLayout title="דוחות תשלום פעילים">
      <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
        <div>אין הרשאה לדף זה</div>
      </div>
    </DesktopLayout>
  );

  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  // פעילי אחדות יהודית
  const achdutActivists = activists.filter(a => a.project_id === 2 && a.role !== 'manager');

  // [DIAG] לוג אבחון תשלומים
  console.log('[PAY-DIAG] month:', month, 'year:', year);
  console.log('[PAY-DIAG] achdutActivists:', achdutActivists.map(a => ({ id: a.id, name: a.name, project_id: a.project_id })));
  console.log('[PAY-DIAG] total interactions loaded:', interactions.length);
  console.log('[PAY-DIAG] latest 5 interactions:', [...interactions].sort((a,b) => (b.id||0)-(a.id||0)).slice(0,5).map(i => ({ id:i.id, activist_id:i.activist_id, project_id:i.project_id, type:i.type, quality:i.quality, duration_minutes:i.duration_minutes, date:i.date })));

  // חישוב תשלומים לכל פעיל
  const paymentData = useMemo(() => achdutActivists.map(activist => {
    const myMitzvotBonuses = mitzvotBonuses.filter(b => b.activist_id === activist.id && b.month === `${year}-${month}`);
    const myNewBonuses     = newParticipantBonuses.filter(b => b.activist_id === activist.id && b.month === `${year}-${month}`);
    const result = calcMonthlyPayment(activist.id, interactions, contacts, myMitzvotBonuses, myNewBonuses);
    return { activist, ...result };
  }), [achdutActivists, interactions, contacts, mitzvotBonuses, newParticipantBonuses]);

  const totalAll = paymentData.reduce((s, d) => s + d.total, 0);
  const currentMonthName = MONTH_NAMES[month];

  return (
    <DesktopLayout title="דוחות תשלום פעילים" subtitle={`אחדות יהודית · ${currentMonthName} ${year}`}>

      {/* סיכום כולל */}
      <div style={{ background:'linear-gradient(135deg,#6c5ce7,#a29bfe)', borderRadius:16, padding:'20px 24px', marginBottom:20, color:'#fff', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:13, opacity:0.8, marginBottom:4 }}>סה"כ תשלומים {currentMonthName}</div>
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
          {paymentData.map(({ activist, total, breakdown }) => (
            <div key={activist.id} style={{ background:'#fffaf5', borderRadius:14, padding:'16px', border:'0.5px solid rgba(0,0,0,0.07)', boxShadow:'0 1px 4px rgba(0,0,0,0.04)', cursor:'pointer', transition:'all 0.18s' }}
              onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.09)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'; }}
              onClick={()=>setSelectedReport(selectedReport?.activist.id===activist.id?null:{activist,total,breakdown})}
            >
              <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{activist.name}</div>
              <div style={{ fontSize:12, color:'#aaa', marginBottom:12 }}>{breakdown.filter(b=>b.type==='קשר').length} קשרים מזכים</div>
              <div style={{ fontSize:28, fontWeight:700, color:'#6c5ce7' }}>{total.toLocaleString()} ₪</div>
            </div>
          ))}
        </div>
      )}

      {/* תצוגת רשימה */}
      {viewMode === 'list' && (
        <div style={{ background:'#fff', borderRadius:16, border:'0.5px solid rgba(0,0,0,0.07)', overflow:'hidden', marginBottom:24 }}>
          {paymentData.map(({ activist, total, breakdown }, idx) => (
            <div key={activist.id}
              style={{ display:'flex', alignItems:'center', padding:'13px 18px', borderBottom:idx===paymentData.length-1?'none':'0.5px solid #f5f5f5', cursor:'pointer', transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='#fafafa'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}
              onClick={()=>setSelectedReport(selectedReport?.activist.id===activist.id?null:{activist,total,breakdown})}
            >
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>{activist.name}</div>
                <div style={{ fontSize:12, color:'#aaa' }}>{breakdown.length} קשרים מזכים</div>
              </div>
              <div style={{ fontSize:22, fontWeight:700, color:'#6c5ce7' }}>{total.toLocaleString()} ₪</div>
            </div>
          ))}
          {/* שורה תחתונה — סיכום */}
          <div style={{ display:'flex', alignItems:'center', padding:'13px 18px', background:'#f0effe', fontWeight:700 }}>
            <div style={{ flex:1, fontSize:14, color:'#6c5ce7' }}>סה"כ</div>
            <div style={{ fontSize:22, color:'#6c5ce7' }}>{totalAll.toLocaleString()} ₪</div>
          </div>
        </div>
      )}

      {/* פירוט פעיל נבחר */}
      {selectedReport && (
        <div style={{ background:'#fffaf5', borderRadius:16, padding:'20px', border:'0.5px solid rgba(108,92,231,0.2)', marginBottom:24 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>פירוט — {selectedReport.activist.name}</div>
          {selectedReport.breakdown.map((item, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'0.5px solid #f0f0f0', fontSize:13 }}>
              <div>
                <span style={{ fontWeight:700 }}>{item.contactName}</span>
                {item.desc && <span style={{ color:'#aaa', marginRight:8 }}>— {item.desc}</span>}
              </div>
              <div style={{ fontWeight:700, color:'#6c5ce7' }}>{item.amount} ₪</div>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:10, fontWeight:700, fontSize:15 }}>
            <span>סה"כ</span>
            <span style={{ color:'#6c5ce7' }}>{selectedReport.total.toLocaleString()} ₪</span>
          </div>
        </div>
      )}

      {/* כפתור דוח חודשי */}
      <div style={{ textAlign:'left' }}>
        <button
          onClick={() => {
            const lines = [`דוח פעילות לתשלום — ${currentMonthName} ${year}`, '='.repeat(40), ''];
            paymentData.forEach(({ activist, total, breakdown }) => {
              lines.push(`${activist.name}: ${total.toLocaleString()} ₪`);
              breakdown.forEach(b => lines.push(`  • ${b.contactName} — ${b.desc}: ${b.amount} ₪`));
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
      </div>

    </DesktopLayout>
  );
}
