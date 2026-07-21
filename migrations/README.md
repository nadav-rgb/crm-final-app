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

כל הקבצים כתובים כ-idempotent (`if not exists` / `drop policy if exists` לפני `create`) —
בטוח להריץ שוב.

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
| **0016_feedback_reports** | **טבלת `feedback_reports` (עמוד `/feedback`)** | ⛔ **טרם הורץ** |

### 0016 — מה תלוי בה
עמוד `/feedback` ("תקלות והצעות") לא יכול לשמור או להציג דיווחים עד שהיא תרוץ.
העמוד מזהה את המצב (`PGRST205`) ומציג הודעת-התקנה ברורה במקום להיכשל בשקט,
אז אין נזק — פשוט אין פונקציונליות.

## אימות אחרי הרצה
```sql
-- 0016: הטבלה + 3 מדיניות RLS
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and tablename='feedback_reports'
 order by policyname;
```
