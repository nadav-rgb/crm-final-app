/**
 * paymentCalc.js — חישוב תשלומים לפעילי אחדות יהודית
 * ======================================================
 * TODO [future]: עדכן מחירים כאן בלבד
 */

// מחירון בסיסי
const BASE_PRICES = {
  'טלפוני-ידידותי':      150,
  'טלפוני-תורני':        200,
  'וידאו-תורני':         250,
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
 */
function comparePaymentOrder(a, b, cfg = DEFAULTS) {
  const priceDiff = interactionBasePrice(b, cfg) - interactionBasePrice(a, cfg);
  if (priceDiff !== 0) return priceDiff;
  const dateDiff = new Date(a.date) - new Date(b.date);
  if (dateDiff !== 0) return dateDiff;
  return Number(a.id ?? 0) - Number(b.id ?? 0);
}

// DEFAULTS — אובייקט הקונפיג מהקבועים לעיל. כל פונקציה מקבלת cfg אופציונלי (מ-payment_config ב-DB);
// אם לא הועבר — משתמשת בערכים האלה (תאימות-לאחור מלאה, No-Hard-Coding כשמעבירים cfg).
const DEFAULTS = {
  BASE_PRICES, MONTHLY_CAPS, PER_CONTACT_CAPS, LEARNING_BONUS,
  MITZVOT_BONUS_PER_LEVEL, NEW_PARTICIPANT_BONUS, MIN_DURATION, CAP_EXCEED_BLOCKS: false,
};

const EMPTY_SET = new Set();

/**
 * חישוב תשלום לקשר בודד
 * 
 * @param interaction         — הקשר הנוכחי
 * @param prevContactMonthly  — קשרים קודמים עם אותו לקוח החודש (לבדיקת מגבלת לקוח)
 * @param prevActivistMonthly — כל הקשרים הקודמים של הפעיל החודש (לבדיקת מגבלה חודשית כללית)
 * @param isHighPotential     — האם הלקוח פוטנציאל גבוה
 * מחזיר { amount, payable, reason }
 */
function calcInteractionPayment(interaction, prevContactMonthly, isHighPotential, prevActivistMonthly = null, cfg = DEFAULTS) {
  // cfg overrides (DB config) — מצללים את הקבועים. אם cfg לא הועבר, אלה ערכי ברירת המחדל.
  const BASE_PRICES      = cfg.BASE_PRICES;
  const MONTHLY_CAPS     = cfg.MONTHLY_CAPS;
  const PER_CONTACT_CAPS = cfg.PER_CONTACT_CAPS;
  const MIN_DUR          = cfg.MIN_DURATION ?? 15;
  const { type, quality, duration_minutes = 0 } = interaction;

  // קשר נגזר ממפגש רב-משתתפים — לתיעוד בלבד, התשלום כבר ניתן על השורה המקורית.
  if (isDerivedInteraction(interaction)) {
    return { amount: 0, payable: false, reason: 'משתתף במפגש רב-משתתפים — המפגש כבר זוכה בתשלום' };
  }

  // שורות נגזרות לא נספרות מול אף תקרה (חודשית או מול הלקוח) — הן לא "מפגש" בפני עצמו.
  prevContactMonthly  = (prevContactMonthly  || []).filter(i => !isDerivedInteraction(i));
  prevActivistMonthly = prevActivistMonthly ? prevActivistMonthly.filter(i => !isDerivedInteraction(i)) : null;

  // בדיקת משך מינימלי
  if (duration_minutes < MIN_DUR) {
    return { amount: 0, payable: false, reason: `פחות מ-${MIN_DUR} דקות` };
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
  if (!baseAmount) return { amount: 0, payable: false, reason: 'סוג קשר לא מזוהה' };

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
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg);
    accumulated.push(interaction);
    if (result.payable) total += result.amount;
  }

  return total;
}

/**
 * חישוב סה"כ תשלום חודשי לפעיל
 * כולל בונוסים
 * @param period — { year, month } (month 0-indexed) לחישוב חודש היסטורי. ללא ערך → החודש הנוכחי.
 */
function calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null) {
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

  for (const interaction of allSorted) {
    const contact = contacts.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact  = accumulated.filter(i => i.contact_id === interaction.contact_id);
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg);
    accumulated.push(interaction);

    if (result.payable) {
      total += result.amount;
      breakdown.push({ type: 'קשר', contactId: interaction.contact_id, contactName: contact?.name, amount: result.amount, desc: `${interaction.type} ${interaction.quality}` });
    } else {
      unpaid.push({ contactId: interaction.contact_id, contactName: contact?.name, date: interaction.date, desc: `${interaction.type} ${interaction.quality}`, reason: result.reason });
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

  return { total, breakdown, unpaid };
}

/**
 * calcConsultantDashboard — נתוני דשבורד ליועץ בודד לחודש הנוכחי.
 * מונים (פרונטלי/טלפון-תורני/רב-משתתפים מול תקרות), שכר משוער (מ-calcMonthlyPayment —
 * תואם בדיוק לעמוד התשלומים של הרכז), פירוט לפי סוג, בונוסים, וקשרים שלא זוכו.
 * @param cfg — קונפיג מ-payment_config (ברירת מחדל: DEFAULTS).
 * @param period — { year, month } (month 0-indexed) לחודש היסטורי. ללא ערך → החודש הנוכחי.
 */
function calcConsultantDashboard(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null) {
  const { year, month } = resolvePeriod(period);

  // רק קשרים של היועץ, בפרויקטים בתשלום (אחדות+נעים להכיר, מאוחד), בחודש הקלנדרי הנוכחי.
  const monthly = interactions.filter(i => {
    const d = new Date(i.date);
    return Number(i.activist_id) === Number(activistId) &&
           countsForPayment(i) &&
           d.getMonth() === month && d.getFullYear() === year;
  });

  // ספירה רק של קשרים מעל משך המינימום — תואם בדיוק לתקרות שהמנוע אוכף (≥MIN_DUR).
  const MIN_DUR = cfg.MIN_DURATION ?? 15;
  const qualifies = (i) => (i.duration_minutes ?? 0) >= MIN_DUR;
  const frontalDone = monthly.filter(i => i.type === 'פרונטלי' && i.quality !== 'רב משתתפים' && qualifies(i)).length;
  // ערוץ הטלפון: תקרת cap_phone (25) במנוע חלה על כל טלפון+וידאו — לכן המונה סופר טלפון+וידאו (עקבי עם המנוע).
  const phoneDone   = monthly.filter(i => (i.type === 'טלפוני' || i.type === 'וידאו') && qualifies(i)).length;
  const multiDone   = monthly.filter(i => i.type === 'פרונטלי' && i.quality === 'רב משתתפים' && qualifies(i)).length;

  const counters = {
    frontal:     { done: frontalDone, cap: cfg.MONTHLY_CAPS.frontal, label: 'פגישות פרונטליות' },
    phoneTorani: { done: phoneDone,   cap: cfg.MONTHLY_CAPS.phone,   label: 'שיחות טלפון' },
    multi:       { done: multiDone,   cap: cfg.MONTHLY_CAPS.multi,   label: 'מפגשים רבי-משתתפים' },
  };

  // שכר — מהמנוע האמיתי, כך שתואם בדיוק לעמוד התשלומים של הרכז (אותו חודש בדיוק).
  const salary = calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses, newParticipantBonuses, cfg, cancelledBonusKeys, { year, month });

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

module.exports = { calcMonthlyPayment, calcInteractionPayment, getMonthlyTotalForActivist, calcConsultantDashboard, makeBonusKey, isDerivedInteraction, comparePaymentOrder, interactionBasePrice, resolvePeriod, DEFAULTS, MITZVOT_BONUS_PER_LEVEL, NEW_PARTICIPANT_BONUS, BASE_PRICES, MONTHLY_PAYMENT_CAP, PAID_PROJECT_IDS };
