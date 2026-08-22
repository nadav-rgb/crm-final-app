// lib/activistStats.js

function lastActiveDays(activistId, interactions) {
  const mine = interactions.filter(i => i.activist_id === activistId);
  if (!mine.length) return null;
  const today = new Date();
  const mostRecent = mine.map(i => new Date(i.date)).sort((a, b) => b - a)[0];
  return Math.floor((today - mostRecent) / 86400000);
}

function interactionsLast30(activistId, interactions) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return interactions.filter(i =>
    i.activist_id === activistId && new Date(i.date) >= cutoff
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

// isPayableInteraction — מיובא מ-paymentCalc בלבד (מקור אחד של אמת)
// אין לבדוק "מזכה" כאן — השתמש בפונקציה מ-paymentCalc.js
const { calcInteractionPayment, comparePaymentOrder } = require('./paymentCalc');

// קשרים מזכים בחודש האחרון (מבוסס על paymentCalc — מקור אחד)
function payableInteractionsLast30(activistId, interactions, contacts, projectId) {
  if (projectId !== 1) return interactionsLast30(activistId, interactions);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  // מחשבים לפי כל הפעילות החודשית של הפעיל — לא רק לכל לקוח
  const myMonthly = interactions.filter(i =>
    i.activist_id === activistId &&
    new Date(i.date) >= cutoff &&
    i.project_id === 1
  ).sort((a, b) => comparePaymentOrder(a, b)); // אותו סדר הקצאה כמו במנוע — אחרת המונה חלוק עליו

  // בניית מצב מצטבר לבדיקת מגבלות
  const accumulated = [];
  let payableCount = 0;

  for (const interaction of myMonthly) {
    const contact = contacts?.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact = accumulated.filter(i => i.contact_id === interaction.contact_id);
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated);
    accumulated.push(interaction);
    if (result.payable) payableCount++;
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
  const myInteractions = interactions.filter(i => i.activist_id === activistId);
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
  timeInSystem,
  payableInteractionsLast30,
  getActivistPerformanceLabel,
  getActivistPerformance,
};
