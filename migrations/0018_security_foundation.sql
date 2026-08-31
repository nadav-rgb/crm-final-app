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
  project_id integer,
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

-- Compatibility is a maintained database invariant until the numeric authority
-- columns are removed. A write may supply either representation, but supplying
-- both with different identities is always rejected. These trigger functions are
-- private, fixed-search-path SECURITY DEFINER routines so forced RLS cannot make
-- validation depend on the caller and there is no caller-settable bypass flag.
create or replace function app_private.sync_identity_pair()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_uuid_column text := tg_argv[0];
  v_legacy_column text := tg_argv[1];
  v_new_json jsonb := to_jsonb(new);
  v_old_json jsonb;
  v_new_uuid uuid;
  v_new_legacy text;
  v_uuid_changed boolean := false;
  v_legacy_changed boolean := false;
  v_resolved_uuid uuid;
  v_resolved_code integer;
begin
  if tg_nargs <> 2 then
    raise exception 'identity pair trigger is misconfigured' using errcode = '23514';
  end if;

  v_new_uuid := nullif(v_new_json ->> v_uuid_column, '')::uuid;
  v_new_legacy := nullif(btrim(v_new_json ->> v_legacy_column), '');
  if tg_op = 'UPDATE' then
    v_old_json := to_jsonb(old);
    v_uuid_changed := (v_new_json -> v_uuid_column)
      is distinct from (v_old_json -> v_uuid_column);
    v_legacy_changed := (v_new_json -> v_legacy_column)
      is distinct from (v_old_json -> v_legacy_column);

    if v_uuid_changed and v_legacy_changed
       and ((v_new_uuid is null) <> (v_new_legacy is null)) then
      raise exception 'identity pair divergence: %.%/%',
        tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
    end if;
  end if;

  if v_new_uuid is null and v_new_legacy is null then
    return jsonb_populate_record(
      new, jsonb_build_object(v_uuid_column, null, v_legacy_column, null)
    );
  end if;

  if tg_op = 'UPDATE' and v_uuid_changed and not v_legacy_changed then
    if v_new_uuid is null then
      return jsonb_populate_record(
        new, jsonb_build_object(v_uuid_column, null, v_legacy_column, null)
      );
    end if;
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p
    where p.id = v_new_uuid and p.activist_code is not null;
  elsif tg_op = 'UPDATE' and v_legacy_changed and not v_uuid_changed then
    if v_new_legacy is null then
      return jsonb_populate_record(
        new, jsonb_build_object(v_uuid_column, null, v_legacy_column, null)
      );
    end if;
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p
    where p.activist_code::text = v_new_legacy;
  elsif v_new_uuid is not null then
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p
    where p.id = v_new_uuid and p.activist_code is not null;
  else
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p
    where p.activist_code::text = v_new_legacy;
  end if;

  if not found or v_resolved_uuid is null or v_resolved_code is null then
    raise exception 'identity pair mapping missing: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;
  if v_new_uuid is not null
     and not (tg_op = 'UPDATE' and v_legacy_changed and not v_uuid_changed)
     and v_new_uuid is distinct from v_resolved_uuid then
    raise exception 'identity pair divergence: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;
  if v_new_legacy is not null
     and not (tg_op = 'UPDATE' and v_uuid_changed and not v_legacy_changed)
     and v_new_legacy is distinct from v_resolved_code::text then
    raise exception 'identity pair divergence: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;

  return jsonb_populate_record(new, jsonb_build_object(
    v_uuid_column, v_resolved_uuid,
    v_legacy_column, v_resolved_code
  ));
end $$;

create or replace function app_private.sync_identity_array_pair()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_uuid_column text := tg_argv[0];
  v_legacy_column text := tg_argv[1];
  v_new_json jsonb := to_jsonb(new);
  v_old_json jsonb;
  v_uuid_json jsonb;
  v_legacy_json jsonb;
  v_uuid_changed boolean := false;
  v_legacy_changed boolean := false;
  v_uuid_count integer;
  v_legacy_count integer;
  v_uuid_mapped integer;
  v_legacy_mapped integer;
  v_from_uuid_users uuid[];
  v_from_uuid_codes integer[];
  v_from_legacy_users uuid[];
  v_from_legacy_codes integer[];
  v_final_users uuid[];
  v_final_codes integer[];
begin
  if tg_nargs <> 2 then
    raise exception 'identity array trigger is misconfigured' using errcode = '23514';
  end if;
  v_uuid_json := coalesce(v_new_json -> v_uuid_column, '[]'::jsonb);
  v_legacy_json := coalesce(v_new_json -> v_legacy_column, '[]'::jsonb);
  if jsonb_typeof(v_uuid_json) <> 'array' or jsonb_typeof(v_legacy_json) <> 'array' then
    raise exception 'identity array divergence: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;

  v_uuid_count := jsonb_array_length(v_uuid_json);
  v_legacy_count := jsonb_array_length(v_legacy_json);
  if v_uuid_count > 100 or v_legacy_count > 100
     or exists (
       select 1 from jsonb_array_elements_text(v_uuid_json) requested(value)
       where value is null
     )
     or exists (
       select 1 from jsonb_array_elements_text(v_legacy_json) requested(value)
       where value is null
     )
     or (select count(distinct value) from jsonb_array_elements_text(v_uuid_json) requested(value))
       <> v_uuid_count
     or (select count(distinct value) from jsonb_array_elements_text(v_legacy_json) requested(value))
       <> v_legacy_count then
    raise exception 'identity array divergence: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[]),
         coalesce(array_agg(p.activist_code order by p.id), '{}'::integer[]),
         count(*)::integer
    into v_from_uuid_users, v_from_uuid_codes, v_uuid_mapped
  from jsonb_array_elements_text(v_uuid_json) requested(user_id)
  join public.profiles p on p.id = requested.user_id::uuid
  where p.activist_code is not null;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[]),
         coalesce(array_agg(p.activist_code order by p.id), '{}'::integer[]),
         count(*)::integer
    into v_from_legacy_users, v_from_legacy_codes, v_legacy_mapped
  from jsonb_array_elements_text(v_legacy_json) requested(activist_code)
  join public.profiles p on p.activist_code::text = requested.activist_code;

  if v_uuid_mapped <> v_uuid_count or v_legacy_mapped <> v_legacy_count then
    raise exception 'identity array mapping missing: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    v_old_json := to_jsonb(old);
    v_uuid_changed := (v_new_json -> v_uuid_column)
      is distinct from (v_old_json -> v_uuid_column);
    v_legacy_changed := (v_new_json -> v_legacy_column)
      is distinct from (v_old_json -> v_legacy_column);
  end if;

  if v_uuid_count > 0 and v_legacy_count > 0
     and not (tg_op = 'UPDATE' and v_uuid_changed <> v_legacy_changed)
     and v_from_uuid_users is distinct from v_from_legacy_users then
    raise exception 'identity array divergence: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and v_uuid_changed and v_legacy_changed
     and ((v_uuid_count = 0) <> (v_legacy_count = 0)) then
    raise exception 'identity array divergence: %.%/%',
      tg_table_name, v_uuid_column, v_legacy_column using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and v_legacy_changed and not v_uuid_changed then
    v_final_users := v_from_legacy_users;
    v_final_codes := v_from_legacy_codes;
  elsif v_uuid_count > 0 or (tg_op = 'UPDATE' and v_uuid_changed) then
    v_final_users := v_from_uuid_users;
    v_final_codes := v_from_uuid_codes;
  else
    v_final_users := v_from_legacy_users;
    v_final_codes := v_from_legacy_codes;
  end if;

  return jsonb_populate_record(new, jsonb_build_object(
    v_uuid_column, to_jsonb(v_final_users),
    v_legacy_column, to_jsonb(v_final_codes)
  ));
end $$;

create or replace function app_private.sync_meeting_reminder_identity()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_new_json jsonb := to_jsonb(new);
  v_old_json jsonb;
  v_legacy_column text;
  v_unused_column text;
  v_new_uuid uuid;
  v_new_legacy text;
  v_uuid_changed boolean := false;
  v_legacy_changed boolean := false;
  v_resolved_uuid uuid;
  v_resolved_code integer;
begin
  if new.type = 'coordinator' then
    v_legacy_column := 'coordinator_id';
    v_unused_column := 'activist_id';
  else
    v_legacy_column := 'activist_id';
    v_unused_column := 'coordinator_id';
  end if;
  if nullif(btrim(v_new_json ->> v_unused_column), '') is not null then
    raise exception 'identity pair divergence: meeting_reminders.recipient_user_id/%',
      v_legacy_column using errcode = '23514';
  end if;

  v_new_uuid := nullif(v_new_json ->> 'recipient_user_id', '')::uuid;
  v_new_legacy := nullif(btrim(v_new_json ->> v_legacy_column), '');
  if tg_op = 'UPDATE' then
    v_old_json := to_jsonb(old);
    if (v_new_json ->> 'type') is distinct from (v_old_json ->> 'type') then
      raise exception 'identity pair divergence: meeting_reminders recipient type'
        using errcode = '23514';
    end if;
    v_uuid_changed := (v_new_json -> 'recipient_user_id')
      is distinct from (v_old_json -> 'recipient_user_id');
    v_legacy_changed := (v_new_json -> v_legacy_column)
      is distinct from (v_old_json -> v_legacy_column);
    if v_uuid_changed and v_legacy_changed
       and ((v_new_uuid is null) <> (v_new_legacy is null)) then
      raise exception 'identity pair divergence: meeting_reminders.recipient_user_id/%',
        v_legacy_column using errcode = '23514';
    end if;
  end if;

  if v_new_uuid is null and v_new_legacy is null then
    raise exception 'identity pair mapping missing: meeting_reminders.recipient_user_id/%',
      v_legacy_column using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and v_uuid_changed and not v_legacy_changed then
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p where p.id = v_new_uuid and p.activist_code is not null;
  elsif tg_op = 'UPDATE' and v_legacy_changed and not v_uuid_changed then
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p where p.activist_code::text = v_new_legacy;
  elsif v_new_uuid is not null then
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p where p.id = v_new_uuid and p.activist_code is not null;
  else
    select p.id, p.activist_code into v_resolved_uuid, v_resolved_code
    from public.profiles p where p.activist_code::text = v_new_legacy;
  end if;
  if not found or v_resolved_uuid is null or v_resolved_code is null then
    raise exception 'identity pair mapping missing: meeting_reminders.recipient_user_id/%',
      v_legacy_column using errcode = '23514';
  end if;
  if (v_new_uuid is not null
      and not (tg_op = 'UPDATE' and v_legacy_changed and not v_uuid_changed)
      and v_new_uuid is distinct from v_resolved_uuid)
     or (v_new_legacy is not null
      and not (tg_op = 'UPDATE' and v_uuid_changed and not v_legacy_changed)
      and v_new_legacy is distinct from v_resolved_code::text) then
    raise exception 'identity pair divergence: meeting_reminders.recipient_user_id/%',
      v_legacy_column using errcode = '23514';
  end if;
  return jsonb_populate_record(new, jsonb_build_object(
    'recipient_user_id', v_resolved_uuid,
    v_legacy_column, v_resolved_code,
    v_unused_column, null
  ));
end $$;

revoke all on function app_private.sync_identity_pair() from public, anon, authenticated;
revoke all on function app_private.sync_identity_array_pair() from public, anon, authenticated;
revoke all on function app_private.sync_meeting_reminder_identity() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_identity_pair_chk') then
    alter table public.contacts add constraint contacts_identity_pair_chk
      check ((assigned_user_id is null) = (activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'interactions_identity_pair_chk') then
    alter table public.interactions add constraint interactions_identity_pair_chk
      check ((actor_user_id is null) = (activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'base_meeting_reports_identity_pair_chk') then
    alter table public.base_meeting_reports add constraint base_meeting_reports_identity_pair_chk
      check ((actor_user_id is null) = (activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_identity_pair_chk') then
    alter table public.expenses add constraint expenses_identity_pair_chk
      check ((actor_user_id is null) = (activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_reports_identity_pair_chk') then
    alter table public.feedback_reports add constraint feedback_reports_identity_pair_chk
      check ((reporter_user_id is null) = (reporter_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_identity_pair_chk') then
    alter table public.notifications add constraint notifications_identity_pair_chk
      check ((recipient_user_id is null) = (recipient_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_reads_identity_pair_chk') then
    alter table public.notification_reads add constraint notification_reads_identity_pair_chk
      check ((recipient_user_id is null) = (recipient_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meeting_reminders_identity_pair_chk') then
    alter table public.meeting_reminders add constraint meeting_reminders_identity_pair_chk check (
      recipient_user_id is not null and (
        (type = 'coordinator' and coordinator_id is not null and activist_id is null)
        or (type <> 'coordinator' and activist_id is not null and coordinator_id is null)
      )
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_identity_pair_chk') then
    alter table public.push_subscriptions add constraint push_subscriptions_identity_pair_chk
      check ((user_id is null) = (activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fcm_tokens_identity_pair_chk') then
    alter table public.fcm_tokens add constraint fcm_tokens_identity_pair_chk
      check ((user_id is null) = (activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tours_guide_identity_pair_chk') then
    alter table public.tours add constraint tours_guide_identity_pair_chk
      check ((guide_user_id is null) = (guide_activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tours_host_identity_pair_chk') then
    alter table public.tours add constraint tours_host_identity_pair_chk
      check ((host_user_id is null) = (host_activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tours_assignment_identity_pair_chk') then
    alter table public.tours add constraint tours_assignment_identity_pair_chk
      check (cardinality(assigned_user_ids) = cardinality(assigned_activists)) not valid;
  end if;
end $$;

alter table public.contacts validate constraint contacts_identity_pair_chk;
alter table public.interactions validate constraint interactions_identity_pair_chk;
alter table public.base_meeting_reports validate constraint base_meeting_reports_identity_pair_chk;
alter table public.expenses validate constraint expenses_identity_pair_chk;
alter table public.feedback_reports validate constraint feedback_reports_identity_pair_chk;
alter table public.notifications validate constraint notifications_identity_pair_chk;
alter table public.notification_reads validate constraint notification_reads_identity_pair_chk;
alter table public.meeting_reminders validate constraint meeting_reminders_identity_pair_chk;
alter table public.push_subscriptions validate constraint push_subscriptions_identity_pair_chk;
alter table public.fcm_tokens validate constraint fcm_tokens_identity_pair_chk;
alter table public.tours validate constraint tours_guide_identity_pair_chk;
alter table public.tours validate constraint tours_host_identity_pair_chk;
alter table public.tours validate constraint tours_assignment_identity_pair_chk;

drop trigger if exists sync_contacts_identity on public.contacts;
create trigger sync_contacts_identity before insert or update on public.contacts for each row
  execute function app_private.sync_identity_pair('assigned_user_id', 'activist_id');
drop trigger if exists sync_interactions_identity on public.interactions;
create trigger sync_interactions_identity before insert or update on public.interactions for each row
  execute function app_private.sync_identity_pair('actor_user_id', 'activist_id');
drop trigger if exists sync_base_meeting_reports_identity on public.base_meeting_reports;
create trigger sync_base_meeting_reports_identity before insert or update on public.base_meeting_reports for each row
  execute function app_private.sync_identity_pair('actor_user_id', 'activist_id');
drop trigger if exists sync_expenses_identity on public.expenses;
create trigger sync_expenses_identity before insert or update on public.expenses for each row
  execute function app_private.sync_identity_pair('actor_user_id', 'activist_id');
drop trigger if exists sync_feedback_reports_identity on public.feedback_reports;
create trigger sync_feedback_reports_identity before insert or update on public.feedback_reports for each row
  execute function app_private.sync_identity_pair('reporter_user_id', 'reporter_id');
drop trigger if exists sync_notifications_identity on public.notifications;
create trigger sync_notifications_identity before insert or update on public.notifications for each row
  execute function app_private.sync_identity_pair('recipient_user_id', 'recipient_id');
drop trigger if exists sync_notification_reads_identity on public.notification_reads;
create trigger sync_notification_reads_identity before insert or update on public.notification_reads for each row
  execute function app_private.sync_identity_pair('recipient_user_id', 'recipient_id');
drop trigger if exists sync_meeting_reminders_identity on public.meeting_reminders;
create trigger sync_meeting_reminders_identity before insert or update on public.meeting_reminders for each row
  execute function app_private.sync_meeting_reminder_identity();
drop trigger if exists sync_push_subscriptions_identity on public.push_subscriptions;
create trigger sync_push_subscriptions_identity before insert or update on public.push_subscriptions for each row
  execute function app_private.sync_identity_pair('user_id', 'activist_id');
drop trigger if exists sync_fcm_tokens_identity on public.fcm_tokens;
create trigger sync_fcm_tokens_identity before insert or update on public.fcm_tokens for each row
  execute function app_private.sync_identity_pair('user_id', 'activist_id');
drop trigger if exists sync_tours_guide_identity on public.tours;
create trigger sync_tours_guide_identity before insert or update on public.tours for each row
  execute function app_private.sync_identity_pair('guide_user_id', 'guide_activist_id');
drop trigger if exists sync_tours_host_identity on public.tours;
create trigger sync_tours_host_identity before insert or update on public.tours for each row
  execute function app_private.sync_identity_pair('host_user_id', 'host_activist_id');
drop trigger if exists sync_tours_identity on public.tours;
create trigger sync_tours_identity before insert or update on public.tours for each row
  execute function app_private.sync_identity_array_pair('assigned_user_ids', 'assigned_activists');

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
