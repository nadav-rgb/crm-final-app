-- Pre-cutover rollback for security migrations 0018-0020.
-- Refuses to run once application sessions exist. After cutover, restore the
-- reviewed database backup instead of using this script.

begin;

do $$ begin
  if exists (select 1 from app_private.auth_sessions) then
    raise exception 'pre-cutover rollback refused: sessions exist';
  end if;
end $$;

drop table if exists app_private.rate_limit_buckets;
drop table if exists app_private.audit_events;
drop table if exists app_private.auth_sessions;
drop table if exists app_private.auth_identities;

alter table public.tours
  drop column if exists assigned_user_ids,
  drop column if exists host_user_id,
  drop column if exists guide_user_id;
alter table public.fcm_tokens drop column if exists user_id;
alter table public.push_subscriptions drop column if exists user_id;
alter table public.meeting_reminders drop column if exists recipient_user_id;
alter table public.notification_reads drop column if exists recipient_user_id;
alter table public.notifications drop column if exists recipient_user_id;
alter table public.feedback_reports drop column if exists reporter_user_id;
alter table public.expenses drop column if exists actor_user_id;
alter table public.base_meeting_reports drop column if exists actor_user_id;
alter table public.interactions drop column if exists actor_user_id;
alter table public.contacts drop column if exists assigned_user_id;
drop table if exists public.project_memberships;
alter table public.profiles
  drop column if exists disabled_at,
  drop column if exists security_version,
  drop column if exists global_role;

drop schema if exists app_private;

commit;
