-- 0019_security_rls.sql
-- Explicit deny-by-default grants and RLS. File-only in G1; do not run until
-- the separately approved G5 isolated Supabase test gate.

begin;

-- The approved legacy production baseline stores meeting-house assignments as
-- JSONB, while the hardened identity-pair contract uses integer[] on both
-- meeting_houses and tours. Normalize that one legacy shape before any array
-- operators, constraints, or dual-write triggers are installed.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'meeting_houses'
  loop
    execute format('drop policy if exists %I on public.meeting_houses', policy_record.policyname);
  end loop;
end $$;

create or replace function app_private.jsonb_integer_array(p_value jsonb)
returns integer[]
language plpgsql immutable
set search_path = pg_catalog
as $$
declare
  v_result integer[];
begin
  if p_value is null then return '{}'::integer[]; end if;
  if jsonb_typeof(p_value) <> 'array' then
    raise exception 'security migration refused: meeting_houses assigned_activists must be a JSON array'
      using errcode = '23514';
  end if;

  begin
    select coalesce(array_agg(e.value::integer order by e.ordinality), '{}'::integer[])
      into v_result
    from jsonb_array_elements_text(p_value) with ordinality as e(value, ordinality);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'security migration refused: meeting_houses assigned_activists must contain integers'
      using errcode = '23514';
  end;
  return v_result;
end $$;

do $$
declare
  v_udt_name text;
begin
  select c.udt_name into v_udt_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'meeting_houses'
    and c.column_name = 'assigned_activists';

  if v_udt_name = 'jsonb' then
    if exists (
      select 1 from public.meeting_houses
      where assigned_activists is not null
        and jsonb_typeof(assigned_activists) <> 'array'
    ) then
      raise exception 'security migration refused: meeting_houses assigned_activists must be a JSON array'
        using errcode = '23514';
    end if;

    alter table public.meeting_houses alter column assigned_activists drop default;
    alter table public.meeting_houses alter column assigned_activists type integer[]
      using app_private.jsonb_integer_array(assigned_activists);
    alter table public.meeting_houses alter column assigned_activists set default '{}';
    alter table public.meeting_houses alter column assigned_activists set not null;
  elsif v_udt_name <> '_int4' then
    raise exception 'security migration refused: incompatible meeting_houses assigned_activists type %', v_udt_name
      using errcode = '42804';
  end if;
end $$;

drop function app_private.jsonb_integer_array(jsonb);

alter table public.meeting_houses
  add column if not exists assigned_user_ids uuid[] not null default '{}';
alter table public.meeting_reminders
  add column if not exists project_id integer references public.projects(id);
alter table public.bonus_cancellations
  add column if not exists beneficiary_user_id uuid references auth.users(id),
  add column if not exists cancelled_by_user_id uuid references auth.users(id);

update public.meeting_houses h
set assigned_user_ids = coalesce((
  select array_agg(p.id order by p.id)
  from public.profiles p
  where p.activist_code = any(h.assigned_activists)
), '{}'::uuid[])
where coalesce(cardinality(h.assigned_activists), 0) > 0
  and coalesce(cardinality(h.assigned_user_ids), 0) = 0;

update public.meeting_reminders r set project_id = h.project_id
from public.meeting_houses h
where r.project_id is null and r.meeting_id::text = h.id::text;
update public.meeting_reminders r set project_id = p.project_id
from public.profiles p
where r.project_id is null and r.recipient_user_id = p.id;

update public.bonus_cancellations b set beneficiary_user_id = p.id
from public.profiles p
where b.activist_id = p.activist_code and b.beneficiary_user_id is null;
update public.bonus_cancellations b set cancelled_by_user_id = p.id
from public.profiles p
where b.cancelled_by = p.activist_code and b.cancelled_by_user_id is null;

do $$ begin
  if exists (
    select 1 from public.meeting_houses h, unnest(h.assigned_activists) legacy_code
    where not exists (select 1 from public.profiles p where p.activist_code = legacy_code)
  ) then raise exception 'security backfill refused: meeting_houses assigned mapping missing'; end if;
  if exists (select 1 from public.meeting_reminders where project_id is null)
    then raise exception 'security backfill refused: meeting_reminders project mapping missing'; end if;
  if exists (select 1 from public.bonus_cancellations where activist_id is not null and beneficiary_user_id is null)
    then raise exception 'security backfill refused: bonus_cancellations beneficiary mapping missing'; end if;
  if exists (select 1 from public.bonus_cancellations where cancelled_by is not null and cancelled_by_user_id is null)
    then raise exception 'security backfill refused: bonus_cancellations actor mapping missing'; end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meeting_houses_assignment_identity_pair_chk') then
    alter table public.meeting_houses add constraint meeting_houses_assignment_identity_pair_chk
      check (cardinality(assigned_user_ids) = cardinality(assigned_activists)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bonus_cancellations_beneficiary_identity_pair_chk') then
    alter table public.bonus_cancellations add constraint bonus_cancellations_beneficiary_identity_pair_chk
      check ((beneficiary_user_id is null) = (activist_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bonus_cancellations_actor_identity_pair_chk') then
    alter table public.bonus_cancellations add constraint bonus_cancellations_actor_identity_pair_chk
      check ((cancelled_by_user_id is null) = (cancelled_by is null)) not valid;
  end if;
end $$;

alter table public.meeting_houses validate constraint meeting_houses_assignment_identity_pair_chk;
alter table public.bonus_cancellations validate constraint bonus_cancellations_beneficiary_identity_pair_chk;
alter table public.bonus_cancellations validate constraint bonus_cancellations_actor_identity_pair_chk;

drop trigger if exists sync_meeting_houses_identity on public.meeting_houses;
create trigger sync_meeting_houses_identity before insert or update on public.meeting_houses for each row
  execute function app_private.sync_identity_array_pair('assigned_user_ids', 'assigned_activists');
drop trigger if exists sync_bonus_cancellations_identity on public.bonus_cancellations;
create trigger sync_bonus_cancellations_identity before insert or update on public.bonus_cancellations for each row
  execute function app_private.sync_identity_pair('beneficiary_user_id', 'activist_id');
drop trigger if exists sync_bonus_cancellations_actor_identity on public.bonus_cancellations;
create trigger sync_bonus_cancellations_actor_identity before insert or update on public.bonus_cancellations for each row
  execute function app_private.sync_identity_pair('cancelled_by_user_id', 'cancelled_by');

create or replace function public.app_user_active()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.disabled_at is null
  )
$$;

-- Boolean-only membership predicate. The caller identity always comes from the
-- authenticated JWT; the project argument can only narrow that caller's scope.
create or replace function public.app_has_active_membership(p_project_id integer)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
    from public.project_memberships pm
    join public.profiles p on p.id = pm.user_id
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.status = 'active'
      and p.disabled_at is null
  )
$$;

create or replace function public.app_is_ceo()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.disabled_at is null and p.global_role = 'ceo'
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  )
$$;

create or replace function public.app_has_project_role(p_project_id integer, p_roles text[])
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
    from public.project_memberships pm
    join public.profiles p on p.id = pm.user_id
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.status = 'active'
      and pm.role = any(p_roles)
      and p.disabled_at is null
      and (pm.role <> 'head' or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  )
$$;

create or replace function public.app_current_activist_code()
returns integer language sql stable security definer set search_path = pg_catalog, public as $$
  select p.activist_code from public.profiles p
  where p.id = auth.uid() and p.disabled_at is null
$$;

create or replace function public.app_current_project_ids()
returns integer[] language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(pm.project_id order by pm.project_id), '{}'::integer[])
  from public.project_memberships pm
  join public.profiles p on p.id = pm.user_id
  where pm.user_id = auth.uid() and pm.status = 'active' and p.disabled_at is null
$$;

create or replace function public.app_current_role()
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select case
    when p.global_role = 'ceo' then 'ceo'
    else (select pm.role from public.project_memberships pm
          where pm.user_id = p.id and pm.status = 'active'
          order by pm.project_id limit 1)
  end
  from public.profiles p where p.id = auth.uid() and p.disabled_at is null
$$;

revoke all on function public.app_user_active() from public, anon;
revoke all on function public.app_has_active_membership(integer) from public, anon;
revoke all on function public.app_is_ceo() from public, anon;
revoke all on function public.app_has_project_role(integer,text[]) from public, anon;
revoke all on function public.app_current_activist_code() from public, anon;
revoke all on function public.app_current_project_ids() from public, anon;
revoke all on function public.app_current_role() from public, anon;
grant execute on function public.app_user_active() to authenticated;
grant execute on function public.app_has_active_membership(integer) to authenticated;
grant execute on function public.app_is_ceo() to authenticated;
grant execute on function public.app_has_project_role(integer,text[]) to authenticated;
grant execute on function public.app_current_activist_code() to authenticated;
grant execute on function public.app_current_project_ids() to authenticated;
grant execute on function public.app_current_role() to authenticated;

alter table public.projects enable row level security;
alter table public.projects force row level security;
alter table public.project_memberships enable row level security;
alter table public.project_memberships force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.contacts enable row level security;
alter table public.contacts force row level security;
alter table public.interactions enable row level security;
alter table public.interactions force row level security;
alter table public.base_meeting_reports enable row level security;
alter table public.base_meeting_reports force row level security;
alter table public.meeting_houses enable row level security;
alter table public.meeting_houses force row level security;
alter table public.meeting_reminders enable row level security;
alter table public.meeting_reminders force row level security;
alter table public.tours enable row level security;
alter table public.tours force row level security;
alter table public.expenses enable row level security;
alter table public.expenses force row level security;
alter table public.bonus_cancellations enable row level security;
alter table public.bonus_cancellations force row level security;
alter table public.payment_config enable row level security;
alter table public.payment_config force row level security;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
alter table public.notification_reads enable row level security;
alter table public.notification_reads force row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
alter table public.fcm_tokens enable row level security;
alter table public.fcm_tokens force row level security;
alter table public.feedback_reports enable row level security;
alter table public.feedback_reports force row level security;

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

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select, insert, delete on public.projects to authenticated;
grant select (project_id, user_id, role, status) on public.project_memberships to authenticated;
grant select (id, activist_code, name, global_role, security_version, disabled_at) on public.profiles to authenticated;
grant select, insert, delete on public.contacts to authenticated;
grant select, insert on public.interactions to authenticated;
grant select, insert, delete on public.base_meeting_reports to authenticated;
grant select, insert, delete on public.meeting_houses to authenticated;
grant select, insert on public.meeting_reminders to authenticated;
grant select, insert on public.tours to authenticated;
grant select, insert on public.expenses to authenticated;
-- Cancellation markers are derived financial state. Authenticated callers may
-- inspect or CEO-delete rows, but creation is restricted to app_cancel_bonus().
grant select, delete on public.bonus_cancellations to authenticated;
grant select, insert on public.payment_config to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
grant select, insert, delete on public.notification_reads to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, insert, delete on public.fcm_tokens to authenticated;
grant select, insert, delete on public.feedback_reports to authenticated;

-- UPDATE is granted only on an explicit business-field allowlist. The migration
-- filters the allowlist through the actual legacy schema so an absent optional
-- compatibility column cannot make the migration fail, while a future/unknown
-- column remains denied by default.
do $$
declare
  v_table text;
  v_allowed text[];
  v_columns text;
begin
  for v_table, v_allowed in
    select * from (values
      ('projects', array['name']::text[]),
      ('contacts', array[
        'name','phone','city','area','depth','profession','age','gender','notes',
        'mitzvot','mitzvot_history','high_potential','days_since_last_contact',
        'joined_at','source','referred_by','next_action','next_action_date',
        'last_interaction_date','how_met','is_graduate','meeting_place_city',
        'meeting_place_number','meetingHouseCity','meetingHouseNumber','meetingHouseKey'
      ]::text[]),
      ('interactions', array[
        'type','quality','notes','participants','date','time','duration_minutes',
        'outcome','description','ai_summary','next_action','next_action_date'
      ]::text[]),
      ('base_meeting_reports', array['report','notes','summary','results']::text[]),
      ('meeting_houses', array[
        'house_number','settlement','city','host_name','facilitator_name','meetings','notes'
      ]::text[]),
      ('tours', array['tour_number','settlement','date','start_time','notes']::text[]),
      ('payment_config', array[
        'rate_phone_friendly','rate_phone_torani','rate_video_friendly','rate_video_torani',
        'rate_frontal_friendly','rate_frontal_torani','rate_multi','rate_shabbat_hosting',
        'rate_tour_guide','min_duration_minutes','cap_phone','cap_frontal','cap_multi',
        'cap_contact_phone_high','cap_contact_phone_regular','cap_contact_frontal_high',
        'cap_contact_frontal_regular','bonus_loyalty_6','bonus_loyalty_4',
        'bonus_mitzvot_level','bonus_new_participant'
      ]::text[]),
      ('push_subscriptions', array['subscription']::text[]),
      ('fcm_tokens', array['token','platform','updated_at']::text[])
    ) as allowlist(table_name, column_names)
  loop
    select string_agg(format('%I', c.column_name), ', ' order by array_position(v_allowed, c.column_name))
      into v_columns
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = v_table
      and c.column_name = any(v_allowed);

    if v_columns is not null then
      execute format('grant update (%s) on public.%I to authenticated', v_columns, v_table);
    end if;
  end loop;
end $$;

-- RLS cannot compare OLD with NEW. This trigger is the independent database
-- invariant for direct anon/authenticated statements. Narrow SECURITY DEFINER
-- workflow RPCs execute as their audited owner and therefore may perform the
-- validated transition without a caller-settable bypass flag.
create or replace function app_private.enforce_immutable_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
declare
  v_column text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  foreach v_column in array tg_argv loop
    if (to_jsonb(new) -> v_column) is distinct from (to_jsonb(old) -> v_column) then
      raise exception 'immutable authority or workflow field: %.%', tg_table_name, v_column
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function app_private.enforce_immutable_columns() from public, anon, authenticated;

drop trigger if exists enforce_projects_immutable_authority on public.projects;
create trigger enforce_projects_immutable_authority before update on public.projects for each row
  execute function app_private.enforce_immutable_columns('id','security_run_id');
drop trigger if exists enforce_project_memberships_immutable_authority on public.project_memberships;
create trigger enforce_project_memberships_immutable_authority before update on public.project_memberships for each row
  execute function app_private.enforce_immutable_columns('project_id','user_id','role','status','created_by','created_at','updated_at');
drop trigger if exists enforce_profiles_immutable_authority on public.profiles;
create trigger enforce_profiles_immutable_authority before update on public.profiles for each row
  execute function app_private.enforce_immutable_columns('id','global_role','role','security_version','disabled_at','project_id','project_ids','activist_code','security_run_id');
drop trigger if exists enforce_contacts_immutable_authority on public.contacts;
create trigger enforce_contacts_immutable_authority before update on public.contacts for each row
  execute function app_private.enforce_immutable_columns('id','project_id','assigned_user_id','activist_id','tour_id','status','is_active','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_interactions_immutable_authority on public.interactions;
create trigger enforce_interactions_immutable_authority before update on public.interactions for each row
  execute function app_private.enforce_immutable_columns('id','project_id','contact_id','actor_user_id','activist_id','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_base_meeting_reports_immutable_authority on public.base_meeting_reports;
create trigger enforce_base_meeting_reports_immutable_authority before update on public.base_meeting_reports for each row
  execute function app_private.enforce_immutable_columns('id','project_id','house_id','meeting_house_id','actor_user_id','activist_id','status','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_meeting_houses_immutable_authority on public.meeting_houses;
create trigger enforce_meeting_houses_immutable_authority before update on public.meeting_houses for each row
  execute function app_private.enforce_immutable_columns('id','project_id','assigned_user_ids','assigned_activists','status','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_meeting_reminders_immutable_authority on public.meeting_reminders;
create trigger enforce_meeting_reminders_immutable_authority before update on public.meeting_reminders for each row
  execute function app_private.enforce_immutable_columns('id','meeting_id','project_id','recipient_user_id','coordinator_id','activist_id','type','idempotency_key','cancelled_at','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_tours_immutable_authority on public.tours;
create trigger enforce_tours_immutable_authority before update on public.tours for each row
  execute function app_private.enforce_immutable_columns('id','project_id','guide_user_id','host_user_id','assigned_user_ids','guide_activist_id','host_activist_id','assigned_activists','guide_name','status','report','reported_by_user_id','reported_at','cancellation_reason','cancelled_at','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_expenses_immutable_authority on public.expenses;
create trigger enforce_expenses_immutable_authority before update on public.expenses for each row
  execute function app_private.enforce_immutable_columns('id','project_id','actor_user_id','activist_id','status','approved_by_user_id','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_bonus_cancellations_immutable_authority on public.bonus_cancellations;
create trigger enforce_bonus_cancellations_immutable_authority before update on public.bonus_cancellations for each row
  execute function app_private.enforce_immutable_columns('id','project_id','beneficiary_user_id','cancelled_by_user_id','activist_id','cancelled_by','bonus_key','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_payment_config_immutable_authority on public.payment_config;
create trigger enforce_payment_config_immutable_authority before update on public.payment_config for each row
  execute function app_private.enforce_immutable_columns('id','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_notifications_immutable_authority on public.notifications;
create trigger enforce_notifications_immutable_authority before update on public.notifications for each row
  execute function app_private.enforce_immutable_columns('id','project_id','recipient_user_id','recipient_id','type','title','body','url','priority','client_id','resource_type','resource_id','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_notification_reads_immutable_authority on public.notification_reads;
create trigger enforce_notification_reads_immutable_authority before update on public.notification_reads for each row
  execute function app_private.enforce_immutable_columns('id','recipient_user_id','recipient_id','notification_id','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_push_subscriptions_immutable_authority on public.push_subscriptions;
create trigger enforce_push_subscriptions_immutable_authority before update on public.push_subscriptions for each row
  execute function app_private.enforce_immutable_columns('id','user_id','activist_id','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_fcm_tokens_immutable_authority on public.fcm_tokens;
create trigger enforce_fcm_tokens_immutable_authority before update on public.fcm_tokens for each row
  execute function app_private.enforce_immutable_columns('id','user_id','activist_id','security_run_id','created_at','created_by','updated_by');
drop trigger if exists enforce_feedback_reports_immutable_authority on public.feedback_reports;
create trigger enforce_feedback_reports_immutable_authority before update on public.feedback_reports for each row
  execute function app_private.enforce_immutable_columns('id','project_id','reporter_user_id','reporter_id','status','reviewed_at','reviewed_by_user_id','reviewer_note','issue_url','security_run_id','created_at','created_by','updated_by');

create policy projects_select on public.projects for select to authenticated using (
  public.app_is_ceo() or (public.app_user_active() and exists (
    select 1 from public.project_memberships pm
    where pm.project_id = projects.id and pm.user_id = auth.uid() and pm.status = 'active'
  ))
);
create policy projects_insert on public.projects for insert to authenticated with check (public.app_is_ceo());
create policy projects_update on public.projects for update to authenticated
  using (public.app_is_ceo()) with check (public.app_is_ceo());
create policy projects_delete on public.projects for delete to authenticated using (public.app_is_ceo());

create policy project_memberships_select on public.project_memberships for select to authenticated using (
  (user_id = auth.uid() and public.app_user_active()) or public.app_is_ceo()
);

create policy profiles_select on public.profiles for select to authenticated using (
  (id = auth.uid() and public.app_user_active()) or public.app_is_ceo()
);

create policy contacts_select on public.contacts for select to authenticated using (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy contacts_insert on public.contacts for insert to authenticated with check (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy contacts_update on public.contacts for update to authenticated
using (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
)
with check (
  public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
  or (assigned_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy contacts_delete on public.contacts for delete to authenticated using (public.app_is_ceo());

create policy interactions_select on public.interactions for select to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']) and exists (
    select 1 from public.contacts c where c.id = interactions.contact_id and c.assigned_user_id = auth.uid()
  ))
);
create policy interactions_insert on public.interactions for insert to authenticated with check (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']) and exists (
    select 1 from public.contacts c where c.id = interactions.contact_id and c.assigned_user_id = auth.uid()
  ))
);
create policy interactions_update on public.interactions for update to authenticated
using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']) and exists (
    select 1 from public.contacts c where c.id = interactions.contact_id and c.assigned_user_id = auth.uid()
  ))
)
with check (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']) and exists (
    select 1 from public.contacts c where c.id = interactions.contact_id and c.assigned_user_id = auth.uid()
  ))
);
create policy interactions_delete on public.interactions for delete to authenticated using (public.app_is_ceo());

create policy base_meeting_reports_select on public.base_meeting_reports for select to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy base_meeting_reports_insert on public.base_meeting_reports for insert to authenticated with check (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy base_meeting_reports_update on public.base_meeting_reports for update to authenticated
using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
)
with check (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
);
create policy base_meeting_reports_delete on public.base_meeting_reports for delete to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head'])
);

create policy meeting_houses_select on public.meeting_houses for select to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (auth.uid() = any(assigned_user_ids) and public.app_has_project_role(project_id, array['activist']))
);
create policy meeting_houses_insert on public.meeting_houses for insert to authenticated with check (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
);
create policy meeting_houses_update on public.meeting_houses for update to authenticated
using (public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord']))
with check (public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord']));
create policy meeting_houses_delete on public.meeting_houses for delete to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head'])
);

create policy meeting_reminders_select on public.meeting_reminders for select to authenticated using (
  (recipient_user_id = auth.uid() and public.app_has_active_membership(project_id))
  or public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
);
create policy meeting_reminders_insert on public.meeting_reminders for insert to authenticated with check (
  recipient_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist'])
);
-- UPDATE/DELETE are intentionally absent. Cancellation is exposed only through
-- app_cancel_meeting_reminders(), which derives recipient and project from rows.

create policy tours_select on public.tours for select to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (public.app_has_active_membership(project_id) and (
    guide_user_id = auth.uid() or host_user_id = auth.uid() or auth.uid() = any(assigned_user_ids)
  ))
);
create policy tours_insert on public.tours for insert to authenticated with check (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
);
create policy tours_update on public.tours for update to authenticated
using (public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord']))
with check (public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord']));
create policy tours_delete on public.tours for delete to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head'])
);

create policy expenses_select on public.expenses for select to authenticated using (
  (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
  or public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','finance'])
);
create policy expenses_insert on public.expenses for insert to authenticated with check (
  actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist'])
);
create policy expenses_update on public.expenses for update to authenticated
using (
  (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
  or public.app_is_ceo() or public.app_has_project_role(project_id, array['head'])
)
with check (
  (actor_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist']))
  or public.app_is_ceo() or public.app_has_project_role(project_id, array['head'])
);
create policy expenses_delete on public.expenses for delete to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head'])
);

create policy bonus_cancellations_select on public.bonus_cancellations for select to authenticated using (
  (beneficiary_user_id = auth.uid() and public.app_has_active_membership(project_id)) or public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord','finance'])
);
create policy bonus_cancellations_insert on public.bonus_cancellations for insert to authenticated with check (
  cancelled_by_user_id = auth.uid() and public.app_has_project_role(project_id, array['head','coord'])
  or public.app_is_ceo()
);
create policy bonus_cancellations_delete on public.bonus_cancellations for delete to authenticated using (public.app_is_ceo());

create policy payment_config_select on public.payment_config for select to authenticated using (public.app_user_active());
create policy payment_config_insert on public.payment_config for insert to authenticated with check (public.app_is_ceo());
create policy payment_config_update on public.payment_config for update to authenticated
  using (public.app_is_ceo()) with check (public.app_is_ceo());

create policy notifications_select on public.notifications for select to authenticated using (
  recipient_user_id = auth.uid() and public.app_user_active()
);
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_user_id = auth.uid() and public.app_user_active())
  with check (recipient_user_id = auth.uid() and public.app_user_active());
create policy notifications_delete on public.notifications for delete to authenticated using (
  recipient_user_id = auth.uid() and public.app_user_active()
);

create policy notification_reads_select on public.notification_reads for select to authenticated using (
  recipient_user_id = auth.uid() and public.app_user_active()
);
create policy notification_reads_insert on public.notification_reads for insert to authenticated with check (
  recipient_user_id = auth.uid() and public.app_user_active()
);
create policy notification_reads_update on public.notification_reads for update to authenticated
  using (recipient_user_id = auth.uid() and public.app_user_active())
  with check (recipient_user_id = auth.uid() and public.app_user_active());
create policy notification_reads_delete on public.notification_reads for delete to authenticated using (
  recipient_user_id = auth.uid() and public.app_user_active()
);

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (
  user_id = auth.uid() and public.app_user_active()
);
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated with check (
  user_id = auth.uid() and public.app_user_active()
);
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid() and public.app_user_active())
  with check (user_id = auth.uid() and public.app_user_active());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using (
  user_id = auth.uid() and public.app_user_active()
);

create policy fcm_tokens_select on public.fcm_tokens for select to authenticated using (
  user_id = auth.uid() and public.app_user_active()
);
create policy fcm_tokens_insert on public.fcm_tokens for insert to authenticated with check (
  user_id = auth.uid() and public.app_user_active()
);
create policy fcm_tokens_update on public.fcm_tokens for update to authenticated
  using (user_id = auth.uid() and public.app_user_active())
  with check (user_id = auth.uid() and public.app_user_active());
create policy fcm_tokens_delete on public.fcm_tokens for delete to authenticated using (
  user_id = auth.uid() and public.app_user_active()
);

create policy feedback_reports_select on public.feedback_reports for select to authenticated using (
  (reporter_user_id = auth.uid() and public.app_has_active_membership(project_id)) or public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord'])
);
create policy feedback_reports_insert on public.feedback_reports for insert to authenticated with check (
  reporter_user_id = auth.uid() and exists (
    select 1 from public.project_memberships pm
    where pm.user_id = auth.uid() and pm.project_id = feedback_reports.project_id and pm.status = 'active'
  )
);
create policy feedback_reports_update on public.feedback_reports for update to authenticated
using (public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord']))
with check (public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord']));
create policy feedback_reports_delete on public.feedback_reports for delete to authenticated using (public.app_is_ceo());

alter view public.activist_directory set (security_invoker = on);

create or replace function public.app_project_directory(p_project_id integer)
returns table(user_id uuid, activist_code integer, name text, role text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if p_project_id is null or auth.uid() is null or not (
    public.app_is_ceo()
    or public.app_has_project_role(p_project_id, array['head','coord','finance'])
    or public.app_has_project_role(p_project_id, array['activist'])
  ) then
    raise exception 'project directory not found' using errcode = '42501';
  end if;
  return query
  select pm.user_id, p.activist_code, p.name, pm.role
  from public.project_memberships pm
  join public.profiles p on p.id = pm.user_id
  where pm.project_id = p_project_id
    and pm.status = 'active'
    and p.disabled_at is null
    and (
      public.app_is_ceo()
      or public.app_has_project_role(p_project_id, array['head','coord','finance'])
      or pm.user_id = auth.uid()
    )
  order by p.name, pm.user_id;
end $$;
revoke all on function public.app_project_directory(integer) from public, anon;
grant execute on function public.app_project_directory(integer) to authenticated;

create or replace function public.app_project_members_are_active(
  p_project_id integer, p_user_ids uuid[]
) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_expected integer;
begin
  v_expected := cardinality(coalesce(p_user_ids, '{}'::uuid[]));
  if p_project_id is null or p_user_ids is null or auth.uid() is null
     or v_expected > 100
     or exists (select 1 from unnest(p_user_ids) candidate where candidate is null)
     or (select count(distinct candidate) from unnest(p_user_ids) candidate) <> v_expected
     or not (
       public.app_is_ceo()
       or public.app_has_project_role(p_project_id, array['head','coord'])
     ) then
    return false;
  end if;
  return (
    select count(*)
    from public.project_memberships pm
    join unnest(p_user_ids) requested(user_id) on requested.user_id = pm.user_id
    join public.profiles p on p.id = pm.user_id and p.disabled_at is null
    where pm.project_id = p_project_id and pm.status = 'active'
  ) = v_expected;
end $$;
revoke all on function public.app_project_members_are_active(integer,uuid[]) from public, anon;
grant execute on function public.app_project_members_are_active(integer,uuid[]) to authenticated;

-- INSERT checks must derive authority from the authenticated identity and the
-- referenced rows. RLS role checks alone are insufficient because a manager
-- could otherwise supply an owner, actor, contact, house, assignee or initial
-- workflow state from outside the row project. Service-role migration/fixture
-- writes have no auth.uid() and remain outside this authenticated-user guard.
create or replace function app_private.enforce_insert_authority()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_row jsonb := to_jsonb(new);
  v_house_id text;
begin
  if v_actor is null then
    return new;
  end if;

  case tg_table_name
    when 'contacts' then
      if new.assigned_user_id is null or not (
        (new.assigned_user_id = v_actor
          and public.app_has_project_role(new.project_id, array['activist']))
        or public.app_project_members_are_active(new.project_id, array[new.assigned_user_id])
      ) then
        raise exception 'invalid contact insert authority' using errcode = '42501';
      end if;

    when 'interactions' then
      if new.actor_user_id is distinct from v_actor or not exists (
        select 1 from public.contacts c
        where c.id::text = new.contact_id::text and c.project_id = new.project_id
      ) then
        raise exception 'invalid interaction insert authority' using errcode = '42501';
      end if;

    when 'base_meeting_reports' then
      if new.actor_user_id is distinct from v_actor then
        raise exception 'invalid base report insert authority' using errcode = '42501';
      end if;
      v_house_id := coalesce(v_row ->> 'house_id', v_row ->> 'meeting_house_id');
      if (v_row ? 'house_id' or v_row ? 'meeting_house_id') and (
        v_house_id is null or not exists (
          select 1 from public.meeting_houses h
          where h.id::text = v_house_id and h.project_id = new.project_id
        )
      ) then
        raise exception 'invalid base report house authority' using errcode = '42501';
      end if;

    when 'meeting_houses' then
      if not public.app_project_members_are_active(new.project_id, new.assigned_user_ids) then
        raise exception 'invalid meeting house insert authority' using errcode = '42501';
      end if;

    when 'meeting_reminders' then
      if new.recipient_user_id is distinct from v_actor or not exists (
        select 1 from public.base_meeting_reports r
        where r.id::text = new.meeting_id::text
          and r.project_id = new.project_id
          and r.actor_user_id = new.recipient_user_id
      ) then
        raise exception 'invalid meeting reminder insert authority' using errcode = '42501';
      end if;

    when 'tours' then
      if not public.app_project_members_are_active(new.project_id, new.assigned_user_ids)
        or (new.guide_user_id is not null and not
          public.app_project_members_are_active(new.project_id, array[new.guide_user_id]))
        or (new.host_user_id is not null and not
          public.app_project_members_are_active(new.project_id, array[new.host_user_id]))
        or v_row ->> 'status' is distinct from 'upcoming'
        or v_row ->> 'report' is not null
        or v_row ->> 'reported_by_user_id' is not null
        or v_row ->> 'reported_at' is not null
        or v_row ->> 'cancellation_reason' is not null
        or v_row ->> 'cancelled_at' is not null then
        raise exception 'invalid tour insert authority' using errcode = '42501';
      end if;

    when 'expenses' then
      if new.actor_user_id is distinct from v_actor then
        raise exception 'invalid expense insert authority' using errcode = '42501';
      end if;

    when 'bonus_cancellations' then
      if new.cancelled_by_user_id is distinct from v_actor
        or new.beneficiary_user_id is null
        or not public.app_project_members_are_active(
          new.project_id, array[new.beneficiary_user_id]
        )
        or split_part(new.bonus_key, '|', 1) is distinct from new.activist_id::text then
        raise exception 'invalid bonus cancellation insert authority' using errcode = '42501';
      end if;
  end case;

  return new;
end $$;
revoke all on function app_private.enforce_insert_authority() from public, anon, authenticated;

drop trigger if exists validate_contacts_insert_authority on public.contacts;
create trigger validate_contacts_insert_authority before insert on public.contacts for each row
  execute function app_private.enforce_insert_authority();
drop trigger if exists validate_interactions_insert_authority on public.interactions;
create trigger validate_interactions_insert_authority before insert on public.interactions for each row
  execute function app_private.enforce_insert_authority();
drop trigger if exists validate_base_meeting_reports_insert_authority on public.base_meeting_reports;
create trigger validate_base_meeting_reports_insert_authority before insert on public.base_meeting_reports for each row
  execute function app_private.enforce_insert_authority();
drop trigger if exists validate_meeting_houses_insert_authority on public.meeting_houses;
create trigger validate_meeting_houses_insert_authority before insert on public.meeting_houses for each row
  execute function app_private.enforce_insert_authority();
drop trigger if exists validate_meeting_reminders_insert_authority on public.meeting_reminders;
create trigger validate_meeting_reminders_insert_authority before insert on public.meeting_reminders for each row
  execute function app_private.enforce_insert_authority();
drop trigger if exists validate_tours_insert_authority on public.tours;
create trigger validate_tours_insert_authority before insert on public.tours for each row
  execute function app_private.enforce_insert_authority();
drop trigger if exists validate_expenses_insert_authority on public.expenses;
create trigger validate_expenses_insert_authority before insert on public.expenses for each row
  execute function app_private.enforce_insert_authority();
drop trigger if exists validate_bonus_cancellations_insert_authority on public.bonus_cancellations;
create trigger validate_bonus_cancellations_insert_authority before insert on public.bonus_cancellations for each row
  execute function app_private.enforce_insert_authority();

drop function if exists public.app_notification_recipients(integer);

create or replace function app_private.audit_row_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, app_private as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_project_id integer := nullif(v_row ->> 'project_id', '')::integer;
  v_audit_project_id integer := v_project_id;
  v_changed_fields text[] := case when tg_op = 'UPDATE' then array(
    select key from jsonb_each(to_jsonb(new)) n(key, value)
    where to_jsonb(old) -> key is distinct from n.value order by key
  ) else '{}'::text[] end;
  v_actor_user_id uuid := auth.uid();
  v_effective_role text;
  v_correlation_id uuid;
  v_trusted_session_hash text := nullif(current_setting('app.trusted_actor_session_hash', true), '');
  v_trusted_project_id integer;
  v_trusted_correlation_id text;
  v_trusted_effective_role text;
begin
  -- A service-role mutation may supply only the server-peppered session hash.
  -- Re-resolve that private, active AAL2 session before honoring any companion
  -- transaction-local attribution values; browser/JWT callers cannot forge it.
  if v_trusted_session_hash is not null then
    select s.user_id into v_actor_user_id
    from app_private.auth_sessions s
    join public.profiles actor on actor.id = s.user_id
    where s.session_hash = v_trusted_session_hash
      and s.aal = 2 and s.auth_state = 'active' and s.revoked_at is null
      and s.idle_expires_at > now() and s.absolute_expires_at > now()
      and actor.disabled_at is null;
    if found then
      select p.id into v_trusted_project_id
      from public.projects p
      where p.id::text = current_setting('app.trusted_project_id', true)
      limit 1;
      v_audit_project_id := coalesce(v_project_id, v_trusted_project_id);
      v_trusted_correlation_id := current_setting('app.trusted_correlation_id', true);
      if v_trusted_correlation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_correlation_id := v_trusted_correlation_id::uuid;
      end if;
      v_trusted_effective_role := current_setting('app.trusted_effective_role', true);
      if v_trusted_effective_role in ('ceo','head') then
        v_effective_role := v_trusted_effective_role;
      end if;
    else
      v_actor_user_id := auth.uid();
    end if;
  end if;
  if v_effective_role is null then
    v_effective_role := case when exists (
      select 1 from public.profiles actor
      where actor.id = v_actor_user_id and actor.global_role = 'ceo'
        and actor.disabled_at is null
    ) then 'ceo' else (
      select pm.role from public.project_memberships pm
      where pm.user_id = v_actor_user_id and pm.project_id = v_audit_project_id
        and pm.status = 'active'
      limit 1
    ) end;
  end if;
  insert into app_private.audit_events
    (actor_user_id, effective_role, project_id, action, resource_type, resource_id,
     result, correlation_id, metadata)
  values
    (v_actor_user_id, v_effective_role, v_audit_project_id, lower(tg_op), tg_table_name,
     coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'client_id'),
     'success', v_correlation_id, jsonb_build_object('changedFields', v_changed_fields));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function app_private.audit_row_change() from public, anon, authenticated;

drop trigger if exists audit_projects_changes on public.projects;
create trigger audit_projects_changes after insert or update or delete on public.projects for each row execute function app_private.audit_row_change();
drop trigger if exists audit_project_memberships_changes on public.project_memberships;
create trigger audit_project_memberships_changes after insert or update or delete on public.project_memberships for each row execute function app_private.audit_row_change();
drop trigger if exists audit_profiles_changes on public.profiles;
create trigger audit_profiles_changes after insert or update or delete on public.profiles for each row execute function app_private.audit_row_change();
drop trigger if exists audit_contacts_changes on public.contacts;
create trigger audit_contacts_changes after insert or update or delete on public.contacts for each row execute function app_private.audit_row_change();
drop trigger if exists audit_interactions_changes on public.interactions;
create trigger audit_interactions_changes after insert or update or delete on public.interactions for each row execute function app_private.audit_row_change();
drop trigger if exists audit_base_meeting_reports_changes on public.base_meeting_reports;
create trigger audit_base_meeting_reports_changes after insert or update or delete on public.base_meeting_reports for each row execute function app_private.audit_row_change();
drop trigger if exists audit_meeting_houses_changes on public.meeting_houses;
create trigger audit_meeting_houses_changes after insert or update or delete on public.meeting_houses for each row execute function app_private.audit_row_change();
drop trigger if exists audit_meeting_reminders_changes on public.meeting_reminders;
create trigger audit_meeting_reminders_changes after insert or update or delete on public.meeting_reminders for each row execute function app_private.audit_row_change();
drop trigger if exists audit_tours_changes on public.tours;
create trigger audit_tours_changes after insert or update or delete on public.tours for each row execute function app_private.audit_row_change();
drop trigger if exists audit_expenses_changes on public.expenses;
create trigger audit_expenses_changes after insert or update or delete on public.expenses for each row execute function app_private.audit_row_change();
drop trigger if exists audit_bonus_cancellations_changes on public.bonus_cancellations;
create trigger audit_bonus_cancellations_changes after insert or update or delete on public.bonus_cancellations for each row execute function app_private.audit_row_change();
drop trigger if exists audit_payment_config_changes on public.payment_config;
create trigger audit_payment_config_changes after insert or update or delete on public.payment_config for each row execute function app_private.audit_row_change();
drop trigger if exists audit_notifications_changes on public.notifications;
create trigger audit_notifications_changes after insert or update or delete on public.notifications for each row execute function app_private.audit_row_change();
drop trigger if exists audit_push_subscriptions_changes on public.push_subscriptions;
create trigger audit_push_subscriptions_changes after insert or update or delete on public.push_subscriptions for each row execute function app_private.audit_row_change();
drop trigger if exists audit_fcm_tokens_changes on public.fcm_tokens;
create trigger audit_fcm_tokens_changes after insert or update or delete on public.fcm_tokens for each row execute function app_private.audit_row_change();
drop trigger if exists audit_feedback_reports_changes on public.feedback_reports;
create trigger audit_feedback_reports_changes after insert or update or delete on public.feedback_reports for each row execute function app_private.audit_row_change();

create or replace function public.app_security_posture()
returns table(
  table_name text,
  rls_enabled boolean,
  rls_forced boolean,
  policy_commands text[],
  policy_count integer
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_expected_tables text[] := array[
    'projects','project_memberships','profiles','contacts','interactions',
    'base_meeting_reports','meeting_houses','meeting_reminders','tours','expenses',
    'bonus_cancellations','payment_config','notifications','notification_reads',
    'push_subscriptions','fcm_tokens','feedback_reports'
  ];
  v_expected_policies jsonb := jsonb_build_object(
    'projects', jsonb_build_array('projects_select','projects_insert','projects_update','projects_delete'),
    'project_memberships', jsonb_build_array('project_memberships_select'),
    'profiles', jsonb_build_array('profiles_select'),
    'contacts', jsonb_build_array('contacts_select','contacts_insert','contacts_update','contacts_delete'),
    'interactions', jsonb_build_array('interactions_select','interactions_insert','interactions_update','interactions_delete'),
    'base_meeting_reports', jsonb_build_array('base_meeting_reports_select','base_meeting_reports_insert','base_meeting_reports_update','base_meeting_reports_delete'),
    'meeting_houses', jsonb_build_array('meeting_houses_select','meeting_houses_insert','meeting_houses_update','meeting_houses_delete'),
    'meeting_reminders', jsonb_build_array('meeting_reminders_select','meeting_reminders_insert'),
    'tours', jsonb_build_array('tours_select','tours_insert','tours_update','tours_delete'),
    'expenses', jsonb_build_array('expenses_select','expenses_insert','expenses_update','expenses_delete'),
    'bonus_cancellations', jsonb_build_array('bonus_cancellations_select','bonus_cancellations_insert','bonus_cancellations_delete'),
    'payment_config', jsonb_build_array('payment_config_select','payment_config_insert','payment_config_update'),
    'notifications', jsonb_build_array('notifications_select','notifications_update','notifications_delete'),
    'notification_reads', jsonb_build_array('notification_reads_select','notification_reads_insert','notification_reads_update','notification_reads_delete'),
    'push_subscriptions', jsonb_build_array('push_subscriptions_select','push_subscriptions_insert','push_subscriptions_update','push_subscriptions_delete'),
    'fcm_tokens', jsonb_build_array('fcm_tokens_select','fcm_tokens_insert','fcm_tokens_update','fcm_tokens_delete'),
    'feedback_reports', jsonb_build_array('feedback_reports_select','feedback_reports_insert','feedback_reports_update','feedback_reports_delete')
  );
  v_expected_table_grants jsonb := jsonb_build_object(
    'projects', jsonb_build_array('delete','insert','select'),
    'project_memberships', jsonb_build_array(),
    'profiles', jsonb_build_array(),
    'contacts', jsonb_build_array('delete','insert','select'),
    'interactions', jsonb_build_array('insert','select'),
    'base_meeting_reports', jsonb_build_array('delete','insert','select'),
    'meeting_houses', jsonb_build_array('delete','insert','select'),
    'meeting_reminders', jsonb_build_array('insert','select'),
    'tours', jsonb_build_array('insert','select'),
    'expenses', jsonb_build_array('insert','select'),
    'bonus_cancellations', jsonb_build_array('delete','select'),
    'payment_config', jsonb_build_array('insert','select'),
    'notifications', jsonb_build_array('delete','select'),
    'notification_reads', jsonb_build_array('delete','insert','select'),
    'push_subscriptions', jsonb_build_array('delete','insert','select'),
    'fcm_tokens', jsonb_build_array('delete','insert','select'),
    'feedback_reports', jsonb_build_array('delete','insert','select')
  );
  v_allowed_column_grants text[] := array[
    'project_memberships:select:project_id','project_memberships:select:user_id',
    'project_memberships:select:role','project_memberships:select:status',
    'profiles:select:id','profiles:select:activist_code','profiles:select:name',
    'profiles:select:global_role','profiles:select:security_version','profiles:select:disabled_at',
    'projects:update:name',
    'contacts:update:name','contacts:update:phone','contacts:update:city','contacts:update:area',
    'contacts:update:depth','contacts:update:profession','contacts:update:age','contacts:update:gender',
    'contacts:update:notes','contacts:update:mitzvot','contacts:update:mitzvot_history',
    'contacts:update:high_potential','contacts:update:days_since_last_contact',
    'contacts:update:joined_at','contacts:update:source','contacts:update:referred_by',
    'contacts:update:next_action','contacts:update:next_action_date','contacts:update:last_interaction_date',
    'contacts:update:how_met','contacts:update:is_graduate','contacts:update:meeting_place_city',
    'contacts:update:meeting_place_number','contacts:update:meetingHouseCity',
    'contacts:update:meetingHouseNumber','contacts:update:meetingHouseKey',
    'interactions:update:type','interactions:update:quality','interactions:update:notes',
    'interactions:update:participants','interactions:update:date','interactions:update:time',
    'interactions:update:duration_minutes','interactions:update:outcome','interactions:update:description',
    'interactions:update:ai_summary','interactions:update:next_action','interactions:update:next_action_date',
    'base_meeting_reports:update:report','base_meeting_reports:update:notes',
    'base_meeting_reports:update:summary','base_meeting_reports:update:results',
    'meeting_houses:update:house_number','meeting_houses:update:settlement',
    'meeting_houses:update:city','meeting_houses:update:host_name',
    'meeting_houses:update:facilitator_name','meeting_houses:update:meetings','meeting_houses:update:notes',
    'tours:update:tour_number','tours:update:settlement','tours:update:date',
    'tours:update:start_time','tours:update:notes',
    'payment_config:update:rate_phone_friendly','payment_config:update:rate_phone_torani',
    'payment_config:update:rate_video_friendly','payment_config:update:rate_video_torani',
    'payment_config:update:rate_frontal_friendly','payment_config:update:rate_frontal_torani',
    'payment_config:update:rate_multi','payment_config:update:rate_shabbat_hosting',
    'payment_config:update:rate_tour_guide','payment_config:update:min_duration_minutes',
    'payment_config:update:cap_phone','payment_config:update:cap_frontal','payment_config:update:cap_multi',
    'payment_config:update:cap_contact_phone_high','payment_config:update:cap_contact_phone_regular',
    'payment_config:update:cap_contact_frontal_high','payment_config:update:cap_contact_frontal_regular',
    'payment_config:update:bonus_loyalty_6','payment_config:update:bonus_loyalty_4',
    'payment_config:update:bonus_mitzvot_level','payment_config:update:bonus_new_participant',
    'notifications:update:read','push_subscriptions:update:subscription',
    'fcm_tokens:update:token','fcm_tokens:update:platform','fcm_tokens:update:updated_at'
  ];
  v_required_column_grants text[] := array[
    'project_memberships:select:project_id','project_memberships:select:user_id',
    'project_memberships:select:role','project_memberships:select:status',
    'profiles:select:id','profiles:select:activist_code','profiles:select:name',
    'profiles:select:global_role','profiles:select:security_version','profiles:select:disabled_at',
    'projects:update:name','notifications:update:read'
  ];
  v_authenticated_oid oid;
  v_anon_oid oid;
  v_unknown_tables text[];
  v_missing_tables text[];
  v_table_record record;
  v_policy record;
  v_actual_policy_names text[];
  v_expected_policy_names text[];
  v_actual_grants text[];
  v_expected_grants text[];
  v_actual_column_grants text[];
  v_column_grant text;
  v_expected_command "char";
  v_qual text;
  v_with_check text;
begin
  select oid into v_authenticated_oid from pg_catalog.pg_roles where rolname = 'authenticated';
  select oid into v_anon_oid from pg_catalog.pg_roles where rolname = 'anon';
  if v_authenticated_oid is null or v_anon_oid is null then
    raise exception 'security posture refused: required API roles are missing';
  end if;

  select array(
    select unknown_table
    from (
      select c.relname::text as unknown_table
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      except
      select unnest(v_expected_tables)
    ) unknown_tables
    order by unknown_table
  ) into v_unknown_tables;
  if cardinality(v_unknown_tables) > 0 then
    raise exception 'security posture refused: unclassified public tables: %', v_unknown_tables;
  end if;

  select array(
    select missing_table
    from (
      select unnest(v_expected_tables) as missing_table
      except
      select c.relname::text
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    ) missing_tables
    order by missing_table
  ) into v_missing_tables;
  if cardinality(v_missing_tables) > 0 then
    raise exception 'security posture refused: classified public tables are missing: %', v_missing_tables;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(c.relacl)
      as table_grant(grantor, grantee, privilege_type, is_grantable)
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and table_grant.grantee in (0::oid, v_anon_oid)
  ) then
    raise exception 'security posture refused: public or anon table grant present';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral pg_catalog.aclexplode(a.attacl)
      as column_grant(grantor, grantee, privilege_type, is_grantable)
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and column_grant.grantee in (0::oid, v_anon_oid)
  ) then
    raise exception 'security posture refused: public or anon column grant present';
  end if;

  select array(
    select format('%s:%s:%s', c.relname, lower(column_grant.privilege_type), a.attname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral pg_catalog.aclexplode(a.attacl)
      as column_grant(grantor, grantee, privilege_type, is_grantable)
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname = any(v_expected_tables)
      and column_grant.grantee = v_authenticated_oid
    order by c.relname, lower(column_grant.privilege_type), a.attname
  ) into v_actual_column_grants;
  if exists (
    select 1 from unnest(v_actual_column_grants) actual_column_grant
    where not (actual_column_grant = any(v_allowed_column_grants))
  ) then
    raise exception 'security posture refused: unexpected authenticated column grant';
  end if;
  foreach v_column_grant in array v_required_column_grants loop
    if not (v_column_grant = any(v_actual_column_grants)) then
      raise exception 'security posture refused: required authenticated column grant missing: %', v_column_grant;
    end if;
  end loop;

  for v_table_record in
    select c.oid, c.relname, c.relacl, c.relrowsecurity, c.relforcerowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(v_expected_tables) and c.relkind in ('r', 'p')
    order by c.relname
  loop
    if not (v_table_record.relrowsecurity and v_table_record.relforcerowsecurity) then
      raise exception 'security posture refused: RLS is not enabled and forced on %', v_table_record.relname;
    end if;

    select array(
      select p.polname::text
      from pg_catalog.pg_policy p
      where p.polrelid = v_table_record.oid
      order by p.polname
    ) into v_actual_policy_names;
    select array(
      select expected_policy.name
      from jsonb_array_elements_text(v_expected_policies -> v_table_record.relname)
        as expected_policy(name)
      order by expected_policy.name
    ) into v_expected_policy_names;
    if v_actual_policy_names is distinct from v_expected_policy_names then
      raise exception 'security posture refused: missing or extra policies on %', v_table_record.relname;
    end if;

    select array(
      select lower(table_grant.privilege_type)
      from pg_catalog.aclexplode(v_table_record.relacl)
        as table_grant(grantor, grantee, privilege_type, is_grantable)
      where table_grant.grantee = v_authenticated_oid
      order by lower(table_grant.privilege_type)
    ) into v_actual_grants;
    select array(
      select expected_grant.name
      from jsonb_array_elements_text(v_expected_table_grants -> v_table_record.relname)
        as expected_grant(name)
      order by expected_grant.name
    ) into v_expected_grants;
    if v_actual_grants is distinct from v_expected_grants then
      raise exception 'security posture refused: authenticated table grants differ on %', v_table_record.relname;
    end if;

    for v_policy in
      select p.polname, p.polcmd, p.polpermissive, p.polroles,
             pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
             pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
      from pg_catalog.pg_policy p
      where p.polrelid = v_table_record.oid
      order by p.polname
    loop
      v_expected_command := case
        when v_policy.polname like '%_select' then 'r'
        when v_policy.polname like '%_insert' then 'a'
        when v_policy.polname like '%_update' then 'w'
        when v_policy.polname like '%_delete' then 'd'
        else null
      end;
      if v_expected_command is null or v_policy.polcmd <> v_expected_command
         or v_policy.polroles is distinct from array[v_authenticated_oid]::oid[] then
        raise exception 'security posture refused: policy command or role differs on %.%',
          v_table_record.relname, v_policy.polname;
      end if;
      if v_policy.polcmd in ('r', 'w', 'd') and v_policy.qual is null then
        raise exception 'security posture refused: policy USING predicate missing on %.%',
          v_table_record.relname, v_policy.polname;
      end if;
      if v_policy.polcmd in ('a', 'w') and v_policy.with_check is null then
        raise exception 'security posture refused: policy WITH CHECK predicate missing on %.%',
          v_table_record.relname, v_policy.polname;
      end if;

      v_qual := regexp_replace(lower(coalesce(v_policy.qual, '')), '[[:space:]()]', '', 'g');
      v_with_check := regexp_replace(lower(coalesce(v_policy.with_check, '')), '[[:space:]()]', '', 'g');
      if v_policy.polpermissive and (
        (v_policy.polcmd in ('r', 'w', 'd')
          and v_qual = any(array['true','true::boolean','''t''::boolean','''true''::boolean','1=1','notfalse']))
        or (v_policy.polcmd in ('a', 'w')
          and v_with_check = any(array['true','true::boolean','''t''::boolean','''true''::boolean','1=1','notfalse']))
      ) then
        raise exception 'security posture refused: permissive-all policy predicate on %.%',
          v_table_record.relname, v_policy.polname;
      end if;
    end loop;
  end loop;

  return query
  select c.relname::text,
         c.relrowsecurity,
         c.relforcerowsecurity,
         array(
           select case p.polcmd
             when 'r' then 'select'
             when 'a' then 'insert'
             when 'w' then 'update'
             when 'd' then 'delete'
             else 'all'
           end
           from pg_catalog.pg_policy p
           where p.polrelid = c.oid
           order by p.polname
         )::text[],
         (select count(*)::integer from pg_catalog.pg_policy p where p.polrelid = c.oid)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = any(v_expected_tables)
  order by c.relname;
end
$$;
revoke all on function public.app_security_posture() from public, anon, authenticated;
grant execute on function public.app_security_posture() to service_role;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;

commit;
