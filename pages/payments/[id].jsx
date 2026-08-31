// pages/payments/[id].jsx — דף פירוט תשלום לפעיל בודד (רכז/הנהלה)
// מגיעים לכאן בלחיצה על כרטיס פעיל בעמוד /payments. אותה לוגיקת חישוב בדיוק
// (calcMonthlyPayment + הדרכת סיורים + החזר הוצאות + ביטול בונוסים) כמו בעמוד הרשימה.
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import DesktopLayout from '../../components/DesktopLayout';
import { useCrm } from '../../lib/CrmStore';
import { useAuth } from '../../lib/AuthStore';
import { calcMonthlyPayment, resolvePeriod } from '../../lib/paymentCalc';
import { getSupabaseClient } from '../../lib/supabaseClient';

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

export default function ActivistPaymentDetail() {
  const router = useRouter();
  const { id } = router.query;
  const activistId = Number(id);
  const { contacts, interactions, mitzvotBonuses, newParticipantBonuses, toraniBonuses, activists, paymentConfig, expenses, tours } = useCrm();
  const { currentUser, can } = useAuth();
  const [cancelledBonuses, setCancelledBonuses] = useState([]); // שורות bonus_cancellations

  const canView = can.seePayments;
  // רשאים לבטל בונוס: רכז/ראש-פרויקט/מנכ"ל בלבד (לא כספים — צפייה בלבד)
  const canCancelBonus = ['coord', 'head', 'ceo'].includes(currentUser?.role);

  const loadCancelledBonuses = useCallback(async () => {
    if (!canView) return;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('bonus_cancellations').select('*');
    if (error) { console.error('Failed to load bonus cancellations', error); return; }
    setCancelledBonuses(Array.isArray(data) ? data : []);
  }, [canView]);

  useEffect(() => { loadCancelledBonuses(); }, [loadCancelledBonuses]);

  const cancelledBonusKeys = useMemo(() => new Set(cancelledBonuses.map(b => b.bonus_key)), [cancelledBonuses]);

  // חודש הדיווח מגיע מה-URL (?y=&m=) כדי לשמר את הבחירה מעמוד /payments. ללא פרמטרים → החודש הנוכחי.
  const { year, month, monthKey, startIso, endIso } = resolvePeriod(
    router.query.y != null && router.query.m != null
      ? { year: Number(router.query.y), month: Number(router.query.m) }
      : null
  );
  const currentMonthName = MONTH_NAMES[month];

  const activist = activists.find(a => Number(a.id) === activistId);

  // חישוב זהה לעמוד התשלומים של הרכז (pages/payments.jsx) — לפעיל הבודד הזה בלבד, באותו חודש.
  const report = useMemo(() => {
    if (!activist) return null;
    const myMitzvotBonuses = mitzvotBonuses.filter(b => b.activist_id === activist.id && b.month === monthKey);
    const myNewBonuses     = newParticipantBonuses.filter(b => b.activist_id === activist.id && b.month === monthKey);
    const myToraniBonuses  = toraniBonuses.filter(b => b.activist_id === activist.id && b.month === monthKey);
    const result = calcMonthlyPayment(activist.id, interactions, contacts, myMitzvotBonuses, myNewBonuses, paymentConfig, cancelledBonusKeys, { year, month }, myToraniBonuses);
    const expensesTotal = expenses
      .filter(x => Number(x.activist_id) === Number(activist.id) && x.date >= startIso && x.date < endIso)
      .reduce((s, x) => s + Number(x.amount || 0), 0);
    const guidedCount = tours.filter(t =>
      t.status === 'completed' &&
      Number(t.guide_activist_id) === Number(activist.id) &&
      t.date >= startIso && t.date < endIso
    ).length;
    const guidePay = guidedCount * (paymentConfig.TOUR_GUIDE_RATE ?? 750);
    return { ...result, expensesTotal, guidePay, guidedCount, grandTotal: result.total + expensesTotal + guidePay };
  }, [activist, interactions, contacts, mitzvotBonuses, newParticipantBonuses, toraniBonuses, paymentConfig, expenses, tours, cancelledBonusKeys, monthKey, startIso, endIso, year, month]);

  async function handleCancelBonus(item) {
    if (!item.key || !activist) return;
    // ⚠️ bonus_key הוא לפי פעיל|סוג|לקוח|חודש — כמה בונוסים מאותו סוג מול אותו לקוח
    // באותו חודש (למשל שתי מצוות שעלו באותה שמירה) חולקים מפתח אחד, וביטול אחד
    // מבטל את כולם. הפורמט לא ניתן לשינוי — יש שורות bonus_cancellations חיות בו.
    // לכן לפחות אומרים לרכז מה הוא באמת מבטל, במקום לחסר ממנו סכום בשקט.
    const sameKey = (report?.breakdown || []).filter(b => b.key === item.key);
    const totalAmount = sameKey.reduce((s, b) => s + b.amount, 0);
    const message = sameKey.length > 1
      ? `הבונוס הזה חולק מפתח עם עוד ${sameKey.length - 1} בונוסים של אותו לקוח החודש:\n\n` +
        sameKey.map(b => `• ${b.desc} (${b.amount.toLocaleString()} ₪)`).join('\n') +
        `\n\nביטול יסיר את כולם — סה"כ ${totalAmount.toLocaleString()} ₪ מהתשלום של ${activist.name}. להמשיך?`
      : `לבטל את הבונוס "${item.desc}" (${item.amount.toLocaleString()} ₪) של ${activist.name}?`;
    const confirmed = window.confirm(message);
    if (!confirmed) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('bonus_cancellations').insert({
      bonus_key:    item.key,
      activist_id:  activist.id,
      project_id:   activist.project_id ?? null,
      desc:         item.desc,
      amount:       item.amount,
      cancelled_by: currentUser?.id ?? null,
    });
    if (error) { window.alert(`שגיאה בביטול הבונוס: ${error.message}`); return; }
    await loadCancelledBonuses();
  }

  if (!canView) return (
    <DesktopLayout title="פירוט תשלום פעיל" backHref={`/payments?y=${year}&m=${month}`} backLabel="← חזרה לתשלומים">
      <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
        <div>אין הרשאה לדף זה</div>
      </div>
    </DesktopLayout>
  );

  if (!activist) return (
    <DesktopLayout title="פירוט תשלום פעיל" backHref={`/payments?y=${year}&m=${month}`} backLabel="← חזרה לתשלומים">
      <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>פעיל לא נמצא</div>
    </DesktopLayout>
  );

  return (
    <DesktopLayout title={`פירוט תשלום — ${activist.name}`} subtitle={`${currentMonthName} ${year}`} backHref={`/payments?y=${year}&m=${month}`} backLabel="← חזרה לתשלומים">
      <div style={{ maxWidth: 640 }}>

        {/* סיכום כולל */}
        <div style={{ background:'linear-gradient(135deg,#6c5ce7,#a29bfe)', borderRadius:16, padding:'20px 24px', marginBottom:20, color:'#fff', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:13, opacity:0.85, marginBottom:4 }}>סה"כ לתשלום {currentMonthName} {year}</div>
            <div style={{ fontSize:36, fontWeight:700 }}>{report.grandTotal.toLocaleString()} ₪</div>
          </div>
          {can.seeActivists && (
            <Link href={`/activists/${activist.id}`} style={{ color:'#fff', fontSize:12, fontWeight:700, textDecoration:'none', background:'rgba(255,255,255,0.18)', borderRadius:10, padding:'8px 14px' }}>
              לפרופיל הפעיל ←
            </Link>
          )}
        </div>

        {/* פירוט */}
        <div style={{ background:'#fffaf5', borderRadius:16, padding:'20px', border:'0.5px solid rgba(108,92,231,0.2)', marginBottom:24 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>פירוט קשרים ובונוסים</div>

          {report.breakdown.length === 0 && report.guidePay === 0 && report.expensesTotal === 0 && (
            <div style={{ fontSize:13, color:'#aaa', padding:'8px 0' }}>אין קשרים מזכים ב{currentMonthName} {year}.</div>
          )}

          {report.breakdown.map((item, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'0.5px solid #f0f0f0', fontSize:13 }}>
              <div>
                <span style={{ fontWeight:700 }}>{item.contactName}</span>
                {item.desc && <span style={{ color:'#aaa', marginRight:8 }}>— {item.desc}</span>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ fontWeight:700, color:'#6c5ce7' }}>{item.amount} ₪</div>
                {canCancelBonus && item.key && (
                  <button onClick={() => handleCancelBonus(item)} title="בטל בונוס"
                    style={{ background:'#fff0f0', border:'1px solid #e0a0a0', color:'#c0392b', borderRadius:8, padding:'4px 9px', fontSize:11.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                    ✕ בטל בונוס
                  </button>
                )}
              </div>
            </div>
          ))}

          {report.guidePay > 0 && (
            <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'0.5px solid #f0f0f0', fontSize:13 }}>
              <div><span style={{ fontWeight:700 }}>🧭 הדרכת סיורים</span><span style={{ color:'#aaa', marginRight:8 }}>— {report.guidedCount} סיורים שהתקיימו</span></div>
              <div style={{ fontWeight:700, color:'#1b6ca8' }}>{report.guidePay.toLocaleString()} ₪</div>
            </div>
          )}

          {report.expensesTotal > 0 && (
            <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'0.5px solid #f0f0f0', fontSize:13 }}>
              <div><span style={{ fontWeight:700 }}>🧾 החזר הוצאות</span><span style={{ color:'#aaa', marginRight:8 }}>— מדיווחי הפעיל החודש</span></div>
              <div style={{ fontWeight:700, color:'#1f7a45' }}>{report.expensesTotal.toLocaleString()} ₪</div>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', marginTop:10, fontWeight:700, fontSize:15 }}>
            <span>סה"כ</span>
            <span style={{ color:'#6c5ce7' }}>{report.grandTotal.toLocaleString()} ₪</span>
          </div>

          {/* קשרים שלא זוכו + הסיבה — שקיפות (לא משפיע על הסכום) */}
          {report.unpaid?.length > 0 && (
            <div style={{ marginTop:18 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#c0392b', marginBottom:8 }}>
                קשרים שלא זוכו בתשלום ({report.unpaid.length})
              </div>
              {report.unpaid.map((item, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'7px 0', borderBottom:'0.5px solid #f0f0f0', fontSize:12.5 }}>
                  <div>
                    <span style={{ fontWeight:700 }}>{item.contactName || 'לקוח'}</span>
                    <span style={{ color:'#aaa', marginRight:6 }}>— {item.desc}</span>
                    <span style={{ color:'#bbb', marginRight:6 }}>({item.date})</span>
                  </div>
                  <div style={{ color:'#c0392b', whiteSpace:'nowrap' }}>{item.reason || 'לא מזכה'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </DesktopLayout>
  );
}
