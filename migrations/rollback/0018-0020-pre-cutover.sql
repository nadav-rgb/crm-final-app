-- Pre-cutover rollback for security migrations 0018-0020.
-- Refuses to run once application sessions exist. After cutover, restore the
-- reviewed database backup instead of using this script.

begin;

do $$ begin
  if exists (select 1 from app_private.auth_sessions) then
    raise exception 'pre-cutover rollback refused: sessions exist';
  end if;
end $$;

-- Policies depend on the authorization helpers below. Remove the complete
-- hardened set first so rollback remains explicit and dependency-ordered.
do $$
declare policy_record record;
begin
  for policy_record in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any(array[
      'projects','project_memberships','profiles','contacts','interactions',
      'base_meeting_reports','meeting_houses','meeting_reminders','tours','expenses',
      'bonus_cancellations','payment_config','notifications','notification_reads',
      'push_subscriptions','fcm_tokens','feedback_reports'
    ])
  loop
    execute format('drop policy if exists %I on public.%I', policy_record.policyname, policy_record.tablename);
  end loop;
end $$;

drop trigger if exists audit_projects_changes on public.projects;
drop trigger if exists audit_project_memberships_changes on public.project_memberships;
drop trigger if exists audit_profiles_changes on public.profiles;
drop trigger if exists audit_contacts_changes on public.contacts;
drop trigger if exists audit_interactions_changes on public.interactions;
drop trigger if exists audit_base_meeting_reports_changes on public.base_meeting_reports;
drop trigger if exists audit_meeting_houses_changes on public.meeting_houses;
drop trigger if exists audit_meeting_reminders_changes on public.meeting_reminders;
drop trigger if exists audit_tours_changes on public.tours;
drop trigger if exists audit_expenses_changes on public.expenses;
drop trigger if exists audit_bonus_cancellations_changes on public.bonus_cancellations;
drop trigger if exists audit_payment_config_changes on public.payment_config;
drop trigger if exists audit_notifications_changes on public.notifications;
drop trigger if exists audit_push_subscriptions_changes on public.push_subscriptions;
drop trigger if exists audit_fcm_tokens_changes on public.fcm_tokens;
drop trigger if exists audit_feedback_reports_changes on public.feedback_reports;

drop function if exists public.app_user_security_invalidate(uuid,text);
drop function if exists public.app_identity_resolve(text);
drop function if exists public.app_membership_change(text,uuid,uuid,integer,text,text);
drop function if exists public.app_audit_append(uuid,text,integer,text,text,text,text,text,uuid,text,jsonb);
drop function if exists public.app_rate_limit_consume(text,integer,integer);
drop function if exists public.app_session_refresh_tokens(text,text,text,text,integer,timestamptz);
drop function if exists public.app_session_revoke(text,text);
drop function if exists public.app_session_rotate(text,text,text,text,integer,timestamptz,text,smallint,integer,text,timestamptz,integer,timestamptz,timestamptz,text);
drop function if exists public.app_session_touch(text,timestamptz,timestamptz);
drop function if exists public.app_session_load(text);
drop function if exists public.app_session_create(text,uuid,text,text,integer,timestamptz,text,smallint,integer,text,timestamptz,integer,timestamptz,timestamptz);

drop function if exists public.app_security_posture();
drop function if exists public.app_notification_recipients(integer);
drop function if exists public.app_current_role();
drop function if exists public.app_current_project_ids();
drop function if exists public.app_current_activist_code();
drop function if exists public.app_has_project_role(integer,text[]);
drop function if exists public.app_is_ceo();
drop function if exists public.app_user_active();
drop function if exists app_private.audit_row_change();

alter table public.meeting_houses drop column if exists assigned_user_ids;
alter table public.meeting_reminders drop column if exists project_id;
alter table public.bonus_cancellations
  drop column if exists cancelled_by_user_id,
  drop column if exists beneficiary_user_id;

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
