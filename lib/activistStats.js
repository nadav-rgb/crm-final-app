// lib/activistStats.js

// isPayableInteraction — מיובא מ-paymentCalc בלבד (מקור אחד של אמת)
// אין לבדוק "מזכה" כאן — השתמש בפונקציה מ-paymentCalc.js
const { calcInteractionPayment, comparePaymentOrder, isDerivedInteraction } = require('./paymentCalc');

// שורה נגזרת ממפגש רב-משתתפים היא תיעוד עבור *הלקוח הנוסף* שהשתתף, לא דיווח נפרד של
// הפעיל. בלי ההחרגה הזו מפגש אחד עם 2 לקוחות נראה כ-3 קשרים במוני האזור האישי
// (דיווחי מוטי שטרלינג 28.7 ושירה שם טוב 30.7: "הכנסתי שיחה אחת וזה נרשם כ-3 שיחות").
// מנוע התשלום כבר החריג אותן (countsForPayment) — רק התצוגה נשארה מאחור.
const isOwnReport = i => !isDerivedInteraction(i);

// תחילת החודש הקלנדרי. "קשרים החודש" חייב להתאפס ב-1 בחודש — חלון מתגלגל של 30 יום
// גורר לתוכו את סוף החודש הקודם (דיווח מוטי גלעד, 2026-08-02).
function monthStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function lastActiveDays(activistId, interactions) {
  const mine = interactions.filter(i => i.activist_id === activistId);
  if (!mine.length) return null;
  const today = new Date();
  const mostRecent = mine.map(i => new Date(i.date)).sort((a, b) => b - a)[0];
  return Math.floor((today - mostRecent) / 86400000);
}

// חלון מתגלגל של 30 יום — נשאר בשימוש רק במסכים שכתוב בהם במפורש "30 יום"
// (pages/activists.jsx, pages/activists/[id].jsx). למונה "החודש" יש
// interactionsThisMonth למטה.
function interactionsLast30(activistId, interactions) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return interactions.filter(i =>
    i.activist_id === activistId && isOwnReport(i) && new Date(i.date) >= cutoff
  ).length;
}

// קשרים שהפעיל דיווח מתחילת החודש הקלנדרי.
function interactionsThisMonth(activistId, interactions) {
  const start = monthStart();
  return interactions.filter(i =>
    i.activist_id === activistId && isOwnReport(i) && i.date && new Date(i.date) >= start
  ).length;
}

function timeInSystem(joinedAt) {
  if (!joinedAt) return '—';
  const days = Math.floor((new Date() - new Date(joinedAt)) / 86400000);
  if (days < 7)   return `${days} ימים`;
  if (days < 30)  return `${Math.floor(days / 7)} שבועות`;
  if (days < 365) return `${Math.floor(days / 30)} חודשים`;
  const years = Math.floor(days / 365);
  return years === 1 ? 'שנה' : `${years} שנים`;
}

// קשרים מזכים מתחילת החודש הקלנדרי (מבוסס על paymentCalc — מקור אחד).
// הסדר חייב להיות comparePaymentOrder ולא כרונולוגי, אחרת המונה יחליט אחרת מהמנוע
// על *מי* תפס את המשבצת האחרונה במכסה.
// @param cfg — הקונפיג מ-payment_config. **חובה להעביר אותו** כשהוא זמין: בלעדיו המונה
//   מתמחר לפי ברירות המחדל שבקוד, ותעריף שעודכן ב-DB יגרום למונה ולעמוד התשלומים
//   לחלוק על *מי* תפס את המשבצת האחרונה — בדיוק מה שהסדר הזה נועד למנוע.
function payableInteractionsThisMonth(activistId, interactions, contacts, projectId, cfg = undefined) {
  if (projectId !== 1) return interactionsThisMonth(activistId, interactions);
  const start = monthStart();

  // מחשבים לפי כל הפעילות החודשית של הפעיל — לא רק לכל לקוח
  const myMonthly = interactions.filter(i =>
    i.activist_id === activistId &&
    new Date(i.date) >= start &&
    i.project_id === 1
  ).sort((a, b) => comparePaymentOrder(a, b, cfg));

  // בניית מצב מצטבר לבדיקת מגבלות
  const accumulated = [];
  let payableCount = 0;

  for (const interaction of myMonthly) {
    const contact = contacts?.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact = accumulated.filter(i => i.contact_id === interaction.contact_id);
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg);
    // רק קשר שזוכה נספר מול התקרות — זהה ללולאה ב-calcMonthlyPayment.
    if (result.payable) { accumulated.push(interaction); payableCount++; }
  }

  return payableCount;
}

// תואר פעיל לפי כמות קשרים
function getActivistPerformanceLabel(count, projectId) {
  if (projectId !== 2) {
    // שאר הפרויקטים — בסיסי
    if (count === 0) return { label: 'רדום 😴',       color: '#888',    bg: '#f5f5f5' };
    if (count <= 3)  return { label: 'מתפקד 💪',       color: '#27ae60', bg: '#edfaf1' };
    return             { label: 'תפקוד גבוה 🔥',    color: '#8e44ad', bg: '#f5eef8' };
  }
  // אחדות יהודית — לפי קשרים מזכים
  if (count === 0) return { label: 'רדום 😴',          color: '#888',    bg: '#f5f5f5' };
  if (count <= 2)  return { label: 'מתפקד 💪',         color: '#27ae60', bg: '#edfaf1' };
  if (count <= 5)  return { label: 'נותן עבודה 🔥',   color: '#f39c12', bg: '#fff8ec' };
  if (count <= 9)  return { label: 'תפקוד גבוה ⭐',   color: '#8e44ad', bg: '#f5eef8' };
  return               { label: 'תפקוד עילית 👑',  color: '#c0392b', bg: '#fdf2f8' };
}

function getActivistPerformance(activistId, contacts, interactions) {
  const myContacts     = contacts.filter(c => c.activist_id === activistId);
  const myInteractions = interactions.filter(i => i.activist_id === activistId && isOwnReport(i));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const recent = myInteractions.filter(i => new Date(i.date) >= cutoff);
  const positiveRecent = recent.filter(i => i.outcome === 'חיובי').length;
  const deepContacts   = myContacts.filter(c => c.depth === 'עמוק' || c.depth === 'תורני').length;
  if (recent.length >= 3 && positiveRecent >= 2 && deepContacts >= 2) return 'high';
  if (recent.length >= 1) return 'active';
  return 'dormant';
}

module.exports = {
  lastActiveDays,
  interactionsLast30,
  interactionsThisMonth,
  timeInSystem,
  payableInteractionsThisMonth,
  getActivistPerformanceLabel,
  getActivistPerformance,
};
