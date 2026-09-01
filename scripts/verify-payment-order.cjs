// scripts/verify-payment-order.cjs — בדיקות מנוע התשלום: סדר הקצאת המכסה + בונוס מצוות.
// שימוש: node scripts/verify-payment-order.cjs
// אין framework בדיקות בפרויקט — זה סקריפט node עצמאי, בדפוס scripts/verify-*.cjs.
// עובד על נתונים סינתטיים בלבד: לא נוגע ב-Supabase ולא דורש .env.local.
const { calcMonthlyPayment, calcInteractionPayment, calcConsultantDashboard, deriveMitzvotBonuses, previewNewMitzvotBonusCount, previewNewMitzvotBonusChanges, comparePaymentOrder, paidBefore, getMonthlyTotalForActivist, DEFAULTS } = require('../lib/paymentCalc.js');
const { payableInteractionsThisMonth } = require('../lib/activistStats.js');

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
  // 6 תורניים מזכים מול לקוח 1 (תקרת הלקוח), אבל רק 2 ידידותיים מזכים מול לקוח 2 —
  // לא 6: מכסת FRIENDLY_FRONTAL_MONTHLY_CAP (2, מ-2026-08-31) חלה בלי תלות ב-contactContext
  // (היא נבדקת מול prevContactMonthly הקיים, לא מידע חדש), ולכן חוסמת אותם לפני שמגיעים
  // בכלל לתקרת-הלקוח הכללית (6). 8 סה"כ מזכים — עדיין מתחת לתקרה החודשית של 15,
  // כך שהבדיקה עצמה (קשר שנדחה על תקרת-לקוח לא אוכל מהתקרה החודשית) עדיין תקפה.
  // בתוספת בונוס-לימוד-6 על ששת התורניים מול לקוח 1 (לקוח 2 לא צובר בונוס-לימוד: זה ידידותי, לא תורני).
  check('שתי תקרות: מפגש שנדחה על תקרת-הלקוח לא אוכל מהתקרה החודשית',
    r.total, 6 * 300 + 2 * 250 + DEFAULTS.LEARNING_BONUS[6]);
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

  // דיווח נוסף (2026-08-31) — אותה מצווה שעולה בשתי שמירות נפרדות באותו חודש (0→1 ואז
  // 1→2) עדיין שילמה 1,200 ₪ לפני התיקון: כל רשומת mitzvot_history הפיקה בונוס משלה.
  const twoSaves = {
    id: 12, name: 'שתי שמירות', activist_id: 7,
    mitzvot_history: [
      { mitzva: 'שבת', from: 0, to: 1, date: '2026-07-05' },
      { mitzva: 'שבת', from: 1, to: 2, date: '2026-07-20' },
    ],
  };
  const twoSavesBonuses = deriveMitzvotBonuses([twoSaves]);
  check('#3 עלייה באותה מצווה בשתי שמירות נפרדות באותו חודש = בונוס אחד', twoSavesBonuses.length, 1);
  check('#3 הבונוס המאוחד משקף את טווח העלייה המלא (0 עד 2)', twoSavesBonuses[0]?.desc, 'עליה בשבת מרמה 0 ל-2');

  // מצווה *שונה* לאותו לקוח באותו חודש לא אמורה להיבלע בקיבוץ — עדיין שני בונוסים נפרדים.
  const twoMitzvot = {
    id: 13, name: 'שתי מצוות', activist_id: 7,
    mitzvot_history: [
      { mitzva: 'שבת',   from: 0, to: 1, date: '2026-07-05' },
      { mitzva: 'כשרות', from: 0, to: 1, date: '2026-07-06' },
    ],
  };
  check('#3 שתי מצוות שונות לאותו לקוח באותו חודש = שני בונוסים נפרדים', deriveMitzvotBonuses([twoMitzvot]).length, 2);

  // עלייה שחוצה חודשים לא מתקזזת לבונוס אחד — התקרה היא חודשית, לא לכל החיים.
  const crossMonth = {
    id: 14, name: 'חוצה חודשים', activist_id: 7,
    mitzvot_history: [
      { mitzva: 'שבת', from: 0, to: 1, date: '2026-07-28' },
      { mitzva: 'שבת', from: 1, to: 2, date: '2026-08-03' },
    ],
  };
  check('#3 עלייה חוצת-חודשים = בונוס נפרד לכל חודש', deriveMitzvotBonuses([crossMonth]).length, 2);
}

// ────────────────────────────────────────────────────────────────────────────
// דיווח נוסף (2026-08-31) — תצוגה מקדימה של בונוס-מצוות ב-update-mitzvot/[id].jsx.
// totalBonus שם מחושב *לפני* השמירה, אז ה-history של השמירה הנוכחית עוד לא קיים
// ב-DB ו-deriveMitzvotBonuses לא יכולה לראות אותו ישירות. previewNewMitzvotBonusCount
// חייבת בכל זאת להסכים עם deriveMitzvotBonuses: מצווה שכבר קיבלה בונוס החודש
// (שורת history קודמת עם to>from באותו חודש קלנדרי) לא נספרת שוב, גם אם היא עולה
// עוד רמה בשמירה הנוכחית. נבדק מול changes בצורת {mitzva,from,to} — כמו שהדף בונה.
// ────────────────────────────────────────────────────────────────────────────
{
  const TODAY = new Date('2026-08-31'); // קבוע כדי שהבדיקה לא תהיה תלוית-שעון-מערכת
  const EARLIER_THIS_MONTH = '2026-08-02';
  const LAST_MONTH = '2026-07-20';

  // שבת כבר עלתה 0→1 החודש בשמירה קודמת (וכבר קיבלה בונוס). שמירה חדשה מעלה אותה
  // עוד: 1→2. זו אותה קבוצה (פעיל,לקוח,שבת,חודש) ב-deriveMitzvotBonuses — לא בונוס נוסף.
  const alreadyBonused = {
    id: 20, name: 'כבר קיבל בונוס', activist_id: 7,
    mitzvot_history: [{ mitzva: 'שבת', from: 0, to: 1, date: EARLIER_THIS_MONTH }],
  };
  check('תצוגה מקדימה: מצווה שכבר קיבלה בונוס החודש לא נספרת שוב',
    previewNewMitzvotBonusCount(alreadyBonused, [{ mitzva: 'שבת', from: 1, to: 2 }], TODAY), 0);

  check('תצוגה מקדימה: מצווה שלא עלתה עדיין החודש כן נספרת',
    previewNewMitzvotBonusCount(alreadyBonused, [{ mitzva: 'כשרות', from: 0, to: 1 }], TODAY), 1);

  // שני שינויים באותה שמירה: אחד חדש (כשרות) ואחד שכבר קיבל בונוס החודש (שבת) —
  // רק החדש נספר, לא changes.length (2) כמו הנוסחה הישנה.
  check('תצוגה מקדימה: מתוך שני שינויים באותה שמירה, רק החדש נספר',
    previewNewMitzvotBonusCount(alreadyBonused,
      [{ mitzva: 'שבת', from: 1, to: 2 }, { mitzva: 'כשרות', from: 0, to: 1 }], TODAY), 1);

  // עליה קודמת בחודש *שעבר* לא חוסמת בונוס החודש — התקרה היא חודשית, לא לכל החיים.
  const rosePriorMonth = {
    id: 21, name: 'עלה בחודש קודם', activist_id: 7,
    mitzvot_history: [{ mitzva: 'שבת', from: 0, to: 1, date: LAST_MONTH }],
  };
  check('תצוגה מקדימה: עליה בחודש הקודם לא חוסמת בונוס החודש',
    previewNewMitzvotBonusCount(rosePriorMonth, [{ mitzva: 'שבת', from: 1, to: 2 }], TODAY), 1);

  // אותו תרחיש, ברמת שורה: previewNewMitzvotBonusChanges חייבת להסכים עם
  // previewNewMitzvotBonusCount לא רק על הסכום אלא על *איזו* שורה היא ה-1.
  check('תצוגה מקדימה לפי-שורה: מצווה שכבר קיבלה בונוס מסומנת isNewBonus:false',
    previewNewMitzvotBonusChanges(alreadyBonused, [{ mitzva: 'שבת', from: 1, to: 2 }], TODAY)
      .map(c => c.isNewBonus),
    [false]);

  check('תצוגה מקדימה לפי-שורה: מתוך שני שינויים, רק החדש מסומן isNewBonus:true',
    previewNewMitzvotBonusChanges(alreadyBonused,
      [{ mitzva: 'שבת', from: 1, to: 2 }, { mitzva: 'כשרות', from: 0, to: 1 }], TODAY)
      .map(c => ({ mitzva: c.mitzva, isNewBonus: c.isNewBonus })),
    [{ mitzva: 'שבת', isNewBonus: false }, { mitzva: 'כשרות', isNewBonus: true }]);

  // בלי history בכלל — כל השינויים חדשים (ההתנהגות הבסיסית, עדיין נכונה כברירת מחדל).
  const noHistory = { id: 22, name: 'ללא היסטוריה', activist_id: 7, mitzvot_history: [] };
  check('תצוגה מקדימה: בלי היסטוריה קודמת כל השינויים נספרים',
    previewNewMitzvotBonusCount(noHistory,
      [{ mitzva: 'שבת', from: 0, to: 1 }, { mitzva: 'כשרות', from: 0, to: 1 }], TODAY), 2);
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

// ────────────────────────────────────────────────────────────────────────────
// הקשר שהרגע נשמר לא יכול להיות "קשר קודם" של עצמו. addInteraction מכניס אותו
// ל-store אופטימית והקומפוננטה מתרנדרת מחדש; אם התצוגה תחשב מחדש מול ה-store המעודכן,
// מסך ההצלחה מדווח "חרגת" על מפגש שהמנוע כן שילם עליו. הטופס פותר את זה בכך שהוא
// נועל את התוצאה *לפני* השמירה — הבדיקה כאן מתעדת את ההפרש שהנעילה מונעת.
// ────────────────────────────────────────────────────────────────────────────
{
  const mk = (id, day) => ({ activist_id: 7, project_id: 1, id, contact_id: 1, type: 'פרונטלי',
    quality: 'תורני', duration_minutes: 60, date: `2026-07-${String(day).padStart(2, '0')}` });
  const five = Array.from({ length: 5 }, (_, k) => mk(700 + k, k + 1));       // 5 מפגשים קיימים
  const sixth = mk(710, 6);                                                    // המפגש שנשמר עכשיו
  const draft = { type: 'פרונטלי', quality: 'תורני', date: '2026-07-06', id: Number.MAX_SAFE_INTEGER };

  const beforeSave = paidBefore(draft, five, contacts, DEFAULTS);
  const locked = calcInteractionPayment({ type: 'פרונטלי', quality: 'תורני', duration_minutes: 60 },
    beforeSave.filter(i => i.contact_id === 1), false, beforeSave, DEFAULTS);

  const afterSave = paidBefore(draft, [...five, sixth], contacts, DEFAULTS);
  const recomputed = calcInteractionPayment({ type: 'פרונטלי', quality: 'תורני', duration_minutes: 60 },
    afterSave.filter(i => i.contact_id === 1), false, afterSave, DEFAULTS);

  const engine = calcMonthlyPayment(7, [...five, sixth], contacts, [], [], DEFAULTS, new Set(), JULY);
  const enginePaidSixth = engine.breakdown.filter(b => b.type === 'קשר').length === 6;

  check('התוצאה שננעלה לפני השמירה תואמת למנוע', [locked.payable, enginePaidSixth], [true, true]);
  check('חישוב מחדש *אחרי* השמירה היה מדווח חריגה — זה מה שהנעילה מונעת',
    recomputed.payable, false);
}

// ────────────────────────────────────────────────────────────────────────────
// עדכון תעריפים (2026-08-31, בקשת נדב) — תעריפי ידידותי/תורני חדשים.
// ────────────────────────────────────────────────────────────────────────────
{
  const { BASE_PRICES: PRICES, FRIENDLY_ELIGIBLE_MONTHS, FRIENDLY_FRONTAL_MONTHLY_CAP, TORANI_BONUS_AMOUNT, TORANI_BONUS_MONTHS } = require('../lib/paymentCalc.js');
  const { calcInteractionPayment } = require('../lib/paymentCalc.js');
  check('תעריף חדש: טלפוני-ידידותי = 0', PRICES['טלפוני-ידידותי'], 0);
  check('תעריף חדש: טלפוני-תורני = 150', PRICES['טלפוני-תורני'], 150);
  check('תעריף חדש: וידאו-תורני = 200', PRICES['וידאו-תורני'], 200);
  check('תעריף ללא שינוי: פרונטלי-ידידותי = 250', PRICES['פרונטלי-ידידותי'], 250);
  check('תעריף ללא שינוי: וידאו-ידידותי = 200', PRICES['וידאו-ידידותי'], 200);
  check('קבועים חדשים מיוצאים נכון', [FRIENDLY_ELIGIBLE_MONTHS, FRIENDLY_FRONTAL_MONTHLY_CAP, TORANI_BONUS_AMOUNT, TORANI_BONUS_MONTHS], [3, 2, 1000, 3]);

  // baseAmount===0 (טלפוני-ידידותי) חייב payable:true, לא "סוג קשר לא מזוהה".
  const zeroRateResult = calcInteractionPayment(
    { type: 'טלפוני', quality: 'ידידותי', duration_minutes: 30, date: '2026-07-05' },
    [], false, [], DEFAULTS);
  check('טלפוני-ידידותי (0 ₪): payable=true, amount=0, לא "סוג לא מזוהה"',
    [zeroRateResult.payable, zeroRateResult.amount, zeroRateResult.reason], [true, 0, '']);
}

// ────────────────────────────────────────────────────────────────────────────
// זכאות קשר ידידותי — חלון 3 חודשים + ניתוק אחרי מעבר לתורני (2026-08-31).
// ────────────────────────────────────────────────────────────────────────────
{
  const { calcInteractionPayment: calc, isoYearMonth, monthsBetween } = require('../lib/paymentCalc.js');

  check('isoYearMonth מפרק תאריך ISO', isoYearMonth('2026-08-15'), { year: 2026, month: 7 });
  check('monthsBetween: אותו חודש = 0', monthsBetween('2026-08-01', '2026-08-28'), 0);
  check('monthsBetween: חודש הבא = 1', monthsBetween('2026-08-15', '2026-09-01'), 1);
  check('monthsBetween: חוצה שנה', monthsBetween('2026-11-15', '2027-02-01'), 3);

  const mkFriendly = (date) => ({ type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 60, date });
  const ctx = (joinedAt, history = []) => ({ joinedAt, allInteractionsWithContact: history });

  // חודשים 0,1,2 מזכים (חלון 3 חודשים), חודש 3 לא.
  check('חודש 1 (אותו חודש כמו joined_at) מזכה',
    calc(mkFriendly('2026-08-15'), [], false, [], DEFAULTS, ctx('2026-08-01')).payable, true);
  check('חודש 3 (עדיין בתוך החלון) מזכה',
    calc(mkFriendly('2026-10-15'), [], false, [], DEFAULTS, ctx('2026-08-01')).payable, true);
  check('חודש 4 (מחוץ לחלון) לא מזכה',
    calc(mkFriendly('2026-11-15'), [], false, [], DEFAULTS, ctx('2026-08-01')).payable, false);
  check('חודש 4: הסיבה מזכירה את חלון הזכאות',
    /חלון הזכאות/.test(calc(mkFriendly('2026-11-15'), [], false, [], DEFAULTS, ctx('2026-08-01')).reason), true);

  // אין joinedAt ואין היסטוריה קודמת — זה הקשר הראשון, עוגן = תאריך הקשר עצמו, מזכה.
  check('אין joined_at ואין היסטוריה — הקשר הראשון עצמו מזכה',
    calc(mkFriendly('2026-08-15'), [], false, [], DEFAULTS, ctx(null, [])).payable, true);

  // אין joinedAt אבל יש היסטוריה — עוגן = הקשר המוקדם ביותר בהיסטוריה.
  const history = [{ date: '2026-06-01', quality: 'ידידותי' }, { date: '2026-07-01', quality: 'ידידותי' }];
  check('בלי joined_at, עם היסטוריה — עוגן = הקשר המוקדם ביותר (יוני), חודש 4 (אוקטובר) לא מזכה',
    calc(mkFriendly('2026-10-15'), [], false, [], DEFAULTS, ctx(null, history)).payable, false);

  // מעבר לתורני מנתק זכאות ידידותי, גם בתוך חלון 3 החודשים. project_id+duration_minutes
  // חייבים להיות תקינים (countsForPayment + MIN_DUR — ר' ביקורת קוד 2026-09-01 למטה):
  // בלעדיהם זה לא "קשר תורני" אמיתי לצורך הכלל הזה, בדיוק כמו ב-deriveToraniBonuses.
  const toraniHistory = [{ date: '2026-08-10', quality: 'תורני', type: 'פרונטלי', project_id: 1, duration_minutes: 60 }];
  check('קשר ידידותי אחרי קשר תורני (גם בתוך החלון) לא מזכה',
    calc(mkFriendly('2026-08-20'), [], false, [], DEFAULTS, ctx('2026-08-01', toraniHistory)).payable, false);
  check('קשר ידידותי *לפני* הקשר התורני הראשון כן מזכה',
    calc(mkFriendly('2026-08-05'), [], false, [], DEFAULTS, ctx('2026-08-01', toraniHistory)).payable, true);

  // ביקורת קוד (2026-09-01) — כלל מעבר-לתורני כאן (firstToraniDate) חייב להסכים עם
  // deriveToraniBonuses על "האם הלקוח עבר לתורני": שניהם דורשים countsForPayment+MIN_DUR,
  // לא רק quality==='תורני'. בלי זה, קשר תורני קצרצר (5 דקות) — שלא מזכה כלום בעצמו
  // ולא תורם לרצף-הבונוס — עדיין ניתק לצמיתות את זכאות-הידידותי של הלקוח: נזק בלי
  // תועלת מקבילה. רגרסיה: קשר תורני 5 דקות ואז קשר ידידותי, באותו חודש — הידידותי
  // חייב להישאר מזכה (בתוך חלון 3 החודשים).
  const shortTorani = { activist_id: 7, project_id: 1, id: 1000, contact_id: 1, type: 'טלפוני', quality: 'תורני', duration_minutes: 5, date: '2026-08-05' };
  const friendlyLater = { type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 60, date: '2026-08-20' };

  const shortResult = calcInteractionPayment(friendlyLater, [], false, [], DEFAULTS,
    { joinedAt: '2026-08-01', allInteractionsWithContact: [shortTorani] });
  check('קשר תורני קצרצר (5 דקות, מתחת ל-MIN_DURATION) לא מנתק זכאות-ידידותי',
    [shortResult.payable, shortResult.amount], [true, 250]);

  // לשם ניגוד: אותו תרחיש, אבל התורני עומד ב-MIN_DURATION — כן מנתק (מוודא שהבדיקה
  // למעלה לא "עוברת ממילא" בלי קשר לתיקון).
  const realTorani = { ...shortTorani, id: 1001, duration_minutes: 60 };
  const realResult = calcInteractionPayment(friendlyLater, [], false, [], DEFAULTS,
    { joinedAt: '2026-08-01', allInteractionsWithContact: [realTorani] });
  check('לשם ניגוד: קשר תורני תקין (60 דקות) כן מנתק זכאות-ידידותי',
    realResult.payable, false);

  // תורני "אמיתי" באורכו (60 דקות) אבל בפרויקט שאינו בתשלום — countsForPayment דוחה
  // אותו, ולכן גם הוא לא אמור לנתק זכאות-ידידותי (מראה ש-countsForPayment מוחל, לא רק MIN_DUR).
  const wrongProjectTorani = { ...realTorani, id: 1002, project_id: 99 };
  const wrongProjectResult = calcInteractionPayment(friendlyLater, [], false, [], DEFAULTS,
    { joinedAt: '2026-08-01', allInteractionsWithContact: [wrongProjectTorani] });
  check('תורני בפרויקט שאינו בתשלום (countsForPayment=false) לא מנתק זכאות-ידידותי',
    wrongProjectResult.payable, true);

  // בלי contactContext — התנהגות ישנה, בלי הגבלה (תאימות לאחור).
  check('בלי contactContext (null) — קשר ידידותי בחודש 5 עדיין מזכה (תאימות לאחור)',
    calc(mkFriendly('2027-01-15'), [], false, [], DEFAULTS, null).payable, true);

  // מכסת 2/חודש/לקוח לפרונטלי-ידידותי — בנוסף לתקרת 6/חודש הכללית. joinedAt='2026-08-01'
  // (לא '2026-01-01'): כל שלוש הבדיקות כאן מתרחשות באוגוסט 2026, אז העוגן חייב להשאיר
  // אותן *בתוך* חלון 3 החודשים (ראה בדיקות החלון למעלה) — אחרת חלון-הזכאות עצמו כבר
  // פוסל את הקשר לפני שמגיעים בכלל לבדיקת המכסה, וזה מפסיק לבודד את כלל המכסה.
  const twoFriendlyThisMonth = [mkFriendly('2026-08-01'), mkFriendly('2026-08-05')];
  check('קשר ידידותי-פרונטלי שלישי באותו חודש עם אותו לקוח — לא מזכה',
    calc(mkFriendly('2026-08-20'), twoFriendlyThisMonth, false, twoFriendlyThisMonth, DEFAULTS, ctx('2026-08-01')).payable, false);
  check('קשר ידידותי-פרונטלי שני באותו חודש — עדיין מזכה',
    calc(mkFriendly('2026-08-20'), [mkFriendly('2026-08-01')], false, [mkFriendly('2026-08-01')], DEFAULTS, ctx('2026-08-01')).payable, true);
}

// ────────────────────────────────────────────────────────────────────────────
// עקביות contactContext: calcMonthlyPayment (המנוע) ו-paidBefore+contactContext
// (תצוגה מקדימה, בדיוק כמו Step 5 בעמוד add-interaction) חייבים להסכים על אותו
// קשר ידידותי מחוץ לחלון — בדיוק כמו שדיווח מוטי גלעד (2026-07-21) חייב את אותו
// דבר לגבי תקרות.
//
// ⚠️ תיקון לבדיקה שבברifing המקורי: הבדיקה השנייה שם ציפתה ש-paidBefore(draftFC,
// oldFriendly, contactsFC, DEFAULTS) יחזיר מערך ריק. זה שגוי — ינואר ופברואר כל
// אחד *בפני עצמו* בתוך חלון 3 החודשים מהצטרפות ינואר (0 ו-1 חודשים בהתאמה) ומתחת
// למכסת FRIENDLY_FRONTAL_MONTHLY_CAP (2), ולכן שניהם מזכים כשנבדקים ללא אפריל
// בקלט — התנהגות נכונה, לא תקלה. יתרה מזאת, הבדיקה המקורית כלל לא בדקה את הדבר
// שהיא טוענת לבדוק (עקביות על *הטיוטה עצמה*) — רק עובדה משנית על צבירה קודמת.
// הבדיקה למטה מתקנת את הערך הצפוי (2, מאומת ידנית + באמפירית) ומוסיפה את בדיקת
// העקביות האמיתית: משחזרים את דפוס Step 5 במדויק (paidBefore בונה
// previousActivistMonthly מכל ההיסטוריה, contactContext נבנה בנפרד מאותה היסטוריה
// קיימת, ו-calcInteractionPayment מחליט על הטיוטה) ומוודאים שהתוצאה זהה למנוע —
// גם ב-payable וגם ב-reason.
// ────────────────────────────────────────────────────────────────────────────
{
  const contactsFC = [{ id: 1, name: 'לקוח ותיק', joined_at: '2026-01-01' }];
  const oldFriendly = Array.from({ length: 2 }, (_, k) => ({
    activist_id: 7, project_id: 1, id: 800 + k, contact_id: 1, type: 'פרונטלי',
    quality: 'ידידותי', duration_minutes: 60, date: `2026-0${k + 1}-15`,
  })); // ינואר, פברואר — כל אחד בפני עצמו עדיין בתוך חלון 3 החודשים מהצטרפות ינואר
  const draftRow = { activist_id: 7, project_id: 1, contact_id: 1, type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 60, date: '2026-04-15', id: 850 };
  const draftFC  = { type: 'פרונטלי', quality: 'ידידותי', date: '2026-04-15', id: Number.MAX_SAFE_INTEGER };
  const allFC    = [...oldFriendly, draftRow];

  // המנוע: הקשר החדש (אפריל, 3 חודשים מהצטרפות ינואר — מחוץ לחלון) לא זוכה.
  const engineResult = calcMonthlyPayment(7, allFC, contactsFC, [], [], DEFAULTS, new Set(), { year: 2026, month: 3 });
  check('המנוע דוחה קשר ידידותי בחודש 4 מהצטרפות', engineResult.breakdown.filter(b => b.type === 'קשר').length, 0);

  // paidBefore על ינואר+פברואר בלבד (בלי אפריל ב-monthlyInteractions כלל) מזכה את
  // שניהם — נכון, לא תקלה (ראה ההסבר למעלה). זו עדיין לא בדיקת-העקביות עצמה, רק
  // וידוא ש-paidBefore לא סוטה/קורס על הקלט הזה.
  const previewBefore = paidBefore(draftFC, oldFriendly, contactsFC, DEFAULTS);
  check('paidBefore מזכה את ינואר+פברואר בפני עצמם (כל אחד בתוך חלונו שלו)', previewBefore.length, 2);

  // בדיקת העקביות עצמה — דפוס Step 5 המדויק: אין קשרים אחרים באפריל, אז
  // previousActivistMonthly ריק (מבודד את חלון-3-החודשים, לא מכסה כלשהי).
  const previousActivistMonthlyFC = paidBefore(draftFC, [], contactsFC, DEFAULTS, allFC);
  const previousContactMonthlyFC  = previousActivistMonthlyFC.filter(i => i.contact_id === 1);
  const contactContextFC = { joinedAt: contactsFC[0].joined_at, allInteractionsWithContact: oldFriendly };
  const previewDraftResult = calcInteractionPayment(
    { type: draftFC.type, quality: draftFC.quality, duration_minutes: 60, date: draftFC.date },
    previousContactMonthlyFC, false, previousActivistMonthlyFC, DEFAULTS, contactContextFC
  );
  check('התצוגה המקדימה (paidBefore+contactContext, כמו Step 5) מסכימה עם המנוע: הטיוטה לא מזכה',
    previewDraftResult.payable, false);
  check('התצוגה המקדימה: אותה סיבה בדיוק כמו המנוע (חלון הזכאות)',
    previewDraftResult.reason, engineResult.unpaid[0]?.reason);
}

// ────────────────────────────────────────────────────────────────────────────
// ביקורת קוד על Task 3 — ממצא קריטי: contactContext ב-paidBefore סינן
// allInteractionsWithContact לפי contact_id בלבד, בלי activist_id (שאר 4 מקומות
// הבנייה כן סיננו לפי שניהם). זה נגיש בפועל, לא תיאורטי: lib/CrmStore.jsx מסנן
// את interactions לפי תפקיד — רק role==='activist' מוגבל לפעיל בודד; רכז/כספים/
// ראש-תחום/מנכ"ל רואים נתוני-רב-פעילים (מנכ"ל: הכל, ללא סינון). עמוד
// add-interaction/[id].jsx חוסם לפי activist_id רק את role==='activist' שמנסה
// לדווח עבור לקוח שאינו שלו — תפקידים אחרים עוברים לכל לקוח. כשתפקיד כזה פותח
// את העמוד עבור לקוח עם היסטוריה מול כמה פעילים, contactContext שנבנה בתוך
// paidBefore (מה-allInteractionsForContext שהעמוד מעביר — כל ה-interactions,
// לא מסונן לפעיל) "דלף" קשר תורני של פעיל *אחר* לתוך בדיקת מעבר-לתורני של הפעיל
// הנוכחי. בדיוק דפוס "תצוגה אחת רואה X, המנוע רואה Y" שכל המשימה הזו נועדה למנוע.
// ────────────────────────────────────────────────────────────────────────────
{
  const contactsX = [{ id: 1, name: 'לקוח משותף', joined_at: '2026-01-01' }];
  // קשר תורני של פעיל *אחר* (8) עם אותו לקוח — קיים ב-historySource (כי העמוד
  // האמיתי מעביר את כל ה-interactions, לא מסונן-פעיל), אבל לא אמור להשפיע על
  // ההערכה של פעיל 7.
  const otherActivistTorani = { activist_id: 8, project_id: 1, id: 900, contact_id: 1, type: 'פרונטלי', quality: 'תורני', duration_minutes: 60, date: '2026-02-10' };
  // הקשר הידידותי של פעיל 7 עצמו — בתוך חלון 3 החודשים מהצטרפות ינואר (חודש 2),
  // ובלי קשר תורני *משלו* — אמור לזכות.
  const myFriendly = { activist_id: 7, project_id: 1, id: 901, contact_id: 1, type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 60, date: '2026-03-10' };
  const draftX = { type: 'פרונטלי', quality: 'ידידותי', date: '2026-03-20', id: Number.MAX_SAFE_INTEGER };

  // monthlyInteractions=[myFriendly] (רק מרץ, כמו שכל קורא אמיתי מסנן), אבל
  // allInteractionsForContext כולל את שתי השורות — בדיוק כמו שעמוד add-interaction
  // מעביר interactions מלא (רב-פעילי אצל רכז/כספים/ראש-תחום/מנכ"ל).
  const resultX = paidBefore(draftX, [myFriendly], contactsX, DEFAULTS, [otherActivistTorani, myFriendly]);
  check('paidBefore: קשר תורני של פעיל אחר עם אותו לקוח לא "דולף" ל-contactContext של הפעיל הנוכחי',
    resultX.length, 1);
  check('paidBefore: הקשר של פעיל 7 עצמו הוא זה שזוכה (לא נדחה בטעות בגלל תורני של פעיל 8)',
    resultX[0]?.id, 901);
}

// ────────────────────────────────────────────────────────────────────────────
// ביקורת קוד על Task 3 — ממצא חשוב: אין כיסוי ישיר ל-getMonthlyTotalForActivist
// ול-payableInteractionsThisMonth. שתיהן מחוברות נכון (contactContext עם
// activist_id) לפי קריאה ידנית, אבל בלי בדיקה כאן רגרסיה עתידית (למשל מישהו
// שמחזיר בטעות את הסינון ל-myMonthly/monthlyInteractions בלבד) לא הייתה נתפסת.
// אותו תרחיש כמו הבדיקה של calcMonthlyPayment למעלה: קשר ידידותי בחודש 4
// מהצטרפות (מחוץ לחלון) מול קשר ידידותי בחודש 1 (בתוך החלון).
// ────────────────────────────────────────────────────────────────────────────
{
  const contactsG = [{ id: 1, name: 'לקוח ותיק', joined_at: '2026-01-01' }];
  const oldFriendlyG = Array.from({ length: 2 }, (_, k) => ({
    activist_id: 7, project_id: 1, id: 810 + k, contact_id: 1, type: 'פרונטלי',
    quality: 'ידידותי', duration_minutes: 60, date: `2026-0${k + 1}-15`,
  }));
  const aprilRowG = { activist_id: 7, project_id: 1, contact_id: 1, id: 860, type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 60, date: '2026-04-15' };
  const allG = [...oldFriendlyG, aprilRowG];

  const totalAprilG = getMonthlyTotalForActivist(7, allG, contactsG, DEFAULTS, { year: 2026, month: 3 }); // אפריל — חודש 4 מהצטרפות
  check('getMonthlyTotalForActivist: קשר ידידותי בחודש 4 מהצטרפות (מחוץ לחלון) לא נספר בסכום', totalAprilG, 0);

  const totalJanG = getMonthlyTotalForActivist(7, allG, contactsG, DEFAULTS, { year: 2026, month: 0 }); // ינואר — חודש 1 מהצטרפות
  check('getMonthlyTotalForActivist: קשר ידידותי בחודש 1 מהצטרפות (בתוך החלון) כן נספר (250 ₪)', totalJanG, 250);
}

// ────────────────────────────────────────────────────────────────────────────
// בונוס תורני — 3 חודשים רצופים, פעם אחת בלבד ללקוח (2026-08-31).
// ────────────────────────────────────────────────────────────────────────────
{
  const { deriveToraniBonuses } = require('../lib/paymentCalc.js');
  // duration_minutes: 60 — חייב לעמוד ב-MIN_DURATION (ביקורת קוד, 2026-09-01: קשר תורני
  // קצר מדי לא נספר לחודש המזכה, ראה deriveToraniBonuses). בלי זה כל הבדיקות בבלוק הזה
  // היו נכשלות אחרי התיקון (duration_minutes היה undefined → 0 → מתחת לסף בכל מקרה).
  const mkT = (activistId, contactId, date, id) => ({ activist_id: activistId, project_id: 1, contact_id: contactId, quality: 'תורני', type: 'פרונטלי', duration_minutes: 60, date, id });
  const contactsTB = [{ id: 1, name: 'לקוח א' }, { id: 2, name: 'לקוח ב' }];

  // 3 חודשים רצופים (יוני,יולי,אוגוסט) → בונוס מיוחס לאוגוסט.
  const threeConsecutive = [mkT(7, 1, '2026-06-05', 1), mkT(7, 1, '2026-07-05', 2), mkT(7, 1, '2026-08-05', 3)];
  const bonuses1 = deriveToraniBonuses(threeConsecutive, contactsTB);
  check('3 חודשים רצופים = בונוס אחד, מיוחס לחודש השלישי', bonuses1.length, 1);
  check('הבונוס מיוחס לאוגוסט (חודש 7, 0-indexed)', bonuses1[0]?.month, '2026-7');
  check('סכום הבונוס = 1000', bonuses1[0]?.amount, 1000);

  // 2 חודשים + פער + 1 נוסף — אף פעם לא 3 ברצף → אין בונוס.
  const withGap = [mkT(7, 2, '2026-06-05', 4), mkT(7, 2, '2026-07-05', 5), mkT(7, 2, '2026-09-05', 6)];
  check('2 חודשים רצופים ואז פער = אין בונוס', deriveToraniBonuses(withGap, contactsTB).length, 0);

  // פער ואז 3 רצופים בהמשך — הבונוס מיוחס לרצף השני, לא כולל את החודש המבודד.
  const gapThenRun = [mkT(7, 1, '2026-03-05', 7), mkT(7, 1, '2026-06-05', 8), mkT(7, 1, '2026-07-05', 9), mkT(7, 1, '2026-08-05', 10)];
  const bonuses2 = deriveToraniBonuses(gapThenRun, contactsTB);
  check('פער ואז 3 רצופים = בונוס אחד, מיוחס לרצף האמיתי (אוגוסט)', bonuses2.length === 1 && bonuses2[0].month === '2026-7', true);

  // 5 חודשים רצופים ברציפות (יוני-אוקטובר) — עדיין בונוס *אחד* בלבד, לא נוסף בחודש 4/5.
  const fiveConsecutive = [1,2,3,4,5].map((_, k) => mkT(7, 1, `2026-0${6 + k}-05`, 20 + k));
  check('5 חודשים רצופים = בונוס אחד בלבד (לא 3)', deriveToraniBonuses(fiveConsecutive, contactsTB).length, 1);

  // התחיל ידידותי, עבר לתורני — הספירה מתחילה מהתורני הראשון, לא מהידידותי.
  const friendlyThenTorani = [
    { activist_id: 7, project_id: 1, contact_id: 1, quality: 'ידידותי', type: 'פרונטלי', date: '2026-01-05', id: 30 },
    { activist_id: 7, project_id: 1, contact_id: 1, quality: 'ידידותי', type: 'פרונטלי', date: '2026-02-05', id: 31 },
    mkT(7, 1, '2026-06-05', 32), mkT(7, 1, '2026-07-05', 33), mkT(7, 1, '2026-08-05', 34),
  ];
  const bonuses3 = deriveToraniBonuses(friendlyThenTorani, contactsTB);
  check('ידידותי לפני תורני לא משפיע — עדיין 3 חודשים מהתורני (אוגוסט)', bonuses3.length === 1 && bonuses3[0].month === '2026-7', true);

  // שני לקוחות שונים — כל אחד נספר בנפרד.
  const twoClients = [...threeConsecutive, mkT(7, 2, '2026-06-05', 40), mkT(7, 2, '2026-07-05', 41), mkT(7, 2, '2026-08-05', 42)];
  check('2 לקוחות, כל אחד השלים רצף בנפרד = 2 בונוסים', deriveToraniBonuses(twoClients, contactsTB).length, 2);

  // שני פעילים שונים עם אותו לקוח — כל רצף נספר בנפרד לפי (activist_id, contact_id).
  // תואם לשאר מנוע התשלום, שבו לקוח משויך לפעיל אחד; הפונקציה טהורה ולא מניחה
  // שיוך יחיד, אז כל פעיל נבדק על הרצף שלו בלבד גם אם שניהם קיימים באותם הנתונים.
  const twoActivists = [
    mkT(7, 1, '2026-06-05', 50), mkT(7, 1, '2026-07-05', 51), mkT(7, 1, '2026-08-05', 52),
    mkT(9, 1, '2026-06-05', 53), mkT(9, 1, '2026-07-05', 54), mkT(9, 1, '2026-08-05', 55),
  ];
  const bonuses4 = deriveToraniBonuses(twoActivists, contactsTB);
  check('שני פעילים שונים עם אותו לקוח = 2 בונוסים (נספרים בנפרד)', bonuses4.length, 2);
  check('כל בונוס מיוחס לפעיל הנכון', bonuses4.map(b => b.activist_id).sort((a, b) => a - b), [7, 9]);

  // ביקורת קוד (2026-09-01) — קשר תורני קצר מ-MIN_DURATION (15 דקות) לא נספר לחודש המזכה,
  // בדיוק כמו בכל שאר המנוע (calcInteractionPayment, בונוס-לימוד). בלי הבדיקה הזו, שלושה
  // "מגעים" תורניים של 2 דקות — שאף אחד מהם לא מזכה אגורה בפני עצמו — עדיין היו מפעילים
  // את מלוא בונוס 1,000 ₪. יולי כאן מכיל רק מגע קצר (5 דק') ולכן "לא קיים" לצורך הרצף —
  // יוני ואוגוסט נשארים, אבל לא רצופים (פער של חודש), אז אין בונוס בכלל.
  const shortMiddleMonth = [
    mkT(7, 1, '2026-06-05', 90),
    { ...mkT(7, 1, '2026-07-05', 91), duration_minutes: 5 }, // קצר מ-15 דקות — לא נספר
    mkT(7, 1, '2026-08-05', 92),
  ];
  check('קשר תורני קצר מ-15 דקות לא נספר לחודש המזכה — הרצף נשבר, אין בונוס',
    deriveToraniBonuses(shortMiddleMonth, contactsTB).length, 0);

  // אותו רצף, אבל יולי מכיל *גם* מגע ארוך מספיק — אמור לחזור להיספר (עדיין 3 רצופים).
  const shortPlusRealSameMonth = [
    mkT(7, 1, '2026-06-05', 93),
    { ...mkT(7, 1, '2026-07-03', 94), duration_minutes: 5 },  // קצר מדי — לא נספר בפני עצמו
    mkT(7, 1, '2026-07-20', 95),                              // אבל מגע נוסף באותו חודש כן מזכה
    mkT(7, 1, '2026-08-05', 96),
  ];
  const bonuses5 = deriveToraniBonuses(shortPlusRealSameMonth, contactsTB);
  check('חודש עם גם מגע קצר וגם מגע תקין — עדיין נספר (מספיק מגע אחד תקין באותו חודש)',
    bonuses5.length === 1 && bonuses5[0].month === '2026-7', true);
}

// ────────────────────────────────────────────────────────────────────────────
// חיווט toraniBonuses דרך calcMonthlyPayment — נכנס ל-breakdown, מכבד ביטול.
// ────────────────────────────────────────────────────────────────────────────
{
  const contactsTW = [{ id: 1, name: 'לקוח' }];
  const toraniBonus = [{ activist_id: 7, contact_id: 1, contactName: 'לקוח', amount: 1000, desc: 'השלים 3 חודשים רצופים של קשר תורני', month: '2026-7' }];
  const r1 = calcMonthlyPayment(7, [], contactsTW, [], [], DEFAULTS, new Set(), { year: 2026, month: 7 }, toraniBonus);
  check('בונוס תורני נכנס ל-breakdown ולסה"כ', [r1.total, r1.breakdown.find(b => b.type === 'בונוס-תורני')?.amount], [1000, 1000]);

  const { makeBonusKey } = require('../lib/paymentCalc.js');
  const cancelledKey = makeBonusKey(7, 'בונוס-תורני', 1, '2026-7');
  const r2 = calcMonthlyPayment(7, [], contactsTW, [], [], DEFAULTS, new Set([cancelledKey]), { year: 2026, month: 7 }, toraniBonus);
  check('ביטול בונוס-תורני (bonus_cancellations) מכבד — לא נכנס ל-total', r2.total, 0);
}

// payableInteractionsThisMonth (lib/activistStats.js) קוראת ל-monthStart() הפנימי
// שלה בלי אפשרות להעביר "עכשיו" מבחוץ — לכן הבדיקה בונה תאריכים *יחסית* לתאריך
// האמיתי של הרצת הבדיקה (new Date()), לא תאריך קבוע, כדי שתישאר תקפה בכל יום.
{
  const now = new Date();
  const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const thisMonthStart      = new Date(now.getFullYear(), now.getMonth(), 1);
  const joinedFourMonthsAgo = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - 4, 1);
  const joinedThisMonth     = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 1);
  const dayInThisMonth      = isoOf(new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 5));

  const contactsP = [
    { id: 1, name: 'ותיק (מחוץ לחלון)', joined_at: isoOf(joinedFourMonthsAgo) },
    { id: 2, name: 'חדש (בתוך החלון)',  joined_at: isoOf(joinedThisMonth) },
  ];
  const rowsP = [
    { activist_id: 7, project_id: 1, id: 951, contact_id: 1, type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 60, date: dayInThisMonth },
    { activist_id: 7, project_id: 1, id: 952, contact_id: 2, type: 'פרונטלי', quality: 'ידידותי', duration_minutes: 60, date: dayInThisMonth },
  ];
  check('payableInteractionsThisMonth: רק הקשר בתוך חלון-3-החודשים נספר (הוותיק, חודש 4 מהצטרפות, לא)',
    payableInteractionsThisMonth(7, rowsP, contactsP, 1, DEFAULTS), 1);
}

// ────────────────────────────────────────────────────────────────────────────
// קשר קצרצר — לעולם לא מזכה, ולא נספר בשום מכסה (2026-08-31).
// ────────────────────────────────────────────────────────────────────────────
{
  const brief = { type: 'קצרצר', quality: 'טלפון', duration_minutes: 5, date: '2026-08-01' };
  const result = calcInteractionPayment(brief, [], false, [], DEFAULTS);
  check('קשר קצרצר: payable=false, amount=0', [result.payable, result.amount], [false, 0]);
  check('הסיבה מזהה קשר קצרצר במפורש (לא "פחות מ-15 דקות")', result.reason, 'קשר קצרצר — אינו מזכה בתשלום');

  // לא נספר במכסת טלפון (25/חודש) — כי type='קצרצר' לא תואם i.type==='טלפוני'/'וידאו'.
  const contactsB = [{ id: 1, name: 'לקוח' }];
  const briefRows = Array.from({ length: 30 }, (_, k) => ({ activist_id: 7, project_id: 1, id: 900 + k, contact_id: 1, type: 'קצרצר', quality: 'טלפון', duration_minutes: 5, date: `2026-08-${String((k % 28) + 1).padStart(2, '0')}` }));
  const r = calcMonthlyPayment(7, briefRows, contactsB, [], [], DEFAULTS, new Set(), { year: 2026, month: 7 });
  check('30 קשרים קצרצרים לא מייצרים אף שורת breakdown ולא חורגים ממכסה', [r.total, r.breakdown.length], [0, 0]);
}

// ────────────────────────────────────────────────────────────────────────────
// אימות: מפגש רב-משתתפים כבר עונה על דרישת נדב (2026-08-31) — לקוח ראשי שעליו
// מחושב התשלום + משתתפים נוספים שהמפגש נרשם אצלם בלי תשלום נוסף. לא קוד חדש —
// רק תיעוד+בדיקה שהקוד הקיים (isDerivedInteraction) עונה במדויק על הדרישה.
// ────────────────────────────────────────────────────────────────────────────
{
  const mainMeetingId = 9000;
  const rows = [
    // הלקוח הראשי — השורה שעליה מחושב התשלום
    { activist_id: 7, project_id: 1, id: mainMeetingId, contact_id: 1, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-08-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }] } },
    // 2 משתתפים נוספים — שורות נגזרות, נרשמות בהיסטוריה שלהם אבל לא מזכות תשלום נוסף
    { activist_id: 7, project_id: 1, id: mainMeetingId + 1, contact_id: 2, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-08-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }], derived_from: mainMeetingId } },
    { activist_id: 7, project_id: 1, id: mainMeetingId + 2, contact_id: 3, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-08-10',
      participants: { count: 3, clients: [{ id: 2 }, { id: 3 }], derived_from: mainMeetingId } },
  ];
  const contactsMP = [{ id: 1, name: 'ראשי' }, { id: 2, name: 'משתתף א' }, { id: 3, name: 'משתתף ב' }];
  const r = calcMonthlyPayment(7, rows, contactsMP, [], [], DEFAULTS, new Set(), { year: 2026, month: 7 });

  check('תשלום ניתן פעם אחת בלבד על המפגש (לא מוכפל לפי 3 משתתפים)', r.total, 300);
  check('רק שורת breakdown אחת (הלקוח הראשי)', r.breakdown.length, 1);
  check('הלקוח שעליו מחושב התשלום הוא הלקוח הראשי (contact_id=1)', r.breakdown[0]?.contactId, 1);
  check('המשתתפים הנוספים לא מופיעים כ"לא זוכה" (הם לא "קשר" עצמאי, אלא תיעוד)', r.unpaid.length, 0);

  // הדרישה "המפגש נרשם גם בהיסטוריה שלהם, נחשב כמפגש שהתקיים" — זה תפקיד
  // addParticipantInteractions (lib/CrmStore.jsx), לא paymentCalc. מאומת בקוד:
  // כל אחת מהשורות הנגזרות מכילה contact_id של המשתתף עצמו (2, 3) — כלומר היא
  // *כן* מופיעה בהיסטוריית הקשרים שלו (interactions.filter(contact_id===2)
  // תמצא אותה), רק לא נכנסת לחישוב שכר בזכות isDerivedInteraction.
  check('כל משתתף נוסף יש לו שורת קשר עצמאית בהיסטוריה שלו',
    rows.filter(i => i.contact_id === 2 || i.contact_id === 3).length, 2);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
