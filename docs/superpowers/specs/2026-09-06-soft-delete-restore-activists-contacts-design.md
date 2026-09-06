# מחיקה-רכה + שחזור (90 יום) לפעילים ולקוחות, בהרשאת רכז/ראש-פרויקט — מפרט תכנון

## מטרה

רכז וראש-פרויקט צריכים יכולת למחוק פעיל או לקוח. המחיקה אינה סופית מיידית: 90 יום שבהם ניתן לשחזר במלואו, ורק בתום התקופה — מחיקה סופית, בפעולת-אישור מפורשת נוספת של רכז/ראש (לא אוטומטי).

## החלטות שאושרו בשיחה

| נושא | החלטה |
|---|---|
| מי יכול למחוק/לשחזר | רכז (coord) + ראש פרויקט (head) — אותו זוג roles כמו הרשאת עריכת-הקשרים ([2026-09-06-coord-interaction-management-and-torani-bonus-eligibility-design.md](2026-09-06-coord-interaction-management-and-torani-bonus-eligibility-design.md)) |
| חלון שחזור | 90 יום מרגע המחיקה |
| היקף המחיקה (פעיל) | **מלא** — הפעיל *וכל אנשי הקשר שלו* נעלמים לגמרי מכל תצוגה, לא רק חסימת login |
| מחיקה סופית אחרי 90 יום | **לא אוטומטי** — דורש אישור מפורש נוסף מרכז או ראש (אחד מהם), בלחיצה ייעודית |

## מצב קיים (אומת בקוד, מחקירה קודמת)

- **`contacts.is_active`** כבר קיים (`migrations/0002_contacts_softdelete.sql`, שורה יחידה: `alter table ... add column if not exists is_active boolean not null default true`). מחיקת לקוח היום (`lib/CrmStore.jsx:551-558`, `deleteContact`) היא כבר `update is_active=false`, לא DELETE אמיתי. הטעינה (`lib/CrmStore.jsx:175`) מסננת `is_active=true` — שורה שנמחקה כבר **לא נגישה משום מסך**. ⚠️ אבל **אין שום מנגנון שחזור קיים** — לא UI, לא endpoint, שום דבר. חלון-האישור הקיים (`pages/contact/[id].jsx:546`) אפילו כותב במפורש "ניתן לשחזור בבסיס הנתונים" — כלומר רק SQL ידני.
- **פעילים — אין שום תשתית קיימת.** `profiles` (הטבלה שממנה נטענים roles/project_ids) **אין לה שום עמודת status/is_active/deleted_at בשום מיגרציה קיימת** (הטבלה קדמה לתיקיית המיגרציות). ה-view הקריא-בלבד `activist_directory` (`lib/CrmStore.jsx:270-306`, select בשורה 278: `activist_code, name, role, project_id, project_ids`) **גם הוא לא חושף status** — האפליקציה ממציאה `status: 'active'` קשיח בקוד (שורה 301) לכל פעיל, בלי קשר לנתון אמיתי כלשהו. login (`lib/AuthStore.jsx`) עובר דרך מיפוי username→email **קשיח בקוד** (`USERNAME_TO_EMAIL`, שורות 10-60) ואז Supabase Auth — אין שום בדיקת status היום בתהליך ה-login.
- ⚠️ **פער מידע שאין לי דרך לסגור לבד:** אין CLI/`exec_sql` (ראה `migrations/README.md`) כדי לשלוף את הגדרת ה-view `activist_directory` המלאה. לפני כתיבת ה-`create or replace view`, מישהו צריך להריץ ב-SQL Editor: `select pg_get_viewdef('public.activist_directory'::regclass, true);` ולהדביק את התוצאה — אחרת יש סיכון להחליף את ה-view ובטעות להשמיט עמודה קיימת שצרכן אחר מסתמך עליה.

## ארכיטקטורה

### מודל הנתונים — מיגרציה חדשה

⚠️ **מספור:** יש מיגרציות `0018`–`0024` על ענפים מקומיים אחרים שטרם מוזגו (`security/hardening-p0` וכדומה — ראה preflight מ-2026-09-06). כדי לא להתנגש איתן, המיגרציה הזו תמוספר **`0025`**, לא `0018`.

`migrations/0025_soft_delete_restore.sql`:
```sql
-- profiles (פעילים) — אין להם היום שום עמודת סטטוס בכלל.
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists deleted_at timestamptz null;

-- contacts — is_active כבר קיים (0002). מוסיפים deleted_at (לחישוב חלון-90-יום ותצוגת "נשארו X ימים"),
-- ו-deleted_via_activist_id: מתי המחיקה הזו היא *תוצאת-לוואי* של מחיקת הפעיל שהחזיק בלקוח (cascade),
-- לעומת מחיקה עצמאית של הלקוח עצמו. קריטי לשחזור מדויק: שחזור פעיל משחזר *רק* לקוחות עם הסימון
-- הזה שווה למזהה שלו — לא לקוחות שהפעיל מחק בעצמו לפני-כן, ולא אחרי.
alter table public.contacts add column if not exists deleted_at timestamptz null;
alter table public.contacts add column if not exists deleted_via_activist_id integer null;

-- ⚠️ activist_directory (view) — לא נכתב כאן. יש להשלים אחרי שמישהו מריץ
-- select pg_get_viewdef('public.activist_directory'::regclass, true);
-- ומחזיר את התוצאה, כדי שה-create or replace view לא ישמיט עמודה קיימת בטעות.
-- ה-view צריך לחשוף גם is_active וגם deleted_at, ולסנן is_active=true כברירת מחדל
-- (בדיוק כמו contacts_select ב-0013 מסנן contacts פעילים בלבד ברמת ה-RLS/הטעינה).
```

### מחיקה — endpoint מיוחס אחד, אותו דפוס כמו ניהול-קשרים

ממשיך את התבנית שכבר תוכננה למניעת-הרשאה (`requireWriteRole`, `pages/api/meeting-houses/_auth.js:7-29`, role ∈ {coord, head, ceo} + admin client עוקף-RLS-בבטחה). קובץ חדש `pages/api/admin/soft-delete.js`:

```
POST body: { entity: 'activist' | 'contact', id, action: 'delete' | 'restore' | 'purge' }
```

1. `requireWriteRole` — coord/head/ceo. + בדיקת חברות-פרויקט (כמו ב-Part א׳ של הספק הקודם — `project_ids` כולל את `project_id` של הישות).
2. **`action: 'delete'` על `contact`:** `update contacts set is_active=false, deleted_at=now() where id=?`.
3. **`action: 'delete'` על `activist`:** בתוך אותה קריאה — (א) `update profiles set is_active=false, deleted_at=now() where id=?`, (ב) `update contacts set is_active=false, deleted_at=now(), deleted_via_activist_id=? where activist_id=? and is_active=true` (**רק** לקוחות שהיו פעילים ברגע המחיקה — לא "מחייה" בטעות לקוח שהפעיל עצמו כבר מחק קודם).
4. **`action: 'restore'`:** ההפך המדויק. על `activist` — משחזר את הפרופיל **וגם** כל `contacts` עם `deleted_via_activist_id = <המזהה הזה>` (ומאפס את השדה בחזרה ל-null). על `contact` בודד — משחזר רק אותו.
5. **`action: 'purge'` (מחיקה סופית, אחרי 90 יום, בלחיצה מפורשת):**
   - שער: מסרב אם `deleted_at` חסר או `now() - deleted_at < 90 days` (לא ניתן "לשרוף שלב" — הגנה כפולה מעבר להסתרת הכפתור ב-UI).
   - `contact`: `delete from contacts where id=?` — מחיקה אמיתית.
   - `activist`: `delete from profiles where id=?`, וגם `admin.auth.deleteUser(profileId)` (מסיר את משתמש ה-Auth כדי לא להשאיר חשבון-רפאים), וגם `delete from contacts where deleted_via_activist_id=?`.
   - ⚠️ **`interactions` לא נמחקות בשום מקרה, גם ב-purge.** הן נשארות ב-DB, מצביעות על `activist_id`/`contact_id` שכבר לא קיימים — "יתומות" ובלתי-נגישות מכל מסך (אין דרך ניווט אליהן ברגע שהפעיל/הלקוח נעלמו), אבל לא נהרסות. זו החלטה מכוונת: זו בדיוק ההיסטוריה שמזינה דוחות-שכר של חודשים שכבר שולמו — מחיקה פיזית שלה הייתה הרס בלתי-הפיך של רשומת-שכר אמיתית, בדיוק סוג הסיכון שמתועד שוב ושוב ב-CLAUDE.md לגבי מנוע התשלום. אם בעתיד תרצה למחוק גם אותן — זו החלטה נפרדת, לא כלולה כאן.
   - צריך לוודא (בזמן המימוש, לא ניחוש כאן): האם יש FK constraint בין `interactions.activist_id/contact_id` לבין `profiles`/`contacts` עם `on delete restrict` — אם כן, ה-DELETE הפיזי למעלה ייכשל בטעות-DB עם שגיאה ברורה (לא שקט), מה שבפועל *מגן* על ההחלטה שלמעלה. יש לבדוק ולתעד בזמן כתיבת ה-migration.

### תצוגת "סל מיחזור" — מסך חדש

`pages/trash.jsx` (רכז/ראש/מנכ"ל בלבד — `can.manageDeleted` חדש ב-`lib/AuthStore.jsx`, זהה ל-roles של `requireWriteRole`): טבלה של כל `contacts`/`profiles` עם `deleted_at is not null`, מסוננת לפרויקטים של המשתמש (כמו כל מסך-ניהול אחר). לכל שורה: שם, סוג (פעיל/לקוח), תאריך מחיקה, "נשארו X ימים לשחזור" (`90 - days_since(deleted_at)`).
- ימים-שנותרו > 0: כפתור "↺ שחזור" בלבד.
- ימים-שנותרו ≤ 0: כפתור "🗑️ מחיקה סופית" (במקום שחזור) — עם אישור-כפול (modal, לא `confirm()` דפדפן — תואם לדפוס האישור הקיים ב-`pages/contact/[id].jsx:538-556`), שמפרט מפורשות מה יימחק (כמה לקוחות ייכללו אם זה פעיל).

**ניווט:** לפי `CLAUDE.md` — פריט חדש חייב להיכנס לשלושת הקבצים (DesktopLayout, landing.jsx, MobileBottomNav) → `drawerItems`, לא `mainItems`, אלא אם תבקש אחרת.

### כפתורי מחיקה קיימים — עדכון יעד

`pages/contact/[id].jsx` (`doDelete`, שורות 124-129) ו-`pages/activists/[id].jsx` (**אין היום כפתור מחיקה כלל** — צריך להוסיף) ינתבו לפי role: activist/ceo ממשיכים במסלול הישיר הקיים (ל-contact בלבד — activist לא יכול היום למחוק פעיל, זה לא משתנה); coord/head קוראים ל-endpoint החדש.

## מחוץ להיקף

- מחיקת/שחזור פרויקטים, תשלומים, בתי-מפגש, סיורים וכו' — רק פעיל ולקוח, כפי שהתבקש.
- התראה יזומה כש-90 הימים מתקרבים לסיום ("תזכורת: X ימים לפעיל שנמחק") — לא התבקש, לא נבנה כרגע. (אפשרות עתידית טבעית דרך אותו מנגנון cron הקיים ב-`pages/api/cron/`.)
- מחיקה פיזית של `interactions` — במפורש לא (ראה ⚠️ למעלה).

## בדיקות לפני commit

- `npm run build` נקי.
- בדיקה ידנית (coord1/coord123, activist1/activist123): רכז מוחק לקוח → נעלם מהרשימה, מופיע ב-`/trash` עם 90 ימים; שחזור → חוזר לרשימה הפעילה. רכז מוחק פעיל עם 2 לקוחות → הפעיל *וה-2 לקוחות* נעלמים; שחזור הפעיל → כל ה-3 חוזרים ביחד.
- בדיקת-גבול ידנית (לזייף `deleted_at` ל-91 יום אחורה ב-DB): כפתור "שחזור" נעלם, "מחיקה סופית" מופיע.
