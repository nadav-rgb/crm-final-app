-- Security RPCs for opaque server sessions, shared rate limits and privileged
-- workflows. File-only until the approved G5 isolated-test migration gate.

begin;

alter table app_private.auth_sessions
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists idle_timeout_seconds integer not null default 28800
    check (idle_timeout_seconds between 60 and 28800);

create or replace function public.app_session_create(
  p_session_hash text, p_user_id uuid, p_encrypted_access_token text,
  p_encrypted_refresh_token text, p_token_key_version integer,
  p_access_token_expires_at timestamptz, p_csrf_hash text, p_aal smallint,
  p_security_version integer, p_auth_state text, p_created_at timestamptz,
  p_idle_timeout_seconds integer, p_idle_expires_at timestamptz,
  p_absolute_expires_at timestamptz
) returns void
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if p_session_hash !~ '^[A-Za-z0-9_-]{43}$'
     or length(p_encrypted_access_token) not between 20 and 16384
     or length(p_encrypted_refresh_token) not between 20 and 16384
     or p_token_key_version < 1
     or p_csrf_hash !~ '^[A-Za-z0-9_-]{43}$'
     or p_aal not in (1, 2)
     or p_security_version < 1
     or p_auth_state not in ('active', 'mfa_required', 'recovery')
     or p_idle_timeout_seconds not between 60 and 28800
     or p_idle_expires_at <= p_created_at
     or p_absolute_expires_at <= p_idle_expires_at
     or p_created_at < now() - interval '5 minutes'
     or p_created_at > now() + interval '1 minute' then
    raise exception 'invalid security session input' using errcode = '22023';
  end if;
  insert into app_private.auth_sessions (
    session_hash, user_id, encrypted_access_token, encrypted_refresh_token,
    token_key_version, access_token_expires_at, csrf_hash, aal,
    security_version, auth_state, created_at, last_seen_at,
    idle_timeout_seconds, idle_expires_at, absolute_expires_at
  ) values (
    p_session_hash, p_user_id, p_encrypted_access_token, p_encrypted_refresh_token,
    p_token_key_version, p_access_token_expires_at, p_csrf_hash, p_aal,
    p_security_version, p_auth_state, p_created_at, p_created_at,
    p_idle_timeout_seconds, p_idle_expires_at, p_absolute_expires_at
  );
end $$;

revoke all on function public.app_session_create(text,uuid,text,text,integer,timestamptz,text,smallint,integer,text,timestamptz,integer,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.app_session_create(text,uuid,text,text,integer,timestamptz,text,smallint,integer,text,timestamptz,integer,timestamptz,timestamptz) to service_role;

create or replace function public.app_session_load(p_session_hash text)
returns table (
  session_hash text, user_id uuid, encrypted_access_token text,
  encrypted_refresh_token text, token_key_version integer,
  access_token_expires_at timestamptz, csrf_hash text, aal smallint,
  security_version integer, current_security_version integer,
  disabled_at timestamptz, auth_state text, created_at timestamptz,
  last_seen_at timestamptz, idle_timeout_seconds integer,
  idle_expires_at timestamptz, absolute_expires_at timestamptz,
  revoked_at timestamptz, revoke_reason text
)
language sql stable security definer
set search_path = pg_catalog, public, app_private
as $$
  select s.session_hash, s.user_id, s.encrypted_access_token,
    s.encrypted_refresh_token, s.token_key_version, s.access_token_expires_at,
    s.csrf_hash, s.aal, s.security_version,
    p.security_version as current_security_version, p.disabled_at,
    s.auth_state, s.created_at, s.last_seen_at, s.idle_timeout_seconds,
    s.idle_expires_at, s.absolute_expires_at, s.revoked_at, s.revoke_reason
  from app_private.auth_sessions s
  join public.profiles p on p.id = s.user_id
  where s.session_hash = p_session_hash
  limit 1
$$;

revoke all on function public.app_session_load(text) from public, anon, authenticated;
grant execute on function public.app_session_load(text) to service_role;

create or replace function public.app_session_touch(
  p_session_hash text, p_last_seen_at timestamptz, p_idle_expires_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_updated integer;
begin
  if p_last_seen_at < now() - interval '1 minute'
     or p_last_seen_at > now() + interval '1 minute'
     or p_idle_expires_at <= p_last_seen_at then
    return false;
  end if;
  update app_private.auth_sessions s
  set last_seen_at = now(),
      idle_expires_at = least(
        now() + make_interval(secs => s.idle_timeout_seconds),
        s.absolute_expires_at
      )
  where s.session_hash = p_session_hash
    and s.revoked_at is null
    and s.idle_expires_at > now()
    and s.absolute_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function public.app_session_touch(text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.app_session_touch(text,timestamptz,timestamptz) to service_role;

create or replace function public.app_session_rotate(
  p_old_session_hash text, p_new_session_hash text,
  p_encrypted_access_token text, p_encrypted_refresh_token text,
  p_token_key_version integer, p_access_token_expires_at timestamptz,
  p_csrf_hash text, p_aal smallint, p_security_version integer,
  p_auth_state text, p_created_at timestamptz,
  p_idle_timeout_seconds integer, p_idle_expires_at timestamptz,
  p_absolute_expires_at timestamptz, p_reason text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_old app_private.auth_sessions%rowtype;
begin
  select * into v_old from app_private.auth_sessions
  where session_hash = p_old_session_hash for update;
  if not found or v_old.revoked_at is not null
     or v_old.idle_expires_at <= now() or v_old.absolute_expires_at <= now()
     or p_new_session_hash = p_old_session_hash
     or p_new_session_hash !~ '^[A-Za-z0-9_-]{43}$'
     or p_csrf_hash !~ '^[A-Za-z0-9_-]{43}$'
     or p_security_version <> v_old.security_version
     or p_absolute_expires_at <> v_old.absolute_expires_at
     or length(p_reason) not between 1 and 120 then
    return false;
  end if;
  update app_private.auth_sessions
  set revoked_at = now(), revoke_reason = p_reason
  where session_hash = p_old_session_hash and revoked_at is null;
  insert into app_private.auth_sessions (
    session_hash, user_id, encrypted_access_token, encrypted_refresh_token,
    token_key_version, access_token_expires_at, csrf_hash, aal,
    security_version, auth_state, created_at, last_seen_at,
    idle_timeout_seconds, idle_expires_at, absolute_expires_at
  ) values (
    p_new_session_hash, v_old.user_id, p_encrypted_access_token,
    p_encrypted_refresh_token, p_token_key_version, p_access_token_expires_at,
    p_csrf_hash, p_aal, p_security_version, p_auth_state, p_created_at,
    p_created_at, p_idle_timeout_seconds, p_idle_expires_at,
    p_absolute_expires_at
  );
  return true;
end $$;

revoke all on function public.app_session_rotate(text,text,text,text,integer,timestamptz,text,smallint,integer,text,timestamptz,integer,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.app_session_rotate(text,text,text,text,integer,timestamptz,text,smallint,integer,text,timestamptz,integer,timestamptz,timestamptz,text) to service_role;

create or replace function public.app_session_revoke(p_session_hash text, p_reason text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_updated integer;
begin
  if length(p_reason) not between 1 and 120 then return false; end if;
  update app_private.auth_sessions
  set revoked_at = now(), revoke_reason = p_reason
  where session_hash = p_session_hash and revoked_at is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function public.app_session_revoke(text,text) from public, anon, authenticated;
grant execute on function public.app_session_revoke(text,text) to service_role;

create or replace function public.app_session_refresh_tokens(
  p_session_hash text, p_expected_encrypted_refresh_token text,
  p_encrypted_access_token text, p_encrypted_refresh_token text,
  p_token_key_version integer, p_access_token_expires_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_updated integer;
begin
  update app_private.auth_sessions
  set encrypted_access_token = p_encrypted_access_token,
      encrypted_refresh_token = p_encrypted_refresh_token,
      token_key_version = p_token_key_version,
      access_token_expires_at = p_access_token_expires_at
  where session_hash = p_session_hash
    and encrypted_refresh_token = p_expected_encrypted_refresh_token
    and revoked_at is null
    and idle_expires_at > now()
    and absolute_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function public.app_session_refresh_tokens(text,text,text,text,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.app_session_refresh_tokens(text,text,text,text,integer,timestamptz) to service_role;

create or replace function public.app_rate_limit_consume(
  p_bucket_hash text, p_limit integer, p_window_seconds integer
) returns table (allowed boolean, current_count integer, retry_after_seconds integer)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if p_bucket_hash !~ '^[A-Za-z0-9_-]{43}$'
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit input' using errcode = '22023';
  end if;
  return query
  with bucket as (
    insert into app_private.rate_limit_buckets
      (bucket_hash, window_started_at, count, blocked_until, expires_at)
    values
      (p_bucket_hash, now(), 1, null, now() + make_interval(secs => p_window_seconds * 2))
    on conflict (bucket_hash) do update set
      window_started_at = case
        when app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now()
          then now() else app_private.rate_limit_buckets.window_started_at end,
      count = case
        when app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now()
          then 1 else app_private.rate_limit_buckets.count + 1 end,
      blocked_until = case
        when app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now()
          then null
        when app_private.rate_limit_buckets.count + 1 > p_limit
          then app_private.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds)
          else app_private.rate_limit_buckets.blocked_until end,
      expires_at = now() + make_interval(secs => p_window_seconds * 2)
    returning count, window_started_at, blocked_until
  )
  select bucket.count <= p_limit and coalesce(bucket.blocked_until <= now(), true),
    bucket.count,
    case when bucket.count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (
        bucket.window_started_at + make_interval(secs => p_window_seconds) - now()
      )))::integer) end
  from bucket;
end $$;

revoke all on function public.app_rate_limit_consume(text,integer,integer) from public, anon, authenticated;
grant execute on function public.app_rate_limit_consume(text,integer,integer) to service_role;

create or replace function public.app_audit_append(
  p_actor_user_id uuid, p_effective_role text, p_project_id integer,
  p_action text, p_resource_type text, p_resource_id text, p_result text,
  p_reason_code text, p_correlation_id uuid, p_session_ref text,
  p_metadata jsonb
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_id uuid;
begin
  if length(p_action) not between 1 and 120
     or length(p_resource_type) not between 1 and 80
     or p_result not in ('success', 'denied', 'failed')
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or coalesce(p_metadata, '{}'::jsonb) ?| array[
       'password','token','accessToken','refreshToken','phone','email','notes','message','body'
     ] then
    raise exception 'invalid audit input' using errcode = '22023';
  end if;
  insert into app_private.audit_events (
    actor_user_id, effective_role, project_id, action, resource_type,
    resource_id, result, reason_code, correlation_id, session_ref, metadata
  ) values (
    p_actor_user_id, left(p_effective_role, 40), p_project_id, p_action,
    p_resource_type, left(p_resource_id, 160), p_result,
    left(p_reason_code, 80), p_correlation_id, left(p_session_ref, 64),
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.app_audit_append(uuid,text,integer,text,text,text,text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.app_audit_append(uuid,text,integer,text,text,text,text,text,uuid,text,jsonb) to service_role;

create or replace function public.app_membership_change(
  p_actor_session_hash text, p_actor_user_id uuid, p_target_user_id uuid,
  p_project_id integer, p_role text, p_status text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor_is_ceo boolean := false;
  v_actor_is_head boolean := false;
begin
  if p_role not in ('head','coord','finance','activist')
     or p_status not in ('active','suspended','revoked') then return false; end if;
  select actor.global_role = 'ceo', exists (
    select 1 from public.project_memberships pm
    where pm.user_id = p_actor_user_id and pm.project_id = p_project_id
      and pm.role = 'head' and pm.status = 'active'
  ) into v_actor_is_ceo, v_actor_is_head
  from app_private.auth_sessions s
  join public.profiles actor on actor.id = s.user_id
  where s.session_hash = p_actor_session_hash
    and s.user_id = p_actor_user_id and s.aal = 2
    and s.auth_state = 'active' and s.revoked_at is null
    and s.idle_expires_at > now() and s.absolute_expires_at > now()
    and actor.disabled_at is null
    and actor.security_version = s.security_version;
  if not found or (not v_actor_is_ceo and not v_actor_is_head) then return false; end if;
  if not v_actor_is_ceo and (
    p_target_user_id = p_actor_user_id or p_role not in ('activist','coord')
  ) then return false; end if;
  perform 1 from public.profiles
  where id = p_target_user_id and disabled_at is null for update;
  if not found then return false; end if;
  insert into public.project_memberships (user_id, project_id, role, status)
  values (p_target_user_id, p_project_id, p_role, p_status)
  on conflict (user_id, project_id) do update
  set role = excluded.role, status = excluded.status, updated_at = now();
  update public.profiles set security_version = security_version + 1
  where id = p_target_user_id;
  update app_private.auth_sessions
  set revoked_at = now(), revoke_reason = 'membership_changed'
  where user_id = p_target_user_id and revoked_at is null;
  return true;
end $$;

revoke all on function public.app_membership_change(text,uuid,uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.app_membership_change(text,uuid,uuid,integer,text,text) to service_role;

commit;
