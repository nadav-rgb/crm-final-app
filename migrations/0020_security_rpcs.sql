-- Security RPCs for opaque server sessions, shared rate limits and privileged
-- workflows. File-only until the approved G5 isolated-test migration gate.

begin;

alter table app_private.auth_sessions
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists idle_timeout_seconds integer not null default 28800
    check (idle_timeout_seconds between 60 and 28800),
  add column if not exists mfa_protected boolean not null default false,
  add column if not exists mfa_factor_fingerprint text
    check (mfa_factor_fingerprint is null or mfa_factor_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  add column if not exists refresh_lock_hash text,
  add column if not exists refresh_lock_expires_at timestamptz;

create or replace function public.app_identity_resolve(p_normalized_username text)
returns table (user_id uuid, login_email text)
language sql stable security definer
set search_path = pg_catalog, public, app_private
as $$
  select i.auth_user_id, i.login_email
  from app_private.auth_identities i
  where i.normalized_username = lower(btrim(p_normalized_username))
    and length(btrim(p_normalized_username)) between 1 and 160
  limit 1
$$;

revoke all on function public.app_identity_resolve(text) from public, anon, authenticated;
grant execute on function public.app_identity_resolve(text) to service_role;

create or replace function public.app_user_security_invalidate(p_user_id uuid, p_reason text)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_version integer;
begin
  if length(p_reason) not between 1 and 120 then
    raise exception 'invalid invalidation reason' using errcode = '22023';
  end if;
  update public.profiles
  set security_version = security_version + 1
  where id = p_user_id
  returning security_version into v_version;
  if not found then
    raise exception 'security profile not found' using errcode = 'P0002';
  end if;
  update app_private.auth_sessions
  set revoked_at = now(), revoke_reason = p_reason
  where user_id = p_user_id and revoked_at is null;
  return v_version;
end $$;

revoke all on function public.app_user_security_invalidate(uuid,text) from public, anon, authenticated;
grant execute on function public.app_user_security_invalidate(uuid,text) to service_role;

create or replace function public.app_session_create(
  p_session_hash text, p_user_id uuid, p_encrypted_access_token text,
  p_encrypted_refresh_token text, p_token_key_version integer,
  p_access_token_expires_at timestamptz, p_csrf_hash text, p_aal smallint,
  p_security_version integer, p_auth_state text, p_mfa_protected boolean,
  p_mfa_factor_fingerprint text, p_created_at timestamptz,
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
     or p_mfa_protected is null
     or (p_mfa_factor_fingerprint is not null
       and p_mfa_factor_fingerprint !~ '^[A-Za-z0-9_-]{43}$')
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
    security_version, auth_state, mfa_protected, mfa_factor_fingerprint,
    created_at, last_seen_at,
    idle_timeout_seconds, idle_expires_at, absolute_expires_at
  ) values (
    p_session_hash, p_user_id, p_encrypted_access_token, p_encrypted_refresh_token,
    p_token_key_version, p_access_token_expires_at, p_csrf_hash, p_aal,
    p_security_version, p_auth_state, p_mfa_protected, p_mfa_factor_fingerprint,
    p_created_at, p_created_at,
    p_idle_timeout_seconds, p_idle_expires_at, p_absolute_expires_at
  );
end $$;

revoke all on function public.app_session_create(text,uuid,text,text,integer,timestamptz,text,smallint,integer,text,boolean,text,timestamptz,integer,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.app_session_create(text,uuid,text,text,integer,timestamptz,text,smallint,integer,text,boolean,text,timestamptz,integer,timestamptz,timestamptz) to service_role;

create or replace function public.app_session_load(p_session_hash text)
returns table (
  session_hash text, user_id uuid, encrypted_access_token text,
  encrypted_refresh_token text, token_key_version integer,
  access_token_expires_at timestamptz, csrf_hash text, aal smallint,
  security_version integer, current_security_version integer,
  disabled_at timestamptz, auth_state text, mfa_protected boolean,
  mfa_factor_fingerprint text, created_at timestamptz,
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
    s.auth_state, s.mfa_protected, s.mfa_factor_fingerprint,
    s.created_at, s.last_seen_at, s.idle_timeout_seconds,
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
  p_auth_state text, p_mfa_protected boolean, p_mfa_factor_fingerprint text,
  p_created_at timestamptz,
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
     or p_mfa_protected is null
     or (p_mfa_factor_fingerprint is not null
       and p_mfa_factor_fingerprint !~ '^[A-Za-z0-9_-]{43}$')
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
    security_version, auth_state, mfa_protected, mfa_factor_fingerprint,
    created_at, last_seen_at,
    idle_timeout_seconds, idle_expires_at, absolute_expires_at
  ) values (
    p_new_session_hash, v_old.user_id, p_encrypted_access_token,
    p_encrypted_refresh_token, p_token_key_version, p_access_token_expires_at,
    p_csrf_hash, p_aal, p_security_version, p_auth_state,
    p_mfa_protected, p_mfa_factor_fingerprint, p_created_at, p_created_at,
    p_idle_timeout_seconds, p_idle_expires_at,
    p_absolute_expires_at
  );
  return true;
end $$;

revoke all on function public.app_session_rotate(text,text,text,text,integer,timestamptz,text,smallint,integer,text,boolean,text,timestamptz,integer,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.app_session_rotate(text,text,text,text,integer,timestamptz,text,smallint,integer,text,boolean,text,timestamptz,integer,timestamptz,timestamptz,text) to service_role;

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

create or replace function public.app_session_refresh_claim(
  p_session_hash text, p_expected_encrypted_refresh_token text,
  p_refresh_lock_hash text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_updated integer;
begin
  if p_refresh_lock_hash is null
     or p_refresh_lock_hash !~ '^[A-Za-z0-9_-]{43}$' then return false; end if;
  update app_private.auth_sessions
  set refresh_lock_hash = p_refresh_lock_hash,
      refresh_lock_expires_at = now() + interval '30 seconds'
  where session_hash = p_session_hash
    and encrypted_refresh_token = p_expected_encrypted_refresh_token
    and revoked_at is null
    and idle_expires_at > now()
    and absolute_expires_at > now()
    and (refresh_lock_hash is null or refresh_lock_expires_at <= now());
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function public.app_session_refresh_claim(text,text,text) from public, anon, authenticated;
grant execute on function public.app_session_refresh_claim(text,text,text) to service_role;

create or replace function public.app_session_refresh_tokens(
  p_session_hash text, p_expected_encrypted_refresh_token text,
  p_refresh_lock_hash text,
  p_encrypted_access_token text, p_encrypted_refresh_token text,
  p_token_key_version integer, p_access_token_expires_at timestamptz,
  p_aal smallint, p_auth_state text, p_mfa_protected boolean,
  p_mfa_factor_fingerprint text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_updated integer;
begin
  if p_refresh_lock_hash !~ '^[A-Za-z0-9_-]{43}$'
     or length(p_encrypted_access_token) not between 20 and 16384
     or length(p_encrypted_refresh_token) not between 20 and 16384
     or p_token_key_version < 1
     or p_access_token_expires_at <= now()
     or p_aal not in (1, 2)
     or p_auth_state not in ('active', 'mfa_required')
     or p_mfa_protected is null
     or p_mfa_factor_fingerprint is null
     or p_mfa_factor_fingerprint !~ '^[A-Za-z0-9_-]{43}$'
     or (p_mfa_protected and (
       (p_aal = 1 and p_auth_state <> 'mfa_required')
       or (p_aal = 2 and p_auth_state <> 'active')
     ))
     or (not p_mfa_protected and p_auth_state <> 'active') then
    return false;
  end if;
  update app_private.auth_sessions
  set encrypted_access_token = p_encrypted_access_token,
      encrypted_refresh_token = p_encrypted_refresh_token,
      token_key_version = p_token_key_version,
      access_token_expires_at = p_access_token_expires_at,
      aal = p_aal,
      auth_state = p_auth_state,
      mfa_protected = p_mfa_protected,
      mfa_factor_fingerprint = p_mfa_factor_fingerprint,
      refresh_lock_hash = null,
      refresh_lock_expires_at = null
  where session_hash = p_session_hash
    and encrypted_refresh_token = p_expected_encrypted_refresh_token
    and refresh_lock_hash = p_refresh_lock_hash
    and refresh_lock_expires_at > now()
    and revoked_at is null
    and idle_expires_at > now()
    and absolute_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function public.app_session_refresh_tokens(text,text,text,text,text,integer,timestamptz,smallint,text,boolean,text) from public, anon, authenticated;
grant execute on function public.app_session_refresh_tokens(text,text,text,text,text,integer,timestamptz,smallint,text,boolean,text) to service_role;

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
  p_project_id integer, p_role text, p_status text, p_correlation_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor_is_ceo boolean := false;
  v_actor_is_head boolean := false;
begin
  if length(p_actor_session_hash) not between 20 and 200
     or p_actor_user_id is null or p_target_user_id is null
     or p_project_id is null or p_correlation_id is null
     or p_role not in ('head','coord','finance','activist','ceo')
     or p_status not in ('active','suspended','revoked') then return false; end if;
  select coalesce(actor.global_role = 'ceo', false), exists (
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
  perform 1 from public.projects where id = p_project_id;
  if not found then return false; end if;
  perform 1 from public.profiles
  where id = p_target_user_id and disabled_at is null for update;
  if not found then return false; end if;
  perform set_config('app.trusted_actor_session_hash', p_actor_session_hash, true);
  perform set_config('app.trusted_project_id', p_project_id::text, true);
  perform set_config('app.trusted_correlation_id', p_correlation_id::text, true);
  perform set_config(
    'app.trusted_effective_role', case when v_actor_is_ceo then 'ceo' else 'head' end, true
  );
  if p_role = 'ceo' then
    if not v_actor_is_ceo then return false; end if;
    perform pg_advisory_xact_lock(832745, 1);
    if p_status = 'active' then
      update public.profiles set global_role = 'ceo', security_version = security_version + 1
      where id = p_target_user_id;
    else
      if (select count(*) from public.profiles where global_role = 'ceo' and disabled_at is null) <= 1
         or not exists (select 1 from public.profiles where id = p_target_user_id and global_role = 'ceo') then
        return false;
      end if;
      update public.profiles set global_role = null, security_version = security_version + 1
      where id = p_target_user_id;
    end if;
    update app_private.auth_sessions
    set revoked_at = now(), revoke_reason = 'global_role_changed'
    where user_id = p_target_user_id and revoked_at is null;
    insert into app_private.audit_events (
      actor_user_id, effective_role, project_id, action, resource_type,
      resource_id, result, correlation_id, session_ref, metadata
    ) values (
      p_actor_user_id, case when v_actor_is_ceo then 'ceo' else 'head' end,
      p_project_id, 'membership.change', 'project_membership', p_target_user_id::text,
      'success', p_correlation_id, left(p_actor_session_hash, 16),
      jsonb_build_object(
        'targetRole', p_role,
        'changedFields', jsonb_build_array('global_role', 'security_version')
      )
    );
    return true;
  end if;
  if exists (
    select 1 from public.project_memberships
    where user_id = p_target_user_id and project_id = p_project_id
      and role = p_role and status = p_status
  ) then return false; end if;
  insert into public.project_memberships (user_id, project_id, role, status)
  values (p_target_user_id, p_project_id, p_role, p_status)
  on conflict (user_id, project_id) do update
  set role = excluded.role, status = excluded.status, updated_at = now();
  update public.profiles set security_version = security_version + 1
  where id = p_target_user_id;
  update app_private.auth_sessions
  set revoked_at = now(), revoke_reason = 'membership_changed'
  where user_id = p_target_user_id and revoked_at is null;
  insert into app_private.audit_events (
    actor_user_id, effective_role, project_id, action, resource_type,
    resource_id, result, correlation_id, session_ref, metadata
  ) values (
    p_actor_user_id, case when v_actor_is_ceo then 'ceo' else 'head' end,
    p_project_id, 'membership.change', 'project_membership', p_target_user_id::text,
    'success', p_correlation_id, left(p_actor_session_hash, 16),
    jsonb_build_object(
      'targetRole', p_role,
      'changedFields', jsonb_build_array('role', 'status', 'security_version')
    )
  );
  return true;
end $$;

revoke all on function public.app_membership_change(text,uuid,uuid,integer,text,text,uuid) from public, anon, authenticated;
grant execute on function public.app_membership_change(text,uuid,uuid,integer,text,text,uuid) to service_role;

-- Authority/workflow transitions use narrow user-JWT RPCs. Every row is locked,
-- authorization and target membership are derived in the transaction, and the
-- 0019 row trigger appends the actor-correct audit event atomically.
create or replace function public.app_reassign_contact(
  p_contact_id text, p_assigned_user_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_project_id integer;
  v_legacy_code integer;
begin
  if auth.uid() is null or p_contact_id is null or p_assigned_user_id is null then return false; end if;
  select c.project_id into v_project_id
  from public.contacts c where c.id::text = p_contact_id for update;
  if not found or not (
    public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head','coord'])
  ) then return false; end if;
  select p.activist_code into v_legacy_code
  from public.profiles p
  join public.project_memberships pm on pm.user_id = p.id
  where p.id = p_assigned_user_id and p.disabled_at is null
    and pm.project_id = v_project_id and pm.status = 'active';
  if not found or v_legacy_code is null then return false; end if;
  update public.contacts
  set assigned_user_id = p_assigned_user_id, activist_id = v_legacy_code
  where id::text = p_contact_id;
  return found;
end $$;
revoke all on function public.app_reassign_contact(text,uuid) from public, anon;
grant execute on function public.app_reassign_contact(text,uuid) to authenticated;

create or replace function public.app_soft_delete_contact(p_contact_id text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_project_id integer;
  v_assigned_user_id uuid;
begin
  if auth.uid() is null or p_contact_id is null then return false; end if;
  select c.project_id, c.assigned_user_id into v_project_id, v_assigned_user_id
  from public.contacts c where c.id::text = p_contact_id and c.is_active = true for update;
  if not found or not (
    public.app_is_ceo()
    or public.app_has_project_role(v_project_id, array['head','coord'])
    or (v_assigned_user_id = auth.uid() and public.app_has_project_role(v_project_id, array['activist']))
  ) then return false; end if;
  update public.contacts set is_active = false where id::text = p_contact_id and is_active = true;
  return found;
end $$;
revoke all on function public.app_soft_delete_contact(text) from public, anon;
grant execute on function public.app_soft_delete_contact(text) to authenticated;

create or replace function public.app_link_contact_tour(p_contact_id text, p_tour_id text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_project_id integer;
  v_assigned_user_id uuid;
begin
  if auth.uid() is null or nullif(btrim(p_contact_id), '') is null then return false; end if;
  select c.project_id, c.assigned_user_id into v_project_id, v_assigned_user_id
  from public.contacts c where c.id::text = p_contact_id for update;
  if not found or not (
    public.app_is_ceo()
    or public.app_has_project_role(v_project_id, array['head','coord'])
    or (v_assigned_user_id = auth.uid() and public.app_has_project_role(v_project_id, array['activist']))
  ) then return false; end if;
  if p_tour_id is not null and not exists (
    select 1 from public.tours t where t.id::text = p_tour_id and t.project_id = v_project_id
  ) then return false; end if;
  update public.contacts set tour_id = p_tour_id where id::text = p_contact_id;
  return found;
end $$;
revoke all on function public.app_link_contact_tour(text,text) from public, anon;
grant execute on function public.app_link_contact_tour(text,text) to authenticated;

create or replace function public.app_delete_interaction(p_interaction_id text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_project_id integer;
begin
  if auth.uid() is null or p_interaction_id is null then return false; end if;
  select i.project_id into v_project_id
  from public.interactions i where i.id::text = p_interaction_id for update;
  if not found or not (
    public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head'])
  ) then return false; end if;
  delete from public.interactions where id::text = p_interaction_id;
  return found;
end $$;
revoke all on function public.app_delete_interaction(text) from public, anon;
grant execute on function public.app_delete_interaction(text) to authenticated;

create or replace function public.app_delete_expense(p_expense_id bigint)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_project_id integer;
begin
  if auth.uid() is null or p_expense_id is null then return false; end if;
  select e.project_id into v_project_id
  from public.expenses e where e.id = p_expense_id for update;
  if not found or not (
    public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head'])
  ) then return false; end if;
  delete from public.expenses where id = p_expense_id;
  return found;
end $$;
revoke all on function public.app_delete_expense(bigint) from public, anon;
grant execute on function public.app_delete_expense(bigint) to authenticated;

create or replace function public.app_review_feedback(p_feedback_id uuid, p_status text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_project_id integer;
begin
  if auth.uid() is null or p_feedback_id is null or p_status not in ('open','reviewed') then return false; end if;
  select f.project_id into v_project_id
  from public.feedback_reports f where f.id = p_feedback_id for update;
  if not found or not (
    public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head','coord'])
  ) then return false; end if;
  update public.feedback_reports
  set status = p_status,
      reviewed_at = case when p_status = 'reviewed' then now() else null end
  where id = p_feedback_id;
  return found;
end $$;
revoke all on function public.app_review_feedback(uuid,text) from public, anon;
grant execute on function public.app_review_feedback(uuid,text) to authenticated;

-- Boolean-only duplicate check. It deliberately exposes no row identifier or PII and
-- accepts calls only from an active member of the requested project (or an AAL2 CEO).
create or replace function public.check_contact_duplicate(
  p_project_id integer, p_phone_suffix text
) returns boolean
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null
     or p_phone_suffix !~ '^[0-9]{7,8}$'
     or not (public.app_has_active_membership(p_project_id) or public.app_is_ceo()) then
    return false;
  end if;
  return exists (
    select 1 from public.contacts c
    where c.project_id = p_project_id and c.is_active = true
      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || p_phone_suffix
  );
end $$;

revoke all on function public.check_contact_duplicate(integer,text) from public, anon;
grant execute on function public.check_contact_duplicate(integer,text) to authenticated;

commit;
