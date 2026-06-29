-- 0006_notification_reads.sql — מצב "נקרא" cross-device לכל התראה (כולל generated/דמו).
-- בעיה שנפתרה: התראות generated אין להן רשומה ב-notifications, ולכן לא ניתן היה לסמן אותן כנקראות.
-- כאן: סט מזהי-נקרא לפי (recipient_id, client_id). lib/notificationDemo.js כותב/קורא;
-- getNotificationsForUser מכבד את הסט; hydrate ממזג חזרה ל-localStorage בכניסה.
--
-- הרצה:
--   dev:  psql "$DEV_DB_URL" -f migrations/0006_notification_reads.sql
--   prod: הדבק ב-Supabase SQL Editor (פרויקט crm-mekarvim) — בכוונה ידנית, לא אוטומטי.
create table if not exists public.notification_reads (
  recipient_id text not null,
  client_id    text not null,
  read_at      timestamptz not null default now(),
  primary key (recipient_id, client_id)
);
create index if not exists notification_reads_recipient_idx on public.notification_reads(recipient_id);

alter table public.notification_reads enable row level security;
drop policy if exists authenticated_all on public.notification_reads;
create policy authenticated_all on public.notification_reads for all to authenticated using (true) with check (true);
