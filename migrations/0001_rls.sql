-- 0001_rls.sql
-- סגירת גישה אנונימית (ציבורית) לכל הנתונים.
-- מפעיל RLS על כל טבלה בסכמת public ומתיר רק למשתמשים מחוברים (authenticated = צוות פנימי).
-- ה-API routes משתמשים ב-service_role שעוקף RLS אוטומטית, כך שכתיבות-שרת לא נשברות.
-- ההתחברות עצמה (supabase.auth) לא מושפעת מ-RLS על טבלאות.

-- 1) כל הטבלאות: הפעלת RLS + policy מתירני למשתמש מחובר (כל הפעולות).
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', r.tablename);
    execute format('drop policy if exists authenticated_all on public.%I;', r.tablename);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true);',
      r.tablename
    );
  end loop;
end $$;

-- 2) Views: לגרום להם לכבד את ה-RLS של הקורא, כדי ש-anon לא יקרא דרכם (למשל activist_directory).
do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('alter view public.%I set (security_invoker = on);', v.table_name);
  end loop;
end $$;
