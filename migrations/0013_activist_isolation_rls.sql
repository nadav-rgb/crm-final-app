-- migrations/0013_activist_isolation_rls.sql
--
-- בידוד נתונים אמיתי בין פעילים, ברמת ה-DB (לא רק סינון בצד לקוח).
--
-- הרקע: migrations/0001_rls.sql התקינה מדיניות גורפת יחידה על *כל* הטבלאות:
--   create policy authenticated_all on public.<table> for all to authenticated using (true) with check (true);
-- זה סגר את דליפת ה-RLS לאנונימי (2026-06-25) — אבל השאיר כל משתמש *מחובר* (כל פעיל, בכל role)
-- עם גישת קריאה/כתיבה מלאה לכל השורות של contacts/interactions/expenses/base_meeting_reports/profiles,
-- ללא שום קשר לזהותו. הבידוד עד כה היה רק בקוד ה-React (סינון בצד לקוח) — לא הגנת שרת אמיתית.
-- מיגרציה זו מחליפה את "authenticated_all" בטבלאות הרגישות במדיניות שבודקת activist_id/project_ids
-- של המשתמש המחובר בפועל (דרך auth.uid() → profiles).
--
-- היקף מכוון: contacts, interactions, expenses, base_meeting_reports, profiles, notifications,
-- notification_reads, tours (select). לא נגעתי ב-meeting_houses / payment_config / fcm_tokens /
-- push_subscriptions / meeting_reminders / projects — אלה כבר מוגנים סבירות (payment_config=read-only
-- לא רגיש, fcm/push/reminders נכתבים רק דרך API עם service role) או שדורשים בדיקה נפרדת של סמנטיקת
-- "assigned_activists" לפני שינוי (כדי לא לשבור פיצ'ר חי לפעילים אמיתיים בלי בדיקה מלאה).
--
-- ⚠️ הערה קריטית על סמנטיקת RLS: מדיניות PERMISSIVE מצטברות ב-OR. כלומר מדיניות ישנה ומתירנית
-- שנשארת על טבלה **מבטלת בשקט** את הבידוד החדש. לכן כל מדיניות קודמת על הטבלאות שבהיקף
-- מופלת כאן במפורש, ולא רק "authenticated_all".
--
-- snapshot של pg_policies *לפני* הרצת הקובץ (נלקח 2026-07-10, לצורך rollback):
--   base_meeting_reports | authenticated_all(ALL), bmr_select(SELECT), bmr_insert(INSERT), bmr_update(UPDATE)
--   contacts             | authenticated_all(ALL)
--   expenses             | expenses_select_authenticated, expenses_insert_authenticated, expenses_delete_authenticated
--   interactions         | authenticated_all(ALL)
--   meeting_houses       | authenticated_all(ALL), meeting_houses_select(SELECT)     [לא נוגעים]
--   meeting_reminders    | authenticated_all(ALL)                                     [לא נוגעים]
--   notification_reads   | authenticated_all(ALL)
--   notifications        | authenticated_all(ALL)
--   payment_config       | authenticated_read(SELECT)                                 [לא נוגעים]
--   profiles             | authenticated_all(ALL), profiles_select(SELECT)
--   projects             | authenticated_all(ALL)                                     [לא נוגעים]
--   push_subscriptions   | authenticated_all(ALL)                                     [לא נוגעים]
--   tours                | tours_select_authenticated(SELECT)
--
-- idempotent: ניתן להריץ שוב בבטחה (create or replace + drop-if-exists לפני כל create policy).

-- ============================================================
-- פונקציות עזר — security definer כדי לקרוא את profiles של המשתמש עצמו בלי רקורסיית-RLS.
-- שמות עם קידומת app_ בכוונה: `current_role` הוא מילה שמורה ב-Postgres ולא ניתן להגדיר פונקציה בשם הזה.
-- ============================================================

create or replace function public.app_current_activist_code()
returns int
language sql stable security definer set search_path = public as $$
  select activist_code from public.profiles where id = auth.uid()
$$;

create or replace function public.app_current_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.app_current_project_ids()
returns int[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(project_ids, '{}'),
    case when project_id is not null then array[project_id] else array[]::int[] end
  )
  from public.profiles where id = auth.uid()
$$;

-- ============================================================
-- contacts
-- ============================================================
drop policy if exists authenticated_all on public.contacts;
drop policy if exists contacts_select on public.contacts;
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;

create policy contacts_select on public.contacts for select to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
  or (app_current_role() in ('coord','head','finance') and project_id = any(app_current_project_ids()))
);

create policy contacts_insert on public.contacts for insert to authenticated with check (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
);

create policy contacts_update on public.contacts for update to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
  or (app_current_role() in ('coord','head') and project_id = any(app_current_project_ids()))
);

-- ============================================================
-- interactions
-- ============================================================
drop policy if exists authenticated_all on public.interactions;
drop policy if exists interactions_select on public.interactions;
drop policy if exists interactions_insert on public.interactions;
drop policy if exists interactions_update on public.interactions;
drop policy if exists interactions_delete on public.interactions;

create policy interactions_select on public.interactions for select to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
  or (app_current_role() in ('coord','head','finance') and project_id = any(app_current_project_ids()))
);

create policy interactions_insert on public.interactions for insert to authenticated with check (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
);

create policy interactions_update on public.interactions for update to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
);

create policy interactions_delete on public.interactions for delete to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
);

-- ============================================================
-- expenses (מחליף את 3 המדיניות המתירניות מ-0007_expenses.sql)
-- ============================================================
drop policy if exists authenticated_all on public.expenses;
drop policy if exists expenses_select_authenticated on public.expenses;
drop policy if exists expenses_insert_authenticated on public.expenses;
drop policy if exists expenses_delete_authenticated on public.expenses;
drop policy if exists expenses_select on public.expenses;
drop policy if exists expenses_insert on public.expenses;
drop policy if exists expenses_delete on public.expenses;

create policy expenses_select on public.expenses for select to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
  or (app_current_role() in ('coord','head','finance') and project_id = any(app_current_project_ids()))
);

create policy expenses_insert on public.expenses for insert to authenticated with check (
  activist_id = app_current_activist_code()
);

create policy expenses_delete on public.expenses for delete to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
);

-- ============================================================
-- base_meeting_reports
-- ה-bmr_* הישנות מוחלפות ע"י base_meeting_reports_* שלהלן (כיסוי זהה: פעיל=שלו, רכז/ראש=הפרויקט, מנכ"ל=הכל).
-- אם אחת מהן הייתה מכוונת לתרחיש נוסף — ניתן לשחזר לפי ה-snapshot בראש הקובץ.
-- ============================================================
drop policy if exists authenticated_all on public.base_meeting_reports;
drop policy if exists bmr_select on public.base_meeting_reports;
drop policy if exists bmr_insert on public.base_meeting_reports;
drop policy if exists bmr_update on public.base_meeting_reports;
drop policy if exists base_meeting_reports_select on public.base_meeting_reports;
drop policy if exists base_meeting_reports_insert on public.base_meeting_reports;
drop policy if exists base_meeting_reports_update on public.base_meeting_reports;

create policy base_meeting_reports_select on public.base_meeting_reports for select to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
  or (app_current_role() in ('coord','head','finance') and project_id = any(app_current_project_ids()))
);

create policy base_meeting_reports_insert on public.base_meeting_reports for insert to authenticated with check (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
  or (app_current_role() in ('coord','head') and project_id = any(app_current_project_ids()))
);

create policy base_meeting_reports_update on public.base_meeting_reports for update to authenticated using (
  app_current_role() = 'ceo'
  or activist_id = app_current_activist_code()
  or (app_current_role() in ('coord','head') and project_id = any(app_current_project_ids()))
);

-- ============================================================
-- profiles — הכי קריטי: סוגר הסלמת-הרשאות (עדכון role/project_ids של עצמו/כל אחד).
-- אין באפליקציה שום מסך שמעדכן profiles מהקליינט (רק service role/ניהול ידני) —
-- לכן אין כלל מדיניות update/insert/delete ל-authenticated; ברירת המחדל של RLS היא דחייה.
-- ============================================================
drop policy if exists authenticated_all on public.profiles;
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles for select to authenticated using (
  app_current_role() = 'ceo'
  or id = auth.uid()
  or (app_current_role() in ('coord','head','finance') and project_ids && app_current_project_ids())
);

-- ============================================================
-- notifications / notification_reads — כל אחד רואה/מסמן-כנקרא רק את ההתראות שלו.
-- recipient_id מאוחסן כ-String(activist_code) (ראה lib/notificationDemo.js).
-- insert נשאר פתוח: הזרימה הקיימת כותבת התראות *לפעילים אחרים* (בונוס/שיבוץ/אישור-רכז) —
-- לא ניתן להגביל insert ל-recipient=עצמי בלי לשבור את כל מנגנון ההתראות.
-- ============================================================
drop policy if exists authenticated_all on public.notifications;
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_insert on public.notifications;
drop policy if exists notifications_update on public.notifications;

create policy notifications_select on public.notifications for select to authenticated using (
  recipient_id = app_current_activist_code()::text
);
create policy notifications_insert on public.notifications for insert to authenticated with check (true);
create policy notifications_update on public.notifications for update to authenticated using (
  recipient_id = app_current_activist_code()::text
);

drop policy if exists authenticated_all on public.notification_reads;
drop policy if exists notification_reads_all on public.notification_reads;
create policy notification_reads_all on public.notification_reads for all to authenticated using (
  recipient_id = app_current_activist_code()::text
) with check (
  recipient_id = app_current_activist_code()::text
);

-- ============================================================
-- tours — פעילות משותפת בפרויקט (לא אישית) — select מוגבל לחברי הפרויקט בלבד.
-- insert/update/delete כבר לא היו פתוחים ל-authenticated (רק service role דרך ה-API), לא נוגעים בזה.
-- ============================================================
drop policy if exists tours_select_authenticated on public.tours;
drop policy if exists tours_select on public.tours;
create policy tours_select on public.tours for select to authenticated using (
  app_current_role() = 'ceo' or project_id = any(app_current_project_ids())
);

-- ============================================================
-- אימות אחרי הרצה — אמור להחזיר את המדיניות החדשות בלבד (בלי authenticated_all) בטבלאות שבהיקף:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public'
--     and tablename in ('contacts','interactions','expenses','base_meeting_reports',
--                       'profiles','notifications','notification_reads','tours')
--   order by tablename, policyname;
-- ============================================================
