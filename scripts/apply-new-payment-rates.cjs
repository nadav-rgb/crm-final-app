// scripts/apply-new-payment-rates.cjs — מעדכן את payment_config ב-Supabase לתעריפים
// החדשים (עדכון 2026-08-31). *** לא רץ אוטומטית — נדב מריץ אותו ביודעין. ***
// שימוש: node scripts/apply-new-payment-rates.cjs           (יבש — רק מציג מה ישתנה)
//        node scripts/apply-new-payment-rates.cjs --apply   (כותב בפועל)
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const NEW_RATES = {
  rate_phone_friendly: 0,    // היה 150
  rate_phone_torani:   150,  // היה 200
  rate_video_torani:   200,  // היה 250
};

(async () => {
  const { data: current, error: readErr } = await sb.from('payment_config').select('*').eq('id', 1).single();
  if (readErr) { console.error('קריאת payment_config נכשלה:', readErr.message); process.exit(1); }

  console.log('=== שינוי תעריפים מוצע ===');
  for (const [col, newVal] of Object.entries(NEW_RATES)) {
    console.log(`${col}: ${current[col]} → ${newVal}`);
  }

  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log('\n(מצב יבש — כלום לא נכתב. הרץ עם --apply כדי לכתוב בפועל.)');
    return;
  }

  const { error: writeErr } = await sb.from('payment_config').update(NEW_RATES).eq('id', 1);
  if (writeErr) { console.error('כתיבה נכשלה:', writeErr.message); process.exit(1); }
  console.log('\n✅ payment_config עודכן.');
})();
