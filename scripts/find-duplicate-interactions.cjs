// scripts/find-duplicate-interactions.cjs — מאתר דיווחי קשר כפולים (לחיצה חוזרת על "שמור").
//
// שימוש:
//   node scripts/find-duplicate-interactions.cjs            → דוח בלבד, לא נוגע בכלום
//   node scripts/find-duplicate-interactions.cjs --delete   → מוחק את השורות העודפות
//
// ⚠️ ה-‎--delete מוחק שורות מטבלת interactions ומשנה סכומי שכר. להרצה ע"י נדב בלבד,
//    אחרי שהוא קרא את הדוח. הריצה ללא הדגל היא הדיפולט ולא כותבת דבר.
//
// רקע: עד 23.8 לטופס דיווח הקשר לא היה מנעול שליחה, והכפתור נשאר לחיץ בזמן השמירה.
// פעיל שלחץ שוב על כפתור שלא הגיב יצר שורה נוספת עם id חדש (Date.now()). סריקה ב-23.8
// מצאה 6 קבוצות ו-10 שורות עודפות אצל 5 פעילים, כולן בהפרש 0.3–20 שניות.
// דיווחי הפעילים: מוטי גלעד 14.8, שירה שם טוב 30.7, מוטי שטרלינג 28.7.
//
// זיהוי כפילות: אותו פעיל + אותו לקוח + אותו תאריך + אותו סוג/איכות + אותו תיאור.
// התיאור הוא שדה חובה בטקסט חופשי — שני דיווחים אמיתיים כמעט לעולם לא זהים בו.
// שורות נגזרות ממפגש רב-משתתפים (participants.derived_from) מוחרגות: הן נוצרות
// אוטומטית ולא נספרות לתשלום ממילא.
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const DO_DELETE = process.argv.includes('--delete');

(async () => {
  const { data: rows, error } = await sb
    .from('interactions')
    .select('id, contact_id, contact_name, activist_id, type, quality, date, time, description, participants')
    .order('date');
  if (error) { console.error('שגיאת טעינה:', error.message); process.exit(1); }

  const isDerived = r => Boolean(r.participants && r.participants.derived_from);
  const key = r => [r.activist_id, r.contact_id, r.date, r.type, r.quality, (r.description || '').trim()].join('|');

  const groups = new Map();
  for (const r of rows) {
    if (isDerived(r)) continue;
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const extras = [];
  let sets = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    sets++;
    // השורה הראשונה (id הנמוך = הלחיצה המקורית) נשמרת; השאר עודפות.
    const sorted = [...g].sort((a, b) => Number(a.id) - Number(b.id));
    const spread = Number(sorted[sorted.length - 1].id) - Number(sorted[0].id);
    console.log(`\n${g.length}× ${sorted[0].date} ${sorted[0].time} · פעיל ${sorted[0].activist_id} · ${sorted[0].contact_name} · ${sorted[0].type}/${sorted[0].quality}`);
    console.log(`   נשמר: ${sorted[0].id}`);
    console.log(`   עודף: ${sorted.slice(1).map(r => r.id).join(', ')}   (טווח ${spread}ms בין הלחיצות)`);
    if (sorted[0].participants) console.log(`   ⚠️ מפגש רב-משתתפים — כל שורה עודפת היא תשלום מלא נוסף`);
    extras.push(...sorted.slice(1));
  }

  console.log(`\n=== ${sets} קבוצות כפולות · ${extras.length} שורות עודפות ===`);

  if (!DO_DELETE) {
    console.log('דוח בלבד. למחיקה בפועל: node scripts/find-duplicate-interactions.cjs --delete');
    return;
  }

  if (extras.length === 0) { console.log('אין מה למחוק.'); return; }
  const ids = extras.map(r => r.id);
  const { error: delErr } = await sb.from('interactions').delete().in('id', ids);
  if (delErr) { console.error('שגיאת מחיקה:', delErr.message); process.exit(1); }
  console.log(`נמחקו ${ids.length} שורות עודפות.`);
})();
