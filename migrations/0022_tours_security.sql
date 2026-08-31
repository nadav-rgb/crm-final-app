-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
begin;

alter table public.tours
  add column if not exists reported_by_user_id uuid references auth.users(id),
  add column if not exists cancellation_reason text;

alter table public.tours
  add constraint tours_status_security_chk check (status in ('upcoming','completed','cancelled')) not valid,
  add constraint tours_cancellation_reason_len_chk check (cancellation_reason is null or length(cancellation_reason) <= 200) not valid;

create index if not exists tours_reported_by_user_idx on public.tours(reported_by_user_id);

create or replace function public.app_assign_tour(
  p_tour_id text, p_guide_user_id uuid, p_host_user_id uuid, p_assigned_user_ids uuid[]
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_id integer;
  v_guide_code integer;
  v_host_code integer;
  v_guide_name text;
  v_assigned_codes integer[];
  v_expected integer := coalesce(cardinality(p_assigned_user_ids), 0);
begin
  if auth.uid() is null or nullif(btrim(p_tour_id), '') is null or v_expected > 100
     or exists (select 1 from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) u where u is null)
     or (select count(distinct u) from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) u) <> v_expected then
    return false;
  end if;
  select t.project_id into v_project_id
  from public.tours t where t.id::text = p_tour_id for update;
  if not found or not (
    public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head','coord'])
  ) then return false; end if;

  if p_guide_user_id is not null then
    select p.activist_code, p.name into v_guide_code, v_guide_name
    from public.profiles p
    join public.project_memberships pm on pm.user_id = p.id
    where p.id = p_guide_user_id and p.disabled_at is null and p.activist_code is not null
      and pm.project_id = v_project_id and pm.status = 'active';
    if not found then return false; end if;
  end if;
  if p_host_user_id is not null then
    select p.activist_code into v_host_code
    from public.profiles p
    join public.project_memberships pm on pm.user_id = p.id
    where p.id = p_host_user_id and p.disabled_at is null and p.activist_code is not null
      and pm.project_id = v_project_id and pm.status = 'active';
    if not found then return false; end if;
  end if;
  select coalesce(array_agg(p.activist_code order by p.activist_code), '{}'::integer[])
    into v_assigned_codes
  from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) requested(user_id)
  join public.profiles p on p.id = requested.user_id and p.disabled_at is null
  join public.project_memberships pm on pm.user_id = p.id
    and pm.project_id = v_project_id and pm.status = 'active'
  where p.activist_code is not null;
  if cardinality(v_assigned_codes) <> v_expected then return false; end if;

  update public.tours
  set guide_user_id = p_guide_user_id,
      guide_activist_id = v_guide_code,
      guide_name = v_guide_name,
      host_user_id = p_host_user_id,
      host_activist_id = v_host_code,
      assigned_user_ids = coalesce(p_assigned_user_ids, '{}'::uuid[]),
      assigned_activists = v_assigned_codes
  where id::text = p_tour_id;
  return found;
end $$;
revoke all on function public.app_assign_tour(text,uuid,uuid,uuid[]) from public, anon;
grant execute on function public.app_assign_tour(text,uuid,uuid,uuid[]) to authenticated;

create or replace function public.app_cancel_tour(p_tour_id text, p_reason text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_id integer;
  v_status text;
begin
  if auth.uid() is null or nullif(btrim(p_tour_id), '') is null
     or length(coalesce(p_reason, '')) > 200 then return false; end if;
  select t.project_id, t.status into v_project_id, v_status
  from public.tours t where t.id::text = p_tour_id for update;
  if not found or v_status <> 'upcoming' or not (
    public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head','coord'])
  ) then return false; end if;
  update public.tours
  set status = 'cancelled', cancellation_reason = nullif(btrim(p_reason), '')
  where id::text = p_tour_id and status = 'upcoming';
  return found;
end $$;
revoke all on function public.app_cancel_tour(text,text) from public, anon;
grant execute on function public.app_cancel_tour(text,text) to authenticated;

create or replace function public.app_delete_tour(p_tour_id text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_id integer;
  v_status text;
  v_report jsonb;
begin
  if auth.uid() is null or nullif(btrim(p_tour_id), '') is null then return false; end if;
  select t.project_id, t.status, t.report into v_project_id, v_status, v_report
  from public.tours t where t.id::text = p_tour_id for update;
  if not found or v_report is not null or v_status = 'completed'
     or not (public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head']))
     or exists (
       select 1 from public.contacts c
       where c.project_id = v_project_id and c.tour_id::text = p_tour_id
     ) then return false; end if;
  delete from public.tours where id::text = p_tour_id;
  return found;
end $$;
revoke all on function public.app_delete_tour(text) from public, anon;
grant execute on function public.app_delete_tour(text) to authenticated;

create or replace function public.app_submit_tour_report(p_tour_id text, p_report jsonb)
returns setof public.tours
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_tour public.tours%rowtype;
  v_allowed boolean := false;
begin
  if auth.uid() is null or nullif(btrim(p_tour_id), '') is null or p_report is null
     or jsonb_typeof(p_report) <> 'object'
     or p_report - array['notes','participantCount','outcome'] <> '{}'::jsonb
     or not (p_report ? 'notes')
     or coalesce(jsonb_typeof(p_report -> 'notes'), '') <> 'string'
     or coalesce(length(btrim(p_report ->> 'notes')), 0) not between 1 and 4000
     or (p_report ? 'participantCount' and (
       jsonb_typeof(p_report -> 'participantCount') <> 'number'
       or (p_report ->> 'participantCount')::numeric <> trunc((p_report ->> 'participantCount')::numeric)
       or (p_report ->> 'participantCount')::numeric not between 0 and 10000
     ))
     or (p_report ? 'outcome' and (
       jsonb_typeof(p_report -> 'outcome') <> 'string'
       or length(p_report ->> 'outcome') > 500
     )) then
    raise exception 'invalid tour report' using errcode = '22023';
  end if;

  select t.* into v_tour
  from public.tours t
  where t.id::text = p_tour_id
  for update;
  if not found or v_tour.status = 'cancelled' then
    raise exception 'tour not found' using errcode = '42501';
  end if;

  v_allowed := public.app_is_ceo()
    or public.app_has_project_role(v_tour.project_id, array['head','coord'])
    or (
      public.app_has_project_role(v_tour.project_id, array['activist'])
      and (
        v_tour.guide_user_id = auth.uid()
        or v_tour.host_user_id = auth.uid()
        or auth.uid() = any(v_tour.assigned_user_ids)
      )
    );
  if not v_allowed then
    raise exception 'tour not found' using errcode = '42501';
  end if;

  return query
  update public.tours t
  set report = p_report,
      reported_by_user_id = auth.uid(),
      reported_at = now(),
      status = 'completed'
  where t.id::text = p_tour_id
  returning t.*;
end $$;

revoke all on function public.app_submit_tour_report(text,jsonb) from public, anon, authenticated;
grant execute on function public.app_submit_tour_report(text,jsonb) to authenticated;

commit;
