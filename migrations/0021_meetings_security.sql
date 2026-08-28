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
