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
  'פרונטלי-ידידותי':     250,
  'פרונטלי-תורני':       300,
  'פרונטלי-רב משתתפים': 300,
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
const PER_CONTACT_CAPS = {
  high: { frontal: 6, phone: 10 },
  regular: { frontal: 2, phone: 4 },
};

// בונוסי התמדה בלימוד עם אותו לקוח
const LEARNING_BONUS = { 4: 600, 6: 850 };

// בונוס עליה בסרגל מצוות לדרגה
const MITZVOT_BONUS_PER_LEVEL = 600;

// בונוס הבאת משתתף חדש
const NEW_PARTICIPANT_BONUS = 250;

/**
 * חישוב תשלום לקשר בודד
 * 
 * @param interaction         — הקשר הנוכחי
 * @param prevContactMonthly  — קשרים קודמים עם אותו לקוח החודש (לבדיקת מגבלת לקוח)
 * @param prevActivistMonthly — כל הקשרים הקודמים של הפעיל החודש (לבדיקת מגבלה חודשית כללית)
 * @param isHighPotential     — האם הלקוח פוטנציאל גבוה
 * מחזיר { amount, payable, reason }
 */
function calcInteractionPayment(interaction, prevContactMonthly, isHighPotential, prevActivistMonthly = null) {
  const { type, quality, duration_minutes = 0 } = interaction;

  // בדיקת משך מינימלי
  if (duration_minutes < 15) {
    return { amount: 0, payable: false, reason: 'פחות מ-15 דקות' };
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
  const activistMonthly = prevActivistMonthly ?? prevContactMonthly;
  const phoneCountAll   = activistMonthly.filter(i => (i.type === 'טלפוני' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= 15).length;
  const frontalCountAll = activistMonthly.filter(i => i.type === 'פרונטלי' && (i.duration_minutes ?? 0) >= 15).length;

  if (isPhone   && phoneCountAll   >= MONTHLY_CAPS.phone)   return { amount: 0, payable: false, reason: `חרגת ממגבלת ${MONTHLY_CAPS.phone} שיחות טלפון חודשית` };
  if (isFrontal && frontalCountAll >= MONTHLY_CAPS.frontal) return { amount: 0, payable: false, reason: `חרגת ממגבלת ${MONTHLY_CAPS.frontal} מפגשים פרונטליים חודשית` };

  // בדיקת מגבלות עם אותו לקוח
  const caps = isHighPotential ? PER_CONTACT_CAPS.high : PER_CONTACT_CAPS.regular;
  const contactFrontal = prevContactMonthly.filter(i => i.type === 'פרונטלי' && (i.duration_minutes ?? 0) >= 15).length;
  const contactPhone   = prevContactMonthly.filter(i => (i.type === 'טלפוני' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= 15).length;

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
function getMonthlyTotalForActivist(activistId, allInteractions, allContacts) {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  const myMonthly = allInteractions
    .filter(i => {
      const d = new Date(i.date);
      return i.activist_id === activistId &&
             i.project_id  === 2 &&
             d.getMonth()  === month &&
             d.getFullYear() === year;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let total = 0;
  const accumulated = [];

  for (const interaction of myMonthly) {
    const contact = allContacts?.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact  = accumulated.filter(i => i.contact_id === interaction.contact_id);
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated);
    accumulated.push(interaction);
    if (result.payable) total += result.amount;
  }

  return total;
}

/**
 * חישוב סה"כ תשלום חודשי לפעיל
 * כולל בונוסים
 */
function calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = []) {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  const monthlyInteractions = interactions.filter(i => {
    const d = new Date(i.date);
    return i.activist_id === activistId &&
           d.getMonth() === month &&
           d.getFullYear() === year &&
           i.project_id === 2; // אחדות יהודית בלבד
  });

  let total = 0;
  const breakdown = [];

  // קשרים בסיסיים
  const contactsInteracted = [...new Set(monthlyInteractions.map(i => i.contact_id))];

  // עיבוד כרונולוגי — כל הקשרים לפי סדר תאריך
  // כך מגבלות חודשיות נבדקות נכון מצטבר
  const allSorted = [...monthlyInteractions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const accumulated = []; // כל הקשרים שעובדו עד כה

  for (const interaction of allSorted) {
    const contact = contacts.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact  = accumulated.filter(i => i.contact_id === interaction.contact_id);
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated);
    accumulated.push(interaction);

    if (result.payable) {
      total += result.amount;
      breakdown.push({ type: 'קשר', contactId: interaction.contact_id, contactName: contact?.name, amount: result.amount, desc: `${interaction.type} ${interaction.quality}` });
    }
  }

  // בונוסי התמדה בלימוד — לפי לקוח
  for (const contactId of contactsInteracted) {
    const contact = contacts.find(c => c.id === contactId);

    const contactInteractions = monthlyInteractions.filter(i => i.contact_id === contactId);
    const learningCount = contactInteractions.filter(i => i.quality === 'תורני' && (i.type === 'פרונטלי' || i.type === 'וידאו') && (i.duration_minutes ?? 0) >= 15).length;
    if (learningCount >= 6 && !breakdown.find(b => b.type === 'בונוס-לימוד-6' && b.contactId === contactId)) {
      total += LEARNING_BONUS[6];
      breakdown.push({ type: 'בונוס-לימוד-6', contactId, contactName: contact?.name, amount: LEARNING_BONUS[6], desc: '6 מפגשי לימוד עם אותו אדם' });
    } else if (learningCount >= 4 && !breakdown.find(b => b.type === 'בונוס-לימוד-4' && b.contactId === contactId)) {
      total += LEARNING_BONUS[4];
      breakdown.push({ type: 'בונוס-לימוד-4', contactId, contactName: contact?.name, amount: LEARNING_BONUS[4], desc: '4 מפגשי לימוד עם אותו אדם' });
    }
  }

  // בונוסי סרגל מצוות
  for (const bonus of mitzvotBonuses) {
    total += bonus.amount;
    breakdown.push({ type: 'בונוס-מצוות', amount: bonus.amount, desc: bonus.desc });
  }

  // בונוסי הבאת משתתף חדש
  for (const bonus of newParticipantBonuses) {
    total += NEW_PARTICIPANT_BONUS;
    breakdown.push({ type: 'בונוס-חדש', amount: NEW_PARTICIPANT_BONUS, desc: `הביא משתתף חדש דרך ${bonus.contactName}` });
  }

  return { total, breakdown };
}

module.exports = { calcMonthlyPayment, calcInteractionPayment, getMonthlyTotalForActivist, MITZVOT_BONUS_PER_LEVEL, NEW_PARTICIPANT_BONUS, BASE_PRICES, MONTHLY_PAYMENT_CAP };
