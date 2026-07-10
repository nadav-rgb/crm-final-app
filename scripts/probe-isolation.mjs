// scripts/probe-isolation.mjs
// אימות בידוד-נתונים (migration 0013). מתחבר כמשתמש אמיתי בדיוק כמו האפליקציה (anon key + סיסמה)
// ובודק מה הוא באמת מצליח למשוך ישירות מ-Supabase, בעקיפת קוד ה-React.
// זהו המבחן האמיתי ל-RLS: אם הוא עובד, גם קריאה ישירה מקונסולה לא תחזיר נתונים של אחרים.
//
// שימוש (סיסמאות לא נשמרות בקוד — מועברות בשורת הפקודה):
//   node scripts/probe-isolation.mjs                      → בדיקת אנונימי בלבד
//   node scripts/probe-isolation.mjs <email> <password>   → + בדיקת משתמש מחובר
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = {};
readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
});
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TABLES = ['contacts', 'interactions', 'expenses', 'base_meeting_reports', 'profiles', 'tours', 'notifications'];

async function probeAnon() {
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  console.log('\n=== ANONYMOUS (לא מחובר) — הכל חייב להיות 0 ===');
  let leak = false;
  for (const t of TABLES) {
    const { data } = await sb.from(t).select('*').limit(5);
    const n = data?.length ?? 0;
    if (n > 0) leak = true;
    console.log(`  ${t.padEnd(22)} rows=${n} ${n ? '❌ דליפה!' : '✅'}`);
  }
  return leak;
}

async function probeUser(email, password) {
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: auth, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { console.log(`\nהתחברות נכשלה (${email}): ${error.message}`); return; }

  const { data: me } = await sb.from('profiles')
    .select('activist_code,name,role,project_ids').eq('id', auth.user.id).single();
  console.log(`\n=== ${me?.name} (code=${me?.activist_code}, role=${me?.role}, projects=${JSON.stringify(me?.project_ids)}) ===`);

  for (const t of TABLES) {
    const { data, error: e } = await sb.from(t).select('*');
    if (e) { console.log(`  ${t.padEnd(22)} ERROR ${e.message}`); continue; }
    let extra = '';
    if (['contacts', 'interactions', 'expenses'].includes(t)) {
      const others = data.filter(r => Number(r.activist_id) !== Number(me.activist_code));
      // פעיל: אסור לראות שורות של אחרים. רכז/ראש: מותר, אך רק בפרויקטים שלו.
      const projs = [...new Set(data.map(r => r.project_id))].sort();
      extra = me.role === 'activist'
        ? ` | של פעילים אחרים: ${others.length} ${others.length ? '❌ דליפה!' : '✅'}`
        : ` | פרויקטים: [${projs}]`;
    }
    if (t === 'notifications' && data.length) {
      const mine = data.every(r => String(r.recipient_id) === String(me.activist_code));
      extra = ` | כולן שלו? ${mine ? '✅' : '❌'}`;
    }
    console.log(`  ${t.padEnd(22)} rows=${String(data.length).padEnd(4)}${extra}`);
  }

  // ניסיון הסלמת-הרשאות: לשנות את ה-role של עצמי ל-ceo
  const { data: esc, error: escErr } = await sb.from('profiles')
    .update({ role: 'ceo' }).eq('id', auth.user.id).select();
  const escalated = !escErr && Array.isArray(esc) && esc.length > 0;
  console.log(`  [הסלמת הרשאות] role→ceo: ${escalated ? '❌❌ הצליח! פירצה!' : '✅ נחסם'}`);

  await sb.auth.signOut();
}

await probeAnon();
const [, , email, password] = process.argv;
if (email && password) await probeUser(email, password);
else console.log('\n(לבדיקת משתמש מחובר: node scripts/probe-isolation.mjs <email> <password>)');
