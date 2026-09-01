# עדכון כללי תשלום — ידידותי/תורני, בונוס תורני, קשר קצרצר — תוכנית מימוש

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** לממש 4 שינויי כללי תשלום שנדב ביקש: תעריפים+זכאות חדשים לקשר ידידותי/תורני, בונוס תורני (1,000 ₪/3 חודשים רצופים), סוג-קשר חדש "קצרצר" שאינו מזכה, ואימות שמפגש רב-משתתפים (כבר קיים) עונה על הדרישה — לפי `docs/superpowers/specs/2026-08-31-payment-rules-overhaul-design.md`.

**Architecture:** `calcInteractionPayment` מקבל פרמטר חדש אופציונלי `contactContext` (היסטוריית הלקוח חוצת-חודשים, לבדיקת חלון-3-חודשים ומעבר-לתורני). `calcMonthlyPayment`/`calcConsultantDashboard` מקבלים פרמטר חדש אופציונלי `toraniBonuses` (בדפוס זהה ל-`mitzvotBonuses`). שני הפרמטרים מסתיימים ברשימת הארגומנטים (append-only) — קריאה ישנה שלא מעדכנים ממשיכה לרוץ בהתנהגות הישנה (בלי שגיאה), אבל **כל קורא אמיתי חייב להתעדכן**, אחרת הבונוס/הכלל פשוט לא יופיע איפשהו בשקט. Task 3 מפרט את הרשימה המלאה.

**Tech Stack:** Next.js Pages Router, CommonJS ב-`lib/`, בדיקות עם `node scripts/verify-*.cjs` (בלי framework), Supabase (payment_config, contacts.joined_at).

## Global Constraints

- `bonus_key` format (`${activistId}|${type}|${contactId}|${monthKey}`) לא משתנה בשום בונוס.
- כל שינוי חייב להיות תואם-לאחור לקוראים שלא מעודכנים (ברירות מחדל בטוחות: `contactContext=null` → התנהגות ישנה בדיוק; `toraniBonuses=[]` → בלי בונוס תורני, לא קריסה).
- **אין להריץ כתיבה לטבלת `payment_config` ב-Supabase** — רק להכין סקריפט מוכן (Task 7), לא להריץ אותו.
- אחרי כל שינוי: `npm run build` נקי.
- כל שינוי במנוע: `node scripts/verify-payment-order.cjs` נקי, 0 כשלים, כולל 27+ הבדיקות הקיימות.
- לא נוגעים בהיסטוריית `interactions`/`mitzvot_history` קיימת — כל השינויים הם בחישוב, לא במחיקה/עריכה של נתונים.
- אין למחוק היסטוריה קיימת בשום מקרה.

---

## File Structure

- **Modify** `lib/paymentCalc.js` — כל לוגיקת הליבה: תעריפים, `calcInteractionPayment`, `deriveToraniBonuses`, `calcMonthlyPayment`, `calcConsultantDashboard`.
- **Modify** `lib/paymentConfig.js` — `DEFAULT_CONFIG.BASE_PRICES` (fallback, לא ה-DB עצמו).
- **Modify** `lib/CrmStore.jsx` — חישוב+חשיפת `toraniBonuses`.
- **Modify** `lib/activistStats.js` — `contactContext` ב-`payableInteractionsThisMonth`.
- **Modify** `data/config.js` — `CONFIG.contactMethods`.
- **Modify** `pages/contact/add-interaction/[id].jsx` — מצב-דיווח שלישי "קצרצר", `contactContext` בתצוגה המקדימה.
- **Modify** `pages/payments.jsx`, `pages/payments/[id].jsx`, `pages/my-dashboard.jsx` — קריאה+העברה של `toraniBonuses`.
- **Modify** `scripts/verify-payment-order.cjs` — כל בדיקות הגבולות.
- **Modify** `scripts/verify-payroll-xlsx.cjs`, `scripts/verify-month-report.cjs` — העברת `toraniBonuses` (לדיוק, לא קריטי לנכונות).
- **Create** `scripts/apply-new-payment-rates.cjs` — מוכן, **לא מורץ**.

---

### Task 1: קבועים חדשים + תיקון תקלת baseAmount===0

**Files:**
- Modify: `lib/paymentCalc.js:8-17` (BASE_PRICES), אחרי שורה 47 (MIN_DURATION) — קבועים חדשים
- Modify: `lib/paymentCalc.js:324-326` (`if (!baseAmount)` בתוך `calcInteractionPayment`)
- Modify: `lib/paymentConfig.js:7-27` (DEFAULT_CONFIG)
- Test: `scripts/verify-payment-order.cjs`

**Interfaces:**
- Produces: קבועים חדשים מיוצאים מ-`lib/paymentCalc.js`: `FRIENDLY_ELIGIBLE_MONTHS = 3`, `FRIENDLY_FRONTAL_MONTHLY_CAP = 2`, `TORANI_BONUS_AMOUNT = 1000`, `TORANI_BONUS_MONTHS = 3`.

- [ ] **Step 1: הוסף בדיקה כושלת ב-`scripts/verify-payment-order.cjs`**

הוסף בסוף הקובץ (לפני `console.log(failures === 0 ...)`):

```js
// ────────────────────────────────────────────────────────────────────────────
// עדכון תעריפים (2026-08-31, בקשת נדב) — תעריפי ידידותי/תורני חדשים.
// ────────────────────────────────────────────────────────────────────────────
{
  const { BASE_PRICES: PRICES, FRIENDLY_ELIGIBLE_MONTHS, FRIENDLY_FRONTAL_MONTHLY_CAP, TORANI_BONUS_AMOUNT, TORANI_BONUS_MONTHS } = require('../lib/paymentCalc.js');
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
```

- [ ] **Step 2: הרץ ווודא כשל**

Run: `node scripts/verify-payment-order.cjs`
Expected: כשלים על התעריפים החדשים (עדיין לא עודכנו) ועל `zeroRateResult` (הבאג הקיים מחזיר `payable:false, reason:'סוג קשר לא מזוהה'` כי `!0` הוא `true`).

- [ ] **Step 3: עדכן את BASE_PRICES והוסף קבועים חדשים ב-`lib/paymentCalc.js`**

שנה את הבלוק (שורות 8-17):
```js
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
```
ל:
```js
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
```

הוסף אחרי שורה `const MIN_DURATION = 15;` (שורה 47):
```js
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
```

- [ ] **Step 4: תקן את בדיקת `baseAmount` — שורה 324-326**

שנה:
```js
  const key = `${type}-${quality}`;
  const baseAmount = BASE_PRICES[key];
  if (!baseAmount) return { amount: 0, payable: false, reason: 'סוג קשר לא מזוהה' };
```
ל:
```js
  const key = `${type}-${quality}`;
  const baseAmount = BASE_PRICES[key];
  // undefined ולא !baseAmount: טלפוני-ידידותי הוא 0 ₪ עכשיו — ערך חוקי, לא "לא מזוהה".
  if (baseAmount === undefined) return { amount: 0, payable: false, reason: 'סוג קשר לא מזוהה' };
```

- [ ] **Step 5: עדכן את `module.exports` בסוף הקובץ**

הוסף את 4 הקבועים החדשים לרשימת ה-`module.exports` הקיימת (חפש `module.exports = {` בסוף הקובץ): `FRIENDLY_ELIGIBLE_MONTHS, FRIENDLY_FRONTAL_MONTHLY_CAP, TORANI_BONUS_AMOUNT, TORANI_BONUS_MONTHS`.

- [ ] **Step 6: עדכן את `DEFAULT_CONFIG.BASE_PRICES` ב-`lib/paymentConfig.js`**

עדכן את הבלוק `BASE_PRICES` בתוך `DEFAULT_CONFIG` (שורות 8-17) לאותם ערכים חדשים מ-Step 3 (`'טלפוני-ידידותי': 0, 'טלפוני-תורני': 150, 'וידאו-תורני': 200`, שאר השורות ללא שינוי). זהו רק ה-fallback ל-JS — לא ה-DB בפועל (ראה מפרט: אין להריץ עדכון DB).

- [ ] **Step 7: הרץ ווודא הצלחה**

Run: `node scripts/verify-payment-order.cjs`
Expected: כל הבדיקות `✓ PASS`.

- [ ] **Step 8: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 9: Commit**

```bash
git add lib/paymentCalc.js lib/paymentConfig.js scripts/verify-payment-order.cjs
git commit -m "feat: update friendly/torani interaction rates, add new payment rule constants"
```

---

### Task 2: זכאות קשר ידידותי + מכסת 2/חודש — בתוך calcInteractionPayment

**Files:**
- Modify: `lib/paymentCalc.js` — `calcInteractionPayment` (החתימה בשורה 289, הגוף עד 357), הוספת helpers `isoYearMonth`/`monthsBetween`
- Test: `scripts/verify-payment-order.cjs`

**Interfaces:**
- Produces: `calcInteractionPayment(interaction, prevContactMonthly, isHighPotential, prevActivistMonthly, cfg, contactContext)` — פרמטר שישי חדש, אופציונלי, ברירת מחדל `null`. `contactContext = { joinedAt: string|null, allInteractionsWithContact: Array }` כאשר `allInteractionsWithContact` הוא **כל** קשרי הפעיל עם הלקוח הזה (כל החודשים, לא מסונן). `contactContext=null` → בלי שום הגבלת-זכאות חדשה (התנהגות ישנה בדיוק).
- Produces: פונקציות עזר מיוצאות `isoYearMonth(dateStr) → {year, month}|null` ו-`monthsBetween(fromStr, toStr) → number`.

- [ ] **Step 1: הוסף בדיקות כושלות ב-`scripts/verify-payment-order.cjs`**

הוסף בסוף הקובץ:

```js
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

  // מעבר לתורני מנתק זכאות ידידותי, גם בתוך חלון 3 החודשים.
  const toraniHistory = [{ date: '2026-08-10', quality: 'תורני' }];
  check('קשר ידידותי אחרי קשר תורני (גם בתוך החלון) לא מזכה',
    calc(mkFriendly('2026-08-20'), [], false, [], DEFAULTS, ctx('2026-08-01', toraniHistory)).payable, false);
  check('קשר ידידותי *לפני* הקשר התורני הראשון כן מזכה',
    calc(mkFriendly('2026-08-05'), [], false, [], DEFAULTS, ctx('2026-08-01', toraniHistory)).payable, true);

  // בלי contactContext — התנהגות ישנה, בלי הגבלה (תאימות לאחור).
  check('בלי contactContext (null) — קשר ידידותי בחודש 5 עדיין מזכה (תאימות לאחור)',
    calc(mkFriendly('2027-01-15'), [], false, [], DEFAULTS, null).payable, true);

  // מכסת 2/חודש/לקוח לפרונטלי-ידידותי — בנוסף לתקרת 6/חודש הכללית.
  const twoFriendlyThisMonth = [mkFriendly('2026-08-01'), mkFriendly('2026-08-05')];
  check('קשר ידידותי-פרונטלי שלישי באותו חודש עם אותו לקוח — לא מזכה',
    calc(mkFriendly('2026-08-20'), twoFriendlyThisMonth, false, twoFriendlyThisMonth, DEFAULTS, ctx('2026-01-01')).payable, false);
  check('קשר ידידותי-פרונטלי שני באותו חודש — עדיין מזכה',
    calc(mkFriendly('2026-08-20'), [mkFriendly('2026-08-01')], false, [mkFriendly('2026-08-01')], DEFAULTS, ctx('2026-01-01')).payable, true);
}
```

- [ ] **Step 2: הרץ ווודא כשל**

Run: `node scripts/verify-payment-order.cjs`
Expected: כשלים על כל הבדיקות החדשות (`isoYearMonth`/`monthsBetween` עוד לא קיימות, אין הגבלת-זכאות).

- [ ] **Step 3: הוסף helpers ותקן את `calcInteractionPayment`**

הוסף לפני `function calcInteractionPayment` (אחרי `orderId`, לפני ה-JSDoc של calcInteractionPayment בשורה 275):

```js
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
```

ב-`calcInteractionPayment` (שורה 289), שנה את החתימה:
```js
function calcInteractionPayment(interaction, prevContactMonthly, isHighPotential, prevActivistMonthly = null, cfg = DEFAULTS) {
```
ל:
```js
function calcInteractionPayment(interaction, prevContactMonthly, isHighPotential, prevActivistMonthly = null, cfg = DEFAULTS, contactContext = null) {
```

בתוך הפונקציה, אחרי שורת `const { type, quality, duration_minutes = 0 } = interaction;` (שורה 295) הוסף גם:
```js
  const FRIENDLY_MONTHS = cfg.FRIENDLY_ELIGIBLE_MONTHS ?? FRIENDLY_ELIGIBLE_MONTHS;
  const FRIENDLY_CAP     = cfg.FRIENDLY_FRONTAL_MONTHLY_CAP ?? FRIENDLY_FRONTAL_MONTHLY_CAP;
```

מיד **אחרי** בדיקת משך המינימלי (אחרי הבלוק `if (duration_minutes < MIN_DUR) { ... }`, שורות 306-309) ו**לפני** בדיקת "אירוח שבת" (שורה 311-314), הוסף:

```js
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

    const firstToraniDate = history
      .filter(i => i.quality === 'תורני')
      .reduce((min, i) => (i.date && (!min || i.date < min) ? i.date : min), null);
    if (firstToraniDate && firstToraniDate <= interaction.date) {
      return { amount: 0, payable: false, reason: 'קשר ידידותי — הלקוח כבר עבר לקשר תורני' };
    }
  }
```

**עדכן** את שורות 324-326 (בדיקת `baseAmount`, כבר תוקנה ב-Task 1 ל-`baseAmount === undefined`) — אחריה, לפני הבלוק `const isPhone = ...` (שורה 328), הוסף:

```js
  // מכסת FRIENDLY_CAP קשרים ידידותיים-פרונטליים בתשלום, לחודש, ללקוח — בנוסף
  // (לא במקום) לתקרת PER_CONTACT_CAPS.frontal (6) הכללית שנבדקת בהמשך ומחילה
  // על כל פרונטלי, ידידותי ותורני כאחד.
  if (type === 'פרונטלי' && quality === 'ידידותי') {
    const friendlyThisMonth = prevContactMonthly.filter(i => i.type === 'פרונטלי' && i.quality === 'ידידותי').length;
    if (friendlyThisMonth >= FRIENDLY_CAP) {
      return { amount: 0, payable: false, reason: `חרגת ממכסת ${FRIENDLY_CAP} קשרים ידידותיים-פרונטליים בחודש עם לקוח זה` };
    }
  }
```

- [ ] **Step 4: הוסף `isoYearMonth`/`monthsBetween` ל-`module.exports`**

- [ ] **Step 5: הרץ ווודא הצלחה**

Run: `node scripts/verify-payment-order.cjs`
Expected: כל הבדיקות `✓ PASS` (כולל Task 1's).

- [ ] **Step 6: `npm run build`**

- [ ] **Step 7: Commit**

```bash
git add lib/paymentCalc.js scripts/verify-payment-order.cjs
git commit -m "feat: add friendly-interaction eligibility window and monthly cap"
```

---

### Task 3: חיבור contactContext לכל הקוראים האמיתיים

**Files:**
- Modify: `lib/paymentCalc.js` — `paidBefore` (שורה 370-384), `getMonthlyTotalForActivist` (390-416), `calcMonthlyPayment` (423-504)
- Modify: `lib/activistStats.js` — `payableInteractionsThisMonth` (סביב שורה 64-89)
- Modify: `pages/contact/add-interaction/[id].jsx` — `payableCheck` (סביב שורה 118-126)
- Test: `scripts/verify-payment-order.cjs`

**Interfaces:**
- Consumes: `contactContext` מ-Task 2.
- Produces: כל הפונקציות למעלה בונות `contactContext = { joinedAt: contact?.joined_at ?? null, allInteractionsWithContact: <כל קשרי contact_id+activist_id, לא מסונן חודש> }` ומעבירות אותה לכל קריאה ל-`calcInteractionPayment`.

⚠️ **זה השלב הכי מועד לתקלה-שקטה בתוכנית הזו.** קורא שנשכח פשוט ימשיך לתת תשלום בלי הגבלת 3-חודשים/מעבר-תורני — לא קריסה, לא אזהרה, רק כסף שיוצא לפי הכלל הישן במסך אחד בזמן שמסך אחר (או המנוע האמיתי) כבר אוכף את הכלל החדש. בדיוק דפוס הבאג שתועד כבר פעמיים ב-CLAUDE.md (התצוגה המקדימה בטופס מול המנוע).

- [ ] **Step 1: הוסף בדיקת עקביות כושלת ב-`scripts/verify-payment-order.cjs`**

```js
// ────────────────────────────────────────────────────────────────────────────
// עקביות contactContext: calcMonthlyPayment (המנוע) ו-paidBefore (תצוגה מקדימה)
// חייבים להסכים על אותו קשר ידידותי מחוץ לחלון — בדיוק כמו שדיווח מוטי גלעד
// (2026-07-21) חייב את אותו דבר לגבי תקרות.
// ────────────────────────────────────────────────────────────────────────────
{
  const contactsFC = [{ id: 1, name: 'לקוח ותיק', joined_at: '2026-01-01' }];
  const oldFriendly = Array.from({ length: 2 }, (_, k) => ({
    activist_id: 7, project_id: 1, id: 800 + k, contact_id: 1, type: 'פרונטלי',
    quality: 'ידידותי', duration_minutes: 60, date: `2026-0${k + 1}-15`,
  })); // ינואר, פברואר — מחוץ לחלון 3 החודשים כשמגיעים לאפריל (חודש 3 מ-ינואר)
  const draftFC = { type: 'פרונטלי', quality: 'ידידותי', date: '2026-04-15', id: Number.MAX_SAFE_INTEGER };

  const engineResult = calcMonthlyPayment(7, [...oldFriendly, { ...draftFC, activist_id: 7, project_id: 1, contact_id: 1, duration_minutes: 60, id: 850 }], contactsFC, [], [], DEFAULTS, new Set(), { year: 2026, month: 3 });
  const previewBefore = paidBefore(draftFC, oldFriendly, contactsFC, DEFAULTS);
  // המנוע: הקשר החדש (אפריל, חודש 3 מהצטרפות ינואר) לא זוכה — מחוץ לחלון.
  check('המנוע דוחה קשר ידידותי בחודש 4 מהצטרפות', engineResult.breakdown.filter(b => b.type === 'קשר').length, 0);
  check('paidBefore לא רואה בזה חריגה מתקרה כלשהי (0 קשרים קודמים שזוכו החודש)', previewBefore.length, 0);
}
```

⚠️ הבדיקה הזו נכשלת עד שכל שלבי המשימה הזו הושלמו (כולל `calcMonthlyPayment` בעצמה) — זה תקין, זו בדיקת האינטגרציה הסופית של המשימה, לא TDD חד-שלבי.

- [ ] **Step 2: הרץ ווודא כשל**

- [ ] **Step 3: `calcMonthlyPayment` — בנה contactContext בלולאה הראשית**

ב-`lib/paymentCalc.js`, בתוך `calcMonthlyPayment`, לפני הלולאה `for (const interaction of allSorted) {` (שורה 450), הוסף פונקציית עזר מקומית:

```js
  // contactContext לכל לקוח — נבנה פעם אחת מראש, לא בכל איטרציה. allInteractionsWithContact
  // הוא *כל* הקשרים ההיסטוריים (לא רק monthlyInteractions), כדי שחלון-3-חודשים ובדיקת
  // מעבר-לתורני יראו מעבר לגבול החודש הנוכחי.
  const contactContextCache = new Map();
  function getContactContext(contactId) {
    if (contactContextCache.has(contactId)) return contactContextCache.get(contactId);
    const contact = contacts.find(c => c.id === contactId);
    const ctx = {
      joinedAt: contact?.joined_at ?? null,
      allInteractionsWithContact: interactions.filter(i => i.contact_id === contactId && i.activist_id === activistId),
    };
    contactContextCache.set(contactId, ctx);
    return ctx;
  }
```

שנה את שורת הקריאה בתוך הלולאה (שורה 454):
```js
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg);
```
ל:
```js
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg, getContactContext(interaction.contact_id));
```

- [ ] **Step 4: `paidBefore` — אותו דפוס**

ב-`paidBefore` (שורה 370), הוסף פרמטר `allInteractions` (ברירת מחדל = `monthlyInteractions`, כי זה מה שכל הקוראים הקיימים כבר מעבירים — אבל לחלון-3-חודשים צריך *כל* ההיסטוריה, לא רק החודש. לכן: הוסף פרמטר חדש בסוף `paidBefore(draft, monthlyInteractions, contacts, cfg = DEFAULTS, allInteractionsForContext = null)`. בתוך הפונקציה, לפני הלולאה `for (const i of ordered) {`:

```js
  const historySource = allInteractionsForContext || monthlyInteractions;
```

ובתוך הלולאה, שנה:
```js
    const r = calcInteractionPayment(i, prevForContact, contact?.high_potential ?? false, accumulated, cfg);
```
ל:
```js
    const contactContext = { joinedAt: contact?.joined_at ?? null, allInteractionsWithContact: historySource.filter(x => x.contact_id === i.contact_id) };
    const r = calcInteractionPayment(i, prevForContact, contact?.high_potential ?? false, accumulated, cfg, contactContext);
```

⚠️ `paidBefore` נקראת היום עם `monthlyInteractions` בלבד (ראה `pages/contact/add-interaction/[id].jsx`, `scripts/verify-payment-order.cjs`) — בלי הפרמטר החמישי החדש, חלון-3-החודשים לא יראה מעבר לגבול החודש (עלול לקבוע "בתוך החלון" באופן שגוי אם הקשר הראשון עם הלקוח היה בחודש קודם). **Step 5 מתקן את זה בקורא בפועל** (add-interaction page) על ידי העברת כל ה-interactions, לא רק `myMonthly`.

- [ ] **Step 5: `pages/contact/add-interaction/[id].jsx` — התצוגה המקדימה החיה**

מצא את הבלוק (סביב שורה 118-126):
```js
  const payableCheck = (isAchdut && form.type && (form.quality || isShabbat) && form.long_enough)
    ? calcInteractionPayment(
        { type: form.type, quality: form.quality, duration_minutes: duration },
        previousContactMonthly,
        contact.high_potential,
        previousActivistMonthly,
        paymentConfig
      )
    : null;
```

שנה ל:
```js
  // contactContext לתצוגה המקדימה — כל קשרי הפעיל עם הלקוח הזה, לא רק החודש הנוכחי
  // (myMonthly), כדי שחלון-3-חודשים ומעבר-לתורני יעבדו נכון גם לקוח ותיק.
  const contactHistory = interactions.filter(i => i.contact_id === contactId && i.activist_id === currentUser?.id);
  const contactContext = { joinedAt: contact.joined_at ?? null, allInteractionsWithContact: contactHistory };
  const payableCheck = (isAchdut && form.type && (form.quality || isShabbat) && form.long_enough)
    ? calcInteractionPayment(
        { type: form.type, quality: form.quality, duration_minutes: duration, date: form.date },
        previousContactMonthly,
        contact.high_potential,
        previousActivistMonthly,
        paymentConfig,
        contactContext
      )
    : null;
```

⚠️ שים לב ל-`date: form.date` שנוסף לאובייקט הקשר בתצוגה המקדימה — בלעדיו `interaction.date` הוא `undefined` וחישוב `monthsBetween` נכשל (0 חודשים תמיד, שקול לתאריך היום). זה תיקון נדרש, לא שינוי סגנון.

- [ ] **Step 6: `lib/activistStats.js` — `payableInteractionsThisMonth`**

באותו קובץ, בתוך הפונקציה (סביב שורה 79-85), הוסף `contactContext` לקריאה, באותו דפוס כמו Step 3 — הפונקציה כבר מקבלת `contacts` ו-`interactions` בפרמטרים שלה, כך שאין צורך בפרמטר נוסף:

```js
  for (const interaction of myMonthly) {
    const contact = contacts?.find(c => c.id === interaction.contact_id);
    const isHigh  = contact?.high_potential ?? false;
    const prevForContact = accumulated.filter(i => i.contact_id === interaction.contact_id);
    const contactContext = { joinedAt: contact?.joined_at ?? null, allInteractionsWithContact: (interactions || []).filter(i => i.contact_id === interaction.contact_id && i.activist_id === activistId) };
    const result = calcInteractionPayment(interaction, prevForContact, isHigh, accumulated, cfg, contactContext);
    if (result.payable) { accumulated.push(interaction); payableCount++; }
  }
```

- [ ] **Step 7: `getMonthlyTotalForActivist` — אותו דפוס (שורה 390-416)**

זהה ל-Step 3/6: בנה `contactContext` מ-`allContacts`+`allInteractions` (שניהם כבר בפרמטרים של הפונקציה) והעבר לקריאה בשורה 410.

- [ ] **Step 8: הרץ ווודא הצלחה**

Run: `node scripts/verify-payment-order.cjs`
Expected: כל הבדיקות `✓ PASS`, כולל בדיקת העקביות מ-Step 1.

- [ ] **Step 9: `npm run build`**

- [ ] **Step 10: Commit**

```bash
git add lib/paymentCalc.js lib/activistStats.js pages/contact/add-interaction/[id].jsx scripts/verify-payment-order.cjs
git commit -m "feat: wire contactContext through every calcInteractionPayment caller"
```

---

### Task 4: בונוס תורני — deriveToraniBonuses + חיווט מלא

**Files:**
- Modify: `lib/paymentCalc.js` — `deriveToraniBonuses` (חדש), `calcMonthlyPayment` (423-504), `calcConsultantDashboard` (513-563)
- Modify: `lib/CrmStore.jsx` — חישוב+חשיפת `toraniBonuses` (ליד `mitzvotBonuses`, סביב שורה 176-194 ו-610-615)
- Modify: `pages/payments.jsx` (סביב שורה 81), `pages/payments/[id].jsx` (סביב שורה 54), `pages/my-dashboard.jsx` (סביב שורה 101)
- Modify: `scripts/verify-payroll-xlsx.cjs` (שורה 58), `scripts/verify-month-report.cjs` (שורה 54) — לדיוק, לא קריטי
- Test: `scripts/verify-payment-order.cjs`

**Interfaces:**
- Produces: `deriveToraniBonuses(interactions, contacts, amount = TORANI_BONUS_AMOUNT, months = TORANI_BONUS_MONTHS) → [{ activist_id, contact_id, contactName, amount, desc, month }]` — פונקציה טהורה, מקור-אמת יחיד (כמו `deriveMitzvotBonuses`).
- Produces: `calcMonthlyPayment(..., toraniBonuses = [])` — פרמטר **תשיעי**, בסוף הרשימה (אחרי `period`). `calcConsultantDashboard(..., toraniBonuses = [])` — אותו דבר, פרמטר תשיעי.

- [ ] **Step 1: הוסף בדיקות כושלות ל-`scripts/verify-payment-order.cjs`**

```js
// ────────────────────────────────────────────────────────────────────────────
// בונוס תורני — 3 חודשים רצופים, פעם אחת בלבד ללקוח (2026-08-31).
// ────────────────────────────────────────────────────────────────────────────
{
  const { deriveToraniBonuses } = require('../lib/paymentCalc.js');
  const mkT = (activistId, contactId, date, id) => ({ activist_id: activistId, project_id: 1, contact_id: contactId, quality: 'תורני', type: 'פרונטלי', date, id });
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
```

- [ ] **Step 2: הרץ ווודא כשל**

- [ ] **Step 3: הוסף `deriveToraniBonuses` ב-`lib/paymentCalc.js`**

הוסף אחרי `deriveMitzvotBonuses` (אחרי שורה 226, לפני `previewNewMitzvotBonusChanges`):

```js
/**
 * deriveToraniBonuses — בונוס חד-פעמי ללקוח שהשלים TORANI_BONUS_MONTHS חודשים
 * קלנדריים *רצופים* עם לפחות קשר תורני אחד בכל חודש. מיוחס לחודש השלישי ברצף
 * *הראשון* שנמצא — "פעם אחת בלבד ללקוח" (מפסיקים לחפש ברגע שנמצא רצף מתאים).
 * מקור-אמת יחיד: פונקציה טהורה, נצרכת ע"י lib/CrmStore.jsx וסקריפטי ה-verify,
 * באותו דפוס בדיוק כמו deriveMitzvotBonuses.
 *
 * per (activist_id, contact_id) — אם לקוח עבר בין פעילים, הרצף נספר בנפרד לכל
 * פעיל (תואם לשאר מנוע התשלום, שבו לקוח משויך לפעיל אחד).
 */
function deriveToraniBonuses(interactions, contacts, amount = TORANI_BONUS_AMOUNT, months = TORANI_BONUS_MONTHS) {
  const byPair = new Map();
  for (const i of (interactions || [])) {
    if (!countsForPayment(i) || i.quality !== 'תורני') continue;
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
          const contact = contacts.find(c => String(c.id) === contactIdStr);
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
```

- [ ] **Step 4: חבר ל-`calcMonthlyPayment`**

שנה את החתימה (שורה 423):
```js
function calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null) {
```
ל:
```js
function calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null, toraniBonuses = []) {
```

הוסף לולאה חדשה אחרי לולאת "בונוסי הבאת משתתף חדש" (אחרי שורה 501, לפני `return { total, breakdown, unpaid };`):

```js
  // בונוס תורני — 3 חודשים רצופים, פעם אחת ללקוח.
  const TORANI_AMOUNT = cfg.TORANI_BONUS_AMOUNT ?? TORANI_BONUS_AMOUNT;
  for (const bonus of toraniBonuses) {
    const key = makeBonusKey(activistId, 'בונוס-תורני', bonus.contact_id, monthKey);
    if (cancelledBonusKeys.has(key)) continue;
    total += TORANI_AMOUNT;
    breakdown.push({ type: 'בונוס-תורני', contactId: bonus.contact_id, contactName: bonus.contactName, amount: TORANI_AMOUNT, desc: bonus.desc, key });
  }
```

⚠️ **`toraniBonuses` שמועבר לכאן חייב להיות מסונן ל-`bonus.month === monthKey` לפני הקריאה** (כמו ש-`mitzvotBonuses`/`newParticipantBonuses` כבר מסוננים היום ע"י כל קורא) — `calcMonthlyPayment` עצמה לא מסננת לפי חודש עבור שלושתם, זו אחריות הקורא. ודא בכל קורא ב-Step 6 שהסינון קיים.

- [ ] **Step 5: חבר ל-`calcConsultantDashboard`**

שנה חתימה (שורה 513) והעברה פנימית (שורה 525):
```js
function calcConsultantDashboard(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null) {
```
ל:
```js
function calcConsultantDashboard(activistId, interactions, contacts, mitzvotBonuses = [], newParticipantBonuses = [], cfg = DEFAULTS, cancelledBonusKeys = EMPTY_SET, period = null, toraniBonuses = []) {
```
ובגוף הפונקציה:
```js
  const salary = calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses, newParticipantBonuses, cfg, cancelledBonusKeys, { year, month });
```
ל:
```js
  const salary = calcMonthlyPayment(activistId, interactions, contacts, mitzvotBonuses, newParticipantBonuses, cfg, cancelledBonusKeys, { year, month }, toraniBonuses);
```

- [ ] **Step 6: הוסף `deriveToraniBonuses` ל-`module.exports`, הרץ ווודא הצלחה, build, commit**

Run: `node scripts/verify-payment-order.cjs` → כל הבדיקות `✓ PASS`. `npm run build` נקי.

```bash
git add lib/paymentCalc.js scripts/verify-payment-order.cjs
git commit -m "feat: add deriveToraniBonuses and wire into calcMonthlyPayment/calcConsultantDashboard"
```

- [ ] **Step 7: `lib/CrmStore.jsx` — חישוב+חשיפה**

הוסף import: `deriveToraniBonuses` לצד `deriveMitzvotBonuses` בשורת ה-import הקיימת מ-`./paymentCalc`.

הוסף `useMemo` ליד `mitzvotBonuses` (סביב שורה 194):
```js
  // בונוס תורני — נגזר מ-interactions הפרסיסטנטי, לא מ-state זמני. אותו דפוס כמו
  // mitzvotBonuses: מקור-אמת יחיד, נגזר-מחדש בכל טעינה. ראה lib/paymentCalc.js.
  const toraniBonuses = useMemo(() => deriveToraniBonuses(interactions, contacts), [interactions, contacts]);
```

הוסף `toraniBonuses` לרשימת ה-`value={{...}}` של ה-Provider (שורה 612, ליד `mitzvotBonuses, newParticipantBonuses,`).

- [ ] **Step 8: `pages/payments.jsx`, `pages/payments/[id].jsx`, `pages/my-dashboard.jsx`**

בכל שלושת הקבצים: הוסף `toraniBonuses` לרשימת ה-destructure מ-`useCrm()`. בנקודת החישוב (ליד `myMitzvotBonuses`/`myNewBonuses` הקיימים), הוסף:

```js
const myToraniBonuses = toraniBonuses.filter(b => b.activist_id === activist.id && b.month === monthKey);
```
(או `currentUser.id` במקום `activist.id` ב-`my-dashboard.jsx` — בדוק את השם המדויק של המשתנה בקובץ). והעבר כפרמטר תשיעי לקריאה ל-`calcMonthlyPayment`/`calcConsultantDashboard` הקיימת בכל קובץ.

- [ ] **Step 9: `scripts/verify-payroll-xlsx.cjs`, `scripts/verify-month-report.cjs`**

באותו דפוס: גזור `toraniBonuses = deriveToraniBonuses(interactions, contacts)`, סנן לפי activist+monthKey, העבר כפרמטר תשיעי לקריאה הקיימת ל-`calcMonthlyPayment`.

- [ ] **Step 10: הרץ הכל, build, commit**

Run: `node scripts/verify-payment-order.cjs` (0 כשלים) ו-`npm run build` (נקי).

```bash
git add lib/CrmStore.jsx pages/payments.jsx pages/payments/[id].jsx pages/my-dashboard.jsx scripts/verify-payroll-xlsx.cjs scripts/verify-month-report.cjs
git commit -m "feat: wire toraniBonuses through app pages and verify scripts"
```

---

### Task 5: קשר קצרצר — UI + מנוע

**Files:**
- Modify: `lib/paymentCalc.js` — `calcInteractionPayment` (חסימה מפורשת)
- Modify: `data/config.js` — `CONFIG.contactMethods`
- Modify: `pages/contact/add-interaction/[id].jsx` — מצב-דיווח שלישי
- Test: `scripts/verify-payment-order.cjs`

**Interfaces:**
- Produces: `calcInteractionPayment` דוחה `type === 'קצרצר'` תמיד, לפני כל בדיקה אחרת.
- Produces: `CONFIG.contactMethods = ['טלפון', 'וואטסאפ']`.
- Produces: טופס עם שדה `form.reportKind` (`'single' | 'multi' | 'brief'`, מחליף את `form.multi` הבוליאני) — `'brief'` מציג רק dropdown אמצעי-קשר; שולח `type: 'קצרצר'`, `quality: <אמצעי הקשר>`, `duration_minutes: 5`.

- [ ] **Step 1: הוסף בדיקה כושלת ל-`scripts/verify-payment-order.cjs`**

```js
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
```

- [ ] **Step 2: הרץ ווודא כשל**

- [ ] **Step 3: הוסף חסימה מפורשת ל-`calcInteractionPayment`**

מיד **אחרי** בדיקת `isDerivedInteraction` (אחרי הבלוק בשורות 297-300) ו**לפני** סינון `prevContactMonthly`/`prevActivistMonthly` (שורות 302-304), הוסף:

```js
  // קשר קצרצר — לעולם לא מזכה, ולא נספר בשום מכסה/בונוס. בדיקה מפורשת ולא רק
  // הישענות על duration_minutes<15: הגנה כפולה, כמו כל שאר החריגות במנוע הזה.
  if (type === 'קצרצר') {
    return { amount: 0, payable: false, reason: 'קשר קצרצר — אינו מזכה בתשלום' };
  }
```

⚠️ שים לב: `type` נגזר מ-`const { type, quality, duration_minutes = 0 } = interaction;` שנמצא **לפני** בדיקת `isDerivedInteraction` (שורה 295 לפני 297) — הסדר כבר נכון, `type` זמין.

- [ ] **Step 4: `data/config.js` — הוסף `contactMethods`**

הוסף ליד `CONFIG.interactionTypes`:
```js
  contactMethods: ['טלפון', 'וואטסאפ'],
```

- [ ] **Step 5: הרץ ווודא הצלחה (מנוע), build, commit**

Run: `node scripts/verify-payment-order.cjs` → `✓ PASS`. `npm run build` נקי.

```bash
git add lib/paymentCalc.js data/config.js scripts/verify-payment-order.cjs
git commit -m "feat: add explicit non-payable very-short interaction type"
```

- [ ] **Step 6: `pages/contact/add-interaction/[id].jsx` — מצב-דיווח שלישי**

זהו שינוי UI מהותי לקובץ קיים ומורכב (693 שורות). קרא את הקובץ המלא לפני העריכה — הוא כבר מטפל בדפוס דומה (`form.multi` בוליאני עם `toggleMulti`) שאליו מתווסף מצב שלישי.

**שינוי EMPTY (שורה 27-35):** החלף `multi: false` ב-`reportKind: 'single'` (`'single' | 'multi' | 'brief'`), הוסף `contact_method: ''`.

**שינוי handler `toggleMulti`:** הפוך אותו ל-`setReportKind(kind)` שמטפל בשלושת המצבים — לוגיקת האיפוס הקיימת (ניקוי type/quality/participant_* בכניסה/יציאה ממצב multi) חייבת להישמר, ולהתרחב כך שגם כניסה/יציאה מ-`'brief'` תנקה את השדות הרלוונטיים (type/quality/duration/participant_*) באותה זהירות. **אל תמחק את לוגיקת האיפוס הקיימת ל-multi** — רק הרחב אותה לתמוך במצב השלישי.

**שינוי ה-UI של "אופי הדיווח" (שורה 488-556):** הוסף כפתור שלישי `⚡ קשר קצרצר` לצד השניים הקיימים. כש-`reportKind === 'brief'`: הצג רק `<select>` יחיד (אמצעי קשר, אופציות מ-`CONFIG.contactMethods`) — הסתר לגמרי את בלוקי "סוג קשר" (שורה 558-573), "איכות הקשר" (576-590), ו"משך זמן" (611-638). **השאר** את בלוקי תיאור (649-656) ופעולה-הבאה (658-678) גלויים — עדיין רלוונטיים לתעד "מה סוכם" גם בקשר קצר.

**שינוי `handleSubmit` (סביב שורה 303-319, בניית `interactionPayload`):** כש-`reportKind === 'brief'`, `type: 'קצרצר'`, `quality: form.contact_method`, `duration_minutes: 5` (קבוע, לא מהטופס). ודא ש-`validate()` (שורה 220-241) לא דורש `type`/`quality`/`long_enough` כש-`reportKind === 'brief'` (רק `contact_method`), באותו דפוס בדיוק כמו שהיא כבר מדלגת על `type`/`quality` כש-`form.multi === true`.

⚠️ **קרא את `validate()` ואת `payableCheck` (סביב שורה 118-126, אחרי Task 3) בעיון** לפני העריכה — שניהם כבר מבחינים בין `!form.multi` ל-`form.multi`, וצריך להוסיף את התנאי השלישי בלי לשבור את הלוגיקה הקיימת לשני המצבים האחרים. אם `payableCheck` מנסה לחשב עבור `reportKind === 'brief'` — זה בסדר (התוצאה תמיד `payable:false` בזכות Step 3), פשוט לוודא שהוא לא זורק שגיאה על `form.quality` ריק.

- [ ] **Step 7: בדיקה ידנית בדפדפן**

הרץ `npm run dev`, התחבר כפעיל, פתח "הוסף קשר" ללקוח קיים, בחר "⚡ קשר קצרצר", ודא: מוצג רק dropdown אמצעי-קשר + תיאור + פעולה הבאה; שמירה מצליחה; הקשר מופיע בהיסטוריית הלקוח; בעמוד `/payments` הקשר הזה לא מופיע כלל בפירוט (לא בתשלום, לא כ"לא זוכה" — כי `unpaid` ב-`calcMonthlyPayment` **כן** ירשום אותו עם הסיבה "קשר קצרצר — אינו מזכה בתשלום", שקיפות מכוונת, לא הסתרה).

- [ ] **Step 8: `npm run build`, commit**

```bash
git add pages/contact/add-interaction/[id].jsx
git commit -m "feat: add very-short interaction report mode to add-interaction form"
```

---

### Task 6: אימות מפגש רב-משתתפים (כבר קיים)

**Files:**
- Test only: `scripts/verify-payment-order.cjs` — אין שינוי קוד ייצור, רק בדיקה מתעדת.

**Interfaces:**
- אין ממשק חדש — משימה זו מוודאת ומתעדת שהמימוש הקיים (`isDerivedInteraction`, `addParticipantInteractions` ב-`lib/CrmStore.jsx`, טופס `pages/contact/add-interaction/[id].jsx`) עונה על סעיף 4 בבקשת נדב.

- [ ] **Step 1: הוסף בדיקה מתעדת (לא כושלת מראש — המימוש כבר קיים)**

```js
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
```

- [ ] **Step 2: הרץ**

Run: `node scripts/verify-payment-order.cjs`
Expected: `✓ PASS` על כל הבדיקות החדשות — **בלי שום שינוי קוד ייצור** (אם בדיקה כלשהי נכשלת, זה ⚠️ ממצא אמיתי שהמימוש הקיים לא עונה על הדרישה בדיוק כפי שחשבנו — עצור ודווח, אל תתקן את הבדיקה כדי שתעבור).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-payment-order.cjs
git commit -m "test: verify existing multi-participant meeting handling meets the payment-rules request"
```

---

### Task 7: אימות מול נתוני אמת + הכנת סקריפט עדכון DB (לא מורץ) + דוח סופי

**Files:**
- Create: `scripts/apply-new-payment-rates.cjs` (מוכן, **לא מורץ**)
- No code changes — קריאה בלבד מול Supabase + כתיבת הדוח הסופי.

- [ ] **Step 1: הרץ את כל בדיקות המנוע**

```bash
node scripts/verify-payment-order.cjs
npm run build
```
תעד את הפלט המלא (הכל אמור לעבור נקי).

- [ ] **Step 2: הרץ `scripts/compare-payment-impact.cjs` לחודש הנוכחי (קריאה בלבד, מול Supabase)**

```bash
COMPARE_BASE_REF=HEAD node scripts/compare-payment-impact.cjs 2026 8
```

⚠️ **`COMPARE_BASE_REF=HEAD`, לא ברירת המחדל `main`** — הענף הזה כבר לא זהה ל-`main` (יש קומיטים קודמים על branch נפרד). `HEAD` בלי המשימה הזו = הקומיט לפני Task 1 של התוכנית הזו (רשום אותו מראש: `git log --oneline` לפני שמתחילים לבצע Task 1, ושמור את ה-SHA). תעד את הפלט — כמה כסף זז, לאיזה פעילים, ולמה (רוב הסביר: ירידה אצל פעילים עם הרבה שיחות תורניות/ידידותיות, כי התעריפים ירדו והזכאות-ידידותי הצטמצמה).

- [ ] **Step 3: צור `scripts/apply-new-payment-rates.cjs` — מוכן, לא מורץ**

בדפוס read+update עם `SUPABASE_SECRET_KEY`, בסגנון `scripts/mark-feedback-reviewed.cjs`:

```js
// scripts/apply-new-payment-rates.cjs — מעדכן את payment_config ב-Supabase לתעריפים
// החדשים (עדכון 2026-08-31). *** לא רץ אוטומטית — נדב מריץ אותו ביודעין. ***
// שימוש: node scripts/apply-new-payment-rates.cjs           (יבש — רק מציג מה ישתנה)
//        node scripts/apply-new-payment-rates.cjs --apply   (כותב בפועל)
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const NEW_RATES = {
  rate_phone_friendly: 0,    // היה 150
  rate_phone_torani:   150,  // היה 200
  rate_video_torani:   200,  // היה 250
};

(async () => {
  const { data: current, error: readErr } = await sb.from('payment_config').select('*').eq('id', 1).single();
  if (readErr) { console.error('קריאת payment_config נכשלה:', readErr.message); process.exit(1); }

  console.log('=== שינוי תעריפים מוצע ===');
  for (const [col, newVal] of Object.entries(NEW_RATES)) {
    console.log(`${col}: ${current[col]} → ${newVal}`);
  }

  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log('\n(מצב יבש — כלום לא נכתב. הרץ עם --apply כדי לכתוב בפועל.)');
    return;
  }

  const { error: writeErr } = await sb.from('payment_config').update(NEW_RATES).eq('id', 1);
  if (writeErr) { console.error('כתיבה נכשלה:', writeErr.message); process.exit(1); }
  console.log('\n✅ payment_config עודכן.');
})();
```

- [ ] **Step 4: הרץ במצב יבש בלבד (בלי `--apply`) כדי לוודא שהוא קורא נכון**

```bash
node scripts/apply-new-payment-rates.cjs
```

⚠️ **בלי `--apply`.** תעד את הפלט (הערכים הנוכחיים מול המוצעים) בדוח הסופי. **אל תריץ עם `--apply` בשום שלב של התוכנית הזו.**

- [ ] **Step 5: Commit**

```bash
git add scripts/apply-new-payment-rates.cjs
git commit -m "chore: prepare (not run) script to apply new payment_config rates"
```

- [ ] **Step 6: כתוב דוח סופי**

לפי הדרישה המקורית של נדב — קבצים ששונו, מה בדיוק יושם, אילו בדיקות נוספו, האם הכל עבר, **ובנוסף**: הבהרה מפורשת ש-`payment_config` ב-DB עדיין לא עודכן (הסקריפט מוכן, `scripts/apply-new-payment-rates.cjs`, לא הורץ) ושהוא צריך להריץ אותו ביודעין; תוצאות `compare-payment-impact.cjs` (למי ובכמה משתנה השכר); שקשר רב-משתתפים כבר היה קיים ולא נבנה מחדש.

---

## Self-Review (בוצע בעת כתיבת התוכנית)

**כיסוי מפרט**: תעריפים+זכאות ידידותי (Task 1+2+3), בונוס תורני (Task 4), קשר קצרצר (Task 5), אימות רב-משתתפים (Task 6), נתונים-ישנים+דוח-סופי+לא-כותבים-ל-DB (Task 7) — כל סעיף במפרט יש לו משימה.

**סריקת placeholder**: אין TBD/TODO גנרי. ⚠️ מסומנות בדיוק במקומות שבהם יש סיכון אמיתי לתקלה שקטה (קוראים שנשכחים, `date` חסר בתצוגה המקדימה, `COMPARE_BASE_REF`), לא כ"implement later" — כל אחת מלווה בהוראה קונקרטית.

**עקביות טיפוסים**: `contactContext` (Task 2) נצרך זהה בכל הקריאות ב-Task 3. `toraniBonuses` (Task 4) עוקב אחר אותו shape כמו `mitzvotBonuses`/`newParticipantBonuses` הקיימים (`{ activist_id, contact_id, contactName, amount, desc, month }`). `deriveToraniBonuses`/`isoYearMonth`/`monthsBetween` מיוצאות פעם אחת ונצרכות בכל מקום.

**⚠️ סיכון ידוע שלא נפתר בתוכנית הזו**: הענף הזה (`fix/feedback-2026-08`) והענף המקביל של דוח-הפעילות (`worktree-activist-activity-report`) שניהם עורכים את `calcMonthlyPayment`/`calcInteractionPayment` באותו קובץ, בשני worktree-ים נפרדים. מיזוג שני הענפים בעתיד עלול לדרוש פתרון קונפליקט ידני ב-`lib/paymentCalc.js` — לא קטלני (שני השינויים לא חופפים באותן שורות בדיוק), אבל דורש תשומת לב. מתועד כאן לנדב, לא נפתר אוטומטית.
