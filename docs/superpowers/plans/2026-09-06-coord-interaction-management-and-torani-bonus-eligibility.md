# הרשאת רכז/ראש-פרויקט לניהול קשרים + זכאות בונוס תורני — תוכנית מימוש

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** לממש 2 שינויי פרוטוקול: (1) רכז + ראש-פרויקט יכולים לערוך/למחוק קשר של פעיל אחר, עם התראה לפעיל בעל הקשר; (2) בונוס תורני (1,000 ₪) חל רק על לקוחות עם `joined_at >= 2026-09-01`. לפי `docs/superpowers/specs/2026-09-06-coord-interaction-management-and-torani-bonus-eligibility-design.md`.

**Architecture:** חלק א' (הרשאות) — endpoint מיוחס חדש (`pages/api/interactions/manage.js`) שמשתמש ב-`requireWriteRole` הקיים (coord/head/ceo) + admin client, **בלי לגעת ב-RLS**. `lib/CrmStore.jsx` מנתב אליו רק את coord/head; activist/ceo ממשיכים במסלול הישיר הקיים. חלק ב' (בונוס) — פילטר יחיד בתוך `deriveToraniBonuses`, פונקציית-מקור-האמת הקיימת.

**Tech Stack:** Next.js Pages Router, CommonJS ב-`lib/`, בדיקות עם `node scripts/verify-*.cjs` (בלי framework, בלי DB) לחלק ב'; בדיקה ידנית מול dev server לחלק א' (אין framework לבדיקת API routes בפרויקט הזה).

## Global Constraints

- `bonus_key` format לא משתנה.
- RLS על `interactions` (`migrations/0013_activist_isolation_rls.sql`) **נשאר בדיוק כמו היום** — לא נכתבת מיגרציה חדשה בתוכנית הזו.
- כל שינוי במנוע התשלום: `node scripts/verify-payment-order.cjs` נקי, 0 כשלים, כולל כל הבדיקות הקיימות (~50+).
- אחרי כל שינוי: `npm run build` נקי.
- מנכ"ל (`ceo`) לא משתנה בשום דבר — ממשיך במסלול הישיר הקיים, בלי התראה חדשה (לא התבקש).

---

## File Structure

- **Modify** `lib/paymentCalc.js` — קבוע `TORANI_BONUS_ELIGIBLE_FROM`, פילטר ב-`deriveToraniBonuses`, `module.exports`.
- **Modify** `scripts/verify-payment-order.cjs` — עדכון תאריכים בבדיקות הקיימות + 4 בדיקות חדשות לגבול-הזכאות.
- **Modify** `pages/api/meeting-houses/_auth.js` — `requireWriteRole` מחזיר גם `project_ids`.
- **Create** `pages/api/interactions/manage.js` — endpoint update/delete מיוחס + התראה.
- **Modify** `lib/CrmStore.jsx` — `updateInteraction`/`deleteInteraction` מנתבים coord/head ל-endpoint החדש.
- **Modify** `pages/contact/[id].jsx` — תנאי-תצוגה מדויק לכפתורי עריכה/מחיקת-קשר (במקום `isOwner` הרחב מדי).

---

### Task 1: זכאות בונוס תורני — `TORANI_BONUS_ELIGIBLE_FROM`

**Files:**
- Modify: `lib/paymentCalc.js:61-62` (קבועים), `lib/paymentCalc.js:267-280` (`deriveToraniBonuses`), `lib/paymentCalc.js:770` (`module.exports`)
- Modify: `scripts/verify-payment-order.cjs:556-633` (עדכון בדיקות קיימות שישברו), הוספת בדיקות חדשות

**Interfaces:**
- Produces: קבוע מיוצא חדש `TORANI_BONUS_ELIGIBLE_FROM = '2026-09-01'`. `deriveToraniBonuses` מקבלת `cfg` (פרמטר חמישי, כבר קיים) ותומכת ב-override דרך `cfg.TORANI_BONUS_ELIGIBLE_FROM`.

⚠️ **קריטי — הבדיקות הקיימות ל-`deriveToraniBonuses` (שורות 556-633) ישברו** ברגע שמוסיפים את הפילטר, כי `contactsTB` שם הן `[{ id: 1, name: '...' }, { id: 2, name: '...' }]` — **בלי `joined_at`**, וללא `joined_at` הלקוח לא זכאי בכלל תחת הכלל החדש. הפתרון: להזיז את כל התאריכים בבלוק הזה **קדימה ב-6 חודשים בדיוק** (משמר את כל יחסי-הרצף/פערים המקוריים) ולהוסיף `joined_at: '2026-09-01'` לשני הלקוחות. טבלת ההזזה המדויקת (לשימוש ב-Step 1):

| חודש מקורי | חודש אחרי הזזה | חודש מקורי | חודש אחרי הזזה |
|---|---|---|---|
| 2026-03 | 2026-09 | 2026-07 | 2027-01 |
| 2026-06 | 2026-12 | 2026-08 | 2027-02 |
|  |  | 2026-09 | 2027-03 |
|  |  | 2026-10 | 2027-04 |

כל אזכור `'2026-7'` (חודש-יעד לבונוס, 0-indexed=אוגוסט) הופך ל-`'2027-1'` (0-indexed=פברואר 2027) — כי "החודש השלישי ברצף" זז באותם 6 חודשים בדיוק.

- [ ] **Step 1: עדכן את הבדיקות הקיימות ב-`scripts/verify-payment-order.cjs` (שורות 556-633) כדי שישרדו את התיקון**

מצא את הבלוק שמתחיל ב-`// בונוס תורני — 3 חודשים רצופים, פעם אחת בלבד ללקוח (2026-08-31).` (שורה 556) ומסתיים ב-`}` (שורה 633). **החלף את כל הבלוק** בגרסה הבאה (זהה בדיוק ללוגיקה המקורית, רק עם תאריכי-חודש מוזזים ב-6 ו-`joined_at` נוסף):

```js
// ────────────────────────────────────────────────────────────────────────────
// בונוס תורני — 3 חודשים רצופים, פעם אחת בלבד ללקוח (2026-08-31).
// תאריכים מוזזים ב-6 חודשים לעומת הגרסה המקורית (דצמבר 2026 – אפריל 2027 במקום
// יוני–אוקטובר 2026) כדי שיעברו את שער-הזכאות שנוסף ב-2026-09-06 (joined_at >= 1.9.2026,
// ראה הבלוק הבא) — יחסי הרצף/הפער/ה"חודש השלישי" נשארים זהים למקור, רק זזים באותו הפרש קבוע.
// ────────────────────────────────────────────────────────────────────────────
{
  const { deriveToraniBonuses } = require('../lib/paymentCalc.js');
  // duration_minutes: 60 — חייב לעמוד ב-MIN_DURATION (ביקורת קוד, 2026-09-01: קשר תורני
  // קצר מדי לא נספר לחודש המזכה, ראה deriveToraniBonuses). בלי זה כל הבדיקות בבלוק הזה
  // היו נכשלות אחרי התיקון (duration_minutes היה undefined → 0 → מתחת לסף בכל מקרה).
  const mkT = (activistId, contactId, date, id) => ({ activist_id: activistId, project_id: 1, contact_id: contactId, quality: 'תורני', type: 'פרונטלי', duration_minutes: 60, date, id });
  const contactsTB = [{ id: 1, name: 'לקוח א', joined_at: '2026-09-01' }, { id: 2, name: 'לקוח ב', joined_at: '2026-09-01' }];

  // 3 חודשים רצופים (דצמבר,ינואר,פברואר) → בונוס מיוחס לפברואר 2027.
  const threeConsecutive = [mkT(7, 1, '2026-12-05', 1), mkT(7, 1, '2027-01-05', 2), mkT(7, 1, '2027-02-05', 3)];
  const bonuses1 = deriveToraniBonuses(threeConsecutive, contactsTB);
  check('3 חודשים רצופים = בונוס אחד, מיוחס לחודש השלישי', bonuses1.length, 1);
  check('הבונוס מיוחס לפברואר 2027 (חודש 1, 0-indexed)', bonuses1[0]?.month, '2027-1');
  check('סכום הבונוס = 1000', bonuses1[0]?.amount, 1000);

  // 2 חודשים + פער + 1 נוסף — אף פעם לא 3 ברצף → אין בונוס.
  const withGap = [mkT(7, 2, '2026-12-05', 4), mkT(7, 2, '2027-01-05', 5), mkT(7, 2, '2027-03-05', 6)];
  check('2 חודשים רצופים ואז פער = אין בונוס', deriveToraniBonuses(withGap, contactsTB).length, 0);

  // פער ואז 3 רצופים בהמשך — הבונוס מיוחס לרצף השני, לא כולל את החודש המבודד.
  const gapThenRun = [mkT(7, 1, '2026-09-05', 7), mkT(7, 1, '2026-12-05', 8), mkT(7, 1, '2027-01-05', 9), mkT(7, 1, '2027-02-05', 10)];
  const bonuses2 = deriveToraniBonuses(gapThenRun, contactsTB);
  check('פער ואז 3 רצופים = בונוס אחד, מיוחס לרצף האמיתי (פברואר 2027)', bonuses2.length === 1 && bonuses2[0].month === '2027-1', true);

  // 5 חודשים רצופים ברציפות (דצמבר–אפריל) — עדיין בונוס *אחד* בלבד, לא נוסף בחודש 4/5.
  const fiveConsecutive = ['2026-12-05', '2027-01-05', '2027-02-05', '2027-03-05', '2027-04-05'].map((date, k) => mkT(7, 1, date, 20 + k));
  check('5 חודשים רצופים = בונוס אחד בלבד (לא 3)', deriveToraniBonuses(fiveConsecutive, contactsTB).length, 1);

  // התחיל ידידותי, עבר לתורני — הספירה מתחילה מהתורני הראשון, לא מהידידותי.
  // (תאריכי ה"ידידותי" לא זזים — quality !=='תורני' מסונן לפני שער-הזכאות בכל מקרה.)
  const friendlyThenTorani = [
    { activist_id: 7, project_id: 1, contact_id: 1, quality: 'ידידותי', type: 'פרונטלי', date: '2026-01-05', id: 30 },
    { activist_id: 7, project_id: 1, contact_id: 1, quality: 'ידידותי', type: 'פרונטלי', date: '2026-02-05', id: 31 },
    mkT(7, 1, '2026-12-05', 32), mkT(7, 1, '2027-01-05', 33), mkT(7, 1, '2027-02-05', 34),
  ];
  const bonuses3 = deriveToraniBonuses(friendlyThenTorani, contactsTB);
  check('ידידותי לפני תורני לא משפיע — עדיין 3 חודשים מהתורני (פברואר 2027)', bonuses3.length === 1 && bonuses3[0].month === '2027-1', true);

  // שני לקוחות שונים — כל אחד נספר בנפרד.
  const twoClients = [...threeConsecutive, mkT(7, 2, '2026-12-05', 40), mkT(7, 2, '2027-01-05', 41), mkT(7, 2, '2027-02-05', 42)];
  check('2 לקוחות, כל אחד השלים רצף בנפרד = 2 בונוסים', deriveToraniBonuses(twoClients, contactsTB).length, 2);

  // שני פעילים שונים עם אותו לקוח — כל רצף נספר בנפרד לפי (activist_id, contact_id).
  const twoActivists = [
    mkT(7, 1, '2026-12-05', 50), mkT(7, 1, '2027-01-05', 51), mkT(7, 1, '2027-02-05', 52),
    mkT(9, 1, '2026-12-05', 53), mkT(9, 1, '2027-01-05', 54), mkT(9, 1, '2027-02-05', 55),
  ];
  const bonuses4 = deriveToraniBonuses(twoActivists, contactsTB);
  check('שני פעילים שונים עם אותו לקוח = 2 בונוסים (נספרים בנפרד)', bonuses4.length, 2);
  check('כל בונוס מיוחס לפעיל הנכון', bonuses4.map(b => b.activist_id).sort((a, b) => a - b), [7, 9]);

  // ביקורת קוד (2026-09-01) — קשר תורני קצר מ-MIN_DURATION (15 דקות) לא נספר לחודש המזכה.
  const shortMiddleMonth = [
    mkT(7, 1, '2026-12-05', 90),
    { ...mkT(7, 1, '2027-01-05', 91), duration_minutes: 5 }, // קצר מ-15 דקות — לא נספר
    mkT(7, 1, '2027-02-05', 92),
  ];
  check('קשר תורני קצר מ-15 דקות לא נספר לחודש המזכה — הרצף נשבר, אין בונוס',
    deriveToraniBonuses(shortMiddleMonth, contactsTB).length, 0);

  // אותו רצף, אבל ינואר מכיל *גם* מגע ארוך מספיק — אמור לחזור להיספר (עדיין 3 רצופים).
  const shortPlusRealSameMonth = [
    mkT(7, 1, '2026-12-05', 93),
    { ...mkT(7, 1, '2027-01-03', 94), duration_minutes: 5 },  // קצר מדי — לא נספר בפני עצמו
    mkT(7, 1, '2027-01-20', 95),                              // אבל מגע נוסף באותו חודש כן מזכה
    mkT(7, 1, '2027-02-05', 96),
  ];
  const bonuses5 = deriveToraniBonuses(shortPlusRealSameMonth, contactsTB);
  check('חודש עם גם מגע קצר וגם מגע תקין — עדיין נספר (מספיק מגע אחד תקין באותו חודש)',
    bonuses5.length === 1 && bonuses5[0].month === '2027-1', true);
}
```

- [ ] **Step 2: הרץ ווודא כשל**

Run: `node scripts/verify-payment-order.cjs`
Expected: כשלים בבלוק הזה (הקבוע `TORANI_BONUS_ELIGIBLE_FROM` עוד לא קיים, אין שער-זכאות — הבדיקות עצמן עדיין אמורות לעבור כי שינית רק תאריכים בלי לשנות היגיון; זו בעצם בדיקת-רגרסיה על העדכון שלך ל-Step 1 לפני שנוגעים בקוד. אם הבדיקות האלה *נכשלות* כאן, יש טעות בהזזת התאריכים — עצור ותקן לפני שממשיכים).

- [ ] **Step 3: הוסף בדיקות כושלות לשער-הזכאות עצמו**

הוסף **מיד אחרי** הבלוק מ-Step 1 (לפני הבלוק `// חיווט toraniBonuses דרך calcMonthlyPayment`):

```js
// ────────────────────────────────────────────────────────────────────────────
// זכאות בונוס תורני — רק ללקוחות שנכנסו מ-1.9.2026 ואילך (2026-09-06, בקשת נדב).
// ────────────────────────────────────────────────────────────────────────────
{
  const { deriveToraniBonuses } = require('../lib/paymentCalc.js');
  const mkT = (contactId, date, id) => ({ activist_id: 7, project_id: 1, contact_id: contactId, quality: 'תורני', type: 'פרונטלי', duration_minutes: 60, date, id });
  const threeMonths = (contactId, baseId) => [
    mkT(contactId, '2026-09-05', baseId), mkT(contactId, '2026-10-05', baseId + 1), mkT(contactId, '2026-11-05', baseId + 2),
  ];

  check('לקוח ותיק (הצטרף לפני 1.9.2026) עם רצף תקין — אין בונוס',
    deriveToraniBonuses(threeMonths(100, 200), [{ id: 100, name: 'ותיק', joined_at: '2026-08-15' }]).length, 0);

  check('לקוח בדיוק מ-1.9.2026 עם רצף תקין — יש בונוס (גבול כולל)',
    deriveToraniBonuses(threeMonths(101, 210), [{ id: 101, name: 'חדש-בדיוק', joined_at: '2026-09-01' }]).length, 1);

  check('לקוח מ-31.8.2026 (יום לפני הסף) — אין בונוס (גבול לא-כולל)',
    deriveToraniBonuses(threeMonths(102, 220), [{ id: 102, name: 'יום-לפני', joined_at: '2026-08-31' }]).length, 0);

  check('לקוח בלי joined_at בכלל — אין בונוס (ברירת מחדל בטוחה)',
    deriveToraniBonuses(threeMonths(103, 230), [{ id: 103, name: 'בלי-תאריך' }]).length, 0);
}
```

- [ ] **Step 4: הרץ ווודא כשל**

Run: `node scripts/verify-payment-order.cjs`
Expected: 4 הבדיקות החדשות נכשלות (אין עדיין שער-זכאות — כולן מקבלות בונוס כרגע, גם ה"ותיק").

- [ ] **Step 5: הוסף את הקבוע ואת הפילטר ב-`lib/paymentCalc.js`**

אחרי שורה `const TORANI_BONUS_MONTHS = 3;` (שורה 62), הוסף:
```js

// בונוס תורני חל רק על לקוחות שנכנסו למערכת (joined_at) מהתאריך הזה ואילך — לא רטרואקטיבי
// ללקוחות ותיקים, גם אם משלימים רצף תקין (בקשת נדב, 2026-09-06).
const TORANI_BONUS_ELIGIBLE_FROM = '2026-09-01';
```

בתוך `deriveToraniBonuses` (שורה 267), שנה:
```js
function deriveToraniBonuses(interactions, contacts, amount = TORANI_BONUS_AMOUNT, months = TORANI_BONUS_MONTHS, cfg = DEFAULTS) {
  const MIN_DUR = cfg.MIN_DURATION ?? 15;
  const byPair = new Map();
  for (const i of (interactions || [])) {
    if (!countsForPayment(i) || i.quality !== 'תורני') continue;
    if ((i.duration_minutes ?? 0) < MIN_DUR) continue;
```
ל:
```js
function deriveToraniBonuses(interactions, contacts, amount = TORANI_BONUS_AMOUNT, months = TORANI_BONUS_MONTHS, cfg = DEFAULTS) {
  const MIN_DUR = cfg.MIN_DURATION ?? 15;
  const ELIGIBLE_FROM = cfg.TORANI_BONUS_ELIGIBLE_FROM ?? TORANI_BONUS_ELIGIBLE_FROM;
  const contactById = new Map((contacts || []).map(c => [String(c.id), c]));
  const byPair = new Map();
  for (const i of (interactions || [])) {
    if (!countsForPayment(i) || i.quality !== 'תורני') continue;
    if ((i.duration_minutes ?? 0) < MIN_DUR) continue;
    // בונוס תורני חל רק על לקוחות מ-ELIGIBLE_FROM ואילך. לקוח בלי joined_at (ותיק) = לא זכאי.
    const contact = contactById.get(String(i.contact_id));
    if (!contact?.joined_at || contact.joined_at < ELIGIBLE_FROM) continue;
```

- [ ] **Step 6: הוסף `TORANI_BONUS_ELIGIBLE_FROM` ל-`module.exports`**

בשורה 770, הוסף `TORANI_BONUS_ELIGIBLE_FROM` לרשימה הקיימת (ליד `TORANI_BONUS_AMOUNT, TORANI_BONUS_MONTHS`).

- [ ] **Step 7: הרץ ווודא הצלחה**

Run: `node scripts/verify-payment-order.cjs`
Expected: כל הבדיקות `✓ PASS`, 0 כשלים (כולל כל הבדיקות הקיימות שלא נגעת בהן).

- [ ] **Step 8: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 9: Commit**

```bash
git add lib/paymentCalc.js scripts/verify-payment-order.cjs
git commit -m "feat: restrict torani bonus eligibility to contacts joined since 2026-09-01"
```

---

### Task 2: `requireWriteRole` — הוספת `project_ids`

**Files:**
- Modify: `pages/api/meeting-houses/_auth.js:18-22`

**Interfaces:**
- Produces: `auth.profile.project_ids` (array) זמין לכל קורא של `requireWriteRole` (תוסף אדיטיבי — קוראים קיימים לא נשברים, פשוט מקבלים שדה נוסף שלא השתמשו בו).

- [ ] **Step 1: עדכן את ה-`select` ב-`requireWriteRole`**

שנה (שורות 18-22):
```js
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('role, project_id, activist_code, name')
    .eq('id', userData.user.id)
    .single();
```
ל:
```js
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('role, project_id, project_ids, activist_code, name')
    .eq('id', userData.user.id)
    .single();
```

- [ ] **Step 2: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות (שינוי אדיטיבי בלבד ל-select, שום קורא קיים לא משתמש בעמודה החדשה עדיין).

- [ ] **Step 3: Commit**

```bash
git add pages/api/meeting-houses/_auth.js
git commit -m "feat: expose project_ids from requireWriteRole"
```

---

### Task 3: `pages/api/interactions/manage.js` — endpoint מיוחס

**Files:**
- Create: `pages/api/interactions/manage.js`

**Interfaces:**
- Consumes: `requireWriteRole` מ-Task 2 (כולל `project_ids`), `notifyRecipients` מ-`lib/notifyRecipients.js`, `getSupabaseAdmin` מ-`lib/supabaseAdmin.js`.
- Produces: `POST /api/interactions/manage` עם body `{ action: 'update'|'delete', interactionId, fields? }`, מחזיר `{ error: null }` בהצלחה או `{ error: string }` + status קוד מתאים.

- [ ] **Step 1: כתוב את הקובץ**

```js
// pages/api/interactions/manage.js — עריכה/מחיקה של קשר על ידי רכז/ראש-פרויקט/מנכ"ל,
// כולל התראה cross-user לפעיל בעל הקשר. אותה תבנית authorization+admin-client כמו
// pages/api/tours/delete.js — לא נוגעים ב-RLS (interactions_update/delete ב-0013 נשארות
// activist+ceo בלבד; המסלול הזה מוסיף coord/head דרך admin client, לא דרך RLS. הגנה כפולה:
// גם אם יש באג כאן, ניסיון לעקוף את ה-API ולפנות ישירות ל-Supabase עדיין ייחסם ב-RLS).
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireWriteRole } from '../meeting-houses/_auth';
import { notifyRecipients } from '../../../lib/notifyRecipients';

// אותם 7 שדות שטופס העריכה הקיים שולח (pages/contact/[id].jsx saveEditInteraction) —
// לא יותר. whitelist מונע כתיבה לשדות שהלקוח לא אמור לגעת בהם (activist_id, project_id וכו').
const EDITABLE_FIELDS = ['type', 'quality', 'duration_minutes', 'date', 'outcome', 'description', 'notes'];

function projectIdsOf(profile) {
  if (Array.isArray(profile.project_ids) && profile.project_ids.length > 0) return profile.project_ids.map(Number);
  return profile.project_id ? [Number(profile.project_id)] : [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireWriteRole(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { action, interactionId, fields } = req.body || {};
  if (!interactionId) return res.status(400).json({ error: 'Missing interactionId' });
  if (!['update', 'delete'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const admin = getSupabaseAdmin();
  const { data: interaction, error: readErr } = await admin
    .from('interactions')
    .select('id, contact_id, contact_name, activist_id, project_id, date')
    .eq('id', interactionId)
    .single();
  if (readErr || !interaction) return res.status(404).json({ error: 'Interaction not found' });

  // הרשאה: מנכ"ל תמיד; רכז/ראש רק בפרויקט של הקשר (requireWriteRole כבר סינן ל-coord/head/ceo).
  const isCeo = auth.profile.role === 'ceo';
  if (!isCeo && !projectIdsOf(auth.profile).includes(Number(interaction.project_id))) {
    return res.status(403).json({ error: 'הקשר הזה לא בפרויקט שלך' });
  }

  // שם בעל-הקשר, לצורך ההתראה. activist_directory הוא ה-view הקריא-בלבד הרגיל של פעילים.
  const { data: owner } = await admin
    .from('activist_directory')
    .select('name')
    .eq('activist_code', interaction.activist_id)
    .single();
  const ownerName = owner?.name;
  const url = interaction.contact_id ? `/contact/${interaction.contact_id}` : '/contacts';
  const actorName = auth.profile.name || (auth.profile.role === 'head' ? 'ראש הפרויקט' : 'הרכז');
  const shouldNotify = ownerName && Number(interaction.activist_id) !== Number(auth.profile.activist_code);

  if (action === 'update') {
    if (!fields || typeof fields !== 'object') return res.status(400).json({ error: 'Missing fields' });
    const row = {};
    EDITABLE_FIELDS.forEach(key => { if (fields[key] !== undefined) row[key] = fields[key]; });
    const { error: writeErr } = await admin.from('interactions').update(row).eq('id', interactionId);
    if (writeErr) return res.status(500).json({ error: writeErr.message });

    if (shouldNotify) {
      await notifyRecipients(admin, [{ activist_code: interaction.activist_id, name: ownerName }], {
        title: 'קשר שלך עודכן',
        body: `${actorName} עדכן קשר שלך עם ${interaction.contact_name || 'לקוח'}.`,
        url, type: 'interaction_managed_edit', priority: 'high',
        clientId: code => `interaction_managed_edit__${interactionId}__${code}`,
      });
    }
    return res.status(200).json({ error: null });
  }

  // action === 'delete'
  const { error: delErr } = await admin.from('interactions').delete().eq('id', interactionId);
  if (delErr) return res.status(500).json({ error: delErr.message });

  if (shouldNotify) {
    await notifyRecipients(admin, [{ activist_code: interaction.activist_id, name: ownerName }], {
      title: 'קשר שלך נמחק',
      body: `${actorName} מחק קשר שלך עם ${interaction.contact_name || 'לקוח'} מתאריך ${interaction.date}.`,
      url, type: 'interaction_managed_delete', priority: 'high',
      clientId: code => `interaction_managed_delete__${interactionId}__${code}`,
    });
  }
  return res.status(200).json({ error: null });
}
```

- [ ] **Step 2: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות. (בדיקה פונקציונלית מלאה — Task 5 בסוף התוכנית, אחרי שגם ה-client וגם ה-UI מחוברים.)

- [ ] **Step 3: Commit**

```bash
git add pages/api/interactions/manage.js
git commit -m "feat: add privileged interaction update/delete endpoint for coord/head"
```

---

### Task 4: חיווט `lib/CrmStore.jsx` — ניתוב לפי role

**Files:**
- Modify: `lib/CrmStore.jsx:474-491` (`updateInteraction`, `deleteInteraction`), import חדש

**Interfaces:**
- Consumes: `POST /api/interactions/manage` מ-Task 3, `authHeader()` מ-`lib/apiAuth.js` (קיים — כבר משמש `lib/meetingHousesSupabase.js`/`lib/toursSupabase.js` באותו דפוס בדיוק).
- Produces: `updateInteraction`/`deleteInteraction` — **אותה חתימה בדיוק** כמו היום (`(interactionId, fields)` / `(interactionId)`, מחזירות `{ error }`) — אין שינוי בשום call-site קיים.

- [ ] **Step 1: הוסף import**

בראש הקובץ, ליד שאר ה-imports מ-`./`:
```js
import { authHeader } from './apiAuth';
```

- [ ] **Step 2: עדכן את `updateInteraction` (שורות 474-483)**

שנה:
```js
  async function updateInteraction(interactionId, fields) {
    if (!fields || Object.keys(fields).length === 0) return { error: null };
    const row = {};
    INTERACTION_COLUMNS.forEach(key => { if (fields[key] !== undefined) row[key] = fields[key]; });
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('interactions').update(row).eq('id', interactionId);
    if (error) { console.error('Failed to update interaction', error); return { error }; }
    setInteractions(prev => prev.map(i => i.id === interactionId ? { ...i, ...row } : i));
    return { error: null };
  }
```
ל:
```js
  async function updateInteraction(interactionId, fields) {
    if (!fields || Object.keys(fields).length === 0) return { error: null };
    const row = {};
    INTERACTION_COLUMNS.forEach(key => { if (fields[key] !== undefined) row[key] = fields[key]; });

    // רכז/ראש-פרויקט עורכים קשר של פעיל אחר — endpoint מיוחס (admin client + התראה לבעל
    // הקשר). activist/ceo ממשיכים בדיוק כמו היום: RLS כבר מתיר (activist=שלו, ceo=הכל).
    if (currentUser?.role === 'coord' || currentUser?.role === 'head') {
      const res = await fetch('/api/interactions/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ action: 'update', interactionId, fields: row }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { console.error('Failed to update interaction (managed)', body.error); return { error: body.error || 'update failed' }; }
      setInteractions(prev => prev.map(i => i.id === interactionId ? { ...i, ...row } : i));
      return { error: null };
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('interactions').update(row).eq('id', interactionId);
    if (error) { console.error('Failed to update interaction', error); return { error }; }
    setInteractions(prev => prev.map(i => i.id === interactionId ? { ...i, ...row } : i));
    return { error: null };
  }
```

- [ ] **Step 3: עדכן את `deleteInteraction` (שורות 485-491)**

שנה:
```js
  async function deleteInteraction(interactionId) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('interactions').delete().eq('id', interactionId);
    if (error) { console.error('Failed to delete interaction', error); return { error }; }
    setInteractions(prev => prev.filter(i => i.id !== interactionId));
    return { error: null };
  }
```
ל:
```js
  async function deleteInteraction(interactionId) {
    if (currentUser?.role === 'coord' || currentUser?.role === 'head') {
      const res = await fetch('/api/interactions/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ action: 'delete', interactionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { console.error('Failed to delete interaction (managed)', body.error); return { error: body.error || 'delete failed' }; }
      setInteractions(prev => prev.filter(i => i.id !== interactionId));
      return { error: null };
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('interactions').delete().eq('id', interactionId);
    if (error) { console.error('Failed to delete interaction', error); return { error }; }
    setInteractions(prev => prev.filter(i => i.id !== interactionId));
    return { error: null };
  }
```

- [ ] **Step 4: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 5: Commit**

```bash
git add lib/CrmStore.jsx
git commit -m "feat: route coord/head interaction edits through the privileged endpoint"
```

---

### Task 5: תיקון תנאי-התצוגה של כפתורי עריכה/מחיקת-קשר

**Files:**
- Modify: `pages/contact/[id].jsx:69` (הוספת משתנה חדש), `pages/contact/[id].jsx:351` (שימוש בו)

**Interfaces:**
- Consumes: `currentUser` מ-`useAuth()` (כבר בשימוש בקובץ, שורה 22), `contact` (כבר מחושב בקובץ).
- Produces: `canManageInteractions` (boolean מקומי לקומפוננטה) — לא מיוצא, בשימוש רק בקובץ הזה.

⚠️ **חשוב לא לגעת ב-`isOwner` עצמו** — הוא בשימוש במקומות אחרים בקובץ (עריכת/מחיקת *לקוח*, `showSensitive`) שלא קשורים לבקשה הזו ולא נבדקו/אושרו לשינוי. מוסיפים משתנה **חדש**, לא משנים את הקיים.

- [ ] **Step 1: הוסף את `canManageInteractions` ליד `isOwner` (שורה 69)**

מצא:
```js
  const isOwner = currentUser?.role !== 'activist' || contact.activist_id === currentUser?.id;
```
הוסף מיד אחריו:
```js
  // תנאי מדויק לכפתורי עריכה/מחיקת-קשר בלבד — לא isOwner (רחב מדי: נכון גם ל-finance,
  // שלא אמור לראות את הכפתורים האלה. ראה docs/superpowers/specs/2026-09-06-coord-interaction-management-and-torani-bonus-eligibility-design.md).
  const canManageInteractions = contact.activist_id === currentUser?.id || ['coord', 'head', 'ceo'].includes(currentUser?.role);
```

- [ ] **Step 2: עדכן את תנאי הכפתורים (שורה 351)**

מצא (בתוך רשימת הקשרים, ליד `✏️`/`🗑️`):
```jsx
                        {isOwner && (
                          <>
                            <button onClick={() => openEditInteraction(i)} title="עריכת קשר"
```
שנה ל:
```jsx
                        {canManageInteractions && (
                          <>
                            <button onClick={() => openEditInteraction(i)} title="עריכת קשר"
```

⚠️ ודא שזה **רק** המופע הזה של `isOwner` (ליד `title="עריכת קשר"`) — לא לגעת בשום מופע אחר של `isOwner` בקובץ.

- [ ] **Step 3: `npm run build`**

Run: `npm run build`
Expected: מצליח בלי שגיאות.

- [ ] **Step 4: בדיקה ידנית מלאה (dev server)**

Run: `npm run dev`, התחבר כ-coord/head על פרויקט עם קשרים של פעיל אחר (יש משתמשי דמו: `coord1`/`coord123`).

1. פתח כרטיס לקוח של פעיל אחר, ולחץ ✏️ על קשר קיים — ודא שהעריכה נשמרת (ללא שגיאת קונסול), ושהפעיל בעל הקשר מקבל התראה (בדוק את `/notifications` שלו, או שורת `notifications` ב-Supabase).
2. לחץ 🗑️ על קשר — ודא שהוא נמחק, ושמגיעה התראת-מחיקה לבעל הקשר.
3. התחבר כ-`activist1`/`activist123` — ודא שכפתורי עריכה/מחיקה **עדיין מוצגים ועובדים** בדיוק כמו קודם על הקשרים **שלו עצמו** (המסלול הישיר לא נשבר).
4. נסה (אם יש לך משתמש finance) לוודא שהכפתורים **לא** מוצגים לו.

- [ ] **Step 5: Commit**

```bash
git add "pages/contact/[id].jsx"
git commit -m "fix: scope interaction manage buttons to owner/coord/head/ceo, not all non-activist roles"
```
