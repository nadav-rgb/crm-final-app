-- 0019_security_rls.sql
-- Explicit deny-by-default grants and RLS. File-only in G1; do not run until
-- the separately approved G5 isolated Supabase test gate.

begin;

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
grant select on public.project_memberships to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.contacts to authenticated;
grant select, insert on public.interactions to authenticated;
grant select, insert, delete on public.base_meeting_reports to authenticated;
grant select, insert, delete on public.meeting_houses to authenticated;
grant select, insert on public.meeting_reminders to authenticated;
grant select, insert on public.tours to authenticated;
grant select, insert on public.expenses to authenticated;
grant select, insert, delete on public.bonus_cancellations to authenticated;
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
  or public.app_has_project_role(project_id, array['head'])
);

create policy profiles_select on public.profiles for select to authenticated using (
  (id = auth.uid() and public.app_user_active()) or public.app_is_ceo() or exists (
    select 1 from public.project_memberships target
    where target.user_id = profiles.id and target.status = 'active'
      and public.app_has_project_role(target.project_id, array['head','coord','finance'])
  )
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
  (recipient_user_id = auth.uid() and public.app_user_active())
  or public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
);
create policy meeting_reminders_insert on public.meeting_reminders for insert to authenticated with check (
  recipient_user_id = auth.uid() and public.app_has_project_role(project_id, array['activist'])
);
-- UPDATE/DELETE are intentionally absent. Cancellation is exposed only through
-- app_cancel_meeting_reminders(), which derives recipient and project from rows.

create policy tours_select on public.tours for select to authenticated using (
  public.app_is_ceo() or public.app_has_project_role(project_id, array['head','coord'])
  or (public.app_user_active() and (
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
  (actor_user_id = auth.uid() and public.app_user_active()) or public.app_is_ceo()
  or public.app_has_project_role(project_id, array['head','coord','finance'])
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
  (beneficiary_user_id = auth.uid() and public.app_user_active()) or public.app_is_ceo()
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
  (reporter_user_id = auth.uid() and public.app_user_active()) or public.app_is_ceo()
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

create or replace function public.app_notification_recipients(target_project integer)
returns table(activist_code integer, name text, role text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select p.activist_code, p.name,
         coalesce(p.global_role, pm.role) as role
  from public.profiles p
  left join public.project_memberships pm
    on pm.user_id = p.id and pm.project_id = target_project and pm.status = 'active'
  where p.disabled_at is null and p.activist_code is not null
    and (public.app_is_ceo() or exists (
      select 1 from public.project_memberships caller
      where caller.user_id = auth.uid() and caller.project_id = target_project and caller.status = 'active'
    ))
    and (p.global_role = 'ceo' or pm.role in ('head','coord','finance'))
$$;
revoke all on function public.app_notification_recipients(integer) from public, anon;
grant execute on function public.app_notification_recipients(integer) to authenticated;

create or replace function app_private.audit_row_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, app_private as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_project_id integer := nullif(v_row ->> 'project_id', '')::integer;
  v_changed_fields text[] := case when tg_op = 'UPDATE' then array(
    select key from jsonb_each(to_jsonb(new)) n(key, value)
    where to_jsonb(old) -> key is distinct from n.value order by key
  ) else '{}'::text[] end;
  v_effective_role text;
begin
  v_effective_role := case when public.app_is_ceo() then 'ceo' else (
    select pm.role from public.project_memberships pm
    where pm.user_id = auth.uid() and pm.project_id = v_project_id and pm.status = 'active'
    limit 1
  ) end;
  insert into app_private.audit_events
    (actor_user_id, effective_role, project_id, action, resource_type, resource_id, result, metadata)
  values
    (auth.uid(), v_effective_role, v_project_id, lower(tg_op), tg_table_name,
     coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'client_id'),
     'success', jsonb_build_object('changedFields', v_changed_fields));
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
returns table(table_name text, rls_enabled boolean, rls_forced boolean, policy_commands text[])
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.relname::text, c.relrowsecurity, c.relforcerowsecurity,
         coalesce(array_agg(distinct p.cmd order by p.cmd) filter (where p.cmd is not null), '{}'::text[])
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
  where n.nspname = 'public' and c.relkind = 'r'
  group by c.relname, c.relrowsecurity, c.relforcerowsecurity
  order by c.relname
$$;
revoke all on function public.app_security_posture() from public, anon, authenticated;
grant execute on function public.app_security_posture() to service_role;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;

commit;
