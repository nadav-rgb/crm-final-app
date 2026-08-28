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

create or replace function public.app_enqueue_notification_event(
  p_event_type text, p_resource_id text, p_project_id integer
) returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id integer;
  v_url text := '/notifications';
  v_is_manager boolean := false;
  v_allowed boolean := false;
  v_count integer := 0;
  v_actor_user_id uuid;
  v_assigned_user_id uuid;
  v_assigned_user_ids uuid[] := '{}';
  v_guide_user_id uuid;
  v_host_user_id uuid;
  v_status text;
  v_reported_by_user_id uuid;
begin
  if v_actor is null or p_event_type not in (
    'meeting_house_assigned','tour_created','tour_updated','tour_cancelled','tour_reported',
    'interaction_created','base_meeting_reported','mitzvot_updated','self_test'
  ) or nullif(btrim(p_resource_id), '') is null then
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
  if not v_allowed then
    raise exception 'notification resource not found' using errcode = '42501';
  end if;

  with candidates(user_id) as (
    select v_actor
    union
    select pm.user_id from public.project_memberships pm
    where p_event_type <> 'self_test' and pm.project_id = v_project_id
      and pm.status = 'active' and pm.role in ('head','coord')
    union
    select recipient from unnest(
      case when p_event_type like 'tour_%'
        then array_remove(v_assigned_user_ids || array[v_guide_user_id,v_host_user_id], null)
        else '{}'::uuid[] end
    ) recipient
    union
    select recipient from unnest(
      case when p_event_type = 'meeting_house_assigned'
        then v_assigned_user_ids else '{}'::uuid[] end
    ) recipient
    union select v_actor_user_id where p_event_type in ('interaction_created','base_meeting_reported')
    union select v_assigned_user_id where p_event_type = 'mitzvot_updated'
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
    select user_id, p_event_type || '__' || p_resource_id || '__' || user_id::text,
      'system', 'עדכון חדש במקרבים', 'יש עדכון חדש במערכת', v_url, 'normal', false, now()
    from recipients
    on conflict (client_id) do update set created_at = excluded.created_at, read = false
    returning 1
  ) select count(*) into v_count from inserted;

  return v_count;
end $$;

revoke all on function public.app_enqueue_notification_event(text,text,integer) from public, anon, authenticated;
grant execute on function public.app_enqueue_notification_event(text,text,integer) to authenticated;

commit;
