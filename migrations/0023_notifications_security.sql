-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
begin;

-- Fail closed before relaxing legacy compatibility columns. 0018 must have
-- mapped every existing row to auth.users ownership first.
do $$ begin
  if exists (select 1 from public.notifications where recipient_user_id is null) then
    raise exception 'security backfill refused: notification recipient mapping missing';
  end if;
  if exists (select 1 from public.push_subscriptions where user_id is null) then
    raise exception 'security backfill refused: push subscription owner mapping missing';
  end if;
  if exists (select 1 from public.fcm_tokens where user_id is null) then
    raise exception 'security backfill refused: fcm token owner mapping missing';
  end if;
  if exists (
    select subscription ->> 'endpoint'
    from public.push_subscriptions
    group by subscription ->> 'endpoint'
    having nullif(btrim(subscription ->> 'endpoint'), '') is null or count(*) > 1
  ) then
    raise exception 'security migration refused: duplicate push endpoints or empty endpoint';
  end if;
end $$;

alter table public.notifications alter column recipient_id drop not null;
alter table public.push_subscriptions alter column activist_id drop not null;
alter table public.fcm_tokens alter column activist_id drop not null;

create unique index if not exists push_subscriptions_endpoint_uq
  on public.push_subscriptions ((subscription ->> 'endpoint'));

-- Inventory by catalog, rather than guessing overload signatures. None of these
-- legacy routines is part of the reviewed event contract and every overload is
-- removed before the replacement is exposed.
do $$
declare
  v_routine record;
begin
  for v_routine in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = any(array[
        'enqueue_interaction_notification',
        'enqueue_base_meeting_notification',
        'enqueue_tour_notification',
        'app_notification_recipients'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_routine.signature);
    execute format('drop function %s', v_routine.signature);
  end loop;
end $$;

create table if not exists app_private.notification_delivery_outbox (
  delivery_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  priority text not null check (priority in ('normal', 'high')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  primary key (delivery_id, recipient_user_id)
);
create index if not exists notification_delivery_outbox_expiry_idx
  on app_private.notification_delivery_outbox(created_at);
revoke all on app_private.notification_delivery_outbox from public, anon, authenticated;

create or replace function public.app_enqueue_notification_event(
  p_event_type text, p_resource_id text, p_project_id integer
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_is_service boolean := coalesce(auth.role() = 'service_role', false);
  v_delivery_id uuid := gen_random_uuid();
  v_project_id integer;
  v_url text := '/notifications';
  v_priority text := 'normal';
  v_event_version text := '';
  v_is_manager boolean := false;
  v_allowed boolean := false;
  v_actor_user_id uuid;
  v_assigned_user_id uuid;
  v_assigned_user_ids uuid[] := '{}';
  v_guide_user_id uuid;
  v_host_user_id uuid;
  v_status text;
  v_reported_by_user_id uuid;
  v_reminder_type text;
  v_next_action_date date;
  v_contact_active boolean;
begin
  if (v_actor is null and not v_is_service) or p_event_type not in (
    'meeting_house_assigned','tour_created','tour_updated','tour_cancelled','tour_reported',
    'interaction_created','base_meeting_reported','mitzvot_updated','self_test',
    'base_report_reminder','missing_report','next_action_due','tour_sheet_sync'
  ) or nullif(btrim(p_resource_id), '') is null then
    raise exception 'invalid notification event' using errcode = '22023';
  end if;
  if p_event_type in ('base_report_reminder','missing_report','next_action_due','tour_sheet_sync')
     and not v_is_service then
    raise exception 'notification resource not found' using errcode = '42501';
  end if;
  if v_is_service and p_event_type not in (
    'base_report_reminder','missing_report','next_action_due','tour_created','tour_sheet_sync'
  ) then
    raise exception 'invalid notification event' using errcode = '22023';
  end if;

  if p_event_type = 'self_test' then
    v_allowed := public.app_user_active() and p_resource_id = v_actor::text;
    select min(pm.project_id) into v_project_id
    from public.project_memberships pm
    where pm.user_id = v_actor and pm.status = 'active';
    v_project_id := coalesce(v_project_id, 0);
  elsif p_event_type = 'meeting_house_assigned' then
    select h.project_id, h.assigned_user_ids
      into v_project_id, v_assigned_user_ids
    from public.meeting_houses h where h.id::text = p_resource_id;
    v_is_manager := public.app_is_ceo()
      or public.app_has_project_role(v_project_id, array['head','coord']);
    v_allowed := v_project_id is not null and v_is_manager;
    v_url := '/meeting-houses/' || p_resource_id;
  elsif p_event_type = 'tour_sheet_sync' then
    select p.id into v_project_id
    from public.projects p where p.id::text = p_resource_id;
    v_allowed := v_is_service and v_project_id is not null;
    v_url := '/tours';
    v_event_version := current_date::text;
  elsif p_event_type like 'tour_%' then
    select t.project_id, t.assigned_user_ids, t.guide_user_id, t.host_user_id,
           t.status, t.reported_by_user_id
      into v_project_id, v_assigned_user_ids, v_guide_user_id, v_host_user_id,
           v_status, v_reported_by_user_id
    from public.tours t where t.id::text = p_resource_id;
    v_is_manager := public.app_is_ceo()
      or public.app_has_project_role(v_project_id, array['head','coord']);
    if p_event_type = 'tour_reported' then
      v_allowed := v_project_id is not null and v_status = 'completed'
        and v_reported_by_user_id = v_actor
        and (v_is_manager or (
          public.app_has_project_role(v_project_id, array['activist']) and (
            v_actor = v_guide_user_id or v_actor = v_host_user_id
            or v_actor = any(v_assigned_user_ids)
          )
        ));
    elsif p_event_type = 'tour_cancelled' then
      v_allowed := v_project_id is not null and v_status = 'cancelled' and v_is_manager;
    elsif p_event_type = 'tour_created' and v_is_service then
      v_allowed := v_project_id is not null;
    else
      v_allowed := v_project_id is not null and v_is_manager;
    end if;
    v_url := '/tours?tour=' || p_resource_id;
  elsif p_event_type = 'interaction_created' then
    select i.project_id, i.actor_user_id into v_project_id, v_actor_user_id
    from public.interactions i where i.id::text = p_resource_id;
    v_is_manager := public.app_is_ceo()
      or public.app_has_project_role(v_project_id, array['head','coord']);
    v_allowed := v_project_id is not null and (
      v_is_manager or (v_actor_user_id = v_actor and public.app_has_active_membership(v_project_id))
    );
  elsif p_event_type = 'base_meeting_reported' then
    select r.project_id, r.actor_user_id into v_project_id, v_actor_user_id
    from public.base_meeting_reports r where r.id::text = p_resource_id;
    v_is_manager := public.app_is_ceo()
      or public.app_has_project_role(v_project_id, array['head','coord']);
    v_allowed := v_project_id is not null and (
      v_is_manager or (v_actor_user_id = v_actor and public.app_has_active_membership(v_project_id))
    );
    v_url := '/base-meetings';
  elsif p_event_type in ('base_report_reminder','missing_report') then
    select r.project_id, r.recipient_user_id, r.type
      into v_project_id, v_assigned_user_id, v_reminder_type
    from public.meeting_reminders r where r.id::text = p_resource_id;
    v_allowed := v_is_service and v_project_id is not null and (
      (p_event_type = 'missing_report' and v_reminder_type = 'coordinator')
      or (p_event_type = 'base_report_reminder' and v_reminder_type <> 'coordinator'
        and v_assigned_user_id is not null)
    );
    if p_event_type = 'missing_report' then v_assigned_user_id := null; end if;
    v_url := '/base-meetings';
    v_priority := 'high';
  elsif p_event_type = 'next_action_due' then
    select c.project_id, c.assigned_user_id, c.next_action_date, c.is_active
      into v_project_id, v_assigned_user_id, v_next_action_date, v_contact_active
    from public.contacts c
    where c.id::text = p_resource_id and nullif(btrim(c.next_action), '') is not null;
    v_allowed := v_is_service and v_project_id is not null
      and v_assigned_user_id is not null and v_contact_active
      and v_next_action_date is not null and v_next_action_date <= current_date;
    v_url := '/contact/' || p_resource_id;
    v_event_version := coalesce(v_next_action_date::text, 'missing');
  elsif p_event_type = 'mitzvot_updated' then
    select c.project_id, c.assigned_user_id into v_project_id, v_assigned_user_id
    from public.contacts c where c.id::text = p_resource_id;
    v_is_manager := public.app_is_ceo()
      or public.app_has_project_role(v_project_id, array['head','coord']);
    v_allowed := v_project_id is not null and (
      v_is_manager or (
        v_assigned_user_id = v_actor
        and public.app_has_project_role(v_project_id, array['activist'])
      )
    );
    v_url := '/contact/' || p_resource_id;
  end if;

  -- Compatibility parameter is a narrowing assertion only. Resource lookup
  -- above is the sole source of tenant authority.
  if p_project_id is not null and p_project_id <> v_project_id then
    v_allowed := false;
  end if;
  if not coalesce(v_allowed, false) then
    raise exception 'notification resource not found' using errcode = '42501';
  end if;

  delete from app_private.notification_delivery_outbox
  where created_at < now() - interval '1 day';

  with candidates(user_id) as (
    select v_actor
    union
    select pm.user_id from public.project_memberships pm
    where p_event_type in (
        'meeting_house_assigned','tour_created','tour_updated','tour_cancelled','tour_reported',
        'interaction_created','base_meeting_reported','mitzvot_updated','missing_report','tour_sheet_sync'
      ) and pm.project_id = v_project_id
      and pm.status = 'active' and pm.role in ('head','coord')
    union
    select recipient from unnest(
      case when p_event_type like 'tour_%' and p_event_type <> 'tour_sheet_sync'
        then array_remove(v_assigned_user_ids || array[v_guide_user_id,v_host_user_id], null)
        else '{}'::uuid[] end
    ) recipient
    union
    select recipient from unnest(
      case when p_event_type = 'meeting_house_assigned'
        then v_assigned_user_ids else '{}'::uuid[] end
    ) recipient
    union select v_actor_user_id where p_event_type in ('interaction_created','base_meeting_reported')
    union select v_assigned_user_id where p_event_type in (
      'mitzvot_updated','base_report_reminder','next_action_due'
    )
  ), recipients as (
    select distinct c.user_id
    from candidates c
    join public.profiles p on p.id = c.user_id and p.disabled_at is null
    where c.user_id is not null and (
      p_event_type = 'self_test' or exists (
        select 1 from public.project_memberships pm
        where pm.user_id = c.user_id and pm.project_id = v_project_id and pm.status = 'active'
      ) or p.global_role = 'ceo'
    )
  ), inserted as (
    insert into public.notifications (
      recipient_user_id, client_id, type, title, body, url, priority, read, created_at
    )
    select user_id,
      p_event_type || '__' || p_resource_id || '__' || v_event_version || '__' || user_id::text,
      p_event_type,
      case p_event_type
        when 'base_report_reminder' then 'תזכורת לדיווח מפגש'
        when 'missing_report' then 'דיווח מפגש ממתין'
        when 'next_action_due' then 'פעולה הבאה ממתינה'
        when 'tour_sheet_sync' then 'סנכרון הסיורים הסתיים'
        else 'עדכון חדש במקרבים'
      end,
      'יש עדכון חדש במערכת', v_url, v_priority, false, now()
    from recipients
    on conflict (client_id) do nothing
    returning recipient_user_id
  )
  insert into app_private.notification_delivery_outbox (
    delivery_id, recipient_user_id, priority
  )
  select v_delivery_id, recipient_user_id, v_priority from inserted;

  return v_delivery_id;
end $$;

revoke all on function public.app_enqueue_notification_event(text,text,integer) from public, anon, authenticated;
grant execute on function public.app_enqueue_notification_event(text,text,integer) to authenticated;
grant execute on function public.app_enqueue_notification_event(text,text,integer) to service_role;

create or replace function public.app_claim_notification_delivery(p_delivery_id uuid)
returns table(user_id uuid, priority text)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_delivery_id is null then
    raise exception 'notification delivery not found' using errcode = '42501';
  end if;
  return query
  with claimed as (
    update app_private.notification_delivery_outbox o
    set claimed_at = now()
    where o.delivery_id = p_delivery_id
      and o.claimed_at is null
      and o.created_at >= now() - interval '10 minutes'
    returning o.recipient_user_id, o.priority
  )
  select c.recipient_user_id, c.priority from claimed c;
end $$;

revoke all on function public.app_claim_notification_delivery(uuid) from public, anon, authenticated;
grant execute on function public.app_claim_notification_delivery(uuid) to service_role;

commit;
