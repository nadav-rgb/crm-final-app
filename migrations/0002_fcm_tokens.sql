-- migrations/0002_fcm_tokens.sql
-- טבלת FCM tokens למכשירי אפליקציית Capacitor (push נייטיב).
-- להריץ דרך תוסף Claude / Supabase SQL Editor (כמו 0001_rls.sql).
-- מקבילה ל-push_subscriptions (web-push). השרת ניגש דרך service role (עוקף RLS).

create table if not exists public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  activist_id text not null,
  token text not null unique,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);

create index if not exists fcm_tokens_activist_idx on public.fcm_tokens(activist_id);

-- RLS פעיל בלי policies → anon/authenticated מקבלים 0 שורות.
-- רק service role (השרת) ניגש. תואם למודל האבטחה הקיים.
alter table public.fcm_tokens enable row level security;
