-- 0018_security_foundation.sql
-- Security hardening foundation. Idempotent DDL only; do not run on a live
-- project until the G5 backup, review and isolated-environment gate is approved.

begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

alter table public.profiles
  add column if not exists global_role text,
  add column if not exists security_version integer not null default 1,
  add column if not exists disabled_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_global_role_check'
  ) then
    alter table public.profiles add constraint profiles_global_role_check
      check (global_role is null or global_role = 'ceo');
  end if;
end $$;

update public.profiles set global_role = 'ceo'
where role = 'ceo' and global_role is null;

create table if not exists public.project_memberships (
  project_id integer not null references public.projects(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('head', 'coord', 'activist', 'finance')),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

insert into public.project_memberships (project_id, user_id, role)
select distinct project_id, id, role
from (
  select p.id, p.role, unnest(
    case
      when coalesce(cardinality(p.project_ids), 0) > 0 then p.project_ids
      when p.project_id is not null then array[p.project_id]
      else array[]::integer[]
    end
  ) as project_id
  from public.profiles p
  where p.role in ('head', 'coord', 'activist', 'finance')
) memberships
on conflict (project_id, user_id) do update
set role = excluded.role, updated_at = now();

create table if not exists app_private.auth_identities (
  normalized_username text primary key
    check (normalized_username = lower(btrim(normalized_username))),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  login_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if exists (
    select lower(btrim(name)) from public.profiles
    where nullif(btrim(name), '') is not null
    group by lower(btrim(name)) having count(*) > 1
  ) then
    raise exception 'security identity backfill refused: duplicate normalized username';
  end if;
end $$;

insert into app_private.auth_identities (normalized_username, auth_user_id, login_email)
select lower(btrim(p.name)), p.id, u.email
from public.profiles p
join auth.users u on u.id = p.id
where nullif(btrim(p.name), '') is not null and u.email is not null
on conflict (normalized_username) do update
set auth_user_id = excluded.auth_user_id,
    login_email = excluded.login_email,
    updated_at = now();

create table if not exists app_private.auth_sessions (
  session_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_key_version integer not null,
  csrf_hash text not null,
  aal smallint not null check (aal in (1, 2)),
  security_version integer not null,
  auth_state text not null check (auth_state in ('active', 'mfa_required', 'recovery')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text
);

create table if not exists app_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id),
  effective_role text,
  project_id integer references public.projects(id),
  action text not null,
  resource_type text not null,
  resource_id text,
  result text not null check (result in ('success', 'denied', 'failed')),
  reason_code text,
  correlation_id uuid,
  session_ref text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table if not exists app_private.rate_limit_buckets (
  bucket_hash text primary key,
  window_started_at timestamptz not null,
  count integer not null check (count >= 0),
  blocked_until timestamptz,
  expires_at timestamptz not null
);

create index if not exists auth_sessions_expiry_idx
  on app_private.auth_sessions (absolute_expires_at) where revoked_at is null;
create index if not exists audit_events_actor_time_idx
  on app_private.audit_events (actor_user_id, occurred_at desc);
create index if not exists rate_limit_expiry_idx
  on app_private.rate_limit_buckets (expires_at);

alter table public.contacts add column if not exists assigned_user_id uuid references auth.users(id);
alter table public.interactions add column if not exists actor_user_id uuid references auth.users(id);
alter table public.base_meeting_reports add column if not exists actor_user_id uuid references auth.users(id);
alter table public.expenses add column if not exists actor_user_id uuid references auth.users(id);
alter table public.feedback_reports add column if not exists reporter_user_id uuid references auth.users(id);
alter table public.notifications add column if not exists recipient_user_id uuid references auth.users(id);
alter table public.notification_reads add column if not exists recipient_user_id uuid references auth.users(id);
alter table public.meeting_reminders add column if not exists recipient_user_id uuid references auth.users(id);
alter table public.push_subscriptions add column if not exists user_id uuid references auth.users(id);
alter table public.fcm_tokens add column if not exists user_id uuid references auth.users(id);
alter table public.tours
  add column if not exists guide_user_id uuid references auth.users(id),
  add column if not exists host_user_id uuid references auth.users(id),
  add column if not exists assigned_user_ids uuid[] not null default '{}';

update public.contacts c set assigned_user_id = p.id
from public.profiles p
where c.activist_id = p.activist_code and c.assigned_user_id is null;
update public.interactions i set actor_user_id = p.id
from public.profiles p
where i.activist_id = p.activist_code and i.actor_user_id is null;
update public.base_meeting_reports r set actor_user_id = p.id
from public.profiles p
where r.activist_id = p.activist_code and r.actor_user_id is null;
update public.expenses e set actor_user_id = p.id
from public.profiles p
where e.activist_id = p.activist_code and e.actor_user_id is null;
update public.feedback_reports f set reporter_user_id = p.id
from public.profiles p
where f.reporter_id = p.activist_code and f.reporter_user_id is null;
update public.notifications n set recipient_user_id = p.id
from public.profiles p
where n.recipient_id = p.activist_code::text and n.recipient_user_id is null;
update public.notification_reads n set recipient_user_id = p.id
from public.profiles p
where n.recipient_id = p.activist_code::text and n.recipient_user_id is null;
update public.meeting_reminders r set recipient_user_id = p.id
from public.profiles p
where (case when r.type = 'coordinator' then r.coordinator_id else r.activist_id end) = p.activist_code::text
  and r.recipient_user_id is null;
update public.push_subscriptions s set user_id = p.id
from public.profiles p
where s.activist_id = p.activist_code::text and s.user_id is null;
update public.fcm_tokens f set user_id = p.id
from public.profiles p
where f.activist_id = p.activist_code::text and f.user_id is null;
update public.tours t set guide_user_id = p.id
from public.profiles p
where t.guide_activist_id = p.activist_code and t.guide_user_id is null;
update public.tours t set host_user_id = p.id
from public.profiles p
where t.host_activist_id = p.activist_code and t.host_user_id is null;
update public.tours t
set assigned_user_ids = coalesce((
  select array_agg(p.id order by p.id)
  from public.profiles p
  where p.activist_code = any(t.assigned_activists)
), '{}'::uuid[])
where coalesce(cardinality(t.assigned_activists), 0) > 0
  and coalesce(cardinality(t.assigned_user_ids), 0) = 0;

do $$ begin
  if exists (select 1 from public.contacts where activist_id is not null and assigned_user_id is null)
    then raise exception 'security backfill refused: contacts owner mapping missing'; end if;
  if exists (select 1 from public.interactions where activist_id is not null and actor_user_id is null)
    then raise exception 'security backfill refused: interactions owner mapping missing'; end if;
  if exists (select 1 from public.base_meeting_reports where activist_id is not null and actor_user_id is null)
    then raise exception 'security backfill refused: base_meeting_reports owner mapping missing'; end if;
  if exists (select 1 from public.expenses where activist_id is not null and actor_user_id is null)
    then raise exception 'security backfill refused: expenses owner mapping missing'; end if;
  if exists (select 1 from public.feedback_reports where reporter_id is not null and reporter_user_id is null)
    then raise exception 'security backfill refused: feedback_reports owner mapping missing'; end if;
  if exists (select 1 from public.notifications where recipient_id is not null and recipient_user_id is null)
    then raise exception 'security backfill refused: notifications recipient mapping missing'; end if;
  if exists (select 1 from public.notification_reads where recipient_id is not null and recipient_user_id is null)
    then raise exception 'security backfill refused: notification_reads recipient mapping missing'; end if;
  if exists (select 1 from public.meeting_reminders where recipient_user_id is null)
    then raise exception 'security backfill refused: meeting_reminders recipient mapping missing'; end if;
  if exists (select 1 from public.push_subscriptions where activist_id is not null and user_id is null)
    then raise exception 'security backfill refused: push_subscriptions owner mapping missing'; end if;
  if exists (select 1 from public.fcm_tokens where activist_id is not null and user_id is null)
    then raise exception 'security backfill refused: fcm_tokens owner mapping missing'; end if;
  if exists (select 1 from public.tours where guide_activist_id is not null and guide_user_id is null)
    then raise exception 'security backfill refused: tours guide mapping missing'; end if;
  if exists (select 1 from public.tours where host_activist_id is not null and host_user_id is null)
    then raise exception 'security backfill refused: tours host mapping missing'; end if;
  if exists (
    select 1 from public.tours t, unnest(t.assigned_activists) legacy_code
    where not exists (select 1 from public.profiles p where p.activist_code = legacy_code)
  ) then raise exception 'security backfill refused: tours assigned mapping missing'; end if;
end $$;

create index if not exists contacts_assigned_user_idx on public.contacts(project_id, assigned_user_id);
create index if not exists interactions_actor_user_idx on public.interactions(project_id, actor_user_id);
create index if not exists base_meeting_reports_actor_user_idx on public.base_meeting_reports(project_id, actor_user_id);
create index if not exists expenses_actor_user_idx on public.expenses(project_id, actor_user_id);
create index if not exists feedback_reports_reporter_user_idx on public.feedback_reports(project_id, reporter_user_id);
create index if not exists notifications_recipient_user_idx on public.notifications(recipient_user_id, created_at desc);
create index if not exists meeting_reminders_recipient_user_idx on public.meeting_reminders(recipient_user_id, remind_at);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index if not exists fcm_tokens_user_idx on public.fcm_tokens(user_id);

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;

commit;
