-- migrations/0026_activist_directory_hide_deleted.sql
-- הורץ דרך ה-SQL Editor 2026-09-06
-- עדכון activist_directory: מסתיר פעילים שנמחקו-רכות (0025), חושף is_active/deleted_at.
-- ⚠️ להריץ רק אחרי 0025 (עמודות is_active/deleted_at ב-profiles).
--
-- הגדרת ה-view הנוכחית (אומתה מול ה-DB ב-2026-09-06):
--   SELECT activist_code, name, role, project_id, project_ids FROM profiles;
--
-- security_invoker=on הוגדר על כל ה-views ב-0001_rls.sql כדי ש-anon לא "יקרא דרכם" —
-- מצוין כאן שוב במפורש כדי לא להסתמך על CREATE OR REPLACE VIEW לשמר reloption קיים.
create or replace view public.activist_directory
with (security_invoker = on) as
select activist_code, name, role, project_id, project_ids, is_active, deleted_at
from public.profiles
where is_active = true;
