/**
 * activityByTypeExcel.js — דוח פעילות חודשי לפעיל, מסודר לפי סוג פעילות.
 * ========================================================================
 * מבוסס על מפרט: docs/superpowers/specs/2026-08-31-activist-activity-report-design.md
 *
 * deriveActivityByType (למטה) היא פונקציה טהורה — קוראת רק מפלט calcMonthlyPayment
 * (lib/paymentCalc.js), לא מחשבת תשלום בעצמה. כל שינוי במדיניות תשלום נכנס דרך
 * calcMonthlyPayment בלבד, לא מפה.
 */

// שמונת שורות הסוג, סדר קבוע — לא נגזר מסדר המפתחות ב-BASE_PRICES (לא עקבי בין
// וידאו לשאר הסוגים). quality: null = לא בודקים quality בכלל (אירוח שבת).
// label "זום" (לא "וידאו") — כך בדוגמה שנדב סיפק.
const TYPE_ROWS = [
  { label: 'טלפוני ידידותי',      type: 'טלפוני',    quality: 'ידידותי',    priceKey: 'טלפוני-ידידותי' },
  { label: 'טלפוני תורני',        type: 'טלפוני',    quality: 'תורני',      priceKey: 'טלפוני-תורני' },
  { label: 'זום ידידותי',         type: 'וידאו',     quality: 'ידידותי',    priceKey: 'וידאו-ידידותי' },
  { label: 'זום תורני',           type: 'וידאו',     quality: 'תורני',      priceKey: 'וידאו-תורני' },
  { label: 'פרונטלי ידידותי',     type: 'פרונטלי',   quality: 'ידידותי',    priceKey: 'פרונטלי-ידידותי' },
  { label: 'פרונטלי תורני',       type: 'פרונטלי',   quality: 'תורני',      priceKey: 'פרונטלי-תורני' },
  { label: 'פרונטלי רב משתתפים',  type: 'פרונטלי',   quality: 'רב משתתפים', priceKey: 'פרונטלי-רב משתתפים' },
  { label: 'אירוח שבת',           type: 'אירוח שבת', quality: null,         priceKey: 'אירוח שבת' },
];

// קטגוריות תוספות — בונוס-לימוד-4 ובונוס-לימוד-6 מתמזגים ל"בונוס לימוד" אחד
// (ראה מפרט, סעיף "טבלת תוספות"). סדר הקטגוריות = סדר ההופעה בגיליון.
const BONUS_CATEGORIES = [
  { label: 'בונוס לימוד',       types: ['בונוס-לימוד-4', 'בונוס-לימוד-6'] },
  { label: 'בונוס עליה במצוות', types: ['בונוס-מצוות'] },
  { label: 'בונוס משתתף חדש',   types: ['בונוס-חדש'] },
];

/**
 * deriveActivityByType — ממיינת פלט calcMonthlyPayment לפי סוג פעילות.
 * @param report        — { breakdown, unpaid } מ-calcMonthlyPayment (אחרי תוספת השדות ב-Task 1)
 * @param expensesTotal — סכום החזר הוצאות בחודש (כבר מחושב ב-payments.jsx/[id].jsx)
 * @param guidePay      — שכר הדרכת סיורים בחודש (כבר מחושב שם)
 * @param cfg            — DEFAULTS מ-paymentCalc.js או קונפיג מ-payment_config
 */
function deriveActivityByType(report, expensesTotal = 0, guidePay = 0, cfg) {
  const { DEFAULTS } = require('./paymentCalc.js');
  cfg = cfg || DEFAULTS;
  const breakdown = report?.breakdown || [];
  const unpaid    = report?.unpaid || [];
  const meetingRows = breakdown.filter(b => b.type === 'קשר');

  const matchesType = (row, t) => row.interactionType === t.type && (t.quality === null || row.quality === t.quality);

  const typeRows = TYPE_ROWS.map(t => {
    const rows = meetingRows.filter(m => matchesType(m, t));
    return {
      label: t.label,
      count: rows.length,
      rate: cfg.BASE_PRICES?.[t.priceKey] ?? null,
      total: rows.reduce((s, m) => s + m.amount, 0),
    };
  });
  const meetingsTotal = typeRows.reduce((s, r) => s + r.total, 0);

  const bonusRows = BONUS_CATEGORIES.map(cat => {
    const rows = breakdown.filter(b => cat.types.includes(b.type));
    if (!rows.length) return null;
    const detail = rows.length === 1 ? rows[0].desc : rows.map(r => r.contactName).join(' + ');
    return { label: cat.label, count: rows.length, detail, amount: rows.reduce((s, r) => s + r.amount, 0) };
  }).filter(Boolean);

  const expensesRow = expensesTotal > 0 ? { label: 'החזר הוצאות', amount: expensesTotal } : null;
  const guideRow    = guidePay > 0     ? { label: 'הדרכת סיורים', amount: guidePay } : null;

  const bonusTotal = bonusRows.reduce((s, r) => s + r.amount, 0) + (expensesRow?.amount ?? 0) + (guideRow?.amount ?? 0);
  const grandTotal = meetingsTotal + bonusTotal;

  const unpaidByReasonMap = new Map();
  for (const u of unpaid) unpaidByReasonMap.set(u.reason, (unpaidByReasonMap.get(u.reason) ?? 0) + 1);

  const detailByType = {};
  for (const t of TYPE_ROWS) {
    detailByType[t.label] = meetingRows
      .filter(m => matchesType(m, t))
      .map(m => ({ name: m.contactName, amount: m.amount, note: m.duration_minutes != null ? `${m.duration_minutes} ד'` : '' }));
  }

  return {
    typeRows, meetingsTotal, bonusRows, expensesRow, guideRow, grandTotal,
    unpaidCount: unpaid.length,
    unpaidByReason: [...unpaidByReasonMap.entries()].map(([reason, count]) => ({ reason, count })),
    detailByType,
  };
}

module.exports = { deriveActivityByType, TYPE_ROWS, BONUS_CATEGORIES };
