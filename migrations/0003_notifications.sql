-- 0003_notifications.sql — התראות מגובות-Supabase (cross-device). הורץ דרך ה-SQL Editor 2026-06-25.
-- dual-write מ-lib/notificationDemo.js (upsert לפי client_id), hydrate ל-localStorage בכניסה.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id text not null,
  type text not null,
  title text not null,
  body text,
  url text,
  priority text default 'normal',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, created_at desc);
-- מפתח dedup להתראות שנוצרות באירוע (id דטרמיניסטי מהאפליקציה).
alter table public.notifications add column if not exists client_id text;
create unique index if not exists notifications_client_id_key on public.notifications(client_id);
alter table public.notifications enable row level security;
drop policy if exists authenticated_all on public.notifications;
create policy authenticated_all on public.notifications for all to authenticated using (true) with check (true);
