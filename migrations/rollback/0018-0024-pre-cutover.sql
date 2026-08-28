-- Pre-cutover rollback for the official chain:
-- 0024 -> 0023 -> 0022 -> 0021 -> 0020 -> 0019 -> 0018.
-- This script deliberately fails closed. After application cutover or real writes
-- to new columns, restore the reviewed backup instead of using this rollback.

begin;

do $$ begin
  if exists (select 1 from app_private.auth_sessions) then
    raise exception 'pre-cutover rollback refused: sessions exist';
  end if;
end $$;

-- 0024: finance projection. Redacted audit rows may remain until app_private is
-- removed with 0018; no business row depends on this function pre-cutover.
revoke all on function public.app_finance_summary(text,integer,uuid) from public, anon, authenticated;
drop function if exists public.app_finance_summary(text,integer,uuid);

-- 0023: restore legacy compatibility columns before their NOT NULL constraints.
revoke all on function public.app_enqueue_notification_event(text,text,integer) from public, anon, authenticated;
drop function if exists public.app_enqueue_notification_event(text,text,integer);
drop index if exists public.push_subscriptions_endpoint_uq;

update public.notifications n set recipient_id = p.activist_code::text
from public.profiles p
where n.recipient_id is null and n.recipient_user_id = p.id;
update public.push_subscriptions s set activist_id = p.activist_code::text
from public.profiles p
where s.activist_id is null and s.user_id = p.id;
update public.fcm_tokens f set activist_id = p.activist_code::text
from public.profiles p
where f.activist_id is null and f.user_id = p.id;

do $$ begin
  if exists (select 1 from public.notifications where recipient_id is null) then
    raise exception 'pre-cutover rollback refused: notification legacy recipient mapping missing';
  end if;
  if exists (select 1 from public.push_subscriptions where activist_id is null) then
    raise exception 'pre-cutover rollback refused: push legacy owner mapping missing';
  end if;
  if exists (select 1 from public.fcm_tokens where activist_id is null) then
    raise exception 'pre-cutover rollback refused: fcm legacy owner mapping missing';
  end if;
end $$;

alter table public.notifications alter column recipient_id set not null;
alter table public.push_subscriptions alter column activist_id set not null;
alter table public.fcm_tokens alter column activist_id set not null;

-- 0022: removing these columns is allowed only before they carry new workflow data.
do $$ begin
  if exists (
    select 1 from public.tours
    where reported_by_user_id is not null or cancellation_reason is not null or status = 'cancelled'
  ) then
    raise exception 'pre-cutover rollback refused: reported_by_user_id or cancellation_reason data exists';
  end if;
end $$;
revoke all on function public.app_submit_tour_report(text,jsonb) from public, anon, authenticated;
drop function if exists public.app_submit_tour_report(text,jsonb);
drop index if exists public.tours_reported_by_user_idx;
alter table public.tours
  drop constraint if exists tours_cancellation_reason_len_chk,
  drop constraint if exists tours_status_security_chk,
  drop column if exists cancellation_reason,
  drop column if exists reported_by_user_id;

-- 0021: idempotency/cancellation values are irreversible without a backup.
do $$ begin
  if exists (
    select 1 from public.meeting_reminders
    where idempotency_key is not null or cancelled_at is not null
  ) then
    raise exception 'pre-cutover rollback refused: idempotency_key or cancelled_at data exists';
  end if;
end $$;
revoke all on function public.app_cancel_meeting_reminders(text) from public, anon, authenticated;
drop function if exists public.app_cancel_meeting_reminders(text);
alter table public.meeting_reminders
  drop constraint if exists meeting_reminders_idempotency_format_chk;
drop index if exists public.meeting_reminders_idempotency_uq;
alter table public.meeting_reminders
  drop column if exists cancelled_at,
  drop column if exists idempotency_key;

-- 0020 service and authenticated RPCs.
drop function if exists public.check_contact_duplicate(integer,text);
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

-- 0019 policies depend on authorization helpers. Remove the complete hardened
-- policy/trigger set first, then revoke authenticated table authority so rollback
-- remains fail-closed until the reviewed pre-hardening backup is restored.
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

revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;

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

drop function if exists public.app_security_posture();
drop function if exists public.app_notification_recipients(integer);
drop function if exists public.app_current_role();
drop function if exists public.app_current_project_ids();
drop function if exists public.app_current_activist_code();
drop function if exists public.app_has_project_role(integer,text[]);
drop function if exists public.app_has_active_membership(integer);
drop function if exists public.app_is_ceo();
drop function if exists public.app_user_active();
drop function if exists app_private.audit_row_change();

alter table public.meeting_houses drop column if exists assigned_user_ids;
alter table public.meeting_reminders drop column if exists project_id;
alter table public.bonus_cancellations
  drop column if exists cancelled_by_user_id,
  drop column if exists beneficiary_user_id;

-- 0018 private state and UUID compatibility columns.
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
