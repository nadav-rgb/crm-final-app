// lib/getStatus.js — סטטוס לקוח לפי ימים מאז קשר אחרון

function getStatus(days) {
  if (days === undefined || days === null) return 'דורש חידוש';
  if (days <= 14)  return 'קשר חי';
  if (days <= 30)  return 'קשר מתמשך';
  if (days <= 90)  return 'דורש חידוש';
  if (days <= 120) return 'על סף ניתוק';
  return 'לשעבר'; // מעל 120 יום
}

module.exports = getStatus;
