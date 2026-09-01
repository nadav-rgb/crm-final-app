// scripts/verify-month-report.cjs — מאמת שמנוע התשלומים יודע לחשב חודש היסטורי (לא רק "החודש").
// שימוש: node scripts/verify-month-report.cjs 2026 7      (שנה, חודש 1-12)
// מריץ את calcMonthlyPayment על נתוני אמת מ-Supabase עבור החודש המבוקש ומדפיס סיכום לפעיל.
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { calcMonthlyPayment, deriveMitzvotBonuses, deriveToraniBonuses } = require('../lib/paymentCalc.js');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

(async () => {
  const year  = Number(process.argv[2] || new Date().getFullYear());
  const month = Number(process.argv[3] || new Date().getMonth() + 1) - 1; // 0-indexed
  const monthKey = `${year}-${month}`;
  const startIso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endIso   = month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, '0')}-01`;

  const [{ data: interactions }, { data: contacts }, { data: activists }, { data: cancellations }, { data: expenses }, { data: tours }] =
    await Promise.all([
      sb.from('interactions').select('*'),
      sb.from('contacts').select('*'),
      sb.from('activist_directory').select('*'),
      sb.from('bonus_cancellations').select('bonus_key'),
      sb.from('expenses').select('*'),
      sb.from('tours').select('*'),
    ]);

  const cancelledKeys = new Set((cancellations || []).map(c => c.bonus_key));

  // בונוסים נגזרים — אותה לוגיקה בדיוק כמו lib/CrmStore.jsx
  const newParticipantBonuses = (contacts || [])
    .filter(c => c.activist_id && c.joined_at && (c.source === 'external' || c.referred_by))
    .map(c => { const d = new Date(c.joined_at); return { activist_id: c.activist_id, contact_id: c.id, contactName: c.name, month: `${d.getFullYear()}-${d.getMonth()}` }; });

  // בונוסי מצוות — מהגזירה המשותפת ב-lib/paymentCalc.js, לא עותק מקומי.
  // בונוס אחד לכל אירוע-עליה, גם בקפיצה של כמה רמות (דיווח מוטי גלעד, 2026-08-02).
  const mitzvotBonuses = deriveMitzvotBonuses(contacts);

  // בונוס תורני — מהגזירה המשותפת ב-lib/paymentCalc.js, אותו דפוס כמו mitzvotBonuses לעיל.
  const toraniBonuses = deriveToraniBonuses(interactions, contacts);

  // מיפוי זהה ל-lib/CrmStore.jsx: ה-view חושף activist_code, לא id.
  const paid = (activists || [])
    .filter(a => a.role === 'activist')
    .map(a => ({ ...a, id: Number(a.activist_code) }));
  let grand = 0, rows = 0;
  console.log(`\n=== ${MONTH_NAMES[month]} ${year} (monthKey=${monthKey}) ===\n`);

  for (const a of paid) {
    const myMitzvot = mitzvotBonuses.filter(b => Number(b.activist_id) === Number(a.id) && b.month === monthKey);
    const myNew     = newParticipantBonuses.filter(b => Number(b.activist_id) === Number(a.id) && b.month === monthKey);
    const myTorani  = toraniBonuses.filter(b => Number(b.activist_id) === Number(a.id) && b.month === monthKey);
    const r = calcMonthlyPayment(a.id, interactions || [], contacts || [], myMitzvot, myNew, undefined, cancelledKeys, { year, month }, myTorani);
    const exp = (expenses || []).filter(x => Number(x.activist_id) === Number(a.id) && x.date >= startIso && x.date < endIso)
      .reduce((s, x) => s + Number(x.amount || 0), 0);
    const guided = (tours || []).filter(t => t.status === 'completed' && Number(t.guide_activist_id) === Number(a.id) && t.date >= startIso && t.date < endIso).length;
    const guidePay = guided * 750;
    const totalRow = r.total + exp + guidePay;
    if (totalRow === 0) continue;
    rows++;
    grand += totalRow;
    console.log(`${String(a.name).padEnd(22)} ${String(totalRow).padStart(7)} ₪   (קשרים ${r.breakdown.filter(b => b.type === 'קשר').length}, בונוסים ${r.breakdown.filter(b => b.type !== 'קשר').length}${exp ? `, הוצאות ${exp}₪` : ''}${guidePay ? `, סיורים ${guidePay}₪` : ''})`);
  }

  console.log(`\n${'='.repeat(60)}\nסה"כ ${rows} פעילים: ${grand.toLocaleString()} ₪\n`);

  if (grand === 0) { console.error('❌ FAIL — החישוב החזיר 0. המנוע לא מכבד את הפרמטר period.'); process.exit(1); }
  console.log('✅ PASS — המנוע חישב חודש היסטורי בהצלחה.');
})();
