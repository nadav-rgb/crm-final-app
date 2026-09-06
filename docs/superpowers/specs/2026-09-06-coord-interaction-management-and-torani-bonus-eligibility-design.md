# הרשאת רכז/ראש-פרויקט לניהול קשרים + זכאות בונוס תורני ללקוחות חדשים — מפרט תכנון

## מטרה

שני תיקוני-פרוטוקול שביקש נדב, בהמשך ישיר לתיקון פער ה-DB ב-payment_config (2026-09-06):

1. רכז וראש-פרויקט צריכים יכולת לערוך/למחוק קשרים (interactions) של הפעילים שלהם — כדי לתקן טעויות בדיווחים המשפיעים על תשלום.
2. בונוס התורני (1,000 ₪, `deriveToraniBonuses`) צריך לחול רק על לקוחות שנכנסו למערכת (`joined_at`) מ-1.9.2026 ואילך — לא על לקוחות ותיקים שמגיעים לרצף 3 חודשים.

## החלטות שאושרו בשיחה

| נושא | החלטה |
|---|---|
| מי מקבל את הרשאת העריכה/מחיקה | רכז (coord) **וגם** ראש פרויקט (head) — לא finance |
| התראה לפעיל כשמישהו אחר עורך/מוחק את הקשר שלו | כן — Push + פעמון, כמו הכיוון ההפוך הקיים (פעיל עורך → מנהלים מקבלים) |
| "לקוחות שנכנסו מספטמבר ואילך" | `contact.joined_at >= '2026-09-01'` (השדה הקיים, המשמש כבר כעוגן לחלון-הזכאות של קשר ידידותי) |

## חלק א׳ — הרשאת רכז/ראש-פרויקט לניהול קשרים

### מצב קיים (אומת בקוד)

- **RLS (`migrations/0013_activist_isolation_rls.sql:112-120`):** `interactions_update`/`interactions_delete` מתירות רק `ceo` או `activist_id = app_current_activist_code()`. רכז/ראש **חסומים** היום ברמת ה-DB, אף שהם *כן* רואים קשרים של פעילים אחרים בפרויקט שלהם (`interactions_select` כבר כוללת `coord`/`head`/`finance`).
- **⚠️ תקלה קיימת שנחשפת אגב הבדיקה:** ב-`pages/contact/[id].jsx:69` `isOwner = currentUser?.role !== 'activist' || contact.activist_id === currentUser?.id` — נכון (`true`) לכל role שאינו activist, כולל **finance**. הכפתורים ✏️/🗑️ על קשר (`pages/contact/[id].jsx:351-356`) מוצגים לפי `isOwner` בלבד — כלומר רכז/ראש/finance **כבר רואים היום** כפתורי עריכה/מחיקה שנכשלים בשקט (RLS דוחה, רק `console.error` ב-`lib/CrmStore.jsx:480/488`). זו לא תקלה שאני יוצר — היא קיימת היום; התיקון הזה סוגר אותה כתוצר-לוואי.

### ארכיטקטורה — endpoint מיוחס, בלי לגעת ב-RLS

יש כבר תבנית מדויקת לזה בקוד: `requireWriteRole` (`pages/api/meeting-houses/_auth.js:7-29`) בודקת `role ∈ {coord, head, ceo}` ומשמשת endpoints שכותבים עם ה-admin client (service role) — לפי ההערה בקובץ עצמו: "לעקוף RLS בבטחה (**בלי לשנות RLS**)". זו בדיוק הדרך שבה בתי מפגש כבר עובדים.

**למה זה עדיף על הרחבת ה-RLS policy:** RLS נשאר בדיוק כמו היום = הגנת-הגנה. גם אם יימצא באג ב-endpoint החדש, ניסיון לעקוף אותו ולפנות ישירות ל-Supabase (עם JWT תקף של רכז) עדיין ייחסם ב-DB. וגם: **אין צורך במיגרציה** — לא תלוי בזה שנדב ירוץ SQL ידנית לפני שהתכונה חיה.

**קובץ חדש: `pages/api/interactions/manage.js`**

```
POST body: { action: 'update' | 'delete', interactionId, fields? }
```

1. `requireWriteRole(req)` — מוודא coord/head/ceo.
2. ⚠️ **תוסף נדרש ל-`requireWriteRole`:** היום היא שולפת `project_id` (יחיד) אבל לא `project_ids` (מערך) — צריך את שניהם כדי לבדוק חברות-פרויקט נכונה (אותו fallback שכבר קיים ב-`lib/AuthStore.jsx:92-94`). מוסיף `project_ids` ל-`.select()` הקיים ב-`_auth.js:20` — שינוי תוסף בלבד, לא שובר קוראים קיימים (meeting-houses endpoints).
3. קורא את השורה מ-`interactions` עם ה-admin client (**לפני** כל פעולה — גם לצורך אימות הרשאה, גם כדי שיהיה על מה להודיע במקרה מחיקה).
4. בדיקת הרשאה: `profile.role === 'ceo' || projectIds.includes(interaction.project_id)`. נכשל → 403.
5. `action: 'update'`: מעדכן רק את 7 השדות שהטופס הקיים כבר שולח ב-`pages/contact/[id].jsx:149-157` (`type, quality, duration_minutes, date, outcome, description, notes`) — אותה רשימה בדיוק, לא יותר.
6. `action: 'delete'`: מוחק עם ה-admin client.
7. בשני המקרים: שולף את שם בעל-הקשר (`profiles`/`activist_directory` לפי `interaction.activist_id`) ושולח התראה **cross-user אמיתית** דרך `notifyRecipients` (`lib/notifyRecipients.js:50`, בדיוק כמו `pages/api/tours/delete.js:60-67`) לפעיל **בעל הקשר** — לא לרכז שביצע את הפעולה:
   - עדכון: `"{שם הרכז/ראש} עדכן קשר שלך עם {contactName}"`, `url: /contact/{contactId}`, `type: 'interaction_managed_edit'`, `priority: 'high'`.
   - מחיקה: `"{שם הרכז/ראש} מחק קשר שלך עם {contactName} מ-{date}"`, אותו `url`/`priority`, `type: 'interaction_managed_delete'`.

### צד לקוח

**`lib/CrmStore.jsx` — `updateInteraction`/`deleteInteraction` (שורות 474-491):** מתווסף ניתוב לפי role:
- `activist` (עורך קשר שלו עצמו) או `ceo` — **ללא שינוי** מהיום: קריאת supabase ישירה, dependent על RLS הקיים.
- `coord`/`head` — קריאה ל-`/api/interactions/manage` במקום.

⚠️ אין צורך לשנות אף call-site אחר — `pages/contact/[id].jsx` ממשיך לקרוא לאותן שתי פונקציות בדיוק; הניתוב קורה בתוך `CrmStore.jsx`.

**תיקון תנאי הכפתורים (`pages/contact/[id].jsx:351`):** מ-`{isOwner && (...)}` ל-תנאי מדויק — בעל הקשר, או `role ∈ {coord, head, ceo}`. סוגר את חשיפת-הכפתורים ל-finance.

### מחוץ להיקף

- לא נוגעים ב-RLS policies הקיימות.
- לא נותנים הרשאה זו ל-finance (רק seePayments, ללא שינוי).
- מנכ"ל ממשיך בדיוק כמו היום — ללא ניתוב ל-endpoint החדש, ללא התראה חדשה (לא התבקש, לא משנים התנהגות קיימת).

## חלק ב׳ — בונוס תורני רק ללקוחות מ-1.9.2026 ואילך

### שינוי יחיד וממוקד

`deriveToraniBonuses` (`lib/paymentCalc.js:267-310`) היא מקור-האמת היחיד לבונוס הזה (נצרכת ע"י `lib/CrmStore.jsx` וסקריפטי ה-verify) — בדיוק כמו `deriveMitzvotBonuses`. הלולאה הראשונה בפונקציה (בונה `byPair` מכל קשר תורני) מקבלת בדיקה נוספת: אם ל-`contact` (לפי `contact_id`) אין `joined_at`, או ש-`joined_at < TORANI_BONUS_ELIGIBLE_FROM` — הקשר לא נכנס למפה בכלל (לא רק "לא מזכה בונוס"; מבחינת הפונקציה, כאילו הלקוח לא קיים).

קבוע חדש, לצד `TORANI_BONUS_AMOUNT`/`TORANI_BONUS_MONTHS` (ליד `lib/paymentCalc.js:61-62`):
```js
const TORANI_BONUS_ELIGIBLE_FROM = '2026-09-01'; // בהשוואת מחרוזות ISO, כמו anchorDate בזכאות-ידידותי
```
מיוצא ב-`module.exports`, כמו שאר קבועי-המדיניות.

⚠️ **לקוח בלי `joined_at` בכלל → לא זכאי** (ברירת מחדל בטוחה, תואם את הטיפול הקיים בלקוחות ותיקים חסרי-שדה בזכאות-ידידותי).

**מה לא משתנה:** קשר תורני בודד ממשיך להשתלם במלואו (150/200 ₪) ללקוח ותיק כמו היום — רק הבונוס החד-פעמי של 1,000 ₪ מוגבל ללקוחות חדשים. אין צורך לגעת ב-`calcMonthlyPayment`, `CrmStore.jsx`, או דפי התשלומים — כולם כבר צורכים את `deriveToraniBonuses` כפי שהיא.

### בדיקות (`scripts/verify-payment-order.cjs`)

- לקוח ותיק (`joined_at` לפני 1.9.2026) עם רצף 3 חודשים תקין → 0 בונוסים.
- לקוח עם `joined_at = '2026-09-01'` בדיוק, רצף תקין → בונוס (בדיקת-גבול, כולל).
- לקוח עם `joined_at = '2026-08-31'` (יום לפני), רצף תקין → 0 בונוסים (בדיקת-גבול, לא כולל).
- לקוח בלי `joined_at` בכלל, רצף תקין → 0 בונוסים.
- לקוח חדש עם 2 לקוחות באותו `deriveToraniBonuses` call — אחד ותיק אחד חדש — רק החדש מקבל בונוס (לא משפיע אחד על השני).

### מחוץ להיקף

- לא נוגעים בתעריף קשר תורני עצמו (150/200 ₪) — רק בזכאות לבונוס.
- לא נוגעים בבונוס המצוות (`deriveMitzvotBonuses`) — לא התבקש.

## בדיקות כלליות לפני commit

- `node scripts/verify-payment-order.cjs` — 0 כשלים, כולל הבדיקות הקיימות.
- `npm run build` נקי.
- בדיקה ידנית בדפדפן (יש משתמשי דמו: coord1/coord123, activist1/activist123): רכז עורך/מוחק קשר של פעיל → מצליח + הפעיל מקבל התראה; אותה פעולה כפעיל על קשר של פעיל אחר → נחסם.
