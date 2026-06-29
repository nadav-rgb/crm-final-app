-- 0005_video_friendly_rate.sql — תעריף ל"וידאו ידידותי" (No-Hard-Coding).
-- מוסיף עמודה rate_video_friendly לטבלת payment_config (שורה יחידה id=1), ברירת מחדל 200.
-- הוספת עמודה עם default ממלאת את השורה הקיימת אוטומטית; ה-update מפורש לשקיפות.
--
-- הרצה:
--   dev:  psql "$DEV_DB_URL" -f migrations/0005_video_friendly_rate.sql
--   prod: הדבק ב-Supabase SQL Editor (פרויקט crm-mekarvim) — בכוונה ידנית, לא אוטומטי.
alter table public.payment_config
  add column if not exists rate_video_friendly int not null default 200;

-- seed/ודא ערך לשורה id=1 (idempotent; אם כבר 200 — ללא שינוי)
update public.payment_config set rate_video_friendly = 200 where id = 1;
