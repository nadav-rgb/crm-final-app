-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
begin;

alter table public.tours
  add column if not exists reported_by_user_id uuid references auth.users(id),
  add column if not exists cancellation_reason text;

grant update (cancellation_reason) on public.tours to authenticated;

alter table public.tours
  add constraint tours_status_security_chk check (status in ('upcoming','completed','cancelled')) not valid,
  add constraint tours_cancellation_reason_len_chk check (cancellation_reason is null or length(cancellation_reason) <= 200) not valid;

create index if not exists tours_reported_by_user_idx on public.tours(reported_by_user_id);

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
     or jsonb_typeof(p_report -> 'notes') <> 'string'
     or length(btrim(p_report ->> 'notes')) not between 1 and 4000
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
