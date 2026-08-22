// scripts/debug-payment.cjs — מאבחן B1: מריץ את calcInteractionPayment על נתוני אמת
// ומדפיס לכל קשר אם הוא משולם ולמה לא. שימוש: node scripts/debug-payment.cjs [activistId]
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { calcInteractionPayment, comparePaymentOrder } = require('../lib/paymentCalc.js');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

(async () => {
  const activistId = Number(process.argv[2] || 11);
  const { data: inter } = await sb.from('interactions').select('*').eq('activist_id', activistId);
  const { data: contacts } = await sb.from('contacts').select('id, name, high_potential');
  const cmap = Object.fromEntries((contacts || []).map(c => [String(c.id), c]));

  // קבץ לפי חודש כמו שהאפליקציה עושה
  const byMonth = {};
  for (const i of (inter || [])) {
    const d = new Date(i.date); const k = `${d.getFullYear()}-${d.getMonth() + 1}`;
    (byMonth[k] ||= []).push(i);
  }

  for (const [month, list] of Object.entries(byMonth)) {
    console.log(`\n=== activist ${activistId} — חודש ${month} (${list.length} קשרים) ===`);
    // אותו סדר ואותה צבירה כמו calcMonthlyPayment — אחרת הסקריפט שנועד לדבג את המנוע
    // מדווח מספר אחר ממנו: הקצאה לפי ערך (לא לפי תאריך), וצבירה של המזכים בלבד.
    const sorted = list.sort((a, b) => comparePaymentOrder(a, b));
    const accumulated = [];
    let total = 0;
    for (const i of sorted) {
      const contact = cmap[String(i.contact_id)];
      const isHigh = contact?.high_potential ?? false;
      const prevForContact = accumulated.filter(x => x.contact_id === i.contact_id);
      const r = calcInteractionPayment(i, prevForContact, isHigh, accumulated);
      if (r.payable) { accumulated.push(i); total += r.amount; }
      console.log(`${i.date} ${String(i.type).padEnd(7)} ${String(i.quality).padEnd(8)} dur=${i.duration_minutes} high=${isHigh} → ${r.payable ? `₪${r.amount}` : `❌ ${r.reason}`}`);
    }
    console.log(`סה"כ חודשי: ₪${total}`);
  }
})();
