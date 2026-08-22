// scripts/mark-feedback-reviewed.cjs — סימון דיווחים מעמוד /feedback כ"נסקר".
//
// שימוש:
//   node scripts/mark-feedback-reviewed.cjs                     → דוח מצב, לא כותב כלום
//   node scripts/mark-feedback-reviewed.cjs --round=2026-08      → מסמן את 15 הדיווחים
//                                                                 שטופלו בסבב 23.8.2026
//   node scripts/mark-feedback-reviewed.cjs --id=<uuid> --note="..."  → דיווח בודד
//
// ⚠️ סגירת דיווח היא החלטה של נדב, אחרי שהוא ראה את הפריוויו. הריצה ללא דגלים היא
//    דוח בלבד. הסוכן שכתב את הסקריפט לא מריץ אותו עם דגלי כתיבה.
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

// סבב 2026-08-23 — מיפוי דיווח → הערת סוקר. המפתח הוא תחילת ה-message,
// כדי שהסקריפט יישאר קריא ולא יהיה רשימת uuid-ים אטומה.
const ROUND_2026_08 = [
  ['איתי רוזן 2026-08-14',            'תוקן — מנעול שליחה + אישור-שכפול בטופס דיווח קשר. הכפילויות הקיימות מאותרות ע"י scripts/find-duplicate-interactions.cjs'],
  ['התקדמות במצוות שסומנו לא מופיע',  'תוקן — api/mitzvot/notify: פעמון + Push לניהול הפרויקט ולפעיל עצמו'],
  ['התקדמות במצוות משלם על כל עליית', 'תוקן — בונוס אחד לכל אירוע-עליה במצווה, גם בקפיצה של כמה רמות'],
  ['באזור אישי המספרי קשרים',         'תוקן — "קשרים החודש" עבר לחודש קלנדרי במקום חלון מתגלגל של 30 יום'],
  ['המערכת סופרת את המפגשים לעניין',  'תוקן — המכסה מוקצית לפי ערך הקשר ולא לפי תאריך; התורני תופס משבצת לפני הידידותי'],
  ['כשמוחקים בדיווח הוצאות',          'תוקן — ההוצאות עברו ל-CrmStore, המחיקה מתעדכנת מיד בסכום לתשלום'],
  ['בדיווח פעילות לתשלום יש רובליקה', 'תוקן — תאריך היעד נגזר מתאריך הקשר (שבוע קדימה) ולא מהיום'],
  ['הכנסתי שיחה אחת וזה נרשם כ 3',    'תוקן — היו 3 שורות זהות מלחיצות חוזרות (24.7 00:42). מנעול שליחה + אישור-שכפול'],
  ['ברישום מפגש רב משתתפים צריך',     'תוקן — בורר לקוח עם חיפוש, וכיתוב שמפנה לשדה "משתתפים נוספים" למי שאינו ברשימה'],
  ['לגבי מה שכתבתי שחישבו לי כפול',   'תוקן — 3 שורות מקוריות של אותו מפגש (26.7 13:18) מלחיצות חוזרות. מנעול שליחה + אישור-שכפול'],
  ['2 אירועים רב משתתפים עם 2 לקוחות','תוקן — אותו שורש: לחיצות חוזרות יצרו שורות מקוריות כפולות'],
  ['מגביל תשלום על שיחות עד 4 פעמים', 'תוקן ב-236319c (26.7) — התקרה עלתה ל-10 שיחות לכל לקוח. אומת מחדש ב-scripts/verify-payment-order.cjs'],
  ['אני לא מקבל התראות',              'תשתית ה-Push תוקנה ב-21.7. בנוסף: התראות הפעיל על עצמו נשלחות עכשיו מהשרת ולכן מגיעות למכשיר. לאבחון: כפתור "שלח התראת ניסיון" ב-/notifications'],
  ['המערכת סופרת מפגשים רבי משתתפים', 'תוקן ב-236319c (22.7) — רב-משתתפים הוחרג ממכסת הפרונטליים. אומת מחדש ב-scripts/verify-payment-order.cjs'],
  ['מפגש חמישי תורני עם אותו לקוח',   'תוקן ב-236319c (26.7) — התקרה מול אותו לקוח 6 מפגשים, והתצוגה המקדימה יושרה למנוע. אומת מחדש'],
];

(async () => {
  const { data: reports, error } = await sb
    .from('feedback_reports')
    .select('id, reporter_name, category, status, message, created_at')
    .order('created_at', { ascending: false });
  if (error) { console.error('שגיאת טעינה:', error.message); process.exit(1); }

  const roundArg = process.argv.find(a => a.startsWith('--round='));
  const idArg    = process.argv.find(a => a.startsWith('--id='));
  const noteArg  = process.argv.find(a => a.startsWith('--note='));

  if (!roundArg && !idArg) {
    console.log(`\n=== ${reports.length} דיווחים ===\n`);
    for (const r of reports) {
      console.log(`[${r.status}] ${r.created_at.slice(0, 10)} · ${r.reporter_name} · ${r.category}`);
      console.log(`   ${r.message.replace(/\n/g, ' ').slice(0, 90)}`);
      console.log(`   id: ${r.id}`);
    }
    console.log('\nדוח בלבד. לסימון: --round=2026-08  או  --id=<uuid> --note="..."');
    return;
  }

  const updates = [];
  if (idArg) {
    updates.push({ id: idArg.slice('--id='.length), note: noteArg ? noteArg.slice('--note='.length) : null });
  } else {
    for (const [prefix, note] of ROUND_2026_08) {
      const match = reports.find(r => r.message.startsWith(prefix));
      if (!match) { console.warn(`⚠️ לא נמצא דיווח שמתחיל ב-"${prefix}"`); continue; }
      updates.push({ id: match.id, note });
    }
  }

  for (const u of updates) {
    const { error: upErr } = await sb.from('feedback_reports')
      .update({ status: 'reviewed', reviewer_note: u.note, reviewed_at: new Date().toISOString() })
      .eq('id', u.id);
    console.log(upErr ? `✗ ${u.id}: ${upErr.message}` : `✓ ${u.id} → reviewed`);
  }
  console.log(`\nסומנו ${updates.length} דיווחים.`);
})();
