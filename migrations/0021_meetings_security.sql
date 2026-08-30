-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
begin;

alter table public.meeting_reminders
  add column if not exists idempotency_key text,
  add column if not exists cancelled_at timestamptz;

create unique index if not exists meeting_reminders_idempotency_uq
  on public.meeting_reminders(idempotency_key)
  where idempotency_key is not null;

alter table public.meeting_reminders
  add constraint meeting_reminders_idempotency_format_chk
  check (idempotency_key is null or idempotency_key ~ '^[0-9a-f]{64}:(activist_1|activist_2|activist_3|coordinator)$')
  not valid;

create or replace function public.app_assign_meeting_house(
  p_house_id text, p_assigned_user_ids uuid[]
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_id integer;
  v_legacy_codes integer[];
  v_expected integer := coalesce(cardinality(p_assigned_user_ids), 0);
begin
  if auth.uid() is null or nullif(btrim(p_house_id), '') is null
     or v_expected > 100
     or exists (select 1 from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) u where u is null)
     or (select count(distinct u) from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) u) <> v_expected then
    return false;
  end if;
  select h.project_id into v_project_id
  from public.meeting_houses h where h.id::text = p_house_id for update;
  if not found or not (
    public.app_is_ceo() or public.app_has_project_role(v_project_id, array['head','coord'])
  ) then return false; end if;
  select coalesce(array_agg(p.activist_code order by p.activist_code), '{}'::integer[])
    into v_legacy_codes
  from unnest(coalesce(p_assigned_user_ids, '{}'::uuid[])) requested(user_id)
  join public.profiles p on p.id = requested.user_id and p.disabled_at is null
  join public.project_memberships pm on pm.user_id = p.id
    and pm.project_id = v_project_id and pm.status = 'active'
  where p.activist_code is not null;
  if cardinality(v_legacy_codes) <> v_expected then return false; end if;
  update public.meeting_houses
  set assigned_user_ids = coalesce(p_assigned_user_ids, '{}'::uuid[]),
      assigned_activists = v_legacy_codes
  where id::text = p_house_id;
  return found;
end $$;
revoke all on function public.app_assign_meeting_house(text,uuid[]) from public, anon;
grant execute on function public.app_assign_meeting_house(text,uuid[]) to authenticated;

create or replace function public.app_cancel_meeting_reminders(p_meeting_id text)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_id integer;
  v_recipient_user_id uuid;
  v_count integer := 0;
begin
  if auth.uid() is null or nullif(btrim(p_meeting_id), '') is null then
    raise exception 'reminder not found' using errcode = '42501';
  end if;

  select r.project_id, r.recipient_user_id
    into v_project_id, v_recipient_user_id
  from public.meeting_reminders r
  where r.meeting_id::text = p_meeting_id
  order by r.id
  limit 1
  for update;

  if not found or v_project_id is null or v_recipient_user_id is null then
    raise exception 'reminder not found' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.meeting_reminders r
    where r.meeting_id::text = p_meeting_id
      and (r.project_id is distinct from v_project_id
        or r.recipient_user_id is distinct from v_recipient_user_id)
  ) then
    raise exception 'reminder authority is inconsistent' using errcode = '42501';
  end if;
  if not (
    (v_recipient_user_id = auth.uid() and public.app_user_active())
    or public.app_is_ceo()
    or public.app_has_project_role(v_project_id, array['head','coord'])
  ) then
    raise exception 'reminder not found' using errcode = '42501';
  end if;

  update public.meeting_reminders
  set cancelled_at = now()
  where meeting_id::text = p_meeting_id and cancelled_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.app_cancel_meeting_reminders(text) from public, anon, authenticated;
grant execute on function public.app_cancel_meeting_reminders(text) to authenticated;

commit;
