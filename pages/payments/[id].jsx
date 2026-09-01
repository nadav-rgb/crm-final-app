// pages/payments/[id].jsx — פירוט תשלום מצרפי דרך ה-BFF בלבד.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DesktopLayout from '../../components/DesktopLayout';
import { useAuth } from '../../lib/AuthStore';
import { deriveActivityByTypeFromPayment, exportActivityXlsx } from '../../lib/activityByTypeExcel';

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function routePeriod(query) {
  const now = new Date();
  const year = Number(query.y), month = Number(query.m);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 0 && month <= 11) return { year, month };
  return { year: now.getFullYear(), month: now.getMonth() };
}

export default function ActivistPaymentDetail() {
  const router = useRouter();
  const { currentUser, can, apiFetch } = useAuth();
  const [payment, setPayment] = useState(null);
  const [bonuses, setBonuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cancellingKey, setCancellingKey] = useState('');
  const [exportingActivity, setExportingActivity] = useState(false);

  const userId = typeof router.query.id === 'string' ? router.query.id : '';
  const projectId = Number(router.query.projectId);
  const projectNarrowing = Number.isInteger(projectId) && projectId > 0 ? projectId : null;
  const { year, month } = routePeriod(router.query);
  const period = `${year}-${String(month + 1).padStart(2, '0')}`;
  const currentMonthName = MONTH_NAMES[month];
  const canView = can.seePayments;
  const canCancelBonus = ['head', 'ceo'].includes(currentUser?.role);
  const backHref = `/payments?y=${year}&m=${month}`;

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ period });
    if (projectNarrowing != null) query.set('projectId', String(projectNarrowing));
    return query.toString();
  }, [period, projectNarrowing]);
  const activityData = useMemo(
    () => payment ? deriveActivityByTypeFromPayment(payment) : null,
    [payment],
  );

  const load = useCallback(async () => {
    if (!router.isReady || !canView || !userId) return;
    setLoading(true);
    try {
      const paymentResult = await apiFetch(`/api/payments/${encodeURIComponent(userId)}?${queryString}`, { method: 'GET' });
      let candidates = [];
      if (canCancelBonus) {
        const bonusQuery = new URLSearchParams({ period, userId });
        if (projectNarrowing != null) bonusQuery.set('projectId', String(projectNarrowing));
        const bonusResult = await apiFetch(`/api/payments/bonus-candidates?${bonusQuery}`, { method: 'GET' });
        candidates = bonusResult.bonuses || [];
      }
      setPayment(paymentResult.payment);
      setBonuses(candidates);
      setLoadError('');
    } catch {
      setPayment(null);
      setBonuses([]);
      setLoadError('טעינת פירוט התשלום נכשלה או שאינה מורשית.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canCancelBonus, canView, period, projectNarrowing, queryString, router.isReady, userId]);

  useEffect(() => { load(); }, [load]);

  async function handleCancelBonus(item) {
    if (!item?.key || cancellingKey) return;
    if (!window.confirm(`לבטל ${item.type} בסך ${Number(item.amount).toLocaleString()} ₪?`)) return;
    setCancellingKey(item.key);
    try {
      await apiFetch('/api/payments/cancel-bonus', { method: 'POST', body: { bonusKey: item.key } });
      await load();
    } catch {
      window.alert('ביטול הבונוס נכשל. ההרשאה והיקף הפרויקט נבדקו מחדש.');
    } finally {
      setCancellingKey('');
    }
  }

  if (!canView) return (
    <DesktopLayout title="פירוט תשלום פעיל" backHref={backHref} backLabel="← חזרה לתשלומים">
      <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
        <div>אין הרשאה לדף זה</div>
      </div>
    </DesktopLayout>
  );

  if (loading) return (
    <DesktopLayout title="פירוט תשלום פעיל" backHref={backHref} backLabel="← חזרה לתשלומים">
      <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>טוען פירוט תשלום…</div>
    </DesktopLayout>
  );

  if (!payment) return (
    <DesktopLayout title="פירוט תשלום פעיל" backHref={backHref} backLabel="← חזרה לתשלומים">
      <div role="alert" style={{ textAlign:'center', padding:60, color:'#a63230' }}>
        {loadError || 'פירוט התשלום לא נמצא.'}
      </div>
    </DesktopLayout>
  );

  const totals = [
    ['פעילות מזכה', payment.activityTotal, '#6c5ce7'],
    ['בונוסים', payment.bonusTotal, '#8e5bb7'],
    ['הדרכת סיורים', payment.tourTotal, '#1b6ca8'],
    ['החזר הוצאות', payment.expenseTotal, '#1f7a45'],
  ];

  return (
    <DesktopLayout
      title={`פירוט תשלום — ${payment.name}`}
      subtitle={`${currentMonthName} ${year} · נתונים מצרפיים`}
      backHref={backHref}
      backLabel="← חזרה לתשלומים"
    >
      <div style={{ maxWidth: 640 }}>
        <div style={{ background:'linear-gradient(135deg,#6c5ce7,#a29bfe)', borderRadius:16, padding:'20px 24px', marginBottom:20, color:'#fff' }}>
          <div style={{ fontSize:13, opacity:0.85, marginBottom:4 }}>סה"כ לתשלום {currentMonthName} {year}</div>
          <div style={{ fontSize:36, fontWeight:700 }}>{Number(payment.grandTotal).toLocaleString()} ₪</div>
        </div>

        {loadError && <div role="alert" style={{ color:'#a63230', marginBottom:14 }}>{loadError}</div>}

        <div style={{ background:'#fffaf5', borderRadius:16, padding:'20px', border:'0.5px solid rgba(108,92,231,0.2)', marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>פירוט מצרפי</div>
          {totals.map(([label, amount, color]) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'9px 0', borderBottom:'0.5px solid #f0f0f0', fontSize:13.5 }}>
              <span>{label}</span>
              <span style={{ fontWeight:700, color }}>{Number(amount).toLocaleString()} ₪</span>
            </div>
          ))}
        </div>

        {activityData && (
          <div style={{ background:'#fff', borderRadius:16, padding:'20px', border:'0.5px solid rgba(108,92,231,0.16)', marginBottom:20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:12 }}>
              <div style={{ fontSize:15, fontWeight:700 }}>פעילות לפי סוג</div>
              <button
                type="button"
                onClick={async () => {
                  if (exportingActivity) return;
                  setExportingActivity(true);
                  try {
                    await exportActivityXlsx(payment.name, currentMonthName, year, activityData);
                  } catch (err) {
                    console.error('Activity export failed', err);
                    window.alert('ייצוא הפעילות נכשל. נסה שוב.');
                  } finally {
                    setExportingActivity(false);
                  }
                }}
                disabled={exportingActivity}
                style={{ background:exportingActivity?'#b7b0e8':'linear-gradient(135deg,#1f7a45,#2ecc71)', color:'#fff', border:'none', borderRadius:9, padding:'7px 12px', fontSize:12, fontWeight:700, cursor:exportingActivity?'default':'pointer', fontFamily:'inherit' }}
              >
                {exportingActivity ? '⏳ מייצא…' : '📋 ייצוא פעילות לאקסל'}
              </button>
            </div>
            {activityData.typeRows.map((row) => (
              <div key={row.label} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:14, padding:'7px 0', borderBottom:'0.5px solid #f2f2f2', fontSize:13 }}>
                <span>{row.label}</span>
                <span style={{ color:'#777' }}>{row.count} קשרים</span>
                <span style={{ fontWeight:700, minWidth:72, textAlign:'left' }}>{row.total.toLocaleString()} ₪</span>
              </div>
            ))}
            {activityData.bonusRows.length > 0 && (
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:13.5, fontWeight:700, marginBottom:5 }}>בונוסים</div>
                {activityData.bonusRows.map((row) => (
                  <div key={row.label} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', fontSize:13 }}>
                    <span>{row.label} · {row.count}</span>
                    <span style={{ fontWeight:700 }}>{row.amount.toLocaleString()} ₪</span>
                  </div>
                ))}
              </div>
            )}
            {activityData.unpaidCount > 0 && (
              <div style={{ marginTop:14, fontSize:12.5, color:'#777' }}>
                <div style={{ fontWeight:700, marginBottom:4 }}>לא זוכו: {activityData.unpaidCount}</div>
                {activityData.unpaidByReason.map((row) => <div key={row.reason}>• {row.reason}: {row.count}</div>)}
              </div>
            )}
          </div>
        )}

        {canCancelBonus && (
          <div style={{ background:'#fff', borderRadius:16, padding:'20px', border:'0.5px solid rgba(192,57,43,0.18)' }}>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>בונוסים הזמינים לביטול</div>
            <div style={{ fontSize:12, color:'#999', marginBottom:12 }}>הרשימה אינה כוללת פרטי לקוחות. השרת מאמת מחדש את הזכאות, הפעיל והפרויקט בכל פעולה.</div>
            {bonuses.length === 0 ? (
              <div style={{ fontSize:13, color:'#aaa', padding:'8px 0' }}>אין בונוסים זמינים לביטול בחודש זה.</div>
            ) : bonuses.map((item) => (
              <div key={item.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'9px 0', borderBottom:'0.5px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontSize:13.5, fontWeight:700 }}>{item.type}</div>
                  <div style={{ fontSize:12, color:'#888' }}>{Number(item.amount).toLocaleString()} ₪</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCancelBonus(item)}
                  disabled={Boolean(cancellingKey)}
                  style={{ background:'#fff0f0', border:'1px solid #e0a0a0', color:'#c0392b', borderRadius:8, padding:'6px 10px', fontSize:11.5, fontWeight:700, cursor:cancellingKey?'default':'pointer', fontFamily:'inherit' }}
                >
                  {cancellingKey === item.key ? 'מבטל…' : '✕ בטל בונוס'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DesktopLayout>
  );
}
