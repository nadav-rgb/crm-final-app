-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
begin;

-- 0018 verified every legacy owner mapping before this UUID cutover. New writes use auth.users IDs;
-- legacy activist_code columns remain temporarily readable but may no longer be mandatory.
alter table public.notifications alter column recipient_id drop not null;
alter table public.push_subscriptions alter column activist_id drop not null;
alter table public.fcm_tokens alter column activist_id drop not null;

create unique index if not exists push_subscriptions_endpoint_uq
  on public.push_subscriptions ((subscription->>'endpoint'));

create or replace function public.app_enqueue_notification_event(
  p_event_type text, p_resource_id text, p_project_id integer
) returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_url text := '/notifications';
  v_valid boolean := false;
  v_count integer := 0;
begin
  if auth.uid() is null or p_event_type not in (
    'meeting_house_assigned','tour_created','tour_updated','tour_cancelled','tour_reported',
    'interaction_created','base_meeting_reported','mitzvot_updated','self_test'
  ) then raise exception 'invalid notification event' using errcode = '22023'; end if;

  if p_event_type = 'self_test' then
    v_valid := public.app_user_active();
  elsif not (public.app_has_active_membership(p_project_id) or public.app_is_ceo()) then
    v_valid := false;
  elsif p_event_type like 'tour_%' then
    select exists(select 1 from public.tours where id::text = p_resource_id and project_id = p_project_id) into v_valid;
    v_url := '/tours?tour=' || p_resource_id;
  elsif p_event_type = 'meeting_house_assigned' then
    select exists(select 1 from public.meeting_houses where id::text = p_resource_id and project_id = p_project_id) into v_valid;
    v_url := '/meeting-houses/' || p_resource_id;
  elsif p_event_type = 'interaction_created' then
    select exists(select 1 from public.interactions where id::text = p_resource_id and project_id = p_project_id) into v_valid;
  elsif p_event_type = 'base_meeting_reported' then
    select exists(select 1 from public.base_meeting_reports where id::text = p_resource_id and project_id = p_project_id) into v_valid;
    v_url := '/base-meetings';
  elsif p_event_type = 'mitzvot_updated' then
    select exists(select 1 from public.contacts where id::text = p_resource_id and project_id = p_project_id) into v_valid;
    v_url := '/contact/' || p_resource_id;
  end if;
  if not v_valid then raise exception 'notification resource not found' using errcode = '42501'; end if;

  with recipients as (
    select auth.uid() as user_id
    union
    select pm.user_id from public.project_memberships pm
    where p_event_type <> 'self_test' and pm.project_id = p_project_id
      and pm.status = 'active' and pm.role in ('head','coord')
    union
    select recipient from public.tours t,
      lateral unnest(array_remove(t.assigned_user_ids || array[t.guide_user_id,t.host_user_id], null)) recipient
    where p_event_type like 'tour_%' and t.id::text = p_resource_id and t.project_id = p_project_id
    union
    select recipient from public.meeting_houses h, lateral unnest(h.assigned_user_ids) recipient
    where p_event_type = 'meeting_house_assigned' and h.id::text = p_resource_id and h.project_id = p_project_id
    union
    select i.actor_user_id from public.interactions i
    where p_event_type = 'interaction_created' and i.id::text = p_resource_id and i.project_id = p_project_id
    union
    select r.actor_user_id from public.base_meeting_reports r
    where p_event_type = 'base_meeting_reported' and r.id::text = p_resource_id and r.project_id = p_project_id
    union
    select c.assigned_user_id from public.contacts c
    where p_event_type = 'mitzvot_updated' and c.id::text = p_resource_id and c.project_id = p_project_id
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

revoke all on function public.app_enqueue_notification_event(text,text,integer) from public, anon;
grant execute on function public.app_enqueue_notification_event(text,text,integer) to authenticated;

commit;
