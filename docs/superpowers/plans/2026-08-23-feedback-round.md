# תיקון 15 דיווחי הפעילים מעמוד /feedback — תוכנית עבודה

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** לסגור את כל 15 הדיווחים הפתוחים בטבלת `feedback_reports` — תיקון קוד לכל דיווח שיש לו שורש בקוד, ואימות/סימון לדיווחים שכבר תוקנו בסבבים קודמים.

**Architecture:** רוב הדיווחים נופלים לארבעה אשכולות: (1) מנוע התשלום `lib/paymentCalc.js` — סדר הקצאת מכסות ובונוס-מצוות; (2) מוני-קשרים בממשק שסופרים שורות נגזרות ממפגש רב-משתתפים; (3) טפסים בלי מנעול-שליחה ובלי טווחי-תאריך הגיוניים; (4) התראות שנכתבות מהדפדפן ולכן לעולם לא מגיעות כ-Push. כל תיקון נעשה במקור-האמת היחיד ולא בכל צרכן בנפרד.

**Tech Stack:** Next.js 14 (Pages Router), React 18, Supabase (Postgres + RLS), CommonJS ב-`lib/paymentCalc.js`, אימות ע"י סקריפטים תחת `scripts/*.cjs` (אין framework בדיקות בפרויקט — הדפוס הקיים הוא סקריפט node שמדפיס PASS/FAIL).

## Global Constraints

- **אין דיפלוי לפרודקשן.** עבודה בענף `fix/feedback-2026-08` בלבד. `.github/workflows/deploy.yml` מדפלוי רק על push ל-`main` — אין לגעת ב-`main`.
- **אין מיגרציות חדשות.** סוכן AI לא יכול להריץ DDL (ראה CLAUDE.md). כל תיקון חייב לעבוד על הסכמה הקיימת.
- **פורמט `bonus_key` לא משתנה:** `${activistId}|${type}|${contactId}|${monthKey}` עם `monthKey` = `${year}-${month}` (month 0-indexed). ב-`bonus_cancellations` כבר יש 3 שורות חיות בפורמט הזה (יולי 2026, פעיל 11) — שינוי הפורמט יחזיר לחיים בונוסים שנדב כבר ביטל.
- **`npm run build` חייב לעבור** אחרי כל משימה.
- כל הערה/מחרוזת חדשה בעברית, בסגנון הקבצים הקיימים.
- ניווט: כל פריט ניווט חדש חייב להיכנס לשלושת הקבצים (DesktopLayout, landing, MobileBottomNav). התוכנית הזו לא מוסיפה פריטי ניווט.

---

## מיפוי הדיווחים → משימות

| # | מדווח | תאריך | תמצית | משימה |
|---|---|---|---|---|
| 1 | מוטי גלעד | 14.8 | דיווח נשמר פעמיים | Task 4 |
| 2 | מוטי גלעד | 2.8 | התקדמות במצוות לא מופיעה בהתראות | Task 6 |
| 3 | מוטי גלעד | 2.8 | בונוס מצוות משולם על כל רמה בקפיצה כפולה | Task 2 |
| 4 | מוטי גלעד | 2.8 | "קשרים החודש" באזור אישי לא מתאפס ב-1 בחודש | Task 3 |
| 5 | אלעזר באום | 31.7 | המכסה נאכלת ע"י ידידותיים לפי תאריך, תורניים נדחקים | Task 1 |
| 6 | שירה שם טוב | 30.7 | מחיקת הוצאה לא משנה את הסכום לתשלום | Task 5 |
| 7 | שירה שם טוב | 30.7 | "תאריך יעד" מוגבל להיום ואילך | Task 4 |
| 8 | שירה שם טוב | 30.7 | שיחה אחת נרשמה כ-3 | Task 3 |
| 9 | מוטי גלעד | 29.7 | ברב-משתתפים לא כל הלקוחות מופיעים ברשימה | Task 7 |
| 10 | מוטי שטרלינג | 28.7 | אירוע רב-משתתפים אחד נחשב כ-3 | Task 3 |
| 11 | מוטי שטרלינג | 28.7 | 2 אירועים עם 2 לקוחות — נחשב כפול | Task 3 |
| 12 | נחמיה גרטש | 26.7 | תקרת 4 שיחות ללקוח | Task 8 (אימות — תוקן ב-236319c) |
| 13 | מוטי גלעד | 23.7 | לא מקבל Push, רק פעמון | Task 6 |
| 14 | אלעזר באום | 22.7 | רב-משתתפים נספר במכסת הפרונטליים | Task 8 (אימות — תוקן ב-236319c) |
| 15 | מוטי גלעד | 21.7 | מפגש 5 עם אותו לקוח "חרג" | Task 8 (אימות — תוקן ב-236319c) |

## File Structure

**חדשים**
- `scripts/verify-payment-order.cjs` — בדיקות מנוע: סדר הקצאת מכסה + בונוס מצוות. מדפיס PASS/FAIL ומחזיר exit code.
- `pages/api/mitzvot/notify.js` — endpoint התראה על עליית מצוות (פעמון + Push לניהול הפרויקט, ופעמון + Push לפעיל עצמו).
- `components/ClientSearchSelect.jsx` — בורר לקוח עם חיפוש, לשורות המשתתפים במפגש רב-משתתפים.

**משתנים**
- `lib/paymentCalc.js` — comparator להקצאת מכסה לפי ערך; export של `isDerivedInteraction` (כבר קיים) ו-`comparePaymentOrder`.
- `lib/CrmStore.jsx` — בונוס-מצוות אחד לכל אירוע-עליה; expenses הופכים ל-state מנוהל עם `addExpense`/`deleteExpense`.
- `lib/activistStats.js` — מוני קשרים מחריגים שורות נגזרות ועוברים לחודש קלנדרי.
- `lib/notifyApi.js` — עטיפת `notifyMitzvotApi`.
- `pages/index.jsx` — "קשרים החודש" = חודש קלנדרי, בלי נגזרות.
- `pages/my-activities.jsx` — מונה "דיווחי קשר" בלי נגזרות + תווית על כרטיס נגזר.
- `pages/landing.jsx` — מוני קשרים בלי נגזרות.
- `pages/contact/add-interaction/[id].jsx` — מנעול שליחה, טווח תאריך-יעד, בורר לקוח מחפש, סדר-ערך בתצוגה המקדימה.
- `pages/contact/update-mitzvot/[id].jsx` — בונוס פר-מצווה, מנעול שמירה, קריאת ההתראה.
- `pages/expenses.jsx` — צריכת expenses מה-store.
- `data/config.js` — ללא שינוי (נבדק).

---

## Task 1 — סדר הקצאת מכסה לפי ערך, לא לפי תאריך (דיווח #5)

**Files:**
- Modify: `lib/paymentCalc.js`
- Modify: `lib/activistStats.js`
- Modify: `pages/contact/add-interaction/[id].jsx`
- Test: `scripts/verify-payment-order.cjs`

**Interfaces:**
- Produces: `comparePaymentOrder(a, b, cfg)` — comparator יציב: מחיר בסיס יורד, ואז `date` עולה, ואז `id` עולה. מיוצא מ-`lib/paymentCalc.js`.
- Produces: `interactionBasePrice(i, cfg)` — מחזיר מספר (0 לסוג לא מזוהה).
- Consumes: `countsForPayment`, `isDerivedInteraction` הקיימים.

**הרציונל:** אלעזר באום: "המערכת סופרת את המפגשים לעניין המכסה לפי תאריך… תורניים מאוחרים יותר שחרגו מהמכסה לא נספרים לתשלום. היה נחמד אם היו נספרים לעניין מכסת התשלום קודם כל התורניים." הלולאה ב-`calcMonthlyPayment` ממיינת `new Date(a.date) - new Date(b.date)` ומקצה מכסה greedy. החלפת המיון בסדר-ערך פותרת את זה בלי לגעת ב-`calcInteractionPayment` עצמו.

- [ ] **Step 1: כתוב את בדיקת הכישלון**

צור `scripts/verify-payment-order.cjs`:

```js
// scripts/verify-payment-order.cjs — בדיקות מנוע התשלום: סדר הקצאת מכסה + בונוס מצוות.
// שימוש: node scripts/verify-payment-order.cjs
// אין framework בדיקות בפרויקט — זה סקריפט node עצמאי בדפוס scripts/verify-*.cjs.
const { calcMonthlyPayment, DEFAULTS } = require('../lib/paymentCalc.js');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok ? '' : `\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`}`);
}

// קונפיג מוקטן: מכסת 2 פרונטליים בלבד, כדי שהתקרה תיבלם בבדיקה קטנה.
const cfg = { ...DEFAULTS, MONTHLY_CAPS: { phone: 25, frontal: 2, multi: 6 } };
const contacts = [{ id: 1, name: 'א' }, { id: 2, name: 'ב' }, { id: 3, name: 'ג' }];
const base = { activist_id: 7, project_id: 1, type: 'פרונטלי', duration_minutes: 60 };

// שני ידידותיים (250) בתחילת החודש ותורני (300) בסופו, מול מכסה של 2.
const interactions = [
  { ...base, id: 1, contact_id: 1, quality: 'ידידותי', date: '2026-07-02' },
  { ...base, id: 2, contact_id: 2, quality: 'ידידותי', date: '2026-07-03' },
  { ...base, id: 3, contact_id: 3, quality: 'תורני',   date: '2026-07-28' },
];

const r = calcMonthlyPayment(7, interactions, contacts, [], [], cfg, new Set(), { year: 2026, month: 6 });
check('התורני נכנס למכסה לפני הידידותי', r.total, 300 + 250);
check('הידידותי המאוחר הוא זה שלא זוכה', r.unpaid.map(u => u.contactId), [2]);

process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: הרץ ובדוק שהיא נכשלת**

```bash
node scripts/verify-payment-order.cjs
```
צפוי: `FAIL — התורני נכנס למכסה לפני הידידותי` (המנוע יחזיר 500 = 250+250, והתורני יידחה).

- [ ] **Step 3: מימוש ב-`lib/paymentCalc.js`**

הוסף אחרי `const countsForPayment = …`:

```js
// מחיר הבסיס של קשר לפי המחירון הפעיל — 0 לסוג שאינו מזוהה.
function interactionBasePrice(i, cfg = DEFAULTS) {
  const prices = cfg.BASE_PRICES || BASE_PRICES;
  if (i.type === 'אירוח שבת') return prices['אירוח שבת'] ?? 0;
  return prices[`${i.type}-${i.quality}`] ?? 0;
}

// סדר הקצאת המכסה. עד 2026-08 ההקצאה הייתה כרונולוגית, ולכן קשר זול בתחילת החודש
// "תפס מקום" לקשר יקר בסופו והפעיל הפסיד את ההפרש (דיווח אלעזר באום, 2026-07-31).
// עכשיו: מחיר יורד → תאריך עולה → id עולה. יציב ודטרמיניסטי, ולכן אותו חישוב בכל מסך.
function comparePaymentOrder(a, b, cfg = DEFAULTS) {
  const priceDiff = interactionBasePrice(b, cfg) - interactionBasePrice(a, cfg);
  if (priceDiff !== 0) return priceDiff;
  const dateDiff = new Date(a.date) - new Date(b.date);
  if (dateDiff !== 0) return dateDiff;
  return Number(a.id ?? 0) - Number(b.id ?? 0);
}
```

החלף בכל שלוש הלולאות (`getMonthlyTotalForActivist`, `calcMonthlyPayment`) את המיון:

```js
// לפני:  .sort((a, b) => new Date(a.date) - new Date(b.date))
// אחרי:  .sort((a, b) => comparePaymentOrder(a, b, cfg))
```

והוסף ל-`module.exports`: `comparePaymentOrder, interactionBasePrice`.

- [ ] **Step 4: הרץ ובדוק שהיא עוברת**

```bash
node scripts/verify-payment-order.cjs
```
צפוי: שתי שורות PASS, exit 0.

- [ ] **Step 5: יישר את הצרכנים לאותו סדר**

ב-`lib/activistStats.js` (`payableInteractionsLast30`) החלף את המיון הכרונולוגי ב-`comparePaymentOrder`.

ב-`pages/contact/add-interaction/[id].jsx`, `isPrevious` חותך `i.date <= form.date`. תחת סדר-ערך "קודם" = כל קשר שמוקצה לפניו. החלף את החיתוך הכרונולוגי בהשוואה מול הקשר החדש:

```js
const draft = { type: form.type, quality: form.quality, date: form.date, id: Number.MAX_SAFE_INTEGER };
const isPrevious = i =>
  i.activist_id === currentUser?.id &&
  PAID_PROJECT_IDS.includes(Number(i.project_id)) &&
  i.date?.slice(0, 7) === currentMonthKey &&
  comparePaymentOrder(i, draft, paymentConfig) < 0;
```

- [ ] **Step 6: build + commit**

```bash
npm run build
git add lib/paymentCalc.js lib/activistStats.js "pages/contact/add-interaction/[id].jsx" scripts/verify-payment-order.cjs
git commit -m "fix: מכסת המפגשים מוקצית לפי ערך ולא לפי תאריך"
```

---

## Task 2 — בונוס מצוות: אחד לכל אירוע-עליה, לא לכל רמה (דיווח #3)

**Files:**
- Modify: `lib/CrmStore.jsx:196-215` (`mitzvotBonuses`)
- Modify: `pages/contact/update-mitzvot/[id].jsx:31,57,66,83`
- Test: `scripts/verify-payment-order.cjs` (מוסיפים בדיקה)

**Interfaces:**
- Consumes: `contact.mitzvot_history` — מערך `{ mitzva, from, to, date }`.
- Produces: `mitzvotBonuses` — פריט אחד לכל שורת היסטוריה שבה `to > from` (במקום `to - from` פריטים).

**הרציונל:** מוטי גלעד: "התקדמות במצוות משלם על כל עליית רמה גם כשהייתה עליה של שתי רמות בבת אחת". בנתוני אמת: יואל שי (לקוח של מוטי) קיבל `{from:0,to:2,mitzva:'ציצית'}` ב-2.8 → 1,200 ₪, ואיתי גרשי קיבל 7 שורות בסך 18 רמות → 10,800 ₪ בשמירה אחת. מעכשיו: 600 ₪ לכל מצווה שעלתה, ללא תלות בגובה הקפיצה.

- [ ] **Step 1: הוסף בדיקה נכשלת ל-`scripts/verify-payment-order.cjs`**

לפני `process.exit`:

```js
// בונוס מצוות — קפיצה של 2 רמות = אירוע אחד, 600 ₪ (דיווח מוטי גלעד, 2026-08-02).
// mitzvotBonuses נגזר ב-lib/CrmStore.jsx; כאן בודקים את הצורה שהמנוע מקבל.
function deriveMitzvotBonuses(contact) {
  if (!contact.activist_id || !Array.isArray(contact.mitzvot_history)) return [];
  return contact.mitzvot_history
    .filter(h => h?.mitzva && Number(h.to ?? 0) > Number(h.from ?? 0))
    .map(h => ({ activist_id: contact.activist_id, contact_id: contact.id, contactName: contact.name }));
}
const jumper = { id: 9, name: 'קופץ', activist_id: 7, mitzvot_history: [{ mitzva: 'ציצית', from: 0, to: 2, date: '2026-07-05' }] };
check('קפיצת 2 רמות = בונוס אחד', deriveMitzvotBonuses(jumper).length, 1);
```

זו בדיקת-חוזה: היא מתעדת את הכלל ומגנה עליו. הנוסחה חייבת להיות זהה ל-`lib/CrmStore.jsx`.

- [ ] **Step 2: הרץ — הבדיקה עוברת מיידית (היא מתעדת את היעד)**

```bash
node scripts/verify-payment-order.cjs
```

- [ ] **Step 3: החלף את הגזירה ב-`lib/CrmStore.jsx`**

```js
  // בונוס-מצוות — נגזר מ-mitzvot_history הפרסיסטנטי (Supabase) של כל לקוח, לא מ-state זמני.
  // אותו דפוס בדיוק כמו newParticipantBonuses לעיל: מקור-אמת יחיד, נגזר-מחדש בכל טעינה.
  // בונוס אחד (₪600) לכל *אירוע עליה* במצווה — לא לכל רמה. קפיצה 0→2 בשמירה אחת היא
  // אירוע אחד ומזכה פעם אחת (דיווח מוטי גלעד, 2026-08-02): לפני כן שמירה שרשמה 7 מצוות
  // מרמה 0 שילמה 18 בונוסים (10,800 ₪) על תיעוד מצב קיים, לא על התקדמות אמיתית.
  const mitzvotBonuses = useMemo(() => contacts.flatMap(c => {
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
        amount:      MITZVOT_BONUS_PER_LEVEL,
        desc:        to - from > 1 ? `עליה ב${h.mitzva} מרמה ${from} ל-${to}` : `עליה ב${h.mitzva} מרמה ${from} ל-${to}`,
        date:        h.date,
        month:       `${d.getFullYear()}-${d.getMonth()}`,
      }];
    });
  }), [contacts]);
```

- [ ] **Step 4: יישר את המסך שמבטיח את הסכום**

`pages/contact/update-mitzvot/[id].jsx`:
- שורה 31: `const totalBonus = changes.length * MITZVOT_BONUS_PER_LEVEL;`
- שורה 57: `כל מצווה שעולה = בונוס {MITZVOT_BONUS_PER_LEVEL} ₪ (גם בקפיצה של כמה רמות)`
- שורה 66: `+{MITZVOT_BONUS_PER_LEVEL}₪` במקום `+{diff*MITZVOT_BONUS_PER_LEVEL}₪`
- שורה 83: `(+{MITZVOT_BONUS_PER_LEVEL}₪)` במקום `(+{c.diff*MITZVOT_BONUS_PER_LEVEL}₪)`

- [ ] **Step 5: build + commit**

```bash
npm run build
node scripts/verify-payment-order.cjs
git add lib/CrmStore.jsx "pages/contact/update-mitzvot/[id].jsx" scripts/verify-payment-order.cjs
git commit -m "fix: בונוס מצוות אחד לכל עליה, גם כשהיא של כמה רמות"
```

---

## Task 3 — מוני הקשרים: חודש קלנדרי, בלי שורות נגזרות (דיווחים #4, #8, #10, #11)

**Files:**
- Modify: `lib/activistStats.js`
- Modify: `pages/index.jsx:26-42,60-67`
- Modify: `pages/my-activities.jsx:52-95,163-185`
- Modify: `pages/landing.jsx:114-125`

**Interfaces:**
- Consumes: `isDerivedInteraction` מ-`lib/paymentCalc.js` (כבר מיוצא).
- Produces: `interactionsThisMonth(activistId, interactions)` ו-`payableInteractionsThisMonth(...)` ב-`lib/activistStats.js`, מחליפות את `*Last30`.

**הרציונל:** שני באגים באותו מקום. (א) `pages/index.jsx` מציג "קשרים החודש" אבל מחשב חלון מתגלגל של 30 יום — לכן ב-1 בחודש המספר לא מתאפס (דיווח מוטי גלעד). (ב) מאז e029f69 מפגש רב-משתתפים יוצר שורת-קשר נגזרת לכל משתתף, והמונים סופרים אותן — מפגש עם 2 לקוחות נראה כ-3 דיווחים (דיווחי מוטי שטרלינג ושירה שם טוב). התשלום כבר מחריג נגזרות; רק התצוגה לא.

- [ ] **Step 1: `lib/activistStats.js` — חודש קלנדרי + החרגת נגזרות**

```js
const { calcInteractionPayment, isDerivedInteraction, comparePaymentOrder } = require('./paymentCalc');

// שורה נגזרת ממפגש רב-משתתפים היא תיעוד עבור הלקוח הנוסף, לא דיווח נפרד של הפעיל.
// בלי ההחרגה, מפגש עם 2 לקוחות נראה כ-3 קשרים (דיווחי מוטי שטרלינג ושירה שם טוב, 28-30.7).
const isOwnReport = i => !isDerivedInteraction(i);

// תחילת החודש הקלנדרי — לא חלון מתגלגל. "קשרים החודש" חייב להתאפס ב-1 בחודש
// (דיווח מוטי גלעד, 2026-08-02).
function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function interactionsThisMonth(activistId, interactions) {
  const start = monthStart();
  return interactions.filter(i =>
    i.activist_id === activistId && isOwnReport(i) && i.date && new Date(i.date) >= start
  ).length;
}
```

`payableInteractionsThisMonth` — אותו גוף כמו `payableInteractionsLast30` הקיים, עם `monthStart()` במקום ה-cutoff, `isOwnReport` בפילטר, ו-`comparePaymentOrder` במיון.

השאר את `interactionsLast30` מיוצאת (בשימוש ב-`pages/activists.jsx` ו-`pages/activists/[id].jsx` שמציגים במפורש "30 יום"), אבל הוסף בה `isOwnReport`.

- [ ] **Step 2: `pages/index.jsx`**

```js
import { interactionsThisMonth, payableInteractionsThisMonth, getActivistPerformanceLabel } from '../lib/activistStats';
…
const myInteractionsCount = can.addContact
  ? interactionsThisMonth(currentUser.id, interactions)
  : interactions.filter(i => i.date?.slice(0, 7) === new Date().toISOString().slice(0, 7)).length;

const payableCount = can.addContact
  ? payableInteractionsThisMonth(currentUser.id, interactions, contacts, activeProject?.id)
  : null;
```

- [ ] **Step 3: `pages/my-activities.jsx`**

בבניית ה-feed, סמן שורה נגזרת ואל תספור אותה כדיווח:

```js
import { isDerivedInteraction } from '../lib/paymentCalc';
…
      .forEach(i => items.push({
        …
        derived: isDerivedInteraction(i),
      }));
…
const interactionCount = feed.filter(x => x.kind === 'interaction' && !x.derived).length;
```

ובכרטיס/שורה, אחרי ה-Pills הקיימים:

```jsx
{item.derived && <Pill text="משתתף במפגש" color="#8e44ad" bg="#f5eef8" />}
```

- [ ] **Step 4: `pages/landing.jsx`**

```js
import { isDerivedInteraction } from '../lib/paymentCalc';
…
// שורה נגזרת ממפגש רב-משתתפים אינה דיווח נפרד — לא נספרת במוני הקשרים.
const reportedInteractions = filteredInteractions.filter(i => !isDerivedInteraction(i));
```
והשתמש ב-`reportedInteractions` בשתי אריחי "סה"כ קשרים" ו"קשרים החודש".

- [ ] **Step 5: build + commit**

```bash
npm run build
git add lib/activistStats.js pages/index.jsx pages/my-activities.jsx pages/landing.jsx
git commit -m "fix: מוני הקשרים — חודש קלנדרי, ומפגש רב-משתתפים נספר פעם אחת"
```

---

## Task 4 — טופס דיווח קשר: מנעול שליחה + תאריך יעד הגיוני (דיווחים #1, #7)

**Files:**
- Modify: `pages/contact/add-interaction/[id].jsx`
- Modify: `pages/contact/update-mitzvot/[id].jsx:33-36`

**Interfaces:**
- Produces: state `saving` בשני הטפסים; הכפתור מקבל `disabled={saving}`.

**הרציונל:** (א) בנתוני אמת יש שתי שורות זהות ל"איתי רוזן" ב-14.8 ב-14:53, `id` 1786708407257 ו-1786708410146 — הפרש 2,889ms, כלומר לחיצה כפולה. `handleSubmit` הוא `async` עם כמה `await` ובלי שום מנעול, והכפתור נשאר לחיץ עד `setSuccess(true)`. (ב) שירה שם טוב: "תאריך יעד… נותן אופציה רק מתאריך יעד של היום… בדכ הקשר הוא שבועי" — `min={TODAY}` על שדה שמתייחס לתאריך הקשר, שיכול להיות מוקדם יותר.

- [ ] **Step 1: מנעול שליחה**

```js
  const [saving, setSaving] = useState(false); // מנעול שליחה — לחיצה כפולה יצרה דיווח כפול (14.8)
```

בראש `handleSubmit`:

```js
    if (saving) return;
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setSaving(true);
```

בכל `return` מוקדם שאחרי `setSaving(true)` (מסלול `CAP_EXCEED_BLOCKS`) — `setSaving(false)` לפני ה-return.

הכפתור:

```jsx
<button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit} disabled={saving}>
  {saving ? 'שומר…' : 'שמור קשר'}
</button>
```
וגם `<button className="btn" … disabled={saving}>נקה</button>`.

- [ ] **Step 2: תאריך יעד — טווח לפי תאריך הקשר**

ב-`EMPTY` השאר `next_action_date: ''`. בשדה:

```jsx
{/* min = תאריך הקשר ולא "היום": קשר שדווח באיחור צריך תאריך-יעד יחסי אליו,
    לא יחסית להיום (דיווח שירה שם טוב, 2026-07-30). */}
<input type="date" className={`form-input ${errors.next_action_date ? 'form-error' : ''}`}
  value={form.next_action_date} min={form.date}
  onChange={e => set('next_action_date', e.target.value)} />
```

והוסף ל-`handleTypeChange`/`set('date')` ברירת מחדל נוחה — בתוך `set`, כשמשנים `date` ו-`next_action_date` ריק, מלא אותו ב-7 ימים קדימה:

```js
  // ברירת מחדל לתאריך היעד: שבוע מתאריך הקשר — הקצב המקובל אצל הפעילים.
  function setDate(value) {
    setForm(prev => {
      const next = { ...prev, date: value };
      if (!prev.next_action_date && value) {
        const d = new Date(value); d.setDate(d.getDate() + 7);
        next.next_action_date = d.toISOString().slice(0, 10);
      }
      return next;
    });
    setErrors(prev => ({ ...prev, date: undefined }));
  }
```
וחבר `onChange={e => setDate(e.target.value)}` לשדה התאריך.

ב-`validate()` החלף את בדיקת התאריך:

```js
    if (form.next_action_date && form.next_action_date < form.date) e.next_action_date = 'תאריך היעד לא יכול להקדים את תאריך הקשר';
```

- [ ] **Step 3: אותו מנעול ב-update-mitzvot**

```js
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const { error } = await updateMitzvot(contactId, currentUser.id, mitzvot);
    if (error) { setSaving(false); return; }
    setSaved(true);
  }
```
והכפתור: `disabled={saving}` עם `{saving ? 'שומר…' : 'שמור עדכון'}`.

- [ ] **Step 4: build + commit**

```bash
npm run build
git add "pages/contact/add-interaction/[id].jsx" "pages/contact/update-mitzvot/[id].jsx"
git commit -m "fix: מנעול שליחה בטפסים + תאריך יעד יחסי לתאריך הקשר"
```

---

## Task 5 — מחיקת הוצאה מתעדכנת בסכום לתשלום (דיווח #6)

**Files:**
- Modify: `lib/CrmStore.jsx` (state `expenses` + `addExpense`/`deleteExpense`/`reloadExpenses`)
- Modify: `pages/expenses.jsx`

**Interfaces:**
- Produces: `addExpense({ date, amount, description })` → `{ error }`, `deleteExpense(id)` → `{ error }`, שניהם מעדכנים את `expenses` ב-store.
- Consumes: `expenses` הקיים ב-store, נצרך כבר ב-`pages/my-dashboard.jsx:100` ו-`pages/payments.jsx:82`.

**הרציונל:** שירה שם טוב: "כשמוחקים בדיווח הוצאות… הסכום לתשלום לא משתנה". `pages/expenses.jsx` מחזיק state מקומי משלו ומוחק ישירות מול Supabase; `CrmStore.expenses` — שממנו הדשבורד ועמוד התשלומים מחשבים — נטען פעם אחת בכניסה ולא מתעדכן. המחיקה כן נשמרת, אבל הסכום מתעדכן רק אחרי רענון מלא.

- [ ] **Step 1: הוסף פעולות ל-`lib/CrmStore.jsx`**

אחרי `deleteContact`:

```js
  // הוצאות — נכתבות דרך ה-store ולא ישירות מהדף, כדי שהסכום לתשלום ב-/my-dashboard
  // וב-/payments יתעדכן מיד. קודם לכן הדף החזיק state משלו והמחיקה לא הגיעה לחישוב
  // עד רענון מלא (דיווח שירה שם טוב, 2026-07-30).
  async function addExpense({ date, amount, description }) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('expenses').insert({
      activist_id: currentUser.id,
      project_id:  currentUser.project_id ?? null,
      date, amount, description,
    }).select().single();
    if (error) { console.error('Failed to insert expense', error); return { error }; }
    setExpenses(prev => [data, ...prev]);
    return { error: null };
  }

  async function deleteExpense(expenseId) {
    const supabase = getSupabaseClient();
    // select() אחרי delete — RLS שחוסמת מחזירה 0 שורות *בלי* error, ואז המחיקה
    // נראית מוצלחת ולא קרה כלום. בלי הבדיקה הזו הכישלון שקט.
    const { data, error } = await supabase.from('expenses').delete().eq('id', expenseId).select('id');
    if (error) { console.error('Failed to delete expense', error); return { error }; }
    if (!data || data.length === 0) return { error: new Error('ההוצאה לא נמחקה — אין הרשאה או שכבר נמחקה') };
    setExpenses(prev => prev.filter(x => Number(x.id) !== Number(expenseId)));
    return { error: null };
  }
```

הוסף `addExpense, deleteExpense` ל-value של ה-Provider.

- [ ] **Step 2: `pages/expenses.jsx` צורך מה-store**

הסר את ה-state המקומי ואת `load()`; קח `expenses, addExpense, deleteExpense` מ-`useCrm()` וסנן לתצוגה:

```js
  const { activists, expenses: allExpenses, addExpense, deleteExpense } = useCrm();
  // רשימת התצוגה — החודש הנוכחי; פעיל רואה רק את שלו (ה-store כבר מסונן ב-RLS,
  // כאן זו הגנת-הגנה נוספת בדיוק כמו בשאר הדפים).
  const expenses = useMemo(() => allExpenses
    .filter(x => x.date >= MONTH_START && (seesAll || Number(x.activist_id) === Number(currentUser?.id)))
    .sort((a, b) => (a.date < b.date ? 1 : -1)), [allExpenses, seesAll, currentUser?.id]);
```

`handleSubmit` קורא ל-`addExpense`, `handleDelete` קורא ל-`deleteExpense` ומציג שגיאה:

```js
  async function handleDelete(id) {
    const { error } = await deleteExpense(id);
    if (error) setLoadErr(error.message);
  }
```

- [ ] **Step 3: build + commit**

```bash
npm run build
git add lib/CrmStore.jsx pages/expenses.jsx
git commit -m "fix: מחיקת הוצאה מתעדכנת מיד בסכום לתשלום"
```

---

## Task 6 — התראות: עליית מצוות + Push לפעיל עצמו (דיווחים #2, #13)

**Files:**
- Create: `pages/api/mitzvot/notify.js`
- Modify: `lib/notifyApi.js`
- Modify: `pages/contact/update-mitzvot/[id].jsx`
- Modify: `pages/api/interactions/notify.js` (הוספת `kind: 'self_payment'`)
- Modify: `pages/contact/add-interaction/[id].jsx` (קריאה ל-kind החדש)

**Interfaces:**
- Produces: `notifyMitzvotApi({ contactId, mitzvot })` — `mitzvot` = מערך שמות מצוות שעלו. השרת קורא את `mitzvot_history` מה-DB ומרכיב את הטקסט בעצמו.
- Produces: `kind: 'self_payment'` ב-`/api/interactions/notify` — פעמון + Push לפעיל *עצמו*, עם `client_id` זהה לזה שהדפדפן כותב, כדי שלא תיווצר שורה כפולה.

**הרציונל:** (א) מוטי גלעד: "התקדמות במצוות שסומנו לא מופיע בהתראות" — `handleSave` ב-update-mitzvot לא יוצר שום התראה. (ב) מוטי גלעד: "אני לא מקבל התראות רק כשאני נכנס לאפליקציה אני רואה בפעמון" — יש לו מנוי web-push ו-2 טוקני FCM ב-DB, אז התשתית עובדת; אבל ההתראות שהוא רואה בפעמון נכתבות ע"י `createDemoNotification` בדפדפן, ו-CLAUDE.md מציין במפורש שהיא **לא יכולה** לשלוח Push. אין מסלול-שרת שמפוש לפעיל על הדיווח של עצמו.

- [ ] **Step 1: `pages/api/mitzvot/notify.js`**

```js
// pages/api/mitzvot/notify.js — התראה על עליית סרגל מצוות, בצד-שרת (admin → Push אמיתי).
// אבטחה בדפוס api/interactions/notify: הלקוח שולח contactId בלבד. השרת קורא את הלקוח
// מה-DB, מוודא בעלות, ומרכיב את ההודעה מ-mitzvot_history — כך פעיל לא יכול לשגר טקסט חופשי.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireAuth } from '../meeting-houses/_auth';
import { getProjectManagers, notifyRecipients } from '../../../lib/notifyRecipients';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.profile?.activist_code) return res.status(403).json({ error: 'No profile' });

  const { contactId } = req.body || {};
  if (!contactId) return res.status(400).json({ error: 'Missing contactId' });

  const supabase = getSupabaseAdmin();
  const { data: contact, error } = await supabase
    .from('contacts')
    .select('id, name, activist_id, project_id, mitzvot_history')
    .eq('id', contactId)
    .single();
  if (error || !contact) return res.status(404).json({ error: 'Contact not found' });

  const callerCode = Number(auth.profile.activist_code);
  if (Number(contact.activist_id) !== callerCode && auth.profile.role !== 'ceo') {
    return res.status(403).json({ error: 'לא ניתן לשלוח התראה על לקוח שאינו שלך' });
  }

  // רק העליות האחרונות — כל השורות שנרשמו בתאריך האחרון בהיסטוריה.
  const history = Array.isArray(contact.mitzvot_history) ? contact.mitzvot_history : [];
  const rises = history.filter(h => h?.mitzva && Number(h.to ?? 0) > Number(h.from ?? 0));
  if (rises.length === 0) return res.status(200).json({ notified: [], reason: 'no rise' });
  const lastDate = rises[rises.length - 1].date;
  const latest = rises.filter(h => h.date === lastDate);

  const projectId = Number(contact.project_id) || 1;
  const activistName = auth.profile.name || 'פעיל';
  const list = latest.map(h => `${h.mitzva} ${h.from}→${h.to}`).join(', ');
  const url = `/contact/${contact.id}`;
  const title = `📈 התקדמות בסרגל המצוות — ${contact.name}`;
  const body = `${activistName} עדכן: ${list}.`;
  // clientId דטרמיניסטי לפי לקוח+תאריך — שמירה חוזרת באותו יום לא מכפילה התראה.
  const stamp = `${contact.id}__${lastDate}`;

  const managers = await getProjectManagers(supabase, projectId, { excludeCode: callerCode });
  const notified = await notifyRecipients(supabase, managers, {
    title, body, url, type: 'mitzvot_progress', priority: 'normal',
    clientId: (code) => `mitzvot__${stamp}__${code}`,
  });

  // הפעיל עצמו — פעמון *ו-Push*. זה המסלול היחיד שיכול להגיע למכשיר שלו:
  // createDemoNotification בדפדפן כותב שורת פעמון בלבד (ראה CLAUDE.md, "התראות").
  const self = await notifyRecipients(supabase, [{ activist_code: callerCode, name: activistName }], {
    title: '✨ עליה בסרגל המצוות נרשמה',
    body: `${contact.name}: ${list}. הבונוס ייכנס לדוח התשלומים.`,
    url: '/my-dashboard', type: 'mitzvot_progress', priority: 'high',
    clientId: () => `mitzvot_self__${stamp}`,
  });

  return res.status(200).json({ notified: [...notified, ...self] });
}
```

- [ ] **Step 2: עטיפה ב-`lib/notifyApi.js`**

```js
// עליית סרגל מצוות → ניהול הפרויקט + הפעיל עצמו (Push אמיתי, לא רק פעמון).
export function notifyMitzvotApi(contactId) {
  return post('/api/mitzvot/notify', { contactId });
}
```

- [ ] **Step 3: קריאה מ-`pages/contact/update-mitzvot/[id].jsx`**

```js
import { notifyMitzvotApi } from '../../../lib/notifyApi';
…
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const { error } = await updateMitzvot(contactId, currentUser.id, mitzvot);
    if (error) { setSaving(false); return; }
    // await לפני ההתראה — השרת קורא את mitzvot_history מה-DB; לפני שהעדכון נחת
    // הוא היה מרכיב הודעה על המצב הישן. fire-and-forget מכאן והלאה.
    if (changes.length > 0) notifyMitzvotApi(contactId);
    setSaved(true);
  }
```

- [ ] **Step 4: `kind: 'self_payment'` ב-`pages/api/interactions/notify.js`**

עדכן `const KINDS = ['summary', 'payment', 'self_payment'];` והוסף ענף:

```js
  } else if (kind === 'self_payment') {
    // הפעיל עצמו. הדפדפן כבר כתב שורת פעמון (createPaymentInteractionNotifications)
    // עם אותו client_id — ה-upsert מאחד אותן, וכאן מתווסף ה-Push שהדפדפן לא יכול לשלוח
    // (דיווח מוטי גלעד, 2026-07-23: "רק כשאני נכנס לאפליקציה אני רואה בפעמון").
    const numeric = Number(amount);
    const amountText = Number.isFinite(numeric) && numeric > 0 ? `${numeric.toLocaleString()} ₪` : null;
    recipients = [{ activist_code: callerCode, name: activistName }];
    title = amountText ? 'הדיווח נכנס לדוח התשלומים' : 'הדיווח נשמר';
    body = `הקשר עם ${contactName} נשמר${amountText ? ` ונכנס לדוח התשלומים בסך ${amountText}` : ''}.`;
    type = amountText ? 'paid_interaction' : 'interaction_saved';
    priority = amountText ? 'high' : 'normal';
    clientId = () => `paid-interaction-activist-${interaction.id}-${callerCode}`;
  } else {
```

`clientId` חייב להיות זהה בדיוק ל-`notificationId(['paid-interaction-activist', interaction.id, activist.id])` ב-`lib/notificationDemo.js` — אחרת תיווצר שורת פעמון כפולה. אמת את `notificationId` לפני הכתיבה.

- [ ] **Step 5: קריאה מ-`pages/contact/add-interaction/[id].jsx`**

אחרי `createPaymentInteractionNotifications(...)`:

```js
      // Push לפעיל עצמו — רק השרת יכול (VAPID/FCM לא קיימים בדפדפן).
      if (!saveError) {
        notifyInteractionApi({
          interactionId: interactionPayload.id,
          kind: 'self_payment',
          amount: payableCheck.payable ? payableCheck.amount : null,
        });
      }
```

- [ ] **Step 6: build + commit**

```bash
npm run build
git add pages/api/mitzvot/notify.js lib/notifyApi.js "pages/contact/update-mitzvot/[id].jsx" pages/api/interactions/notify.js "pages/contact/add-interaction/[id].jsx"
git commit -m "feat: התראת עליה בסרגל מצוות + Push לפעיל על הדיווח של עצמו"
```

---

## Task 7 — בורר לקוח מחפש במפגש רב-משתתפים (דיווח #9)

**Files:**
- Create: `components/ClientSearchSelect.jsx`
- Modify: `pages/contact/add-interaction/[id].jsx`

**Interfaces:**
- Produces: `<ClientSearchSelect options={[{id,name,city}]} value={string} onChange={(idString) => void} placeholder="…" />`

**הרציונל:** מוטי גלעד: "ברישום מפגש רב משתתפים צריך לבחור לקוח מרשימה ולא כל הלקוחות מופיעים". רשימת הבחירה היא `<select>` ילידי עם עד 25 לקוחות — במובייל היא נפתחת כגלגלת שקשה לסרוק, ובלי חיפוש קל להחמיץ שם. בנוסף, משתתף שאינו לקוח של הפעיל לא יכול להופיע שם כלל (RLS), והשדה החופשי "משתתפים נוספים" לא מספיק בולט. שני התיקונים: בורר עם חיפוש, וכיתוב שמפנה במפורש לשדה החופשי.

- [ ] **Step 1: הקומפוננטה**

`components/ClientSearchSelect.jsx` — input חיפוש + רשימה נפתחת, בדפוס `components/ActivistSearchSelect.jsx` הקיים (קרא אותו קודם והתאם את הסגנון והנגישות).

- [ ] **Step 2: החלפה בטופס + כיתוב מפנה**

```jsx
<label className="form-label">
  משתתפים מהלקוחות שלך <span style={{ color: '#999', fontWeight: 400 }}>(לא חובה)</span>
</label>
{/* רק לקוחות *שלך* מופיעים כאן — כך RLS מגדירה. מי שאינו לקוח שלך נרשם בשדה
    "משתתפים נוספים" למטה (דיווח מוטי גלעד, 2026-07-29). */}
<div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
  משתתף שאינו מופיע ברשימה — רשום אותו בשדה "משתתפים נוספים" למטה.
</div>
```

- [ ] **Step 3: build + commit**

```bash
npm run build
git add components/ClientSearchSelect.jsx "pages/contact/add-interaction/[id].jsx"
git commit -m "fix: בחירת משתתפים עם חיפוש, והפניה מפורשת לשדה החופשי"
```

---

## Task 8 — אימות שלושת הדיווחים שכבר תוקנו (דיווחים #12, #14, #15)

**Files:**
- Modify: `scripts/verify-payment-order.cjs`

**הרציונל:** commit 236319c טיפל בשלושתם. הדיווחים עדיין `open` בטבלה. יש לאמת שהתיקון עומד גם אחרי שינויי Task 1, ולא רק להסתמך על הודעת ה-commit.

- [ ] **Step 1: הוסף שלוש בדיקות**

```js
// #14 — מפגש רב-משתתפים לא נספר במכסת הפרונטליים (דיווח אלעזר באום, 22.7).
const capCfg = { ...DEFAULTS, MONTHLY_CAPS: { phone: 25, frontal: 1, multi: 6 } };
const multiThenFrontal = [
  { activist_id: 7, project_id: 1, id: 1, contact_id: 1, type: 'פרונטלי', quality: 'רב משתתפים', duration_minutes: 60, date: '2026-07-02' },
  { activist_id: 7, project_id: 1, id: 2, contact_id: 2, type: 'פרונטלי', quality: 'תורני',      duration_minutes: 60, date: '2026-07-03' },
];
check('רב-משתתפים לא אוכל ממכסת הפרונטליים',
  calcMonthlyPayment(7, multiThenFrontal, contacts, [], [], capCfg, new Set(), { year: 2026, month: 6 }).total, 600);

// #12 — תקרת שיחות מול אותו לקוח = 10, לא 4 (החלטת נדב 26.7).
check('תקרת שיחות ללקוח רגיל', DEFAULTS.PER_CONTACT_CAPS.regular.phone, 10);

// #15 — 6 מפגשים פרונטליים מול אותו לקוח מזכים; השביעי לא.
const sameContact = Array.from({ length: 7 }, (_, k) => ({
  activist_id: 7, project_id: 1, id: 10 + k, contact_id: 1, type: 'פרונטלי', quality: 'תורני',
  duration_minutes: 60, date: `2026-07-${String(k + 1).padStart(2, '0')}`,
}));
const same = calcMonthlyPayment(7, sameContact, contacts, [], [], DEFAULTS, new Set(), { year: 2026, month: 6 });
check('6 מפגשים מזכים מול אותו לקוח, השביעי לא', [same.total, same.unpaid.length], [1800, 1]);
```

- [ ] **Step 2: הרץ + commit**

```bash
node scripts/verify-payment-order.cjs
git add scripts/verify-payment-order.cjs
git commit -m "test: אימות שלושת התיקונים מ-236319c מול המנוע הנוכחי"
```

---

## Task 9 — הרצת המנוע על נתוני אמת והשוואת לפני/אחרי

**Files:**
- Create: `scripts/compare-payment-impact.cjs`

**הרציונל:** Task 1 ו-Task 2 משנים סכומי כסף בפועל. לפני שנדב מאשר, הוא צריך לראות כמה זז ולמי — לא רק ש"הבדיקות עוברות".

- [ ] **Step 1: סקריפט השוואה**

מריץ `calcMonthlyPayment` על נתוני Supabase האמיתיים לחודש נתון, פעם עם `mitzvotBonuses` בגזירה הישנה (פר-רמה) ופעם בחדשה (פר-אירוע), ומדפיס טבלת פעיל / סכום-ישן / סכום-חדש / הפרש.

- [ ] **Step 2: הרץ על יולי ואוגוסט 2026 ושמור את הפלט לדוח הסיום**

```bash
node scripts/compare-payment-impact.cjs 2026 7
node scripts/compare-payment-impact.cjs 2026 8
```

- [ ] **Step 3: commit**

```bash
git add scripts/compare-payment-impact.cjs
git commit -m "test: השוואת השפעת שינויי המנוע על נתוני אמת"
```

---

## Task 10 — סימון הדיווחים כ"נסקר" + עדכון תיעוד

**Files:**
- Modify: `CLAUDE.md` (סעיף מנוע התשלום — סדר ההקצאה ובונוס המצוות)
- Create: `scripts/mark-feedback-reviewed.cjs`

- [ ] **Step 1: תיעוד ב-CLAUDE.md**

הוסף תחת "לוגיקה עסקית חשובה" סעיף "מנוע התשלום" עם שני הכללים החדשים: הקצאת מכסה לפי ערך, ובונוס-מצוות אחד לאירוע.

- [ ] **Step 2: סקריפט סימון**

`scripts/mark-feedback-reviewed.cjs` — מקבל רשימת `id`ים ו-`reviewer_note`, מעדכן `status='reviewed'`, `reviewed_at=now()`. **לא מריצים אותו אוטומטית** — נדב מחליט מתי הדיווחים נסגרים, אחרי שהוא ראה את הפריוויו.

- [ ] **Step 3: commit + push לענף (לא ל-main)**

```bash
npm run build
git add CLAUDE.md scripts/mark-feedback-reviewed.cjs docs/superpowers/plans/2026-08-23-feedback-round.md
git commit -m "docs: כללי מנוע התשלום המעודכנים + סקריפט סגירת דיווחים"
git push -u origin fix/feedback-2026-08
```

---

---

## מה התברר תוך כדי — תיקון להערכה המקורית

**דיווחים #8/#10/#11 אינם בעיית תצוגה.** התוכנית שיערה שהם נובעים מהשורות הנגזרות של מפגש
רב-משתתפים. סריקה על נתוני אמת (`scripts/find-duplicate-interactions.cjs`) הראתה משהו אחר:

| מתי | פעיל | מה נמצא |
|---|---|---|
| 30.6 22:09 | מוטי גלעד | 2 שורות זהות, הפרש 20.5 שניות |
| 6.7 09:51 | רונן ישראלי | 4 שורות זהות, הפרש 2.7 שניות |
| 24.7 00:42 | שירה שם טוב | 3 שורות זהות, הפרש 5 שניות ← דיווח #8 |
| 26.7 13:18 | מוטי שטרלינג | 3 שורות **מקוריות** של אותו מפגש רב-משתתפים, הפרש 9.6 שניות ← דיווח #10 |
| 14.8 14:53 | מוטי גלעד | 2 שורות זהות, הפרש 2.9 שניות ← דיווח #1 |
| 14.8 16:25 | דוד רוזנצוויג | 2 שורות זהות, הפרש 0.3 שניות |

סה"כ **6 קבוצות, 10 שורות עודפות, 5 פעילים** — כולן לחיצות חוזרות על כפתור שלא הגיב.
המקרה של 26.7 עלה כסף ממש: שלוש שורות מקוריות של מפגש רב-משתתפים = 900 ₪ במקום 300.

לכן Task 4 הורחב: מעבר למנעול ה-`saving`, נוסף **אישור-שכפול** — דיווח שנראה זהה לקיים
(אותו לקוח+תאריך+סוג+איכות+תיאור) דורש לחיצה שנייה מודעת. המנעול מכסה לחיצה כפולה באותו
מסך; האישור מכסה גם דיווח חוזר מטופס חדש אחרי שהאפליקציה נתקעה, וזה בדיוק מה שמוטי תיאר.

התיקון של Task 3 (החרגת שורות נגזרות מהמונים) נשאר נכון ונחוץ בפני עצמו — הוא פשוט לא
הסיבה לדיווחים האלה.

---

## סקירה אדוורסרית על ה-diff — 14 ליקויים שתוקנו

אחרי סיום המשימות, סוכן נפרד קיבל את ה-diff המלא מול `main` עם הנחיה לנסות לשבור אותו.
שלושה סבבים, 14 ליקויים.
כל הממצאים היו אמיתיים; אחד מהם היה **רגרסיה שאני הכנסתי**.

| # | קובץ | הליקוי | התיקון |
|---|---|---|---|
| 1 | `paymentCalc.js`, `activistStats.js` | **רגרסיה בכסף.** קשר שנדחה על תקרת-הלקוח המשיך לתפוס משבצת בתקרה החודשית. בשילוב עם ההקצאה לפי ערך זה שילם *פחות* מהסדר הכרונולוגי: 10 תורניים מול לקוח א' + 10 ידידותיים מול ב' → 3,900 במקום 4,150 | תקרה סופרת מפגשים ש**שולמו**. `accumulated.push` רק כש-`result.payable` |
| 2 | `paymentCalc.js` | `comparePaymentOrder` לא היה סדר מלא: תאריך חסר → NaN, ו-`new Date(null)` הוא 1970 ולא Invalid Date, כלומר שורה בלי תאריך קפצה לראש התור | `orderTime()`: falsy/לא-תקין → Infinity, השוואה במקום חיסור. + בדיקות טרנזיטיביות ואנטי-סימטריה |
| 3 | `add-interaction/[id].jsx` | `handleSubmit` בלי `try/finally` — throw כלשהו השאיר `saving=true` לנצח, הטופס מת, והפעיל מרענן ומדווח שוב | `try/catch/finally`. כשל *אחרי* שמירה מציג הצלחה ולא "נסה שוב" |
| 4 | `add-interaction/[id].jsx` | `dupConfirm` בוליאני נשאר דלוק וכיבה את ההגנה לשארית הסשן | `dupConfirmedId` — ה-id של הדיווח שאושר |
| 5 | `api/mitzvot/notify.js` | **הזרקת טקסט.** `mitzvot_history` הוא JSONB שהפעיל כותב אליו, ו-`h.mitzva` נכנס ישירות לגוף ה-Push לכל צוות הניהול | רשימה לבנה מול `data/config.js`, אימות רמות, חלון יומיים, חסם אורך לשם הלקוח |
| 6 | `api/interactions/notify.js` | `self_payment` דרס את שורת הפעמון של הדפדפן, שמפרטת גם את *סיבת* אי-הזכאות | לא נשלח על דיווח שלא זיכה; מוגבל לבעל הקשר |
| 7 | `add-interaction/[id].jsx` | כשל ברישום משתתפי מפגש רב-משתתפים היה שקט לגמרי | toast אזהרה |

**הלקח שנכנס ל-CLAUDE.md:** "מה-DB" ≠ "מאומת". שדה שהמשתמש עצמו כותב הוא עדיין קלט שלו,
וקריאה שלו מהשרת לא הופכת אותו לבטוח.

### סבב שני — ארבעה ליקויים שהתיקונים עצמם יצרו

| # | קובץ | הליקוי | התיקון |
|---|---|---|---|
| 8 | `paymentCalc.js` | מוני הדשבורד סתרו את המנוע אחרי שהתקרה עברה לספור מפגשים ששולמו: "18/15 חריגה" בזמן שהמנוע עוד משלם על ה-19 | המונים נגזרים מה-`breakdown` של המנוע, לצד `reported` שמסביר את הפער |
| 9 | `add-interaction/[id].jsx` | התצוגה המקדימה עדיין ספרה *כל* דיווח, גם שנדחה — הזהירה "לא יזוכה" על קשר שהמנוע משלם עליו, ועם `CAP_EXCEED_BLOCKS` חסמה אותו | `paidBefore()` מריץ את לולאת ההקצאה של המנוע עצמו |
| 10 | `api/mitzvot/notify.js` | חלון הזמן חסם רק את הצד הישן. תאריך עתידי עבר, הפך ל-`lastDate`, וכל POST ייצר `client_id` חדש → Push ללא הגבלה | החלון נבדק לכל שורה, משני הצדדים |
| 11 | `add-interaction/[id].jsx` | רק האזהרה הראשונה הוצגה — אזהרת המשתתפים נבלעה מאחורי אזהרת התקרה | כל האזהרות מוצגות, בונוס ראשון |

### סבב שלישי — שלושה ליקויים

| # | קובץ | הליקוי | התיקון |
|---|---|---|---|
| 12 | `add-interaction/[id].jsx` | **מסך ההצלחה דיווח חריגה על מפגש ששולם.** `addInteraction` מכניס את השורה ל-store אופטימית, הקומפוננטה מתרנדרת, והקשר שהרגע נשמר נספר כ"קשר קודם" מול עצמו. תקלה שהייתה בכל הגרסאות הקודמות של `isPrevious` | התוצאה ננעלת ב-state *לפני* השמירה |
| 13 | `my-dashboard.jsx` | הסבר המונה נקב בסיבה הלא נכונה — "תקרה מול אותו לקוח" גם כשהתקרה החודשית בלמה | מפנה לרשימת "קשרים שלא זוכו" שמפרטת לכל קשר. תג "חריגה" חזר להיות משמעותי (`reported > cap`) |
| 14 | `api/mitzvot/notify.js` | מכשיר ששעונו מקדים וחוצה חצות UTC לפני השרת איבד את ההתראה בשקט בכל שמירה | החלון נפתח ליום קדימה — עדיין 4 תאריכים אפשריים, ההגברה סגורה |

---

## מה נשאר פתוח ודורש את נדב

1. **מיגרציה 0017 (`feedback_issue_url`) לא רצה.** אומת מול ה-DB — `select *` על `feedback_reports` לא מחזיר `issue_url`. לכן ה-cron `api/cron/feedback-to-issues` נכשל כל לילה ולא נפתחו issues. צריך להריץ ב-SQL Editor.
2. **החלטת מדיניות — בונוס מצוות.** הקוד עובר ל-600 ₪ לאירוע-עליה במקום 600 ₪ לרמה, לפי דיווח מוטי גלעד. זו הקטנת תשלום בפועל (ראה פלט Task 9). דורש אישור.
3. **החלטת מדיניות — סדר המכסה.** תשלומי יולי 2026 כבר הופקו לפי הסדר הכרונולוגי. הסדר החדש משנה רטרואקטיבית את החישוב לחודשים סגורים. דורש החלטה: להחיל מאוגוסט ואילך, או לתקן רטרואקטיבית.
4. **10 השורות הכפולות הקיימות.** `scripts/find-duplicate-interactions.cjs` מדפיס אותן; `--delete` מוחק. המחיקה משנה סכומי שכר ולכן לא הורצה.

## השפעת השינויים על נתוני אמת (`scripts/compare-payment-impact.cjs`)

| חודש | פעיל | לפני | אחרי | הפרש | מקור |
|---|---|---|---|---|---|
| יולי 2026 | אלעזר באום | 10,450 | 10,550 | **+100** | סדר המכסה — בדיוק שני המפגשים התורניים שתיאר בדיווח |
| יולי 2026 | *סה"כ* | 73,350 | 73,450 | +100 | |
| אוגוסט 2026 | רפאל רייטן | 10,900 | 4,900 | **−6,000** | 4 מצוות מרמה 0 לרמה 4 בשמירה אחת (אופק כהן) |
| אוגוסט 2026 | מוטי גלעד | 4,350 | 3,750 | **−600** | קפיצת ציצית 0→2 שהוא עצמו דיווח עליה |
| אוגוסט 2026 | *סה"כ* | 60,700 | 54,100 | −6,600 | |

שכר פעילות ובונוסים בלבד — בלי החזר הוצאות ובלי שכר הדרכת סיורים.
