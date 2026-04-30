/**
 * StatusBadge — תגית סטטוס לקוח
 * ================================
 * TODO [future]: עדכן כאן את עיצוב תגיות הסטטוס
 * שמות סטטוס אחידים: קשר חי | קשר מתמשך | דורש חידוש | על סף ניתוק | לשעבר
 */

// מיפוי סטטוס → מחלקה
const STATUS_CLASS = {
  'קשר חי':       'badge badge--live',
  'קשר מתמשך':    'badge badge--ongoing',
  'דורש חידוש':   'badge badge--renew',
  'על סף ניתוק':  'badge badge--edge',
  'לשעבר':        'badge badge--former',
  // Legacy — TODO: הסר אחרי מיגרציה מלאה
  'תקין':   'badge badge--live',
  'דחוף':   'badge badge--renew',
  'קריטי':  'badge badge--edge',
  'דורש קשר': 'badge badge--ongoing',
};

export default function StatusBadge({ status }) {
  if (!status) return null;
  const className = STATUS_CLASS[status] ?? 'badge badge--former';
  return <span className={className}>{status}</span>;
}
