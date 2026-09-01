/**
 * paymentCalc.js — חישוב תשלומים לפעילי אחדות יהודית
 * ======================================================
 * TODO [future]: עדכן מחירים כאן בלבד
 */

// עדכון תעריפים 2026-08-31 (בקשת נדב): טלפוני-ידידותי → 0 (לא מזכה עוד),
// טלפוני-תורני 200→150, וידאו-תורני 250→200. שאר התעריפים ללא שינוי.
const BASE_PRICES = {
  'טלפוני-ידידותי':      0,
  'טלפוני-תורני':        150,
  'וידאו-תורני':         200,
  'וידאו-ידידותי':       200,
  'פרונטלי-ידידותי':     250,
  'פרונטלי-תורני':       300,
  'פרונטלי-רב משתתפים': 300,
  'אירוח שבת':           600,
};

// תקרת תשלום חודשית כוללת לפעיל (בשקלים)
// TODO [future]: עדכן כאן
const MONTHLY_PAYMENT_CAP = 99999; // אין תקרה כספית כוללת כרגע — ניתן להגדיר בעתיד

// מגבלות כמותיות חודשיות לפעיל
const MONTHLY_CAPS = {
  phone:    25,
  frontal:  15,
  multi:    6,
};

// מגבלות עם אותו לקוח
// החלטת נדב 2026-07-26: כל לקוח נחשב פוטנציאלי — 10 שיחות לכולם, לא רק ל-high_potential.
const PER_CONTACT_CAPS = {
  high: { frontal: 6, phone: 10 },
  regular: { frontal: 6, phone: 10 },
};

// בונוסי התמדה בלימוד עם אותו לקוח
const LEARNING_BONUS = { 4: 600, 6: 850 };

// בונוס עליה בסרגל מצוות לדרגה
const MITZVOT_BONUS_PER_LEVEL = 600;

// בונוס הבאת משתתף חדש
const NEW_PARTICIPANT_BONUS = 250;

// משך מינימלי לקשר מזכה (דקות)
const MIN_DURATION = 15;

// קשר ידידותי מזכה רק ב-3 החודשים הראשונים של הקשר עם הלקוח, ורק כל עוד הלקוח
// לא עבר לקשר תורני (ראה כלל הזכאות ב-calcInteractionPayment). TODO [future]:
// להעביר ל-payment_config כשתתווסף עמודה — היום קבוע קשיח, כמו MONTHLY_PAYMENT_CAP.
const FRIENDLY_ELIGIBLE_MONTHS = 3;

// מכסת קשרים ידידותיים-פרונטליים בתשלום, לחודש, ללקוח — בנוסף (לא במקום) לתקרת
// PER_CONTACT_CAPS.frontal (6) הקיימת, שנשארת ללא שינוי וחלה על כל פרונטלי.
const FRIENDLY_FRONTAL_MONTHLY_CAP = 2;

// בונוס חד-פעמי ללקוח שהשלים TORANI_BONUS_MONTHS חודשים קלנדריים *רצופים* עם
// לפחות קשר תורני אחד בכל חודש. ראה deriveToraniBonuses למטה.
const TORANI_BONUS_AMOUNT = 1000;
const TORANI_BONUS_MONTHS = 3;

// מפתח יציב לבונוס (לצורך ביטול ע"י רכז — ראה migrations/0014_bonus_cancellations.sql).
// כל בונוס בפירוט התשלום (בונוס-מצוות/בונוס-חדש/בונוס-לימוד) מקבל מפתח כזה.
function makeBonusKey(activistId, type, contactId, monthKey) {
  return `${activistId}|${type}|${contactId ?? ''}|${monthKey}`;
}

/**
 * resolvePeriod — מנרמל את חודש הדיווח לכל פונקציות החישוב.
 * @param period — { year, month } כאשר month הוא 0-indexed (יולי = 6). ללא ערך → החודש הנוכחי.
 * מחזיר { year, month, monthKey, startIso, endIso } כאשר endIso הוא ה-1 בחודש הבא (בלעדי).
 *
 * ⚠️ monthKey נשאר בפורמט `${year}-${month}` עם month 0-indexed (יולי 2026 = "2026-6") —
 * זהה ל-lib/CrmStore.jsx ולשורות bonus_cancellations הקיימות ב-DB. אין לשנות את הפורמט.
 */
function resolvePeriod(period) {
  const now   = new Date();
  const year  = Number(period?.year  ?? now.getFullYear());
  const month = Number(period?.month ?? now.getMonth()); // 0-indexed
  const pad   = n => String(n).padStart(2, '0');
  return {
    year, month,
    monthKey: `${year}-${month}`,
    startIso: `${year}-${pad(month + 1)}-01`,
    endIso:   month === 11 ? `${year + 1}-01-01` : `${year}-${pad(month + 2)}-01`,
  };
}

// פרויקטים בתשלום — אחדות יהודית (1) + נעים להכיר (2). כללים ותעריפים זהים,
// והתקרות משותפות: הפעילות בשני הפרויקטים נספרת יחד (החלטת נדב 2026-07-02).
const PAID_PROJECT_IDS = [1, 2];
const isPaidInteraction = i => PAID_PROJECT_IDS.includes(Number(i.project_id));

// קשר נגזר ממפגש רב-משתתפים: שורה שנוצרה אוטומטית לכל לקוח נוסף שהשתתף במפגש,
// כדי שהסטטוס שלו ("ימים מאז קשר אחרון") יתעדכן. המפגש משולם **פעם אחת** — על השורה
// המקורית — בין אם היו בו שני משתתפים או מאתיים. לכן שורות נגזרות מוחרגות מכל חישוב
// תשלום, מכל תקרה ומכל בונוס. (החלטת נדב 2026-07-27)
const isDerivedInteraction = i => Boolean(i && i.participants && i.participants.derived_from);

// הפילטר היחיד שקובע אם קשר נכנס למנוע התשלום. כל מונה/תקרה/סכום עובר דרכו.
const countsForPayment = i => isPaidInteraction(i) && !isDerivedInteraction(i);

// מחיר הבסיס של קשר לפי המחירון הפעיל — 0 לסוג שאינו מזוהה.
function interactionBasePrice(i, cfg = DEFAULTS) {
  const prices = cfg?.BASE_PRICES || BASE_PRICES;
  if (i.type === 'אירוח שבת') return prices['אירוח שבת'] ?? 0;
  return prices[`${i.type}-${i.quality}`] ?? 0;
}

/**
 * comparePaymentOrder — הסדר שבו קשרים מקבלים משבצות מהמכסה החודשית.
 *
 * עד 2026-08 ההקצאה הייתה כרונולוגית טהורה, ולכן מפגש ידידותי (250 ₪) בתחילת החודש
 * "תפס מקום" למפגש תורני (300 ₪) בסופו, והפעיל הפסיד את ההפרש — בלי שום שליטה על זה,
 * כי סדר המפגשים נקבע ע"י הלקוחות (דיווח אלעזר באום, 2026-07-31).
 *
 * הסדר החדש: מחיר יורד → תאריך עולה → id עולה. דטרמיניסטי ויציב, ולכן כל מסך שמחשב
 * (עמוד התשלומים, דשבורד היועץ, התצוגה המקדימה בטופס) מגיע בדיוק לאותה תוצאה.
 * חשוב: זה משנה רק *מי* מקבל את המשבצת כשהתקרה נבלמת — לא את גובה התקרה ולא את התעריף.
 *
 * הקומפרטור עצמו נמצא אחרי שני עוזרי-הנרמול שלמטה (orderTime / orderId). שניהם קיימים
 * כדי שהוא לעולם לא יחזיר NaN — קומפרטור כזה מפרק את Array.sort בשקט, והתוצאה היא
 * סכומי שכר שמשתנים בין הרצה להרצה.
 */
// זמן למיון. תאריך חסר או לא תקין נדחק לסוף במקום להחזיר NaN — קומפרטור שמחזיר NaN
// מפרק את המיון בשקט. ⚠️ `new Date(null)` הוא 1970 ולא Invalid Date, ולכן falsy נבדק
// בנפרד: בלי זה שורה בלי תאריך הייתה קופצת לראש התור ותופסת משבצת ראשונה במכסה.
function orderTime(value) {
  if (!value) return Infinity;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Infinity : t;
}

// id כשובר-שוויון אחרון. id לא-מספרי (למשל אם אי-פעם נעבור ל-UUID) לא יפיל את המיון:
// שני ערכים לא-מספריים נחשבים שווים, ומספר תמיד קודם ללא-מספר.
function orderId(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : Infinity;
}

function comparePaymentOrder(a, b, cfg = DEFAULTS) {
  const pa = interactionBasePrice(a, cfg), pb = interactionBasePrice(b, cfg);
  const safePa = Number.isFinite(pa) ? pa : 0, safePb = Number.isFinite(pb) ? pb : 0;
  if (safePa !== safePb) return safePb - safePa; // מחיר יורד
  const ta = orderTime(a.date), tb = orderTime(b.date);
  // השוואה ולא חיסור: Infinity - Infinity הוא NaN.
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ia = orderId(a.id), ib = orderId(b.id);
  if (ia !== ib) return ia < ib ? -1 : 1;
  return 0;
}

// DEFAULTS — אובייקט הקונפיג מהקבועים לעיל. כל פונקציה מקבלת cfg אופציונלי (מ-payment_config ב-DB);
// אם לא הועבר — משתמשת בערכים האלה (תאימות-לאחור מלאה, No-Hard-Coding כשמעבירים cfg).
const DEFAULTS = {
  BASE_PRICES, MONTHLY_CAPS, PER_CONTACT_CAPS, LEARNING_BONUS,
  MITZVOT_BONUS_PER_LEVEL, NEW_PARTICIPANT_BONUS, MIN_DURATION, CAP_EXCEED_BLOCKS: false,
};

const EMPTY_SET = new Set();

/**
 * deriveMitzvotBonuses — בונוסי סרגל-מצוות מתוך mitzvot_history של הלקוחות.
 *
 * מקור-אמת יחיד: הגזירה הזו נצרכת ע"י lib/CrmStore.jsx (האפליקציה) ו-scripts/verify-*.cjs
 * (אימות מול נתוני אמת). כשהיא הייתה משוכפלת בשלושה מקומות, שינוי מדיניות באחד מהם
 * הותיר את השניים האחרים מדווחים סכום אחר.
 *
 * הכלל: בונוס אחד לכל מצווה שעלתה באותו חודש — לא לכל רמה (דיווח מוטי גלעד, 2026-08-02)
 * ולא לכל שמירה (דיווח נוסף, 2026-08-31). קפיצה של כמה רמות בשמירה אחת היא רשומת
 * mitzvot_history יחידה, וכבר קיבלה בונוס יחיד לפני התיקון הזה. אבל אותה עלייה יכולה
 * להירשם גם כשתי שמירות נפרדות באותו חודש (0→1 היום, 1→2 בעוד שבוע) — שתי רשומות
 * נפרדות לאותה מצווה, ובלי הקיבוץ כאן כל רשומה כזו הפיקה בונוס משלה (1,200 ₪ במקום 600).
 * מקבצים לפי (פעיל, לקוח, מצווה, חודש) ומציגים את טווח העלייה המלא באותו חודש.
 *
 * ⚠️ הקיבוץ הוא לפי מצווה, לא לפי bonus_key (activist|type|contact|month — ראה
 * makeBonusKey). פורמט bonus_key נשאר גס-יותר בכוונה כדי לא לשבור שורות bonus_cancellations
 * קיימות (ראה CLAUDE.md). המשמעות: שתי מצוות *שונות* שעלו לאותו לקוח באותו חודש עדיין
 * מייצרות שני בונוסים נפרדים (600+600, וזה תקין) אבל חולקות bonus_key אחד לצורך ביטול —
 * מגבלה קיימת ומתועדת ב-pages/payments/[id].jsx, לא משהו שהקיבוץ כאן פותר.
 *
 * @returns מערך { activist_id, contact_id, contactName, amount, desc, date, month }
 *          כאשר month = `${year}-${month}` עם month 0-indexed (כמו monthKey ב-resolvePeriod).
 */
// groupMitzvotEvents — הליבה המשותפת: הופכת mitzvot_history גולמי לאירועי-עלייה
// ומקבצת אותם לפי (פעיל, לקוח, מצווה, חודש). deriveMitzvotBonuses (למטה) וגם
// previewNewMitzvotBonusCount (מתחתיה) נשענים על הפונקציה הזו כדי ששתיהן יסכימו
// תמיד על מה נחשב "אותה קבוצה" — בלי זה קל לשכפל את כלל הקיבוץ ולסטות בשקט.
function groupMitzvotEvents(contacts) {
  const events = (contacts || []).flatMap(c => {
    if (!c.activist_id || !Array.isArray(c.mitzvot_history)) return [];
    return c.mitzvot_history.flatMap(h => {
      const from = Number(h?.from ?? 0);
      const to   = Number(h?.to ?? 0);
      if (!h?.mitzva || to <= from) return [];
      const d = h.date ? new Date(h.date) : new Date();
      return [{
        activist_id: c.activist_id,
        contact_id:  c.id,
        contactName: c.name,
        mitzva:      h.mitzva,
        from, to,
        date:        h.date,
        month:       `${d.getFullYear()}-${d.getMonth()}`,
      }];
    });
  });

  // רשומות עלייה לאותה מצווה, לאותו לקוח, באותו חודש → קבוצה אחת → בונוס אחד.
  const groups = new Map();
  for (const e of events) {
    const groupKey = `${e.activist_id}|${e.contact_id}|${e.mitzva}|${e.month}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(e);
  }
  return groups;
}

function deriveMitzvotBonuses(contacts, perLevel = MITZVOT_BONUS_PER_LEVEL) {
  const groups = groupMitzvotEvents(contacts);

  return [...groups.values()].map(group => {
    const [first] = group;
    const minFrom  = Math.min(...group.map(e => e.from));
    const maxTo    = Math.max(...group.map(e => e.to));
    // orderTime (מוגדר למעלה) דוחק תאריך חסר/לא-תקין ל-Infinity במקום NaN — כאן זה
    // בפועל תיאורטי בלבד (updateMitzvot תמיד כותב date), אבל שומר על אותה גישה זהירה.
    const lastDate = group.reduce((d, e) => (orderTime(e.date) > orderTime(d) ? e.date : d), first.date);
    return {
      activist_id: first.activist_id,
      contact_id:  first.contact_id,
      contactName: first.contactName,
      amount:      perLevel,
      desc:        `עליה ב${first.mitzva} מרמה ${minFrom} ל-${maxTo}`,
      date:        lastDate,
      month:       first.month,
    };
  });
}

/**
 * deriveToraniBonuses — בונוס חד-פעמי ללקוח שהשלים TORANI_BONUS_MONTHS חודשים
 * קלנדריים *רצופים* עם לפחות קשר תורני אחד בכל חודש. מיוחס לחודש השלישי ברצף
 * *הראשון* שנמצא — "פעם אחת בלבד ללקוח" (מפסיקים לחפש ברגע שנמצא רצף מתאים).
 * מקור-אמת יחיד: פונקציה טהורה, נצרכת ע"י lib/CrmStore.jsx וסקריפטי ה-verify,
 * באותו דפוס בדיוק כמו deriveMitzvotBonuses.
 *
 * per (activist_id, contact_id) — אם לקוח עבר בין פעילים, הרצף נספר בנפרד לכל
 * פעיל (תואם לשאר מנוע התשלום, שבו לקוח משויך לפעיל אחד).
 *
 * ⚠️ ביקורת קוד (2026-09-01): קשר תורני נספר לחודש המזכה רק אם משכו עומד ב-MIN_DURATION
 * (ברירת מחדל 15 דקות) — בדיוק כמו calcInteractionPayment וכמו לולאת בונוס-הלימוד למעלה
 * (`(i.duration_minutes ?? 0) >= MIN_DUR`). בלי הבדיקה הזו, שלושה "מגעים" תורניים של
 * 2 דקות — שאף אחד מהם לא מזכה אגורה בפני עצמו, ולא נספר מול אף תקרה/בונוס אחר במנוע —
 * היו עדיין מפעילים את מלוא בונוס 1,000 ₪. אין הגבלת type (בניגוד לבונוס-הלימוד, שמחריג
 * טלפוני) — זו החלטת עיצוב מכוונת: "קשר תורני" נספר לפי איכות בלבד, לא ערוץ.
 *
 * @param cfg — קונפיג אופציונלי (ברירת מחדל: DEFAULTS), לצורך MIN_DURATION. כמו
 *   deriveMitzvotBonuses, הנגזרת עצמה לא מקבלת cfg חי מהקוראים היום (אף אחד מ-7 נקודות
 *   הקריאה הקיימות לא מעביר paymentConfig) — הפרמטר קיים כדי לאפשר זאת בעתיד, בהתאם
 *   לדפוס ברירת-המחדל-cfg המבוסס בקובץ (calcInteractionPayment/calcMonthlyPayment וכו').
 * @returns מערך { activist_id, contact_id, contactName, amount, desc, month }
 *          כאשר month = `${year}-${month}` עם month 0-indexed (כמו monthKey ב-resolvePeriod).
 */
function deriveToraniBonuses(interactions, contacts, amount = TORANI_BONUS_AMOUNT, months = TORANI_BONUS_MONTHS, cfg = DEFAULTS) {
  const MIN_DUR = cfg.MIN_DURATION ?? 15;
  const byPair = new Map();
  for (const i of (interactions || [])) {
    if (!countsForPayment(i) || i.quality !== 'תורני') continue;
    if ((i.duration_minutes ?? 0) < MIN_DUR) continue;
    const ym = isoYearMonth(i.date);
    if (!ym) continue;
    const pairKey = `${i.activist_id}|${i.contact_id}`;
    if (!byPair.has(pairKey)) byPair.set(pairKey, new Map());
    const monthMap = byPair.get(pairKey);
    const mk = `${ym.year}-${ym.month}`;
    if (!monthMap.has(mk)) monthMap.set(mk, ym);
  }

  const bonuses = [];
  for (const [pairKey, monthMap] of byPair) {
    const [activistIdStr, contactIdStr] = pairKey.split('|');
    const sorted = [...monthMap.values()].sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));
    let runStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur  = sorted[i];
      const consecutive = cur && ((cur.year - prev.year) * 12 + (cur.month - prev.month)) === 1;
      if (!consecutive) {
        if (i - runStart >= months) {
          const target = sorted[runStart + months - 1];
          const contact = (contacts || []).find(c => String(c.id) === contactIdStr);
          bonuses.push({
            activist_id: Number(activistIdStr),
            contact_id:  Number(contactIdStr),
            contactName: contact?.name,
            amount,
            desc: `השלים ${months} חודשים רצופים של קשר תורני`,
            month: `${target.year}-${target.month}`,
          });
          break; // רצף ראשון בלבד — "פעם אחת ללקוח"
        }
        runStart = i;
      }
    }
  }
  return bonuses;
}

/**
 * previewNewMitzvotBonusChanges — כמו previewNewMitzvotBonusCount, אבל ברמת שינוי בודד:
 * מחזירה את changes כשכל איבר מסומן isNewBonus (true אם השינוי הזה יפיק בונוס *חדש*).
 * לשימוש באינדיקטורים לפי-שורה בעמוד עדכון סרגל מצוות (pages/contact/update-mitzvot/[id].jsx),
 * לצד totalBonus — כדי שהסכום המוצג לא יוכל לסטות ממה שכל שורה בנפרד טוענת (דיווח נוסף, 2026-08-31).
 *
 * changes מכיל לכל היותר איבר אחד לכל מצווה (בנוי מ-mitzvotList.reduce בעמוד הקורא), ולכן כל
 * שינוי ממופה דטרמיניסטית למפתח-קבוצה יחיד ב-groupMitzvotEvents — בדיוק כמו שהיה קורה אם הוא
 * היה השינוי היחיד שנשמר. משווים לפי מפתח-קבוצה, לא לפי הבונוסים המוחזרים, מאותה סיבה
 * שמתועדת ב-previewNewMitzvotBonusCount למטה.
 *
 * @param contact — הלקוח, עם mitzvot_history הקיים (לפני השמירה הזו)
 * @param changes — [{mitzva, from, to}] השינויים שעומדים להישמר
 * @param date    — התאריך שיירשם בפועל (ברירת מחדל: עכשיו) — ראה updateMitzvot ב-CrmStore
 * @returns changes עם שדה isNewBonus נוסף לכל איבר, באותו סדר
 */
function previewNewMitzvotBonusChanges(contact, changes, date = new Date()) {
  if (!contact?.activist_id || !changes?.length) return (changes || []).map(c => ({ ...c, isNewBonus: false }));

  const beforeKeys = new Set(groupMitzvotEvents([contact]).keys());
  const dateStr = date.toISOString().split('T')[0];

  return changes.map(c => {
    const hypotheticalContact = {
      ...contact,
      mitzvot_history: [
        ...(contact.mitzvot_history || []),
        { mitzva: c.mitzva, from: c.from, to: c.to, date: dateStr },
      ],
    };
    const afterKeys = groupMitzvotEvents([hypotheticalContact]).keys();
    let isNewBonus = false;
    for (const key of afterKeys) if (!beforeKeys.has(key)) { isNewBonus = true; break; }
    return { ...c, isNewBonus };
  });
}

/**
 * previewNewMitzvotBonusCount — כמה בונוסים *חדשים* יפיקו changes אם יישמרו עכשיו.
 * עוטפת את previewNewMitzvotBonusChanges (סינון+אורך) כדי שה-total לעולם לא יוכל
 * לסטות מסכום הדגלים ברמת-שורה — ראה התיעוד המלא שם.
 * @returns מספר קבוצות-הבונוס החדשות (כל אחת = MITZVOT_BONUS_PER_LEVEL ₪)
 */
function previewNewMitzvotBonusCount(contact, changes, date = new Date()) {
  return previewNewMitzvotBonusChanges(contact, changes, date).filter(c => c.isNewBonus).length;
}

// מפרק "YYYY-MM-DD" לרכיבי שנה/חודש (0-indexed). מחרוזת ולא new Date(): אזור-זמן
// יכול להזיז יום 31 לחודש הבא ולשבש חישוב הפרש-חודשים.
function isoYearMonth(dateStr) {
  if (!dateStr) return null;
  const [y, m] = String(dateStr).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return { year: y, month: m - 1 };
}

// הפרש חודשים קלנדריים בין שני תאריכי ISO. 0 = אותו חודש, שלילי אם toStr קודם ל-fromStr.
function monthsBetween(fromStr, toStr) {
  const from = isoYearMonth(fromStr);
  const to   = isoYearMonth(toStr);
  if (!from || !to) return 0;
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/**
 * חישוב תשלום לקשר בודד
 *
 * ⚠️ שני מערכי ה-"prev" חייבים להכיל **רק קשרים שזוכו בפועל**. תקרה סופרת מפגשים
 * ששולמו, לא מפגשים שדווחו: קשר שנדחה על תקרת-הלקוח ובכל זאת נספר בתקרה החודשית
 * חוסם מפגש מזכה אחר — כלומר הפעיל מפסיד כסף על דיווח שלא קיבל עליו אגורה.
 * כל הלולאות שקוראות לפונקציה מצטברות `if (result.payable)` בלבד.
 *
 * @param interaction         — הקשר הנוכחי
 * @param prevContactMonthly  — קשרים *מזכים* קודמים עם אותו לקוח החודש (מגבלת לקוח)
 * @param prevActivistMonthly — כל הקשרים ה*מזכים* הקודמים של הפעיל החודש (מגבלה חודשית)
 * @param isHighPotential     — האם הלקוח פוטנציאל גבוה
 * @param cfg             — קונפיג אופציונלי (ברירת מחדל: DEFAULTS) — תעריפים/תקרות/משך-מינימלי מ-payment_config (DB)
 * @param contactContext  — { joinedAt, allInteractionsWithContact } לבדיקת חלון-3-חודשים ומעבר-לתורני (ר' buildContactContext). null (ברירת מחדל) = בלי הגבלת-זכאות חדשה, תאימות-לאחור מלאה
 * מחזיר { amount, payable, reason }
 */
function calcInteractionPayment(interaction, prevContactMonthly, isHighPotential, prevActivistMonthly = null, cfg = DEFAULTS, contactContext = null) {
  // cfg overrides (DB config) — מצללים את הקבועים. אם cfg לא הועבר, אלה ערכי ברירת המחדל.
  const BASE_PRICES      = cfg.BASE_PRICES;
  const MONTHLY_CAPS     = cfg.MONTHLY_CAPS;
  const PER_CONTACT_CAPS = cfg.PER_CONTACT_CAPS;
  const MIN_DUR          = cfg.MIN_DURATION ?? 15;
  const { type, quality, duration_minutes = 0 } = interaction;
  const FRIENDLY_MONTHS = cfg.FRIENDLY_ELIGIBLE_MONTHS ?? FRIENDLY_ELIGIBLE_MONTHS;
  const FRIENDLY_CAP     = cfg.FRIENDLY_FRONTAL_MONTHLY_CAP ?? FRIENDLY_FRONTAL_MONTHLY_CAP;

  // קשר נגזר ממפגש רב-משתתפים — לתיעוד בלבד, התשלום כבר ניתן על השורה המקורית.
  if (isDerivedInteraction(interaction)) {
    return { amount: 0, payable: false, reason: 'משתתף במפגש רב-משתתפים — המפגש כבר זוכה בתשלום' };
  }

  // קשר קצרצר — לעולם לא מזכה, ולא נספר בשום מכסה/בונוס. בדיקה מפורשת ולא רק
  // הישענות על duration_minutes<15: הגנה כפולה, כמו כל שאר החריגות במנוע הזה.
  if (type === 'קצרצר') {
    return { amount: 0, payable: false, reason: 'קשר קצרצר — אינו מזכה בתשלום' };
  }

  // שורות נגזרות לא נספרות מול אף תקרה (חודשית או מול הלקוח) — הן לא "מפגש" בפני עצמו.
  prevContactMonthly  = (prevContactMonthly  || []).filter(i => !isDerivedInteraction(i));
  prevActivistMonthly = prevActivistMonthly ? prevActivistMonthly.filter(i => !isDerivedInteraction(i)) : null;

  // בדיקת משך מינימלי
  if (duration_minutes < MIN_DUR) {
    return { amount: 0, payable: false, reason: `פחות מ-${MIN_DUR} דקות` };
  }

  // זכאות קשר ידידותי — חלון FRIENDLY_MONTHS חודשים מתחילת הקשר, ומתנתק לצמיתות
  // ברגע שהלקוח עבר לקשר תורני (גם אם עדיין בתוך החלון). contactContext=null
  // (ברירת מחדל) משמר את ההתנהגות הישנה — בלי הגבלה — לתאימות-לאחור עם קוראים
  // שלא עודכנו. כל קורא אמיתי *חייב* להעביר contactContext, ראה Task 3.
  if (quality === 'ידידותי' && contactContext) {
    const history = contactContext.allInteractionsWithContact || [];
    const earliestInHistory = history.reduce(
      (min, i) => (i.date && (!min || i.date < min) ? i.date : min), null);
    const anchorDate = contactContext.joinedAt || earliestInHistory || interaction.date;

    if (monthsBetween(anchorDate, interaction.date) >= FRIENDLY_MONTHS) {
      return { amount: 0, payable: false, reason: `קשר ידידותי — מעבר לחלון הזכאות של ${FRIENDLY_MONTHS} חודשים מתחילת הקשר` };
    }

    // countsForPayment + MIN_DUR — בדיוק אותו סינון כמו deriveToraniBonuses (ביקורת קוד,
    // 2026-09-01): בלעדיו קשר תורני קצרצר (למשל 5 דקות) שלא מזכה כלום בעצמו ולא תורם
    // לרצף-הבונוס, עדיין היה מנתק לצמיתות את זכאות-הידידותי של הלקוח — נזק בלי תועלת
    // מקבילה. שני הכללים חייבים להסכים על "האם הלקוח עבר לתורני".
    const firstToraniDate = history
      .filter(i => countsForPayment(i) && i.quality === 'תורני' && (i.duration_minutes ?? 0) >= MIN_DUR)
      .reduce((min, i) => (i.date && (!min || i.date < min) ? i.date : min), null);
    if (firstToraniDate && firstToraniDate <= interaction.date) {
      return { amount: 0, payable: false, reason: 'קשר ידידותי — הלקוח כבר עבר לקשר תורני' };
    }
  }

  // אירוח שבת — תעריף קבוע, בלי איכות ובלי תקרות ערוץ/לקוח
  if (type === 'אירוח שבת') {
    return { amount: BASE_PRICES['אירוח שבת'] ?? 600, payable: true, reason: '' };
  }

  // מפגש רב-משתתפים
  if (type === 'פרונטלי' && quality === 'רב משתתפים') {
    const allMonthly = prevActivistMonthly ?? prevContactMonthly;
    const multiCount = allMonthly.filter(i => i.type === 'פרונטלי' && i.quality === 'רב משתתפים').length;
    if (multiCount >= MONTHLY_CAPS.multi) return { amount: 0, payable: false, reason: 'חרגת ממגבלת מפגשים רב-משתתפים' };
    return { amount: BASE_PRICES['פרונטלי-רב משתתפים'], payable: true, reason: '' };
  }

  const key = `${type}-${quality}`;
  const baseAmount = BASE_PRICES[key];
  // undefined ולא !baseAmount: טלפוני-ידידותי הוא 0 ₪ עכשיו — ערך חוקי, לא "לא מזוהה".
  if (baseAmount === undefined) return { amount: 0, payable: false, reason: 'סוג קשר לא מזוהה' };

  // מכסת FRIENDLY_CAP קשרים ידידותיים-פרונטליים בתשלום, לחודש, ללקוח — בנוסף
  // (לא במקום) לתקרת PER_CONTACT_CAPS.frontal (6) הכללית שנבדקת בהמשך ומחילה
  // על כל פרונטלי, ידידותי ותורני כאחד.
  if (type === 'פרונטלי' && quality === 'ידידותי') {
    const friendlyThisMonth = prevContactMonthly.filter(i => i.type === 'פרונטלי' && i.quality === 'ידידותי').length;
    if (friendlyThisMonth >= FRIENDLY_CAP) {
      return { amount: 0, payable: false, reason: `חרגת ממכסת ${FRIENDLY_CAP} קשרים ידידותיים-פרונטליים בחודש עם לקוח זה` };
    }
  }

  const isPhone   = type === 'טלפוני' || type === 'וידאו';
  const isFrontal = type === 'פרונטלי';

  // בדיקת מגבלות חודשיות כלליות — מול כל פעילות הפעיל (לא רק לקוח אחד)
  // מפגש רב-משתתפים הוא type='פרונטלי' עם quality='רב משתתפים', ויש לו תקרה משלו (MONTHLY_CAPS.multi).
  // חובה להחריג אותו מספירת הפרונטליים — אחרת הוא "אוכל" פעמיים מהמכסה (דיווח אלעזר באום, 2026-07-22).
  const isMulti = i => i.type === 'פרונטלי' && i.quality === 'רב משתתפים';
  const activistMonthly = prevActivistMonthly ?? prevContactMonthly;
  const phoneCountAll   = activistMonthly.filter(i => (i.type === 'טלפוני' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= MIN_DUR).length;
  const frontalCountAll = activistMonthly.filter(i => i.type === 'פרונטלי' && !isMulti(i) && (i.duration_minutes ?? 0) >= MIN_DUR).length;

  if (isPhone   && phoneCountAll   >= MONTHLY_CAPS.phone)   return { amount: 0, payable: false, reason: `חרגת ממגבלת ${MONTHLY_CAPS.phone} שיחות טלפון חודשית` };
  if (isFrontal && frontalCountAll >= MONTHLY_CAPS.frontal) return { amount: 0, payable: false, reason: `חרגת ממגבלת ${MONTHLY_CAPS.frontal} מפגשים פרונטליים חודשית` };

  // בדיקת מגבלות עם אותו לקוח
  const caps = isHighPotential ? PER_CONTACT_CAPS.high : PER_CONTACT_CAPS.regular;
  const contactFrontal = prevContactMonthly.filter(i => i.type === 'פרונטלי' && !isMulti(i) && (i.duration_minutes ?? 0) >= MIN_DUR).length;
  const contactPhone   = prevContactMonthly.filter(i => (i.type === 'טלפוני' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= MIN_DUR).length;

  if (isFrontal && contactFrontal >= caps.frontal) return { amount: 0, payable: false, reason: 'חרגת ממגבלת מפגשים עם לקוח זה' };
  if (isPhone   && contactPhone   >= caps.phone)   return { amount: 0, payable: false, reason: 'חרגת ממגבלת שיחות עם לקוח זה' };

  // בדיקת תקרת תשלום חודשית כוללת
  if (MONTHLY_PAYMENT_CAP < Infinity) {
    // חישוב הצטברות עד כה (דורש prevActivistMonthly)
    // מותאם לעתיד כאשר תוגדר תקרה כספית
  }

  return { amount: baseAmount, payable: true, reason: '' };
}

/**
 * buildContactContext — מקור-אמת יחיד לבניית contactContext עבור calcInteractionPayment.
 *
 * חמש נקודות קריאה שונות (calcMonthlyPayment, paidBefore, getMonthlyTotalForActivist,
 * payableInteractionsThisMonth, ותצוגה מקדימה חיה ב-add-interaction/[id].jsx) צריכות
 * לבנות את אותו אובייקט בדיוק. לפני שהופק לכאן, כל אחת בנתה אותו "ידנית" — וזה בדיוק מה
 * שאיפשר לאחת מהן (paidBefore) לשכוח את סינון ה-activist_id בשקט (ביקורת קוד, 2026-09-01):
 * historySource יכול להכיל כמה פעילים (רכז/כספים/ראש-תחום/מנכ"ל רואים interactions
 * רב-פעילי — ראה scopeQueryToUser ב-lib/CrmStore.jsx), ובלי הסינון קשר תורני של פעיל *אחר*
 * עם אותו לקוח "דלף" לתוך חלון-3-החודשים/מעבר-לתורני של הפעיל הנבדק.
 *
 * @param contact         — הלקוח (כבר מאותר, contacts.find(...)) — או null/undefined
 * @param contactId       — מזהה הלקוח (לסינון allInteractions)
 * @param activistId      — מזהה הפעיל שעבורו נבדקת הזכאות (לסינון allInteractions)
 * @param allInteractions — מאגר רחב של קשרים (עשוי לחצות חודשים ופעילים) לחיתוך ממנו
 * @returns { joinedAt, allInteractionsWithContact } — הצורה שמצפה לה calcInteractionPayment
 */
function buildContactContext(contact, contactId, activistId, allInteractions) {
  return {
    joinedAt: contact?.joined_at ?? null,
    allInteractionsWithContact: (allInteractions || []).filter(i => i.contact_id === contactId && i.activist_id === activistId),
  };
}

/**
 * paidBefore — הקשרים ה**מזכים** שמוקצים לפני `draft` באותו חודש.
 *
 * זה בדיוק מה ש-calcMonthlyPayment צבר ב-`accumulated` ברגע שהוא מגיע לקשר הזה, ולכן
 * זו הדרך היחידה שבה מסך אחר (התצוגה המקדימה בטופס) יכול לשאול את אותה שאלה ולקבל את
 * אותה תשובה. סינון "ידני" של קשרים קודמים תמיד יסטה מהמנוע ברגע שכללי התקרה משתנים —
 * וזה בדיוק מה שקרה: הטופס הזהיר "חרגת" על קשר שהמנוע כן שילם עליו.
 *
 * @param draft               — הקשר הנבדק. { type, quality, date, id }
 * @param monthlyInteractions — כל קשרי הפעיל באותו חודש (לפני סינון כלשהו)
 * @param allInteractionsForContext — כל היסטוריית הקשרים (לא רק החודש) לצורך חלון-3-חודשים
 *   ומעבר-לתורני (contactContext). ברירת מחדל: null → נופל חזרה ל-monthlyInteractions,
 *   שזה מה שכל הקוראים הישנים כבר מעבירים — אבל אז חלון-3-החודשים לא רואה מעבר לגבול
 *   החודש הנוכחי (ראה Task 3 בתוכנית). קורא שצריך את חלון-3-החודשים חייב להעביר את זה.
 */
function paidBefore(draft, monthlyInteractions, contacts, cfg = DEFAULTS, allInteractionsForContext = null) {
  const historySource = allInteractionsForContext || monthlyInteractions;

  const ordered = (monthlyInteractions || [])
    .filter(countsForPayment)
    .filter(i => comparePaymentOrder(i, draft, cfg) < 0)
    .sort((a, b) => comparePaymentOrder(a, b, cfg));

  const accumulated = [];
  for (const i of ordered) {
    const contact = contacts?.find(c => c.id === i.contact_id);
    const prevForContact = accumulated.filter(x => x.contact_id === i.contact_id);
    // buildContactContext מסנן גם contact_id וגם activist_id (i.activist_id — הפעיל של
    // *השורה הזו*, לא פרמטר חיצוני) — ראה התיעוד שם על למה זה קריטי.
    const contactContext = buildContactContext(contact, i.contact_id, i.activist_id, historySource);
    const r = calcInteractionPayment(i, prevForContact, contact?.high_potential ?? false, accumulated, cfg, contactContext);
    if (r.payable) accumulated.push(i);
  }
  return accumulated;
}

/**
 * סכום כל התשלומים שהפעיל צבר החודש עד כה
 * משמש לבדיקת תקרה כוללת
 */
function getMonthlyTotalForActivist(activistId, allInteractions, allContacts, cfg = DEFAULTS, period = null) {
  const { year, month } = resolvePeriod(period);

  const myMonthly = allInteractions
    .filter(i => {
      const d = new Date(i.date);
      return i.activist_id === activistId &&
             countsForPayment(i) &&
             d.getMonth()  === month &&
             d.getFullYear() === year;
    })
    .sort((a, b) => comparePaymentOrder(a, b, cfg));

  let total = 0;
  const accumulated = [];

  for (const interaction of myMonthly) {
    const contact = allContacts?.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact  = accumulated.filter(i => i.contact_id === interaction.contact_id);
    // contactContext מ-allInteractions (לא myMonthly) — חלון-3-חודשים ומעבר-לתורני חייבים
    // לראות מעבר לגבול החודש הנוכחי, אותו דפוס כמו calcMonthlyPayment.
    const contactContext = buildContactContext(contact, interaction.contact_id, activistId, allInteractions);
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg, contactContext);
    // רק קשר שזוכה נספר מול התקרות — ראה ההערה ב-calcInteractionPayment.
    if (result.payable) { accumulated.push(interaction); total += result.amount; }
  }

  return total;
}

/**
 * חישוב סה"כ תשלום חודשי לפעיל
 * כולל בונוסים
 * @param period — { year, month } (month 0-indexed) לחישוב חודש היסטורי. ללא ערך → החודש הנוכחי.
 */
function calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null, toraniBonuses = []) {
  // cfg overrides (DB config) — מצללים את הקבועים.
  const LEARNING_BONUS        = cfg.LEARNING_BONUS;
  const NEW_PARTICIPANT_BONUS = cfg.NEW_PARTICIPANT_BONUS;
  const MIN_DUR               = cfg.MIN_DURATION ?? 15;
  const { year, month, monthKey } = resolvePeriod(period);

  const monthlyInteractions = interactions.filter(i => {
    const d = new Date(i.date);
    return i.activist_id === activistId &&
           d.getMonth() === month &&
           d.getFullYear() === year &&
           countsForPayment(i); // אחדות יהודית + נעים להכיר, תקרות משותפות. בלי שורות נגזרות.
  });

  let total = 0;
  const breakdown = [];
  const unpaid = []; // קשרים שלא זוכו + הסיבה — לשקיפות בלבד, לא משפיע על total

  // קשרים בסיסיים
  const contactsInteracted = [...new Set(monthlyInteractions.map(i => i.contact_id))];

  // עיבוד לפי סדר הקצאת המכסה (comparePaymentOrder) — הקשר היקר תופס משבצת ראשון.
  // לפני 2026-08 היה כאן מיון כרונולוגי, וקשר זול בתחילת החודש דחק קשר יקר בסופו.
  const allSorted = [...monthlyInteractions].sort((a, b) => comparePaymentOrder(a, b, cfg));
  const accumulated = []; // כל הקשרים שעובדו עד כה

  // contactContext לכל לקוח — נבנה פעם אחת מראש, לא בכל איטרציה. allInteractionsWithContact
  // הוא *כל* הקשרים ההיסטוריים (לא רק monthlyInteractions), כדי שחלון-3-חודשים ובדיקת
  // מעבר-לתורני יראו מעבר לגבול החודש הנוכחי.
  const contactContextCache = new Map();
  function getContactContext(contactId) {
    if (contactContextCache.has(contactId)) return contactContextCache.get(contactId);
    const contact = contacts.find(c => c.id === contactId);
    const ctx = buildContactContext(contact, contactId, activistId, interactions);
    contactContextCache.set(contactId, ctx);
    return ctx;
  }

  for (const interaction of allSorted) {
    const contact = contacts.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact  = accumulated.filter(i => i.contact_id === interaction.contact_id);
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg, getContactContext(interaction.contact_id));

    if (result.payable) {
      accumulated.push(interaction); // רק קשר שזוכה נספר מול התקרות
      total += result.amount;
      breakdown.push({ type: 'קשר', contactId: interaction.contact_id, contactName: contact?.name, amount: result.amount, desc: `${interaction.type} ${interaction.quality}`, date: interaction.date, duration_minutes: interaction.duration_minutes, interactionType: interaction.type, quality: interaction.quality });
    } else {
      unpaid.push({ contactId: interaction.contact_id, contactName: contact?.name, date: interaction.date, desc: `${interaction.type} ${interaction.quality}`, reason: result.reason, duration_minutes: interaction.duration_minutes, interactionType: interaction.type, quality: interaction.quality });
    }
  }

  // בונוסי התמדה בלימוד — לפי לקוח
  for (const contactId of contactsInteracted) {
    const contact = contacts.find(c => c.id === contactId);

    const contactInteractions = monthlyInteractions.filter(i => i.contact_id === contactId);
    const learningCount = contactInteractions.filter(i => i.quality === 'תורני' && (i.type === 'פרונטלי' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= MIN_DUR).length;
    if (learningCount >= 6 && !breakdown.find(b => b.type === 'בונוס-לימוד-6' && b.contactId === contactId)) {
      const key = makeBonusKey(activistId, 'בונוס-לימוד-6', contactId, monthKey);
      if (!cancelledBonusKeys.has(key)) {
        total += LEARNING_BONUS[6];
        breakdown.push({ type: 'בונוס-לימוד-6', contactId, contactName: contact?.name, amount: LEARNING_BONUS[6], desc: '6 מפגשי לימוד עם אותו אדם', key });
      }
    } else if (learningCount >= 4 && !breakdown.find(b => b.type === 'בונוס-לימוד-4' && b.contactId === contactId)) {
      const key = makeBonusKey(activistId, 'בונוס-לימוד-4', contactId, monthKey);
      if (!cancelledBonusKeys.has(key)) {
        total += LEARNING_BONUS[4];
        breakdown.push({ type: 'בונוס-לימוד-4', contactId, contactName: contact?.name, amount: LEARNING_BONUS[4], desc: '4 מפגשי לימוד עם אותו אדם', key });
      }
    }
  }

  // בונוסי סרגל מצוות — הסכום מהקונפיג (cfg) ולא מהערך שנחתם בעת העדכון, כדי שיהיה DB-driven.
  const MITZVOT_PER_LEVEL = cfg.MITZVOT_BONUS_PER_LEVEL ?? 600;
  for (const bonus of mitzvotBonuses) {
    const key = makeBonusKey(activistId, 'בונוס-מצוות', bonus.contact_id, monthKey);
    if (cancelledBonusKeys.has(key)) continue;
    total += MITZVOT_PER_LEVEL;
    breakdown.push({ type: 'בונוס-מצוות', contactId: bonus.contact_id, contactName: bonus.contactName, amount: MITZVOT_PER_LEVEL, desc: bonus.desc, key });
  }

  // בונוסי הבאת משתתף חדש
  for (const bonus of newParticipantBonuses) {
    const key = makeBonusKey(activistId, 'בונוס-חדש', bonus.contact_id, monthKey);
    if (cancelledBonusKeys.has(key)) continue;
    total += NEW_PARTICIPANT_BONUS;
    breakdown.push({ type: 'בונוס-חדש', contactId: bonus.contact_id, contactName: bonus.contactName, amount: NEW_PARTICIPANT_BONUS, desc: `הביא משתתף חדש דרך ${bonus.contactName}`, key });
  }

  // בונוס תורני — 3 חודשים רצופים, פעם אחת ללקוח.
  const TORANI_AMOUNT = cfg.TORANI_BONUS_AMOUNT ?? TORANI_BONUS_AMOUNT;
  for (const bonus of toraniBonuses) {
    const key = makeBonusKey(activistId, 'בונוס-תורני', bonus.contact_id, monthKey);
    if (cancelledBonusKeys.has(key)) continue;
    total += TORANI_AMOUNT;
    breakdown.push({ type: 'בונוס-תורני', contactId: bonus.contact_id, contactName: bonus.contactName, amount: TORANI_AMOUNT, desc: bonus.desc, key });
  }

  return { total, breakdown, unpaid };
}

/**
 * calcConsultantDashboard — נתוני דשבורד ליועץ בודד לחודש הנוכחי.
 * מונים (פרונטלי/טלפון-תורני/רב-משתתפים מול תקרות), שכר משוער (מ-calcMonthlyPayment —
 * תואם בדיוק לעמוד התשלומים של הרכז), פירוט לפי סוג, בונוסים, וקשרים שלא זוכו.
 * @param cfg — קונפיג מ-payment_config (ברירת מחדל: DEFAULTS).
 * @param period — { year, month } (month 0-indexed) לחודש היסטורי. ללא ערך → החודש הנוכחי.
 */
function calcConsultantDashboard(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null, toraniBonuses = []) {
  const { year, month } = resolvePeriod(period);

  // רק קשרים של היועץ, בפרויקטים בתשלום (אחדות+נעים להכיר, מאוחד), בחודש הקלנדרי הנוכחי.
  const monthly = interactions.filter(i => {
    const d = new Date(i.date);
    return Number(i.activist_id) === Number(activistId) &&
           countsForPayment(i) &&
           d.getMonth() === month && d.getFullYear() === year;
  });

  // שכר — מהמנוע האמיתי, כך שתואם בדיוק לעמוד התשלומים של הרכז (אותו חודש בדיוק).
  const salary = calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses, newParticipantBonuses, cfg, cancelledBonusKeys, { year, month }, toraniBonuses);

  // המונים נגזרים מה-breakdown של המנוע — כלומר מהקשרים ש**זוכו** — ולא מספירה עצמאית
  // של מה שדווח. מאז שהתקרה סופרת רק מפגשים ששולמו, ספירה עצמאית מציגה "חריגה" בזמן
  // שהמנוע עדיין ישלם על עוד מפגש: פעיל עם 18 פרונטליים שרק 14 מהם זוכו היה רואה
  // "18/15 חריגה" ובכל זאת מקבל תשלום על ה-19. desc נבנה כ-`${type} ${quality}`.
  const paidDescs   = salary.breakdown.filter(b => b.type === 'קשר').map(b => b.desc || '');
  const frontalDone = paidDescs.filter(d => d.startsWith('פרונטלי') && !d.includes('רב משתתפים')).length;
  // ערוץ הטלפון: תקרת cap_phone (25) במנוע חלה על כל טלפון+וידאו — לכן המונה סופר טלפון+וידאו (עקבי עם המנוע).
  const phoneDone   = paidDescs.filter(d => d.startsWith('טלפוני') || d.startsWith('וידאו')).length;
  const multiDone   = paidDescs.filter(d => d.startsWith('פרונטלי') && d.includes('רב משתתפים')).length;

  // `reported` = כמה דווחו בפועל (מעל משך המינימום), לצד `done` = כמה מהם תפסו משבצת.
  // כשהם נבדלים, זה בגלל תקרה מול לקוח מסוים — והפעיל צריך לראות את ההסבר ולא רק מספר
  // שנמוך ממה שהוא זוכר שעשה.
  const MIN_DUR = cfg.MIN_DURATION ?? 15;
  const qualifies = (i) => (i.duration_minutes ?? 0) >= MIN_DUR;
  const frontalReported = monthly.filter(i => i.type === 'פרונטלי' && i.quality !== 'רב משתתפים' && qualifies(i)).length;
  const phoneReported   = monthly.filter(i => (i.type === 'טלפוני' || i.type === 'וידאו') && qualifies(i)).length;
  const multiReported   = monthly.filter(i => i.type === 'פרונטלי' && i.quality === 'רב משתתפים' && qualifies(i)).length;

  const counters = {
    frontal:     { done: frontalDone, reported: frontalReported, cap: cfg.MONTHLY_CAPS.frontal, label: 'פגישות פרונטליות' },
    phoneTorani: { done: phoneDone,   reported: phoneReported,   cap: cfg.MONTHLY_CAPS.phone,   label: 'שיחות טלפון' },
    multi:       { done: multiDone,   reported: multiReported,   cap: cfg.MONTHLY_CAPS.multi,   label: 'מפגשים רבי-משתתפים' },
  };

  // קיבוץ השכר המזכה לפי סוג פעילות.
  const byType = {};
  for (const b of salary.breakdown.filter(x => x.type === 'קשר')) {
    if (!byType[b.desc]) byType[b.desc] = { label: b.desc, count: 0, subtotal: 0 };
    byType[b.desc].count++;
    byType[b.desc].subtotal += b.amount;
  }
  const salaryByType = Object.values(byType);
  const bonuses = salary.breakdown.filter(b => b.type !== 'קשר');

  return { counters, total: salary.total, salaryByType, bonuses, unpaid: salary.unpaid };
}

module.exports = { calcMonthlyPayment, calcInteractionPayment, getMonthlyTotalForActivist, paidBefore, calcConsultantDashboard, makeBonusKey, isDerivedInteraction, comparePaymentOrder, interactionBasePrice, deriveMitzvotBonuses, deriveToraniBonuses, previewNewMitzvotBonusCount, previewNewMitzvotBonusChanges, resolvePeriod, buildContactContext, DEFAULTS, MITZVOT_BONUS_PER_LEVEL, NEW_PARTICIPANT_BONUS, BASE_PRICES, MONTHLY_PAYMENT_CAP, PAID_PROJECT_IDS, FRIENDLY_ELIGIBLE_MONTHS, FRIENDLY_FRONTAL_MONTHLY_CAP, TORANI_BONUS_AMOUNT, TORANI_BONUS_MONTHS, isoYearMonth, monthsBetween };
