# מיגרציות — איך מריצים ומה המצב

## איך מריצים
אין Supabase CLI בפרויקט ואין connection string ישיר ל-Postgres.
**כל מיגרציה מורצת ידנית ב-SQL Editor של Supabase:**

1. פותחים את ה-SQL Editor של הפרויקט:
   https://supabase.com/dashboard/project/vgohvbaqhilxrhxuqxrg/sql/new
2. מדביקים את תוכן קובץ ה-`.sql` במלואו
3. **Run**
4. מוסיפים לשורת הכותרת של הקובץ הערה: `-- הורץ דרך ה-SQL Editor YYYY-MM-DD`
5. מעדכנים את הטבלה למטה

⚠️ **חשוב לדעת:** `SUPABASE_SECRET_KEY` שב-`.env.local` **לא מספיק** להרצת מיגרציות.
הוא מפתח service-role ל-PostgREST — הוא עושה CRUD על טבלאות קיימות, אבל **לא מריץ DDL**
(`create table` / `create policy` / `alter table`). גם אין ב-DB פונקציית `exec_sql` וכדומה.
לכן סוכן AI **לא יכול** להריץ מיגרציה בעצמו — זו פעולה ידנית של בעל הפרויקט בלבד.

רוב הקבצים משתמשים ב־guards, אך אין הנחת idempotency גורפת. בפרט, `0021` ו־`0022`
הם **single-apply; not fully idempotent** במצבם המאושר, משום ש־`ADD CONSTRAINT` אינו guarded.
ב־G5 אין לבצע retry עיוור: כשל עוצר את השרשרת, נבדק מול snapshot/backup, ורק אז מחליטים
אם לשחזר או לבצע תיקון review חדש.

## מצב נוכחי
אומת מול ה-DB החי ב-2026-07-21 (בדיקת קיום האובייקטים דרך PostgREST):

| מיגרציה | מה מוסיפה | סטטוס |
|---|---|---|
| 0001_rls | RLS בסיסי על כל הטבלאות | ✅ הורץ |
| 0002_contacts_softdelete | `contacts.is_active` | ✅ הורץ |
| 0002_fcm_tokens | טבלת `fcm_tokens` | ✅ הורץ |
| 0003_notifications | טבלת `notifications` | ✅ הורץ |
| 0004_payment_config | טבלת `payment_config` | ✅ הורץ |
| 0005_video_friendly_rate | תעריף וידאו | ✅ הורץ |
| 0006_notification_reads | טבלת `notification_reads` | ✅ הורץ |
| 0007_expenses | טבלת `expenses` | ✅ הורץ |
| 0008_rate_shabbat | תעריף שבת | ✅ הורץ |
| 0009_profiles_project_ids | `profiles.project_ids` | ✅ הורץ |
| 0010_rate_tour_guide | תעריף מדריך סיור | ✅ הורץ |
| 0011_tours | טבלת `tours` | ✅ הורץ |
| 0012_tour_reports_contact_link | `tours.report` | ✅ הורץ |
| 0013_activist_isolation_rls | בידוד נתונים בין פעילים | ✅ הורץ |
| 0014_bonus_cancellations | טבלת `bonus_cancellations` | ✅ הורץ |
| 0015_participants_reports_project_notification_recipients | `interactions.participants` + RPC `app_notification_recipients` | ✅ הורץ |
| 0016_feedback_reports | טבלת `feedback_reports` (עמוד `/feedback`) | ✅ הורץ 2026-07-21 |
| 0018_security_foundation | memberships, UUID ownership, private sessions/audit/rate-limit | ⛔ לא הורץ — נדרש G5 מאושר |
| 0019_security_rls | explicit grants, forced RLS, UUID assignment, audit triggers | ⛔ לא הורץ — נדרש G5 מאושר |
| 0020_security_rpcs | service-only sessions, datastore refresh lock/CAS, MFA state, rate-limit, audit and membership RPCs | ⛔ לא הורץ — נדרש G5 מאושר |
| 0021_meetings_security | reminder idempotency/cancellation schema + narrow cancel RPC | ⛔ לא הורץ — נדרש G5 מאושר; single-apply; not fully idempotent |
| 0022_tours_security | tour reporter/cancellation schema + narrow report RPC | ⛔ לא הורץ — נדרש G5 מאושר; single-apply; not fully idempotent |
| 0023_notifications_security | UUID ownership + resource-derived event RPC + private generic-push outbox | ⛔ לא הורץ — נדרש G5 מאושר |
| 0024_finance_security | aggregate finance projection with caller-derived scope and atomic audit | ⛔ לא הורץ — נדרש G5 מאושר |

## שרשרת Security Hardening הרשמית — לא להרצה ללא G5

הסדר היחיד המאושר הוא `0018 → 0019 → 0020 → 0021 → 0022 → 0023 → 0024`.
כל קובץ תלוי בהצלחת ה־preconditions וה־verification של קודמו. הוראות מפורטות נמצאות
ב־`docs/security/STAGING_RUNBOOK.md`; rollback pre-cutover נמצא ב־
`migrations/rollback/0018-0024-pre-cutover.sql` ופועל בסדר ההפוך בלבד.

- `0018`: UUID mappings, memberships ו־private storage; כל owner mapping חייב להיות מלא.
- `0019`: deny-by-default grants/RLS וה־helper `app_has_active_membership`.
- `0020`: session/rate/audit/governance RPCs; refresh דורש shared rate bucket, datastore lock/CAS ו-provider MFA state; כל function reference חייב להיפתר.
- `0021`: תלויה ב־recipient/project UUID contract; validate constraint רק אחרי inventory.
- `0022`: תלויה ב־tour UUID contract; report actor נגזר רק ב־RPC.
- `0023`: תלויה ב־0018 ownership וב־0019 helpers; duplicate endpoints עוצרים לפני index.
- `0024`: תלויה בכל finance source tables וב־`app_private.audit_events`; parity מול
  `paymentCalc.js` היא precondition ל־G5, לא evidence שנאסף כעת.

### 0016 — אימות שבוצע (2026-07-21)
- הטבלה קיימת עם כל 10 העמודות ✅
- **RLS פעיל ונבדק אנונימית:** `SELECT` מחזיר `[]` (לא דולף שורות),
  `INSERT` נדחה עם `42501 – new row violates row-level security policy` ✅
- ⚠️ שים לב: מדיניות ה-`SELECT` של רכז היא `project_id = any(app_current_project_ids())`.
  שורה עם `project_id = null` **לא תיראה לאף רכז**. לכן `pages/feedback.jsx` תמיד כותב
  `project_id` (נפילה ל-`project_ids[0]` ואז ל-`1`) — המנכ"ל הוא הפרופיל היחיד ב-DB
  בלי `project_id`, ובלי הנפילה הזו דיווח שלו היה נעלם בשקט מתור הסקירה.

## אימות אחרי הרצה
```sql
-- 0016: הטבלה + 3 מדיניות RLS
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and tablename='feedback_reports'
 order by policyname;
```
