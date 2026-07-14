-- migrations/0015_participants_reports_project_notification_recipients.sql
--
-- שלושה תיקונים במיגרציה אחת — להרצה ב-Supabase SQL Editor לפני פריסת הקוד:
-- (א) עמודת participants ב-interactions — שמות משתתפים במפגש רב-משתתפים ומונה לקוחות באירוח שבת.
-- (ב) השלמת project_id לדיווחי מפגשי-בסיס ישנים שנשמרו NULL — בלעדיו RLS (0013) מסתיר אותם מרכזים.
-- (ג) RPC לנמעני התראות — עוקף את בידוד profiles כדי שפעיל יוכל ליצור התראות למנהלים/רכזים.

-- (א) משתתפים בקשר — מפגש רב משתתפים (שמות) ואירוח שבת (מונה לקוחות)
-- מבנה: { "count": 12, "clients": [{"id":123,"name":"..."}], "external": ["..."] }
-- השמות משוכפלים גם לתוך notes לתצוגה מיידית; העמודה היא המקור המובנה לדוחות.
-- אין שינוי RLS — העמודה יורשת את מדיניות interactions הקיימת.
alter table public.interactions
  add column if not exists participants jsonb;

-- (ב) השלמת project_id לדיווחי מפגשי-בסיס ישנים (נשמרו NULL — לכן RLS הסתיר אותם מרכזים)
update public.base_meeting_reports r
   set project_id = h.project_id
  from public.meeting_houses h
 where r.project_id is null
   and h.project_id is not null
   and r.house_id::text = h.id::text;   -- ::text כי meeting_houses.id נשמר כ-String

-- עוגן: דיווחי בסיס = אחדות יהודית (project 1) לשורות ללא בית תואם (בתי דמו מקומיים)
update public.base_meeting_reports set project_id = 1 where project_id is null;

-- (ג) נמעני-התראות: security definer עוקף את בידוד profiles (שבגללו כיום שאילתת
-- המנהלים מסשן של פעיל מחזירה ריק והתראות-מנהל מתות). חושף רק code/name/role של בעלי-תפקיד.
create or replace function public.app_notification_recipients(target_project int)
returns table(activist_code int, name text, role text)
language sql stable security definer set search_path = public as $$
  select activist_code, name, role
    from public.profiles
   where activist_code is not null
     and (
       role = 'ceo'
       or (role in ('coord','head','finance')
           and target_project = any(coalesce(
                 nullif(project_ids, '{}'),
                 case when project_id is not null then array[project_id] else array[]::int[] end)))
     )
$$;
grant execute on function public.app_notification_recipients(int) to authenticated;
