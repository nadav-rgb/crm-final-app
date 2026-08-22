// scripts/verify-payment-order.cjs — בדיקות מנוע התשלום: סדר הקצאת המכסה + בונוס מצוות.
// שימוש: node scripts/verify-payment-order.cjs
// אין framework בדיקות בפרויקט — זה סקריפט node עצמאי, בדפוס scripts/verify-*.cjs.
// עובד על נתונים סינתטיים בלבד: לא נוגע ב-Supabase ולא דורש .env.local.
const { calcMonthlyPayment, calcConsultantDashboard, deriveMitzvotBonuses, comparePaymentOrder, paidBefore, DEFAULTS } = require('../lib/paymentCalc.js');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'} — ${name}`);
  if (!ok) {
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

const contacts = [{ id: 1, name: 'א' }, { id: 2, name: 'ב' }, { id: 3, name: 'ג' }];
const JULY = { year: 2026, month: 6 }; // month 0-indexed

// ────────────────────────────────────────────────────────────────────────────
// דיווח #5 (אלעזר באום, 2026-07-31) — המכסה נאכלה לפי תאריך, ולכן מפגש ידידותי
// בתחילת החודש "תפס מקום" למפגש תורני בסופו והפעיל הפסיד את ההפרש.
// ────────────────────────────────────────────────────────────────────────────
{
  // מכסה מוקטנת ל-2 פרונטליים, כדי שהתקרה תיבלם בבדיקה קטנה.
  const cfg = { ...DEFAULTS, MONTHLY_CAPS: { phone: 25, frontal: 2, multi: 6 } };
  const base = { activist_id: 7, project_id: 1, type: 'פרונטלי', duration_minutes: 60 };
  const interactions = [
    { ...base, id: 1, contact_id: 1, quality: 'ידידותי', date: '2026-07-02' },
    { ...base, id: 2, contact_id: 2, quality: 'ידידותי', date: '2026-07-03' },
    { ...base, id: 3, contact_id: 3, quality: 'תורני',   date: '2026-07-28' },
  ];
  const r = calcMonthlyPayment(7, interactions, contacts, [], [], cfg, new Set(), JULY);
  check('#5 התורני נכנס למכסה לפני הידידותי', r.total, 300 + 250);
  check('#5 הידידותי הזול הוא זה שנדחק החוצה', r.unpaid.map(u => u.contactId), [2]);
}

// ────────────────────────────────────────────────────────────────────────────
// שתי התקרות ביחד: קשר שנדחה בגלל תקרת-הלקוח לא אמור לאכול משבצת מהתקרה החודשית.
// אחרת סדר-לפי-ערך יכול לשלם *פחות* מהסדר הכרונולוגי: כל 10 המפגשים היקרים מול
// לקוח א' מעובדים ראשונים, 4 מהם נדחים על תקרת-הלקוח — ובכל זאת שורפים 4 משבצות
// חודשיות שחוסמות מפגשים מזכים מול לקוח ב'.
// ────────────────────────────────────────────────────────────────────────────
{
  const mk = (contact, quality, day, id) => ({
    activist_id: 7, project_id: 1, contact_id: contact, type: 'פרונטלי',
    quality, duration_minutes: 60, date: `2026-07-${String(day).padStart(2, '0')}`, id,
  });
  // 10 תורניים מול לקוח 1 ו-10 ידידותיים מול לקוח 2, לסירוגין. תקרות: 15 חודשי, 6 ללקוח.
  const rows = [];
  for (let k = 0; k < 10; k++) {
    rows.push(mk(1, 'תורני',   k + 1, 100 + k));
    rows.push(mk(2, 'ידידותי', k + 1, 200 + k));
  }
  const r = calcMonthlyPayment(7, rows, contacts, [], [], DEFAULTS, new Set(), JULY);
  // 6 מזכים מול כל לקוח (תקרת הלקוח), 12 סה"כ — מתחת לתקרה החודשית של 15.
  // בתוספת בונוס-לימוד-6 על ששת התורניים מול לקוח 1.
  check('שתי תקרות: מפגש שנדחה על תקרת-הלקוח לא אוכל מהתקרה החודשית',
    r.total, 6 * 300 + 6 * 250 + DEFAULTS.LEARNING_BONUS[6]);
  check('שתי תקרות: אף מפגש לא נדחה בגלל התקרה החודשית',
    r.unpaid.filter(u => /חודשית/.test(u.reason)).length, 0);
}

// ────────────────────────────────────────────────────────────────────────────
// דיווח #3 (מוטי גלעד, 2026-08-02) — בונוס מצוות שולם על כל רמה, גם כשהעליה
// נרשמה בשמירה אחת. נבדק מול deriveMitzvotBonuses עצמה — אותה פונקציה שהאפליקציה
// וסקריפטי האימות צורכים, לא עותק של הלוגיקה.
// ────────────────────────────────────────────────────────────────────────────
{
  const jumper = {
    id: 9, name: 'קופץ', activist_id: 7,
    mitzvot_history: [{ mitzva: 'ציצית', from: 0, to: 2, date: '2026-07-05' }],
  };
  check('#3 קפיצה של 2 רמות = בונוס אחד', deriveMitzvotBonuses([jumper]).length, 1);

  const baseline = {
    id: 10, name: 'תיעוד מצב', activist_id: 7,
    mitzvot_history: [
      { mitzva: 'שבת',   from: 0, to: 3, date: '2026-07-30' },
      { mitzva: 'כיפה',  from: 0, to: 2, date: '2026-07-30' },
      { mitzva: 'לימוד', from: 0, to: 4, date: '2026-07-30' },
    ],
  };
  check('#3 שלוש מצוות בשמירה אחת = שלושה בונוסים (לא תשעה)', deriveMitzvotBonuses([baseline]).length, 3);

  // ירידה/אי-שינוי לא מזכים כלל.
  const noRise = {
    id: 11, name: 'ללא שינוי', activist_id: 7,
    mitzvot_history: [{ mitzva: 'שבת', from: 2, to: 2, date: '2026-07-30' }, { mitzva: 'כיפה', from: 3, to: 1, date: '2026-07-30' }],
  };
  check('#3 ירידה או אי-שינוי אינם מזכים', deriveMitzvotBonuses([noRise]).length, 0);
}

// ────────────────────────────────────────────────────────────────────────────
// דיווחים #12/#14/#15 — תוקנו ב-236319c. הבדיקות כאן מוודאות שהתיקון עומד גם
// אחרי שינוי סדר ההקצאה, ולא מסתמכות על הודעת ה-commit.
// ────────────────────────────────────────────────────────────────────────────
{
  // #14 (אלעזר באום, 22.7) — מפגש רב-משתתפים לא נספר במכסת הפרונטליים.
  const capCfg = { ...DEFAULTS, MONTHLY_CAPS: { phone: 25, frontal: 1, multi: 6 } };
  const rows = [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-02' },
    { activist_id: 7, project_id: 1, id: 2, contact_id: 2, type: 'פרונטלי', quality: 'תורני',      duration_minutes: 60, date: '2026-07-03' },
  ];
  check('#14 רב-משתתפים לא אוכל ממכסת הפרונטליים',
    calcMonthlyPayment(7, rows, contacts, [], [], capCfg, new Set(), JULY).total, 300 + 300);

  // #12 (נחמיה גרטש, 26.7) — תקרת שיחות מול לקוח רגיל = 10, לא 4.
  check('#12 תקרת שיחות ללקוח רגיל = 10', DEFAULTS.PER_CONTACT_CAPS.regular.phone, 10);

  // #15 (מוטי גלעד, 21.7) — 6 מפגשים פרונטליים מול אותו לקוח מזכים, השביעי לא.
  const sameContact = Array.from({ length: 7 }, (_, k) => ({
    activist_id: 7, project_id: 1, id: 10 + k, contact_id: 1, type: 'פרונטלי', quality: 'תורני',
    duration_minutes: 60, date: `2026-07-${String(k + 1).padStart(2, '0')}`,
  }));
  const same = calcMonthlyPayment(7, sameContact, contacts, [], [], DEFAULTS, new Set(), JULY);
  // 6×300 על המפגשים + 850 בונוס-לימוד-6 (LEARNING_BONUS[6]) שנפתח בדיוק במפגש השישי.
  check('#15 6 מפגשים מזכים מול אותו לקוח, השביעי לא', [same.total, same.unpaid.length], [6 * 300 + 850, 1]);
}

// ────────────────────────────────────────────────────────────────────────────
// דיווחים #8/#10/#11 — שורה נגזרת ממפגש רב-משתתפים לא מזכה ולא אוכלת מכסה.
// ────────────────────────────────────────────────────────────────────────────
{
  const meetingId = 500;
  const rows = [
    { activist_id: 7, project_id: 1, id: meetingId, contact_id: 1, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }] } },
    { activist_id: 7, project_id: 1, id: meetingId + 1, contact_id: 2, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }], derived_from: meetingId } },
    { activist_id: 7, project_id: 1, id: meetingId + 2, contact_id: 3, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }], derived_from: meetingId } },
  ];
  const r = calcMonthlyPayment(7, rows, contacts, [], [], DEFAULTS, new Set(), JULY);
  check('#10/#11 מפגש רב-משתתפים עם 3 לקוחות = תשלום אחד', r.total, 300);
  check('#10/#11 השורות הנגזרות לא מופיעות כ"לא זוכה"', r.unpaid.length, 0);
}

// ────────────────────────────────────────────────────────────────────────────
// comparePaymentOrder חייב להיות סדר מלא (total order). קומפרטור שמחזיר NaN, או
// שאינו טרנזיטיבי, מפרק את Array.sort **בשקט** — והתוצאה היא סכומי שכר שמשתנים
// בין הרצה להרצה בלי שאף אחד ישים לב.
// ⚠️ `new Date(null)` הוא 1970 ולא Invalid Date. בלי בדיקת falsy מפורשת, שורה בלי
// תאריך קופצת לראש התור ותופסת משבצת ראשונה במכסה.
// ────────────────────────────────────────────────────────────────────────────
{
  const P = (q, d, id) => ({ type: 'פרונטלי', quality: q, date: d, id });
  check('סדר: תורני (300) לפני ידידותי (250)',
    comparePaymentOrder(P('תורני', '2026-07-20', 2), P('ידידותי', '2026-07-01', 1)) < 0, true);
  check('סדר: בשוויון מחיר — התאריך המוקדם קודם',
    comparePaymentOrder(P('תורני', '2026-07-01', 5), P('תורני', '2026-07-20', 1)) < 0, true);
  check('סדר: בשוויון מלא — id שובר',
    comparePaymentOrder(P('תורני', '2026-07-01', 1), P('תורני', '2026-07-01', 2)) < 0, true);
  check('סדר: אנטי-סימטריה',
    comparePaymentOrder(P('תורני', '2026-07-01', 1), P('ידידותי', '2026-07-01', 2)) ===
    -comparePaymentOrder(P('ידידותי', '2026-07-01', 2), P('תורני', '2026-07-01', 1)), true);

  const broken = [null, '', undefined, 'לא-תאריך'];
  check('סדר: תאריך חסר/לא תקין נדחק לסוף',
    broken.every(d => comparePaymentOrder(P('תורני', d, 1), P('תורני', '2026-07-01', 2)) > 0), true);
  check('סדר: לעולם לא מחזיר NaN',
    broken.every(x => broken.every(y => !Number.isNaN(comparePaymentOrder(P('תורני', x, 1), P('תורני', y, 2))))), true);

  // טרנזיטיביות על כל השלשות במדגם שמכסה מחיר × תאריך (כולל פגומים) × id.
  const pool = [];
  for (const q of ['תורני', 'ידידותי']) for (const d of ['2026-07-01', '2026-07-05', null, '']) for (const id of [1, 2]) pool.push(P(q, d, id));
  let violations = 0;
  for (const a of pool) for (const b of pool) for (const c of pool) {
    if (Math.sign(comparePaymentOrder(a, b)) <= 0 &&
        Math.sign(comparePaymentOrder(b, c)) <= 0 &&
        Math.sign(comparePaymentOrder(a, c)) > 0) violations++;
  }
  check(`סדר: טרנזיטיביות (${pool.length ** 3} שלשות)`, violations, 0);
}

// ────────────────────────────────────────────────────────────────────────────
// שלושת המסכים חייבים להסכים: המנוע (calcMonthlyPayment), מוני הדשבורד
// (calcConsultantDashboard) והתצוגה המקדימה בטופס (paidBefore). כשהתקרה עברה לספור
// רק מפגשים ששולמו, ספירה עצמאית בשני האחרונים החלה לסתור את המנוע: הדשבורד הציג
// "חריגה" והטופס הזהיר "לא יזוכה" — בזמן שהמנוע עוד שילם על המפגש הבא.
// ────────────────────────────────────────────────────────────────────────────
{
  // לקוח 1 עם 10 פרונטליים תורניים (רק 6 מזכים — תקרת לקוח), ועוד 8 לקוחות עם אחד כל אחד.
  // סה"כ 18 מפגשים שדווחו, 14 מזכים — כלומר עוד משבצת פנויה מתוך 15.
  const rows = [];
  for (let k = 0; k < 10; k++) {
    rows.push({ activist_id: 7, project_id: 1, id: 300 + k, contact_id: 1, type: 'פרונטלי',
      quality: 'תורני', duration_minutes: 60, date: `2026-07-${String(k + 1).padStart(2, '0')}` });
  }
  for (let k = 0; k < 8; k++) {
    rows.push({ activist_id: 7, project_id: 1, id: 400 + k, contact_id: 10 + k, type: 'פרונטלי',
      quality: 'תורני', duration_minutes: 60, date: `2026-07-${String(k + 11).padStart(2, '0')}` });
  }
  const many = Array.from({ length: 20 }, (_, k) => ({ id: k + 1, name: `לקוח ${k + 1}` }));
  const dash = calcConsultantDashboard(7, rows, many, [], [], DEFAULTS, new Set(), JULY);
  const paidFrontal = calcMonthlyPayment(7, rows, many, [], [], DEFAULTS, new Set(), JULY)
    .breakdown.filter(b => b.type === 'קשר').length;

  check('מוני הדשבורד סופרים מה ששולם, לא מה שדווח', dash.counters.frontal.done, paidFrontal);
  check('מונה הדשבורד לא מציג "חריגה" בזמן שיש עוד משבצת',
    dash.counters.frontal.done < dash.counters.frontal.cap, true);

  // התצוגה המקדימה: מפגש חדש מול לקוח חדש, כשעדיין יש משבצת פנויה — חייב לצאת מזכה.
  const draft = { type: 'פרונטלי', quality: 'תורני', date: '2026-07-25', id: Number.MAX_SAFE_INTEGER };
  const before = paidBefore(draft, rows, many, DEFAULTS);
  check('paidBefore מחזיר רק את המזכים (14 מתוך 18 שדווחו)', before.length, paidFrontal);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
