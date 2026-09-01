# דוח פעילות חודשי לפעיל (Excel) — תוכנית מימוש

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להוסיף שני כפתורי ייצוא Excel — דוח פעילות לפי סוג לפעיל בודד (`pages/payments/[id].jsx`), ודוח מרוכז לכל הפעילים (`pages/payments.jsx`) — בהתאם למפרט ב-`docs/superpowers/specs/2026-08-31-activist-activity-report-design.md`.

**Architecture:** `calcMonthlyPayment` (הקיים, `lib/paymentCalc.js`) מקבל 4 שדות גולמיים נוספים על שורותיו. קובץ חדש `lib/activityByTypeExcel.js` מכיל פונקציה טהורה שממיינת את הפלט לפי סוג פעילות, ופונקציות exceljs שכותבות גיליונות מהמבנה הזה — לפעיל בודד ולקובץ מרוכז. שני העמודים קוראים לפונקציות ההורדה בלבד.

**Tech Stack:** Next.js Pages Router, `exceljs` (import דינמי), CommonJS ב-`lib/`, בדיקות עצמאיות עם `node scripts/verify-*.cjs` (אין framework בדיקות בפרויקט).

## Global Constraints

- כל שינוי ב-`calcMonthlyPayment` הוא **תוספת שדות בלבד** — אסור לשנות/למחוק שדה קיים בפלט.
- `bonus_key` (פורמט `${activistId}|${type}|${contactId}|${monthKey}`) אסור בהחלט להשתנות — אין נגיעה בו בתוכנית הזו.
- אחרי כל שינוי: `npm run build` חייב לעבור נקי (חוק עבודה, `CLAUDE.md`).
- כל שינוי במנוע התשלום: `node scripts/verify-payment-order.cjs` (בלי DB) חייב לעבור, 0 כשלים.
- שמות עמודות/כותרות בעברית, גיליונות RTL, כמו בכל קובצי ה-`lib/*Excel.js` הקיימים.
- אין להשתמש ב-`git commit --amend`; כל שלב commit יוצר קומיט חדש.

---

## File Structure

- **Modify** `lib/paymentCalc.js` — שדות גולמיים נוספים על `breakdown`/`unpaid` ב-`calcMonthlyPayment` (Task 1).
- **Modify** `scripts/verify-payment-order.cjs` — בדיקת השדות החדשים (Task 1).
- **Create** `lib/activityByTypeExcel.js` — כל לוגיקת הדוח: גזירה טהורה + בניית חוברות עבודה + הורדה (Tasks 2–4).
- **Create** `scripts/verify-activity-report.cjs` — בדיקות עצמאיות ל-`lib/activityByTypeExcel.js`, בדפוס `scripts/verify-payroll-xlsx.cjs` (Tasks 2–4).
- **Modify** `pages/payments/[id].jsx` — כפתור ייצוא פעיל בודד (Task 5).
- **Modify** `pages/payments.jsx` — כפתור ייצוא מרוכז (Task 5).

---

### Task 1: שדות גולמיים על breakdown/unpaid

**Files:**
- Modify: `lib/paymentCalc.js:451` (שורת `breakdown.push` מסוג `'קשר'`), `lib/paymentCalc.js:453` (שורת `unpaid.push`)
- Test: `scripts/verify-payment-order.cjs`

**Interfaces:**
- Produces: שורת `breakdown` מסוג `'קשר'` כוללת מעתה גם `date` (string), `duration_minutes` (number), `interactionType` (string), `quality` (string). שורת `unpaid` כוללת מעתה גם `duration_minutes`, `interactionType`, `quality` (כבר יש לה `date`). ⚠️ השדה נקרא `interactionType`, לא `type` — ראה ההערה בסוף Step 3 למטה.

- [ ] **Step 1: הוסף בדיקה כושלת ל-`scripts/verify-payment-order.cjs`**

הוסף בסוף הקובץ, **לפני** שורת `console.log(failures === 0 ...)` הסוגרת:

```js
// ────────────────────────────────────────────────────────────────────────────
// דיווח נוסף (2026-08-31) — דוח פעילות לפי סוג (lib/activityByTypeExcel.js) צריך
// date/duration_minutes/type/quality גולמיים על שורות breakdown/unpaid, לא רק
// desc מחורז ("פרונטלי תורני"). נבדק ישירות מול calcMonthlyPayment.
// ────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    { activist_id: 7, project_id: 1, id: 900, contact_id: 1, type: 'פרונטלי', quality: 'תורני', duration_minutes: 45, date: '2026-07-05' },
    { activist_id: 7, project_id: 1, id: 901, contact_id: 1, type: 'פרונטלי', quality: 'תורני', duration_minutes: 5,  date: '2026-07-06' }, // מתחת למינימום — לא זוכה
  ];
  const r = calcMonthlyPayment(7, rows, contacts, [], [], DEFAULTS, new Set(), JULY);
  const paidRow = r.breakdown.find(b => b.type === 'קשר');
  check('שדות גולמיים בשורת breakdown זוכה',
    [paidRow?.date, paidRow?.duration_minutes, paidRow?.interactionType, paidRow?.quality],
    ['2026-07-05', 45, 'פרונטלי', 'תורני']);
  const unpaidRow = r.unpaid[0];
  check('שדות גולמיים בשורת unpaid',
    [unpaidRow?.duration_minutes, unpaidRow?.interactionType, unpaidRow?.quality],
    [5, 'פרונטלי', 'תורני']);
}
```

- [ ] **Step 2: הרץ ווודא כשל**

Run: `node scripts/verify-payment-order.cjs`
Expected: `✗ FAIL — שדות גולמיים בשורת breakdown זוכה` (ו-unpaid) — שאר הבדיקות עוברות.

- [ ] **Step 3: הוסף את השדות ב-`calcMonthlyPayment`**

ב-`lib/paymentCalc.js`, שנה את השורה הזו (מס' 451):

```js
      breakdown.push({ type: 'קשר', contactId: interaction.contact_id, contactName: contact?.name, amount: result.amount, desc: `${interaction.type} ${interaction.quality}` });
```

ל:

```js
      breakdown.push({ type: 'קשר', contactId: interaction.contact_id, contactName: contact?.name, amount: result.amount, desc: `${interaction.type} ${interaction.quality}`, date: interaction.date, duration_minutes: interaction.duration_minutes, interactionType: interaction.type, quality: interaction.quality });
```

ואת השורה הזו (מס' 453):

```js
      unpaid.push({ contactId: interaction.contact_id, contactName: contact?.name, date: interaction.date, desc: `${interaction.type} ${interaction.quality}`, reason: result.reason });
```

ל:

```js
      unpaid.push({ contactId: interaction.contact_id, contactName: contact?.name, date: interaction.date, desc: `${interaction.type} ${interaction.quality}`, reason: result.reason, duration_minutes: interaction.duration_minutes, interactionType: interaction.type, quality: interaction.quality });
```

⚠️ שים לב: השדה נקרא `interactionType`, **לא** `type` — כי `breakdown`/`unpaid` כבר משתמשים ב-`type` לסוג-השורה עצמה (`'קשר'`, `'בונוס-מצוות'` וכו'). קריאה ל-`row.type` על שורת breakdown חייבת להמשיך להחזיר `'קשר'`.

- [ ] **Step 4: הרץ ווודא הצלחה**

Run: `node scripts/verify-payment-order.cjs`
Expected: כל הבדיקות `✓ PASS`, כולל השתיים החדשות. `\nכל הבדיקות עברו.`

- [ ] **Step 5: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 6: Commit**

```bash
git add lib/paymentCalc.js scripts/verify-payment-order.cjs
git commit -m "feat: add raw date/duration/type/quality fields to payment breakdown rows"
```

---

### Task 2: `deriveActivityByType` — גזירה טהורה לפי סוג פעילות

**Files:**
- Create: `lib/activityByTypeExcel.js`
- Create: `scripts/verify-activity-report.cjs`

**Interfaces:**
- Consumes: פלט `calcMonthlyPayment` מ-Task 1 — `{ breakdown: [{type, contactId, contactName, amount, desc, date, duration_minutes, interactionType, quality, key?}], unpaid: [{contactId, contactName, date, desc, reason, duration_minutes, interactionType, quality}] }`, ועוד `expensesTotal` (number), `guidePay` (number), `cfg` (אופציונלי, ברירת מחדל `DEFAULTS` מ-`lib/paymentCalc.js`).
- Produces: `deriveActivityByType(report, expensesTotal, guidePay, cfg) → ActivityData`, כאשר:
  ```js
  ActivityData = {
    typeRows: [{ label: string, count: number, rate: number|null, total: number }],  // תמיד 8 שורות, בסדר קבוע
    meetingsTotal: number,
    bonusRows: [{ label: string, count: number, detail: string, amount: number }],   // רק קטגוריות שקיימות בפועל
    expensesRow: { label: 'החזר הוצאות', amount: number } | null,
    guideRow: { label: 'הדרכת סיורים', amount: number } | null,
    grandTotal: number,
    unpaidCount: number,
    unpaidByReason: [{ reason: string, count: number }],
    detailByType: { [label: string]: [{ name: string, amount: number, note: string }] },  // מפתח = typeRows[i].label, גם כשריק
  }
  ```

- [ ] **Step 1: כתוב את קובץ הבדיקה עם בדיקות כושלות**

צור `scripts/verify-activity-report.cjs`:

```js
// scripts/verify-activity-report.cjs — בדיקות דוח הפעילות לפי סוג (lib/activityByTypeExcel.js).
// שימוש: node scripts/verify-activity-report.cjs
// שלב 1 (בקובץ הזה): נתונים סינתטיים בלבד, כמו scripts/verify-payment-order.cjs.
const { calcMonthlyPayment, DEFAULTS } = require('../lib/paymentCalc.js');
const { deriveActivityByType } = require('../lib/activityByTypeExcel.js');

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

const contacts = [
  { id: 1, name: 'יוסי כהן' }, { id: 2, name: 'דנה לוי' }, { id: 3, name: 'רון גל' },
];
const AUG = { year: 2026, month: 7 }; // month 0-indexed, אוגוסט = 7

// ────────────────────────────────────────────────────────────────────────────
// תרחיש הדוגמה שנדב סיפק (ניר קובי אוגוסט לפי סוג פעילות.xlsx), מצומצם.
// ────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'טלפוני', quality: 'ידידותי', duration_minutes: 20, date: '2026-08-01' },
    { activist_id: 7, project_id: 1, id: 2, contact_id: 1, type: 'טלפוני', quality: 'תורני',    duration_minutes: 20, date: '2026-08-02' },
    { activist_id: 7, project_id: 1, id: 3, contact_id: 2, type: 'טלפוני', quality: 'תורני',    duration_minutes: 20, date: '2026-08-03' },
    { activist_id: 7, project_id: 1, id: 4, contact_id: 3, type: 'וידאו',  quality: 'תורני',    duration_minutes: 30, date: '2026-08-04' },
    { activist_id: 7, project_id: 1, id: 5, contact_id: 1, type: 'טלפוני', quality: 'תורני',    duration_minutes: 5,  date: '2026-08-05' }, // לא זוכה — פחות מ-15 ד'
  ];
  const report = calcMonthlyPayment(7, rows, contacts, [], [], DEFAULTS, new Set(), AUG);
  const data = deriveActivityByType(report, 0, 0);

  check('8 שורות סוג, בסדר קבוע', data.typeRows.map(r => r.label), [
    'טלפוני ידידותי', 'טלפוני תורני', 'זום ידידותי', 'זום תורני',
    'פרונטלי ידידותי', 'פרונטלי תורני', 'פרונטלי רב משתתפים', 'אירוח שבת',
  ]);
  check('טלפוני ידידותי: 1 מפגש, תעריף 150, סה"כ 150',
    data.typeRows[0], { label: 'טלפוני ידידותי', count: 1, rate: 150, total: 150 });
  check('טלפוני תורני: 2 מפגשים (השלישי לא זוכה), תעריף 200, סה"כ 400',
    data.typeRows[1], { label: 'טלפוני תורני', count: 2, rate: 200, total: 400 });
  check('זום תורני מוצג בתווית "זום", לא "וידאו"',
    data.typeRows[3], { label: 'זום תורני', count: 1, rate: 250, total: 250 });
  check('פרונטלי רב משתתפים: 0 מפגשים, תעריף מוצג, סה"כ 0',
    data.typeRows[6], { label: 'פרונטלי רב משתתפים', count: 0, rate: 300, total: 0 });
  check('meetingsTotal = סכום כל שורות הסוג', data.meetingsTotal, 150 + 400 + 250);
  check('grandTotal = meetingsTotal כשאין בונוסים/הוצאות', data.grandTotal, data.meetingsTotal);
  check('מפגש שלא זוכה מופיע ב-unpaidByReason', data.unpaidByReason, [{ reason: 'פחות מ-15 דקות', count: 1 }]);
  check('detailByType["טלפוני תורני"] כולל שם + סכום + הערת-משך',
    data.detailByType['טלפוני תורני'],
    [{ name: 'דנה לוי', amount: 200, note: "20 ד'" }, { name: 'יוסי כהן', amount: 200, note: "20 ד'" }]);
  check('detailByType["פרונטלי רב משתתפים"] ריק כשאין מפגשים', data.detailByType['פרונטלי רב משתתפים'], []);
}

// ────────────────────────────────────────────────────────────────────────────
// קיבוץ תוספות: כמות=1 → פירוט=desc; כמות>1 → פירוט=שמות מחוברים ב-" + ".
// בונוס-לימוד-4 ובונוס-לימוד-6 מתמזגים לקטגוריה אחת "בונוס לימוד".
// ────────────────────────────────────────────────────────────────────────────
{
  const report = {
    breakdown: [
      { type: 'בונוס-לימוד-4', contactId: 1, contactName: 'יוסי כהן', amount: 600, desc: '4 מפגשי לימוד עם אותו אדם' },
      { type: 'בונוס-חדש', contactId: 2, contactName: 'אבנט קליינר', amount: 250, desc: 'הביא משתתף חדש דרך אבנט קליינר' },
      { type: 'בונוס-חדש', contactId: 3, contactName: 'אייל קוגן', amount: 250, desc: 'הביא משתתף חדש דרך אייל קוגן' },
    ],
    unpaid: [],
  };
  const data = deriveActivityByType(report, 356, 0);
  check('3 שורות תוספות: לימוד, חדש, הוצאות (בלי סיורים — guidePay=0)',
    data.bonusRows.map(r => r.label), ['בונוס לימוד', 'בונוס משתתף חדש']);
  check('בונוס לימוד: כמות 1, פירוט = desc',
    data.bonusRows[0], { label: 'בונוס לימוד', count: 1, detail: '4 מפגשי לימוד עם אותו אדם', amount: 600 });
  check('בונוס משתתף חדש: כמות 2, פירוט = שמות מחוברים',
    data.bonusRows[1], { label: 'בונוס משתתף חדש', count: 2, detail: 'אבנט קליינר + אייל קוגן', amount: 500 });
  check('שורת הוצאות מופיעה כש-expensesTotal > 0',
    data.expensesRow, { label: 'החזר הוצאות', amount: 356 });
  check('אין שורת הדרכת-סיורים כש-guidePay = 0', data.guideRow, null);
  check('grandTotal = meetingsTotal(0) + לימוד(600) + חדש(500) + הוצאות(356)',
    data.grandTotal, 600 + 500 + 356);
}

// ────────────────────────────────────────────────────────────────────────────
// unpaidByReason מקבץ כמה סיבות שונות בנפרד, לא מציג רק את הראשונה.
// ────────────────────────────────────────────────────────────────────────────
{
  const report = {
    breakdown: [],
    unpaid: [
      { contactId: 1, contactName: 'א', date: '2026-08-01', reason: 'פחות מ-15 דקות', duration_minutes: 5, interactionType: 'טלפוני', quality: 'תורני' },
      { contactId: 1, contactName: 'א', date: '2026-08-02', reason: 'פחות מ-15 דקות', duration_minutes: 5, interactionType: 'טלפוני', quality: 'תורני' },
      { contactId: 2, contactName: 'ב', date: '2026-08-03', reason: 'חרגת ממגבלת לקוח', duration_minutes: 60, interactionType: 'פרונטלי', quality: 'תורני' },
    ],
  };
  const data = deriveActivityByType(report, 0, 0);
  check('unpaidCount סופר את כולם', data.unpaidCount, 3);
  check('unpaidByReason: שתי סיבות שונות, כל אחת עם המספר שלה',
    data.unpaidByReason, [{ reason: 'פחות מ-15 דקות', count: 2 }, { reason: 'חרגת ממגבלת לקוח', count: 1 }]);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: הרץ ווודא כשל (הפונקציה עוד לא קיימת)**

Run: `node scripts/verify-activity-report.cjs`
Expected: שגיאה — `Cannot find module '../lib/activityByTypeExcel.js'` (הקובץ עוד לא קיים).

- [ ] **Step 3: צור את `lib/activityByTypeExcel.js` עם `deriveActivityByType`**

```js
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
```

⚠️ הערה חשובה על **סדר** התוצאות בבדיקות: `Array.prototype.filter` שומר סדר-הופעה מקורי. `meetingRows` בנוי מ-`breakdown`, שנבנה ב-`calcMonthlyPayment` לפי `comparePaymentOrder` (מחיר יורד → תאריך עולה). בבדיקת "detailByType['טלפוני תורני']" למעלה, שני המפגשים (יוסי כהן ודנה לוי) **באותו מחיר** (200), כך שהסדר ביניהם נקבע ע"י תאריך עולה — דנה לוי (03/08) לפני יוסי כהן (02/08 היה השני שנרשם אך תאריכו 02/08 מוקדם יותר)... **בדוק בפועל את סדר הפלט בהרצה הראשונה של הבדיקה ותקן את ה-`expected` בהתאם אם הוא הפוך** — זו בדיקת רגרסיה על ההתנהגות בפועל, לא מפרט נורמטיבי לסדר הזה.

- [ ] **Step 4: הרץ ווודא הצלחה (עם תיקון סדר אם נדרש, לפי ההערה למעלה)**

Run: `node scripts/verify-activity-report.cjs`
Expected: כל הבדיקות `✓ PASS`. אם `detailByType['טלפוני תורני']` נכשל רק על סדר השורות — עדכן את מערך ה-`expected` בבדיקה לסדר שבאמת התקבל (הדפס `data.detailByType['טלפוני תורני']` עם `console.log` זמנית אם צריך), לא את הקוד ב-`activityByTypeExcel.js`.

- [ ] **Step 5: Commit**

```bash
git add lib/activityByTypeExcel.js scripts/verify-activity-report.cjs
git commit -m "feat: add deriveActivityByType pure grouping for activity report"
```

---

### Task 3: גיליון לפעיל בודד — Excel

**Files:**
- Modify: `lib/activityByTypeExcel.js`
- Modify: `scripts/verify-activity-report.cjs`

**Interfaces:**
- Consumes: `ActivityData` מ-Task 2, `activistName` (string), `monthName` (string, למשל `'אוגוסט'`), `year` (number).
- Produces:
  - `writeSummaryBlock(ws, startRow, activistName, monthName, year, data) → nextRow` (number) — כותב בלוקים 1–5 מהמפרט, מתחיל בשורה `startRow`.
  - `writeDetailBlock(ws, startRow, data) → nextRow` — כותב בלוק 6 (פירוט לפי סוג).
  - `async function buildActivityWorkbook(activistName, monthName, year, data) → ExcelJS.Workbook` — גיליון אחד, `writeSummaryBlock` ואז `writeDetailBlock`.
  - `async function exportActivityXlsx(activistName, monthName, year, data)` — הורדה בדפדפן (כמו `exportPayrollXlsx`).

- [ ] **Step 1: הוסף בדיקות כושלות ל-`scripts/verify-activity-report.cjs`**

הוסף בסוף הקובץ (לפני `console.log(failures === 0 ...)`):

```js
// ────────────────────────────────────────────────────────────────────────────
// buildActivityWorkbook — נכתב ל-Node, נקרא בחזרה, מבנה + נוסחאות + RTL תקינים.
// ────────────────────────────────────────────────────────────────────────────
{
  const { buildActivityWorkbook } = require('../lib/activityByTypeExcel.js');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const report = calcMonthlyPayment(7, [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'טלפוני', quality: 'תורני', duration_minutes: 20, date: '2026-08-01' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);
  const data = deriveActivityByType(report, 0, 0);

  (async () => {
    const wb = await buildActivityWorkbook('בדיקה אוטומטית', 'אוגוסט', 2026, data);
    const outPath = path.join(os.tmpdir(), 'activity-report-single-test.xlsx');
    await wb.xlsx.writeFile(outPath);

    const ExcelJS = (await import('exceljs')).default;
    const back = new ExcelJS.Workbook();
    await back.xlsx.readFile(outPath);
    const ws = back.worksheets[0];

    check('שם הגיליון = שם הפעיל', ws?.name, 'בדיקה אוטומטית');
    check('הגיליון נשמר RTL', Boolean(ws?.views?.[0]?.rightToLeft), true);

    // מוצא את שורת "טלפוני תורני" בטבלת הסוגים ומוודא את הערכים שלה.
    let toraniRow = null;
    ws.eachRow(row => { if (row.getCell(1).value === 'טלפוני תורני') toraniRow = row; });
    check('שורת "טלפוני תורני" קיימת בגיליון', Boolean(toraniRow), true);
    if (toraniRow) {
      check('טלפוני תורני: מספר מפגשים=1, תעריף=200, סה"כ=200',
        [toraniRow.getCell(2).value, toraniRow.getCell(3).value, toraniRow.getCell(4).value],
        [1, 200, 200]);
    }

    // שורת "סה"כ קשרים/מפגשים מזכים" חייבת להיות נוסחת SUM, לא ערך קפוא.
    let totalMeetingsRow = null;
    ws.eachRow(row => { if (row.getCell(1).value === 'סה"כ קשרים/מפגשים מזכים') totalMeetingsRow = row; });
    check('שורת סיכום מפגשים היא נוסחת SUM',
      Boolean(totalMeetingsRow?.getCell(4)?.value?.formula), true);

    console.log(failures === 0 ? '\nכל הבדיקות עברו (כולל buildActivityWorkbook).' : `\n${failures} בדיקות נכשלו.`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
```

⚠️ שים לב: הבלוק הזה **א-סינכרוני** ומכיל את קריאת ה-`console.log`/`process.exit` הסופית בתוכו (כי `buildActivityWorkbook` הוא `async`). **הסר** את שורת `console.log(failures === 0 ...)` ואת `process.exit(...)` המקוריות בסוף הקובץ (מ-Task 2) כדי שלא ירוצו לפני שהבלוק הא-סינכרוני מסיים — הבלוק הזה הוא עכשיו הסיום היחיד של הקובץ.

- [ ] **Step 2: הרץ ווודא כשל**

Run: `node scripts/verify-activity-report.cjs`
Expected: שגיאה — `buildActivityWorkbook is not a function` או `undefined`.

- [ ] **Step 3: הוסף את פונקציות הכתיבה ל-`lib/activityByTypeExcel.js`**

הוסף בסוף הקובץ, לפני שורת `module.exports`:

```js
const MONEY_FORMAT = '#,##0 ₪';
const HEADER_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6C5CE7' } };
const HEADER_FONT   = { bold: true, color: { argb: 'FFFFFFFF' } };
const SUBTOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EFFE' } };

// שם גיליון תקין: עד 31 תווים, בלי : \ / ? * [ ]
function safeSheetName(name) {
  return String(name || 'גיליון').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
}

function styleHeaderRow(row) {
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', horizontal: 'center' };
}

/**
 * writeSummaryBlock — כותב בלוקים 1–5 (כותרת, טבלת סוגים, תוספות, סה"כ, הערת-שוליים)
 * החל משורה startRow. מחזיר את השורה הפנויה הבאה (לשימוש בערימה בלשונית המרוכזת).
 */
function writeSummaryBlock(ws, startRow, activistName, monthName, year, data) {
  let r = startRow;

  ws.getCell(r, 1).value = `${monthName} ${year} — ${activistName}`;
  ws.getCell(r, 1).font = { bold: true, size: 13 };
  r += 1;

  // טבלת סוגי פעילות
  const typeHeaderRow = ws.getRow(r);
  typeHeaderRow.values = ['סוג הפעילות', 'מספר מפגשים', 'תעריף', 'סה"כ לתשלום'];
  styleHeaderRow(typeHeaderRow);
  r += 1;
  const firstTypeRow = r;
  for (const row of data.typeRows) {
    ws.getRow(r).values = [row.label, row.count, row.count > 0 ? row.rate : '—', row.total];
    ws.getCell(r, 4).numFmt = MONEY_FORMAT;
    r += 1;
  }
  const lastTypeRow = r - 1;
  const totalMeetingsRow = ws.getRow(r);
  totalMeetingsRow.getCell(1).value = 'סה"כ קשרים/מפגשים מזכים';
  totalMeetingsRow.getCell(4).value = { formula: `SUM(D${firstTypeRow}:D${lastTypeRow})` };
  totalMeetingsRow.getCell(4).numFmt = MONEY_FORMAT;
  totalMeetingsRow.font = { bold: true };
  totalMeetingsRow.fill = SUBTOTAL_FILL;
  r += 2; // שורה ריקה אחרי

  // טבלת תוספות (רק אם יש בכלל תוספת)
  const additions = [...data.bonusRows, data.expensesRow, data.guideRow].filter(Boolean);
  let additionsTotalFormulaRange = null;
  if (additions.length > 0) {
    const addHeaderRow = ws.getRow(r);
    addHeaderRow.values = ['תוספות', 'כמות', 'פירוט', 'סה"כ'];
    styleHeaderRow(addHeaderRow);
    r += 1;
    const firstAddRow = r;
    for (const add of additions) {
      ws.getRow(r).values = [add.label, add.count ?? 1, add.detail ?? '', add.amount];
      ws.getCell(r, 4).numFmt = MONEY_FORMAT;
      r += 1;
    }
    additionsTotalFormulaRange = [firstAddRow, r - 1];
    r += 1; // שורה ריקה
  }

  // שורת סה"כ לתשלום — נוסחה, לא ערך קפוא
  const grandRow = ws.getRow(r);
  grandRow.getCell(1).value = `סה"כ לתשלום ${monthName} ${year}`;
  grandRow.getCell(4).value = additionsTotalFormulaRange
    ? { formula: `D${firstTypeRow - 1 + 1}+SUM(D${firstTypeRow}:D${lastTypeRow})+SUM(D${additionsTotalFormulaRange[0]}:D${additionsTotalFormulaRange[1]})` }
    : { formula: `SUM(D${firstTypeRow}:D${lastTypeRow})` };
  grandRow.getCell(4).numFmt = MONEY_FORMAT;
  grandRow.font = { bold: true, size: 12 };
  r += 1;

  // הערת שוליים — מפגשים שלא זוכו
  if (data.unpaidCount > 0) {
    const reasonsText = data.unpaidByReason.map(u => `${u.count} — ${u.reason}`).join(' · ');
    ws.getCell(r, 1).value = `לא זוכו: ${data.unpaidCount} קשרים — ${reasonsText}`;
    ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF999999' } };
    r += 1;
  }

  return r + 1; // שורה ריקה לפני מה שיבוא אחרי
}

/**
 * writeDetailBlock — כותב את בלוק 6 (פירוט לפי סוג) החל משורה startRow.
 * מחזיר את השורה הפנויה הבאה.
 */
function writeDetailBlock(ws, startRow, data) {
  let r = startRow;
  ws.getCell(r, 1).value = 'פירוט מלא — מסודר לפי סוג הפעילות';
  ws.getCell(r, 1).font = { bold: true, size: 13 };
  r += 1;

  for (const typeRow of data.typeRows) {
    const meetings = data.detailByType[typeRow.label] || [];
    ws.getCell(r, 1).value = `${typeRow.label} — ${typeRow.count} מפגשים`;
    ws.getCell(r, 2).value = typeRow.total;
    ws.getCell(r, 2).numFmt = MONEY_FORMAT;
    ws.getCell(r, 1).font = { bold: true };
    r += 1;

    const miniHeaderRow = ws.getRow(r);
    miniHeaderRow.values = [`מס'`, 'שם', 'סכום', 'הערה'];
    styleHeaderRow(miniHeaderRow);
    r += 1;

    if (meetings.length === 0) {
      ws.getCell(r, 1).value = 'אין פעילות מסוג זה החודש';
      ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF999999' } };
      r += 1;
    } else {
      meetings.forEach((m, i) => {
        ws.getRow(r).values = [i + 1, m.name, m.amount, m.note];
        ws.getCell(r, 3).numFmt = MONEY_FORMAT;
        r += 1;
      });
    }
    r += 1; // שורה ריקה בין קבוצות סוג
  }
  return r;
}

function setupSheet(ws) {
  ws.views = [{ rightToLeft: true }];
  ws.columns = [{ width: 26 }, { width: 16 }, { width: 16 }, { width: 16 }];
}

/**
 * buildActivityWorkbook — חוברת עבודה עם גיליון אחד (סיכום + פירוט) לפעיל בודד.
 */
async function buildActivityWorkbook(activistName, monthName, year, data) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(activistName));
  setupSheet(ws);
  const afterSummary = writeSummaryBlock(ws, 1, activistName, monthName, year, data);
  writeDetailBlock(ws, afterSummary, data);
  return wb;
}

/**
 * exportActivityXlsx — מפיק ומוריד קובץ xlsx לפעיל בודד. דפדפן בלבד.
 */
async function exportActivityXlsx(activistName, monthName, year, data) {
  const wb = await buildActivityWorkbook(activistName, monthName, year, data);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `פעילות-${activistName}-${monthName}-${year}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
```

עדכן את `module.exports` בסוף הקובץ:

```js
module.exports = {
  deriveActivityByType, TYPE_ROWS, BONUS_CATEGORIES,
  writeSummaryBlock, writeDetailBlock, safeSheetName,
  buildActivityWorkbook, exportActivityXlsx,
};
```

- [ ] **Step 4: הרץ ווודא הצלחה**

Run: `node scripts/verify-activity-report.cjs`
Expected: כל הבדיקות `✓ PASS`, כולל `buildActivityWorkbook`. אם נוסחת `grandRow` לא מסתכמת נכון (בדוק ידנית: פתח את `%TEMP%/activity-report-single-test.xlsx` באקסל ווודא שהתא "סה"כ לתשלום" מציג 200) — תקן את נוסחת ה-`formula` ב-`writeSummaryBlock` בהתאם; היא כתובה כאן להמחשה ועלולה לדרוש תיקון קטן במיקומי התאים בפועל.

- [ ] **Step 5: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות (הקובץ עדיין לא מיובא משום דף).

- [ ] **Step 6: Commit**

```bash
git add lib/activityByTypeExcel.js scripts/verify-activity-report.cjs
git commit -m "feat: build single-activist activity-by-type Excel sheet"
```

---

### Task 4: קובץ מרוכז לכל הפעילים

**Files:**
- Modify: `lib/activityByTypeExcel.js`
- Modify: `scripts/verify-activity-report.cjs`

**Interfaces:**
- Consumes: `activistsData: [{ activistName: string, data: ActivityData }]` (סדר = סדר ההופעה בעמוד `/payments`), `monthName`, `year`.
- Produces:
  - `async function buildCombinedActivityWorkbook(activistsData, monthName, year) → ExcelJS.Workbook` — לשונית ראשונה `"סיכום כללי"` (בלוקי סיכום מוערמים + 2 שורות ריקות ביניהם + סה"כ ארגוני בסוף), ואז לשונית אחת לכל פעיל (גיליון מלא, כמו Task 3). שמות לשוניות כפולים מקבלים סיומת ` (2)`, ` (3)` וכו'.
  - `async function exportCombinedActivityXlsx(activistsData, monthName, year)` — הורדה בדפדפן.

- [ ] **Step 1: הוסף בדיקות כושלות**

הוסף **לפני** הבלוק הא-סינכרוני מ-Task 3 (לפני ה-`(async () => { ... })();` האחרון), בלוק א-סינכרוני חדש — ומזג את שני הבלוקים הא-סינכרוניים לאחד (יש `process.exit` אחד בסוף הקובץ, לא שניים):

```js
// ────────────────────────────────────────────────────────────────────────────
// buildCombinedActivityWorkbook — לשונית "סיכום כללי" עם 2 פעילים מוערמים
// + סה"כ ארגוני, ואז לשונית מלאה לכל פעיל.
// ────────────────────────────────────────────────────────────────────────────
async function testCombinedWorkbook() {
  const { buildCombinedActivityWorkbook } = require('../lib/activityByTypeExcel.js');

  const reportA = calcMonthlyPayment(7, [
    { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'טלפוני', quality: 'תורני', duration_minutes: 20, date: '2026-08-01' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);
  const reportB = calcMonthlyPayment(8, [
    { activist_id: 8, project_id: 1, id: 2, contact_id: 2, type: 'פרונטלי', quality: 'תורני', duration_minutes: 45, date: '2026-08-02' },
  ], contacts, [], [], DEFAULTS, new Set(), AUG);

  const activistsData = [
    { activistName: 'פעיל א', data: deriveActivityByType(reportA, 0, 0) },
    { activistName: 'פעיל ב', data: deriveActivityByType(reportB, 0, 0) },
  ];

  const wb = await buildCombinedActivityWorkbook(activistsData, 'אוגוסט', 2026);
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const outPath = path.join(os.tmpdir(), 'activity-report-combined-test.xlsx');
  await wb.xlsx.writeFile(outPath);

  const ExcelJS = (await import('exceljs')).default;
  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(outPath);

  check('3 לשוניות: סיכום כללי + 2 פעילים', back.worksheets.map(s => s.name),
    ['סיכום כללי', 'פעיל א', 'פעיל ב']);

  const overview = back.worksheets[0];
  // כותרת "פעיל א" בשורה 1, כותרת "פעיל ב" אמורה להופיע אחרי הבלוק שלו + 2 שורות ריקות.
  let firstActivistTitleRow = null, secondActivistTitleRow = null;
  overview.eachRow((row, rowNumber) => {
    const v = String(row.getCell(1).value || '');
    if (v.includes('פעיל א')) firstActivistTitleRow = rowNumber;
    if (v.includes('פעיל ב') && !v.includes('סה"כ')) secondActivistTitleRow = rowNumber;
  });
  check('שתי כותרות הפעילים קיימות בלשונית הראשונה',
    [Boolean(firstActivistTitleRow), Boolean(secondActivistTitleRow)], [true, true]);

  // שורת סה"כ ארגוני בסוף הלשונית
  let orgTotalRow = null;
  overview.eachRow((row, rowNumber) => {
    if (row.getCell(1).value === 'סה"כ ארגוני לפי סוג פעילות') orgTotalRow = rowNumber;
  });
  check('בלוק "סה"כ ארגוני לפי סוג פעילות" קיים בסוף הלשונית', Boolean(orgTotalRow), true);

  // לשונית "פעיל ב" מכילה את הפירוט המלא שלו (בדיוק כמו buildActivityWorkbook עצמאי)
  const sheetB = back.worksheets.find(s => s.name === 'פעיל ב');
  let sheetBHasDetail = false;
  sheetB.eachRow(row => { if (row.getCell(1).value === 'פירוט מלא — מסודר לפי סוג הפעילות') sheetBHasDetail = true; });
  check('לשונית פעיל ב כוללת את בלוק הפירוט המלא', sheetBHasDetail, true);

  console.log(failures === 0 ? '\nכל הבדיקות עברו (כולל buildCombinedActivityWorkbook).' : `\n${failures} בדיקות נכשלו.`);
  process.exit(failures === 0 ? 0 : 1);
}

testCombinedWorkbook();
```

**החלף** את הבלוק הא-סינכרוני מ-Task 3 (`(async () => { ... buildActivityWorkbook ... })();`) כך שיקרא ל-`testCombinedWorkbook()` בסופו במקום ל-`console.log`/`process.exit` שלו — או פשוט מזג את שתי הבדיקות (single + combined) לתוך פונקציה א-סינכרונית אחת שרצה ברצף ומסיימת עם `process.exit` יחיד. הימנע משני `process.exit` בקובץ אחד.

- [ ] **Step 2: הרץ ווודא כשל**

Run: `node scripts/verify-activity-report.cjs`
Expected: שגיאה — `buildCombinedActivityWorkbook is not a function`.

- [ ] **Step 3: הוסף את `buildCombinedActivityWorkbook` ל-`lib/activityByTypeExcel.js`**

הוסף לפני `module.exports`:

```js
// מחזיר שם ייחודי בתוך workbook — מוסיף " (2)", " (3)" וכו' אם יש התנגשות.
function uniqueSheetName(wb, name) {
  const base = safeSheetName(name);
  if (!wb.getWorksheet(base)) return base;
  let i = 2;
  while (wb.getWorksheet(`${base} (${i})`.slice(0, 31))) i++;
  return `${base} (${i})`.slice(0, 31);
}

/**
 * buildCombinedActivityWorkbook — לשונית "סיכום כללי" (כל הפעילים מוערמים + סה"כ
 * ארגוני לפי סוג בסוף), ואז לשונית מלאה לכל פעיל.
 */
async function buildCombinedActivityWorkbook(activistsData, monthName, year) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  const overview = wb.addWorksheet('סיכום כללי');
  setupSheet(overview);
  let r = 1;
  // שורה→ [count, total] לכל שורת-סוג, כדי לחשב את הסה"כ הארגוני בסוף בלי לרוץ שוב על הנתונים.
  const perTypeCells = TYPE_ROWS.map(() => ({ countCells: [], totalCells: [] }));

  for (const { activistName, data } of activistsData) {
    const blockStartRow = r;
    r = writeSummaryBlock(overview, r, activistName, monthName, year, data);
    // אחרי writeSummaryBlock יש כבר שורה ריקה בסוף — מוסיפים עוד אחת ל-2 שורות ריקות בסה"כ.
    r += 1;

    // איתור שורות טבלת-הסוגים שנכתבו זה עתה, כדי לצבור אותן לסה"כ הארגוני.
    for (let i = 0; i < TYPE_ROWS.length; i++) {
      const label = TYPE_ROWS[i].label;
      for (let scanRow = blockStartRow; scanRow < r; scanRow++) {
        if (overview.getCell(scanRow, 1).value === label) {
          perTypeCells[i].countCells.push(`B${scanRow}`);
          perTypeCells[i].totalCells.push(`D${scanRow}`);
          break;
        }
      }
    }
  }

  // סה"כ ארגוני לפי סוג פעילות
  const orgHeaderRow = overview.getRow(r);
  orgHeaderRow.getCell(1).value = 'סה"כ ארגוני לפי סוג פעילות';
  orgHeaderRow.getCell(1).font = { bold: true, size: 13 };
  r += 1;
  const orgTableHeaderRow = overview.getRow(r);
  orgTableHeaderRow.values = ['סוג הפעילות', 'מספר מפגשים (הכל)', 'סה"כ ₪ (הכל)'];
  styleHeaderRow(orgTableHeaderRow);
  r += 1;
  TYPE_ROWS.forEach((t, i) => {
    const row = overview.getRow(r);
    row.getCell(1).value = t.label;
    row.getCell(2).value = perTypeCells[i].countCells.length
      ? { formula: perTypeCells[i].countCells.join('+') }
      : 0;
    row.getCell(3).value = perTypeCells[i].totalCells.length
      ? { formula: perTypeCells[i].totalCells.join('+') }
      : 0;
    row.getCell(3).numFmt = MONEY_FORMAT;
    r += 1;
  });

  // לשונית מלאה לכל פעיל — זהה למה שמופק בייצוא הבודד.
  for (const { activistName, data } of activistsData) {
    const ws = wb.addWorksheet(uniqueSheetName(wb, activistName));
    setupSheet(ws);
    const afterSummary = writeSummaryBlock(ws, 1, activistName, monthName, year, data);
    writeDetailBlock(ws, afterSummary, data);
  }

  return wb;
}

/**
 * exportCombinedActivityXlsx — מפיק ומוריד קובץ xlsx מרוכז לכל הפעילים. דפדפן בלבד.
 */
async function exportCombinedActivityXlsx(activistsData, monthName, year) {
  const wb = await buildCombinedActivityWorkbook(activistsData, monthName, year);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `פעילות-כל-הפעילים-${monthName}-${year}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
```

עדכן שוב את `module.exports`:

```js
module.exports = {
  deriveActivityByType, TYPE_ROWS, BONUS_CATEGORIES,
  writeSummaryBlock, writeDetailBlock, safeSheetName, uniqueSheetName,
  buildActivityWorkbook, exportActivityXlsx,
  buildCombinedActivityWorkbook, exportCombinedActivityXlsx,
};
```

- [ ] **Step 4: הרץ ווודא הצלחה**

Run: `node scripts/verify-activity-report.cjs`
Expected: כל הבדיקות `✓ PASS`. פתח את `%TEMP%/activity-report-combined-test.xlsx` באקסל ווודא ידנית: 3 לשוניות, מרווח 2 שורות בין הפעילים בלשונית הראשונה, בלוק "סה"כ ארגוני" בסופה עם נוסחאות (לא ערכים קפואים).

- [ ] **Step 5: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 6: Commit**

```bash
git add lib/activityByTypeExcel.js scripts/verify-activity-report.cjs
git commit -m "feat: build combined multi-activist activity-by-type workbook"
```

---

### Task 5: כפתורי ייצוא בממשק

**Files:**
- Modify: `pages/payments/[id].jsx`
- Modify: `pages/payments.jsx`

**Interfaces:**
- Consumes: `exportActivityXlsx`, `deriveActivityByType` מ-`lib/activityByTypeExcel.js`; `report` (כבר קיים ב-`payments/[id].jsx`, מכיל `breakdown`+`unpaid`); `paymentData` (כבר קיים ב-`payments.jsx`).

- [ ] **Step 1: כפתור בדף פעיל בודד — `pages/payments/[id].jsx`**

הוסף import בראש הקובץ:

```js
import { deriveActivityByType, exportActivityXlsx } from '../../lib/activityByTypeExcel';
```

הוסף state ליד שאר ה-`useState` (אחרי `cancelledBonuses`):

```js
const [exportingActivity, setExportingActivity] = useState(false);
```

הוסף כפתור בתוך אזור הכותרת/סיכום (בתוך ה-div של "סיכום כולל", אחרי הקישור "לפרופיל הפעיל" הקיים — או ליד ה-`<div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>פירוט קשרים ובונוסים</div>`):

```jsx
<button
  onClick={async () => {
    if (exportingActivity) return;
    setExportingActivity(true);
    try {
      const activityData = deriveActivityByType(report, report.expensesTotal, report.guidePay, paymentConfig);
      await exportActivityXlsx(activist.name, currentMonthName, year, activityData);
    } catch (err) {
      console.error('Activity export failed', err);
      alert('ייצוא הפעילות נכשל. נסה שוב.');
    } finally {
      setExportingActivity(false);
    }
  }}
  disabled={exportingActivity}
  style={{ background: exportingActivity ? '#b7b0e8' : 'linear-gradient(135deg,#1f7a45,#2ecc71)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:12.5, fontWeight:700, cursor: exportingActivity ? 'default' : 'pointer', fontFamily:'inherit', marginTop:10 }}
>
  {exportingActivity ? '⏳ מייצא…' : '📋 ייצוא פעילות לאקסל'}
</button>
```

⚠️ `paymentConfig` לא מיובא כרגע ב-`payments/[id].jsx` מ-`useCrm()` — בדוק את שורת ה-`useCrm()` הקיימת (`const { contacts, interactions, mitzvotBonuses, ... } = useCrm();`) והוסף `paymentConfig` לרשימת ה-destructure אם הוא לא כבר שם (הוא כבר משמש בשורה שבונה את `report` — ודא שהוא זמין באותו scope).

- [ ] **Step 2: בדיקה ידנית בדפדפן — פעיל בודד**

הרץ `npm run dev`, התחבר כ-`coord1`/`coord123`, נווט ל-`/payments`, לחץ על כרטיס פעיל עם פעילות בחודש הנוכחי, לחץ "📋 ייצוא פעילות לאקסל". ודא: הקובץ יורד, נפתח באקסל, שם הגיליון = שם הפעיל, כל השורות סבירות (השווה ידנית ל"פירוט קשרים ובונוסים" המוצג באותו עמוד).

- [ ] **Step 3: כפתור בדף רשימת התשלומים — `pages/payments.jsx`**

הוסף import:

```js
import { deriveActivityByType, exportCombinedActivityXlsx } from '../lib/activityByTypeExcel';
```

הוסף state ליד `exporting` הקיים:

```js
const [exportingActivity, setExportingActivity] = useState(false);
```

הוסף כפתור שלישי באזור "כפתורי ייצוא" הקיים (ליד שני הכפתורים הקיימים, `📊 ייצוא לאקסל` ו-`📄 דוח פעילות לתשלום`):

```jsx
<button
  onClick={async () => {
    if (exportingActivity) return;
    setExportingActivity(true);
    try {
      const activistsData = paymentData.map(({ activist, breakdown, unpaid, expensesTotal, guidePay }) => ({
        activistName: activist.name,
        data: deriveActivityByType({ breakdown, unpaid }, expensesTotal, guidePay, paymentConfig),
      }));
      await exportCombinedActivityXlsx(activistsData, currentMonthName, year);
    } catch (err) {
      console.error('Combined activity export failed', err);
      alert('ייצוא הפעילות המרוכז נכשל. נסה שוב.');
    } finally {
      setExportingActivity(false);
    }
  }}
  disabled={exportingActivity || paymentData.length === 0}
  style={{ background: exportingActivity || paymentData.length === 0 ? '#b7b0e8' : 'linear-gradient(135deg,#1f7a45,#2ecc71)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:700, cursor: exportingActivity || paymentData.length === 0 ? 'default' : 'pointer', fontFamily:'Rubik,sans-serif', boxShadow:'0 2px 8px rgba(31,122,69,0.25)' }}
>
  {exportingActivity ? '⏳ מייצא…' : `📋 ייצוא פעילות לכל הפעילים`}
</button>
```

- [ ] **Step 4: בדיקה ידנית בדפדפן — קובץ מרוכז**

באותו דפדפן, ב-`/payments`, לחץ "📋 ייצוא פעילות לכל הפעילים". ודא: הקובץ יורד, נפתח באקסל, לשונית "סיכום כללי" ראשונה עם כל הפעילים מוערמים ומרווח ביניהם, לשונית לכל פעיל אחריה, בלוק "סה"כ ארגוני" בסוף לשונית הסיכום.

- [ ] **Step 5: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 6: הרץ שוב את שתי בדיקות המנוע**

Run: `node scripts/verify-payment-order.cjs && node scripts/verify-activity-report.cjs`
Expected: שתיהן `כל הבדיקות עברו.` — 0 כשלים.

- [ ] **Step 7: Commit**

```bash
git add pages/payments/[id].jsx pages/payments.jsx
git commit -m "feat: add activity-by-type Excel export buttons to payments pages"
```

---

## Self-Review (בוצע בעת כתיבת התוכנית)

**כיסוי מפרט**: מקור נתונים (Task 1) ✓, סדר/קיבוץ סוגים (Task 2) ✓, מבנה גיליון לפעיל כולל כלל-הפירוט והערת-שוליים (Task 2+3) ✓, קובץ מרוכז עם ערימה+מרווח+סה"כ ארגוני (Task 4) ✓, מיקום כפתורים/הרשאות/שמות קבצים (Task 5 — הרשאה `can.seePayments` כבר קיימת ברמת העמוד, לא נדרש שינוי) ✓, בדיקות (בכל Task) ✓.

**סריקת placeholder**: אין `TBD`/`TODO` בתוכנית. שתי הערות ⚠️ (Task 2 על סדר detailByType, Task 3 על נוסחת grandRow) מסמנות במפורש היכן ייתכן שיידרש תיקון קטן מול ריצה בפועל — לא "implement later" גנרי, אלא הנחיה קונקרטית מה לבדוק ואיך לתקן.

**עקביות טיפוסים**: `ActivityData` (Task 2) נצרך זהה ב-Task 3/4 (`writeSummaryBlock`, `writeDetailBlock`) וב-Task 5 (`deriveActivityByType(...)` מוזן ישירות ל-`exportActivityXlsx`/`exportCombinedActivityXlsx`). שם השדה `interactionType` (לא `type`) עקבי בין Task 1 (producer) ל-Task 2 (consumer ב-`matchesType`).
