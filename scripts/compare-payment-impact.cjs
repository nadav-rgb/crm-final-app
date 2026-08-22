// scripts/compare-payment-impact.cjs — כמה כסף זז בגלל שינויי המנוע, על נתוני אמת.
// שימוש: node scripts/compare-payment-impact.cjs 2026 8      (שנה, חודש 1-12)
//
// למה: שני שינויים בסבב הזה נוגעים בכסף — סדר הקצאת המכסה (דיווח אלעזר באום) ובונוס
// מצוות אחד לאירוע במקום לרמה (דיווח מוטי גלעד). "הבדיקות עוברות" זו לא תשובה מספקת
// לפני אישור; צריך לראות למי הסכום זז ובכמה.
//
// איך: מושך את lib/paymentCalc.js של ענף main (המנוע שרץ בפרודקשן) לקובץ זמני, מריץ
// את שני המנועים על אותם נתונים בדיוק, ומדפיס טבלת הפרשים. אין כתיבה לשום מקום.
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const BASE_REF = process.env.COMPARE_BASE_REF || 'main';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

// המנוע הישן — נשלף מ-git ונטען כמודול זמני. אם ה-ref לא קיים, נופלים בחן.
function loadBaseEngine() {
  try {
    const src = execFileSync('git', ['show', `${BASE_REF}:lib/paymentCalc.js`], { encoding: 'utf8', maxBuffer: 4 << 20 });
    const tmp = path.join(os.tmpdir(), `paymentCalc.${BASE_REF.replace(/[^\w]/g, '_')}.cjs`);
    fs.writeFileSync(tmp, src);
    return require(tmp);
  } catch (e) {
    console.error(`לא ניתן לטעון את המנוע מ-${BASE_REF}: ${e.message}`);
    process.exit(1);
  }
}

// גזירת בונוסי-מצוות בשיטה הישנה: בונוס לכל *רמה* (Array.from({length: diff})).
// משוכפלת כאן בכוונה — זו ההגדרה ההיסטורית, והיא כבר לא קיימת בקוד החי.
function deriveMitzvotBonusesLegacy(contacts, perLevel) {
  return (contacts || []).flatMap(c => {
    if (!c.activist_id || !Array.isArray(c.mitzvot_history)) return [];
    return c.mitzvot_history.flatMap(h => {
      const from = Number(h?.from ?? 0), to = Number(h?.to ?? 0), diff = to - from;
      if (!h?.mitzva || diff <= 0) return [];
      const d = h.date ? new Date(h.date) : new Date();
      return Array.from({ length: diff }, (_, i) => ({
        activist_id: c.activist_id, contact_id: c.id, contactName: c.name, amount: perLevel,
        desc: `עליה ב${h.mitzva} מרמה ${from + i} ל-${from + i + 1}`,
        month: `${d.getFullYear()}-${d.getMonth()}`,
      }));
    });
  });
}

(async () => {
  const year  = Number(process.argv[2] || new Date().getFullYear());
  const month = Number(process.argv[3] || new Date().getMonth() + 1) - 1; // 0-indexed
  const monthKey = `${year}-${month}`;

  const NEW = require('../lib/paymentCalc.js');
  const OLD = loadBaseEngine();

  const [{ data: interactions }, { data: contacts }, { data: activists }, { data: cancellations }] =
    await Promise.all([
      sb.from('interactions').select('*'),
      sb.from('contacts').select('*'),
      sb.from('activist_directory').select('*'),
      sb.from('bonus_cancellations').select('bonus_key'),
    ]);

  const cancelledKeys = new Set((cancellations || []).map(c => c.bonus_key));

  const newParticipantBonuses = (contacts || [])
    .filter(c => c.activist_id && c.joined_at && (c.source === 'external' || c.referred_by))
    .map(c => { const d = new Date(c.joined_at); return { activist_id: c.activist_id, contact_id: c.id, contactName: c.name, month: `${d.getFullYear()}-${d.getMonth()}` }; });

  const mitzvotNew = NEW.deriveMitzvotBonuses(contacts);
  const mitzvotOld = deriveMitzvotBonusesLegacy(contacts, NEW.MITZVOT_BONUS_PER_LEVEL);

  const paid = (activists || []).filter(a => a.role === 'activist').map(a => ({ ...a, id: Number(a.activist_code) }));

  const rows = [];
  let sumOld = 0, sumNew = 0;

  for (const a of paid) {
    const period = { year, month };
    const oldRes = OLD.calcMonthlyPayment(a.id, interactions, contacts,
      mitzvotOld.filter(b => Number(b.activist_id) === a.id && b.month === monthKey),
      newParticipantBonuses.filter(b => Number(b.activist_id) === a.id && b.month === monthKey),
      OLD.DEFAULTS, cancelledKeys, period);
    const newRes = NEW.calcMonthlyPayment(a.id, interactions, contacts,
      mitzvotNew.filter(b => Number(b.activist_id) === a.id && b.month === monthKey),
      newParticipantBonuses.filter(b => Number(b.activist_id) === a.id && b.month === monthKey),
      NEW.DEFAULTS, cancelledKeys, period);

    sumOld += oldRes.total;
    sumNew += newRes.total;
    if (oldRes.total !== newRes.total) {
      rows.push({ name: a.name, old: oldRes.total, neu: newRes.total, diff: newRes.total - oldRes.total });
    }
  }

  console.log(`\n=== השפעת שינויי המנוע — ${MONTH_NAMES[month]} ${year} (מול ${BASE_REF}) ===\n`);
  if (rows.length === 0) {
    console.log('אין הפרש לאף פעיל בחודש הזה.');
  } else {
    const pad = (s, n) => String(s).padEnd(n, ' ');
    console.log(`${pad('פעיל', 22)}${pad('לפני', 10)}${pad('אחרי', 10)}הפרש`);
    console.log('-'.repeat(52));
    for (const r of rows.sort((x, y) => x.diff - y.diff)) {
      console.log(`${pad(r.name, 22)}${pad(r.old.toLocaleString(), 10)}${pad(r.neu.toLocaleString(), 10)}${r.diff > 0 ? '+' : ''}${r.diff.toLocaleString()}`);
    }
  }
  console.log('-'.repeat(52));
  console.log(`סה"כ כל הפעילים: ${sumOld.toLocaleString()} → ${sumNew.toLocaleString()} (${sumNew - sumOld >= 0 ? '+' : ''}${(sumNew - sumOld).toLocaleString()} ₪)`);
  console.log('\n* הסכומים כאן הם שכר הפעילות והבונוסים בלבד — בלי החזר הוצאות ובלי שכר הדרכת סיורים.\n');
})();
