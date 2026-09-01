-- SECURITY HARDENING: WRITTEN ONLY. DO NOT RUN OUTSIDE THE APPROVED G5 TEST PROJECT.
-- Aggregated finance projection. The function owner may read source tables, but
-- callers receive only the explicitly declared field-minimized output below.
begin;

-- Current-main approved rates. This is part of the unapplied Finance cutover,
-- replacing the removed browser/admin mutation script with a reviewed migration.
update public.payment_config
set rate_phone_friendly = 0,
    rate_phone_torani = 150,
    rate_video_torani = 200
where id = 1;

-- Persisted-fact classifier used by the notification RPC. It replays the same
-- deterministic monthly allocation rules as app_finance_summary and never
-- accepts an amount or recipient assertion from the browser.
create or replace function app_private.interaction_payment_fact(
  p_interaction_id text,
  p_actor uuid
) returns table (payable boolean, amount numeric)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_cfg public.payment_config%rowtype;
  v_target_date date;
  v_start date;
  v_end date;
  v_interaction record;
  v_phone_count integer := 0;
  v_frontal_count integer := 0;
  v_multi_count integer := 0;
  v_contact_phone jsonb := '{}'::jsonb;
  v_contact_frontal jsonb := '{}'::jsonb;
  v_contact_friendly_frontal jsonb := '{}'::jsonb;
  v_contact_key text;
  v_contact_phone_count integer;
  v_contact_frontal_count integer;
  v_contact_friendly_frontal_count integer;
  v_recognized boolean;
  v_payable boolean;
begin
  if p_actor is null or nullif(btrim(p_interaction_id), '') is null then
    return query select false, 0::numeric;
    return;
  end if;
  select i.date into v_target_date
  from public.interactions i
  where i.id::text = p_interaction_id
    and i.actor_user_id = p_actor
    and i.project_id in (1, 2)
    and not (coalesce(i.participants, '{}'::jsonb) ? 'derived_from');
  if not found then
    return query select false, 0::numeric;
    return;
  end if;
  v_start := date_trunc('month', v_target_date::timestamp)::date;
  v_end := (v_start + interval '1 month')::date;
  select * into v_cfg from public.payment_config where id = 1;
  if not found then
    raise exception 'payment configuration unavailable' using errcode = '55000';
  end if;

  for v_interaction in
    select i.id, i.contact_id, i.type, i.quality,
           coalesce(i.duration_minutes, 0) as duration_minutes, i.date,
           coalesce(c.high_potential, false) as is_high_potential,
           coalesce(
             c.joined_at,
             (
               select min(h.date)
               from public.interactions h
               where h.actor_user_id = p_actor and h.contact_id = i.contact_id
             ),
             i.date
           ) as anchor_date,
           (
             select min(h.date)
             from public.interactions h
             where h.actor_user_id = p_actor
               and h.contact_id = i.contact_id
               and h.project_id in (1, 2)
               and h.quality = 'תורני'
               and coalesce(h.duration_minutes, 0) >= v_cfg.min_duration_minutes
               and not (coalesce(h.participants, '{}'::jsonb) ? 'derived_from')
           ) as first_torani_date,
           case
             when i.type = 'טלפוני' and i.quality = 'ידידותי' then v_cfg.rate_phone_friendly
             when i.type = 'טלפוני' and i.quality = 'תורני' then v_cfg.rate_phone_torani
             when i.type = 'וידאו' and i.quality = 'ידידותי' then v_cfg.rate_video_friendly
             when i.type = 'וידאו' and i.quality = 'תורני' then v_cfg.rate_video_torani
             when i.type = 'פרונטלי' and i.quality = 'ידידותי' then v_cfg.rate_frontal_friendly
             when i.type = 'פרונטלי' and i.quality = 'תורני' then v_cfg.rate_frontal_torani
             when i.type = 'פרונטלי' and i.quality = 'רב משתתפים' then v_cfg.rate_multi
             when i.type = 'אירוח שבת' then v_cfg.rate_shabbat_hosting
             else null
           end as base_amount
    from public.interactions i
    left join public.contacts c on c.id = i.contact_id
    where i.actor_user_id = p_actor
      and i.project_id in (1, 2)
      and i.date >= v_start and i.date < v_end
      and not (coalesce(i.participants, '{}'::jsonb) ? 'derived_from')
    order by base_amount desc, i.date asc nulls last, i.id::text asc
  loop
    v_contact_key := coalesce(v_interaction.contact_id::text, '');
    v_contact_phone_count := coalesce((v_contact_phone ->> v_contact_key)::integer, 0);
    v_contact_frontal_count := coalesce((v_contact_frontal ->> v_contact_key)::integer, 0);
    v_contact_friendly_frontal_count := coalesce((v_contact_friendly_frontal ->> v_contact_key)::integer, 0);
    v_recognized := v_interaction.base_amount is not null;
    v_payable := false;

    if v_interaction.type = 'קצרצר'
      or v_interaction.duration_minutes < v_cfg.min_duration_minutes then
      v_payable := false;
    elsif v_interaction.quality = 'ידידותי'
      and (((extract(year from v_interaction.date)::integer * 12)
        + extract(month from v_interaction.date)::integer)
        - ((extract(year from v_interaction.anchor_date)::integer * 12)
        + extract(month from v_interaction.anchor_date)::integer)) >= 3 then
      v_payable := false;
    elsif v_interaction.quality = 'ידידותי'
      and v_interaction.first_torani_date is not null
      and v_interaction.first_torani_date <= v_interaction.date then
      v_payable := false;
    elsif not v_recognized then
      v_payable := false;
    elsif v_interaction.type = 'אירוח שבת' then
      v_payable := true;
    elsif v_interaction.type = 'פרונטלי' and v_interaction.quality = 'רב משתתפים' then
      v_payable := v_multi_count < v_cfg.cap_multi;
    elsif v_interaction.type = 'פרונטלי' and v_interaction.quality = 'ידידותי'
      and v_contact_friendly_frontal_count >= 2 then
      v_payable := false;
    elsif v_interaction.type in ('טלפוני','וידאו') then
      v_payable := v_phone_count < v_cfg.cap_phone
        and v_contact_phone_count < case when v_interaction.is_high_potential
          then v_cfg.cap_contact_phone_high else v_cfg.cap_contact_phone_regular end;
    elsif v_interaction.type = 'פרונטלי' then
      v_payable := v_frontal_count < v_cfg.cap_frontal
        and v_contact_frontal_count < case when v_interaction.is_high_potential
          then v_cfg.cap_contact_frontal_high else v_cfg.cap_contact_frontal_regular end;
    end if;

    if v_payable then
      if v_interaction.type in ('טלפוני','וידאו') then
        v_phone_count := v_phone_count + 1;
        v_contact_phone := jsonb_set(
          v_contact_phone, array[v_contact_key], to_jsonb(v_contact_phone_count + 1), true
        );
      elsif v_interaction.type = 'פרונטלי' and v_interaction.quality = 'רב משתתפים' then
        v_multi_count := v_multi_count + 1;
      elsif v_interaction.type = 'פרונטלי' then
        v_frontal_count := v_frontal_count + 1;
        v_contact_frontal := jsonb_set(
          v_contact_frontal, array[v_contact_key], to_jsonb(v_contact_frontal_count + 1), true
        );
        if v_interaction.quality = 'ידידותי' then
          v_contact_friendly_frontal := jsonb_set(
            v_contact_friendly_frontal,
            array[v_contact_key],
            to_jsonb(v_contact_friendly_frontal_count + 1),
            true
          );
        end if;
      end if;
    end if;

    if v_interaction.id::text = p_interaction_id then
      return query select v_payable,
        case when v_payable then coalesce(v_interaction.base_amount, 0) else 0 end::numeric;
      return;
    end if;
  end loop;
  return query select false, 0::numeric;
end $$;

alter function app_private.interaction_payment_fact(text,uuid) owner to postgres;
revoke all on function app_private.interaction_payment_fact(text,uuid) from public, anon, authenticated;

create or replace function public.app_finance_summary(
  p_period text,
  p_project_id integer default null,
  p_user_id uuid default null
) returns table (
  user_id uuid,
  name text,
  period text,
  activity_total numeric,
  bonus_total numeric,
  tour_total numeric,
  expense_total numeric,
  grand_total numeric,
  activity_by_type jsonb,
  bonus_by_type jsonb,
  unpaid_by_reason jsonb
)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_aal text := coalesce(auth.jwt() ->> 'aal', 'aal1');
  v_actor_is_ceo boolean := false;
  v_effective_role text;
  v_effective_projects integer[] := '{}';
  v_management_projects integer[] := '{}';
  v_self_projects integer[] := '{}';
  v_force_self boolean := false;
  v_start date;
  v_end date;
  v_month_key text;
  v_cfg public.payment_config%rowtype;
  v_target record;
  v_interaction record;
  v_learning record;
  v_activity numeric;
  v_bonus numeric;
  v_tour numeric;
  v_expense numeric;
  v_base numeric;
  v_payable boolean;
  v_phone_count integer;
  v_frontal_count integer;
  v_multi_count integer;
  v_contact_phone jsonb;
  v_contact_frontal jsonb;
  v_contact_friendly_frontal jsonb;
  v_contact_key text;
  v_contact_phone_count integer;
  v_contact_frontal_count integer;
  v_contact_friendly_frontal_count integer;
  v_category_key text;
  v_recognized boolean;
  v_unpaid_reason text;
  v_activity_counts jsonb;
  v_unpaid_counts jsonb;
  v_mitzvot_count integer;
  v_new_count integer;
  v_torani_count integer;
  v_learning_4_count integer;
  v_learning_6_count integer;
  v_bonus_key text;
  v_row_count integer := 0;
begin
  if v_actor is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid finance summary request' using errcode = '22023';
  end if;

  select p.global_role = 'ceo'
    into v_actor_is_ceo
  from public.profiles p
  where p.id = v_actor and p.disabled_at is null;
  if not found then
    raise exception 'finance scope not found' using errcode = '42501';
  end if;

  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month')::date;
  v_month_key := extract(year from v_start)::integer::text || '-'
    || (extract(month from v_start)::integer - 1)::text;

  if v_actor_is_ceo then
    if v_aal <> 'aal2' then
      raise exception 'finance scope not found' using errcode = '42501';
    end if;
    v_effective_role := 'ceo';
    -- CEO scope is global and is not coupled to fixture/project identifiers.
    select coalesce(array_agg(p.id order by p.id), '{}')
      into v_effective_projects
    from public.projects p;
  else
    select coalesce(array_agg(distinct pm.project_id order by pm.project_id), '{}')
      into v_management_projects
    from public.project_memberships pm
    where pm.user_id = v_actor and pm.status = 'active'
      and (pm.role = 'finance' or (pm.role = 'head' and v_aal = 'aal2'));

    if cardinality(v_management_projects) > 0 then
      if exists (
        select 1 from public.project_memberships pm
        where pm.user_id = v_actor and pm.status = 'active'
          and pm.project_id = any(v_management_projects) and pm.role = 'head'
      ) then
        v_effective_role := 'head';
      else
        v_effective_role := 'finance';
      end if;
      v_effective_projects := v_management_projects;
    else
      select coalesce(array_agg(distinct pm.project_id order by pm.project_id), '{}')
        into v_self_projects
      from public.project_memberships pm
      where pm.user_id = v_actor and pm.status = 'active' and pm.role = 'activist';
      if cardinality(v_self_projects) = 0 then
        -- Coordinator-only and disabled/stale identities are denied.
        raise exception 'finance scope not found' using errcode = '42501';
      end if;
      v_effective_role := 'activist';
      v_effective_projects := v_self_projects;
      v_force_self := true;
    end if;
  end if;

  -- Parameters only narrow the server-derived project/user scope.
  if p_project_id is not null then
    if not (p_project_id = any(v_effective_projects)) then
      raise exception 'finance scope not found' using errcode = '42501';
    end if;
    v_effective_projects := array[p_project_id];
  end if;
  if v_force_self and p_user_id is not null and p_user_id <> v_actor then
    raise exception 'finance scope not found' using errcode = '42501';
  end if;
  if p_user_id is not null and not exists (
    select 1
    from public.project_memberships pm
    join public.profiles p on p.id = pm.user_id
    where pm.user_id = p_user_id and pm.status = 'active' and pm.role = 'activist'
      and pm.project_id = any(v_effective_projects) and p.disabled_at is null
  ) then
    raise exception 'finance scope not found' using errcode = '42501';
  end if;

  select * into v_cfg from public.payment_config where id = 1;
  if not found then
    raise exception 'payment configuration unavailable' using errcode = '55000';
  end if;

  for v_target in
    select distinct p.id as target_user_id, p.name as target_name, p.activist_code
    from public.profiles p
    join public.project_memberships pm on pm.user_id = p.id
    where p.disabled_at is null and pm.status = 'active' and pm.role = 'activist'
      and pm.project_id = any(v_effective_projects)
      and (p_user_id is null or p.id = p_user_id)
      and (not v_force_self or p.id = v_actor)
    order by p.name, p.id
  loop
    if v_target.activist_code is null then
      raise exception 'finance identity mapping unavailable' using errcode = '55000';
    end if;

    v_activity := 0;
    v_bonus := 0;
    v_phone_count := 0;
    v_frontal_count := 0;
    v_multi_count := 0;
    v_contact_phone := '{}'::jsonb;
    v_contact_frontal := '{}'::jsonb;
    v_contact_friendly_frontal := '{}'::jsonb;
    v_activity_counts := jsonb_build_object(
      'phone-friendly', 0, 'phone-torani', 0,
      'video-friendly', 0, 'video-torani', 0,
      'frontal-friendly', 0, 'frontal-torani', 0,
      'frontal-multi', 0, 'shabbat-hosting', 0
    );
    v_unpaid_counts := '{}'::jsonb;
    v_mitzvot_count := 0;
    v_new_count := 0;
    v_torani_count := 0;
    v_learning_4_count := 0;
    v_learning_6_count := 0;

    -- Same allocation order as paymentCalc.js: price descending, date ascending,
    -- then stable row id. Only paid interactions consume monthly/contact caps.
    for v_interaction in
      select i.id, i.contact_id, i.type, i.quality,
             coalesce(i.duration_minutes, 0) as duration_minutes, i.date,
             coalesce(c.high_potential, false) as is_high_potential,
             coalesce(
               c.joined_at,
               (
                 select min(h.date)
                 from public.interactions h
                 where h.actor_user_id = v_target.target_user_id
                   and h.contact_id = i.contact_id
               ),
               i.date
             ) as anchor_date,
             (
               select min(h.date)
               from public.interactions h
               where h.actor_user_id = v_target.target_user_id
                 and h.contact_id = i.contact_id
                 and h.project_id in (1, 2)
                 and h.quality = 'תורני'
                 and coalesce(h.duration_minutes, 0) >= v_cfg.min_duration_minutes
                 and not (coalesce(h.participants, '{}'::jsonb) ? 'derived_from')
             ) as first_torani_date,
             case
               when i.type = 'טלפוני' and i.quality = 'ידידותי' then 'phone-friendly'
               when i.type = 'טלפוני' and i.quality = 'תורני' then 'phone-torani'
               when i.type = 'וידאו' and i.quality = 'ידידותי' then 'video-friendly'
               when i.type = 'וידאו' and i.quality = 'תורני' then 'video-torani'
               when i.type = 'פרונטלי' and i.quality = 'ידידותי' then 'frontal-friendly'
               when i.type = 'פרונטלי' and i.quality = 'תורני' then 'frontal-torani'
               when i.type = 'פרונטלי' and i.quality = 'רב משתתפים' then 'frontal-multi'
               when i.type = 'אירוח שבת' then 'shabbat-hosting'
               else null
             end as category_key,
             case
               when i.type = 'אירוח שבת' then v_cfg.rate_shabbat_hosting
               when i.type = 'טלפוני' and i.quality = 'ידידותי' then v_cfg.rate_phone_friendly
               when i.type = 'טלפוני' and i.quality = 'תורני' then v_cfg.rate_phone_torani
               when i.type = 'וידאו' and i.quality = 'ידידותי' then v_cfg.rate_video_friendly
               when i.type = 'וידאו' and i.quality = 'תורני' then v_cfg.rate_video_torani
               when i.type = 'פרונטלי' and i.quality = 'ידידותי' then v_cfg.rate_frontal_friendly
               when i.type = 'פרונטלי' and i.quality = 'תורני' then v_cfg.rate_frontal_torani
               when i.type = 'פרונטלי' and i.quality = 'רב משתתפים' then v_cfg.rate_multi
               else 0
             end as base_amount
      from public.interactions i
      left join public.contacts c on c.id = i.contact_id
      where i.actor_user_id = v_target.target_user_id
        and i.project_id = any(v_effective_projects)
        and i.project_id in (1, 2)
        and i.date >= v_start and i.date < v_end
        and not (coalesce(i.participants, '{}'::jsonb) ? 'derived_from')
      order by base_amount desc, i.date asc nulls last, i.id::text asc
    loop
      v_base := coalesce(v_interaction.base_amount, 0);
      v_payable := false;
      v_category_key := v_interaction.category_key;
      v_recognized := v_category_key is not null;
      v_unpaid_reason := null;
      v_contact_key := coalesce(v_interaction.contact_id::text, '');
      v_contact_phone_count := coalesce((v_contact_phone ->> v_contact_key)::integer, 0);
      v_contact_frontal_count := coalesce((v_contact_frontal ->> v_contact_key)::integer, 0);
      v_contact_friendly_frontal_count := coalesce((v_contact_friendly_frontal ->> v_contact_key)::integer, 0);

      if v_interaction.type = 'קצרצר' then
        v_unpaid_reason := 'short-contact';
      elsif v_interaction.duration_minutes < v_cfg.min_duration_minutes then
        v_unpaid_reason := 'min-duration';
      elsif v_interaction.quality = 'ידידותי'
        and (((extract(year from v_interaction.date)::integer * 12)
          + extract(month from v_interaction.date)::integer)
          - ((extract(year from v_interaction.anchor_date)::integer * 12)
          + extract(month from v_interaction.anchor_date)::integer)) >= 3 then
        v_unpaid_reason := 'friendly-window';
      elsif v_interaction.quality = 'ידידותי'
        and v_interaction.first_torani_date is not null
        and v_interaction.first_torani_date <= v_interaction.date then
        v_unpaid_reason := 'torani-transition';
      elsif not v_recognized then
        v_unpaid_reason := 'unknown-type';
      elsif v_interaction.type = 'אירוח שבת' then
        v_payable := true;
      elsif v_interaction.type = 'פרונטלי' and v_interaction.quality = 'רב משתתפים' then
        v_payable := v_multi_count < v_cfg.cap_multi;
        if not v_payable then v_unpaid_reason := 'monthly-cap'; end if;
      elsif v_interaction.type = 'פרונטלי' and v_interaction.quality = 'ידידותי'
        and v_contact_friendly_frontal_count >= 2 then
        v_unpaid_reason := 'friendly-frontal-cap';
      elsif v_interaction.type in ('טלפוני','וידאו') then
        v_payable := v_phone_count < v_cfg.cap_phone
          and v_contact_phone_count < case when v_interaction.is_high_potential
            then v_cfg.cap_contact_phone_high else v_cfg.cap_contact_phone_regular end;
        if not v_payable then
          v_unpaid_reason := case when v_phone_count >= v_cfg.cap_phone then 'monthly-cap' else 'contact-cap' end;
        end if;
      elsif v_interaction.type = 'פרונטלי' then
        v_payable := v_frontal_count < v_cfg.cap_frontal
          and v_contact_frontal_count < case when v_interaction.is_high_potential
            then v_cfg.cap_contact_frontal_high else v_cfg.cap_contact_frontal_regular end;
        if not v_payable then
          v_unpaid_reason := case when v_frontal_count >= v_cfg.cap_frontal then 'monthly-cap' else 'contact-cap' end;
        end if;
      end if;

      if v_payable then
        v_activity := v_activity + v_base;
        v_activity_counts := jsonb_set(
          v_activity_counts,
          array[v_category_key],
          to_jsonb(coalesce((v_activity_counts ->> v_category_key)::integer, 0) + 1),
          true
        );
        if v_interaction.type = 'פרונטלי' and v_interaction.quality = 'רב משתתפים' then
          v_multi_count := v_multi_count + 1;
        elsif v_interaction.type in ('טלפוני','וידאו') then
          v_phone_count := v_phone_count + 1;
          v_contact_phone := jsonb_set(
            v_contact_phone, array[v_contact_key], to_jsonb(v_contact_phone_count + 1), true
          );
        elsif v_interaction.type = 'פרונטלי' then
          v_frontal_count := v_frontal_count + 1;
          v_contact_frontal := jsonb_set(
            v_contact_frontal, array[v_contact_key], to_jsonb(v_contact_frontal_count + 1), true
          );
          if v_interaction.quality = 'ידידותי' then
            v_contact_friendly_frontal := jsonb_set(
              v_contact_friendly_frontal,
              array[v_contact_key],
              to_jsonb(v_contact_friendly_frontal_count + 1),
              true
            );
          end if;
        end if;
      else
        v_unpaid_reason := coalesce(v_unpaid_reason, 'not-payable');
        v_unpaid_counts := jsonb_set(
          v_unpaid_counts,
          array[v_unpaid_reason],
          to_jsonb(coalesce((v_unpaid_counts ->> v_unpaid_reason)::integer, 0) + 1),
          true
        );
      end if;
    end loop;

    -- Learning bonuses use all qualifying monthly interactions, matching the JS
    -- engine, while cancellations retain the historical zero-indexed month key.
    for v_learning in
      select i.contact_id, count(*)::integer as learning_count
      from public.interactions i
      where i.actor_user_id = v_target.target_user_id
        and i.project_id = any(v_effective_projects)
        and i.project_id in (1, 2)
        and i.date >= v_start and i.date < v_end
        and not (coalesce(i.participants, '{}'::jsonb) ? 'derived_from')
        and i.quality = 'תורני' and i.type in ('פרונטלי','וידאו')
        and coalesce(i.duration_minutes, 0) >= v_cfg.min_duration_minutes
      group by i.contact_id
    loop
      if v_learning.learning_count >= 6 then
        v_bonus_key := v_target.activist_code::text || '|בונוס-לימוד-6|'
          || coalesce(v_learning.contact_id::text, '') || '|' || v_month_key;
        if not exists (select 1 from public.bonus_cancellations b where b.bonus_key = v_bonus_key) then
          v_bonus := v_bonus + v_cfg.bonus_loyalty_6;
          v_learning_6_count := v_learning_6_count + 1;
        end if;
      elsif v_learning.learning_count >= 4 then
        v_bonus_key := v_target.activist_code::text || '|בונוס-לימוד-4|'
          || coalesce(v_learning.contact_id::text, '') || '|' || v_month_key;
        if not exists (select 1 from public.bonus_cancellations b where b.bonus_key = v_bonus_key) then
          v_bonus := v_bonus + v_cfg.bonus_loyalty_4;
          v_learning_4_count := v_learning_4_count + 1;
        end if;
      end if;
    end loop;

    select coalesce(sum(event_count), 0)::integer
      into v_mitzvot_count
    from (
      select c.id, count(distinct h ->> 'mitzva')::integer as event_count
      from public.contacts c
      cross join lateral jsonb_array_elements(coalesce(c.mitzvot_history, '[]'::jsonb)) h
      where c.assigned_user_id = v_target.target_user_id
        and c.project_id = any(v_effective_projects)
        and c.project_id in (1, 2)
        and nullif(h ->> 'mitzva', '') is not null
        and (case when coalesce(h ->> 'to', '') ~ '^-?\d+(?:\.\d+)?$' then (h ->> 'to')::numeric else 0 end)
          > (case when coalesce(h ->> 'from', '') ~ '^-?\d+(?:\.\d+)?$' then (h ->> 'from')::numeric else 0 end)
        and (case when coalesce(h ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}'
             then left(h ->> 'date', 10)::date else current_date end) >= v_start
        and (case when coalesce(h ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}'
             then left(h ->> 'date', 10)::date else current_date end) < v_end
        and not exists (
          select 1 from public.bonus_cancellations b
          where b.bonus_key = v_target.activist_code::text || '|בונוס-מצוות|'
            || c.id::text || '|' || v_month_key
        )
      group by c.id
    ) mitzvot_events;
    v_bonus := v_bonus + (v_mitzvot_count * v_cfg.bonus_mitzvot_level);

    select count(*)::integer
      into v_new_count
    from public.contacts c
    where c.assigned_user_id = v_target.target_user_id
      and c.project_id = any(v_effective_projects)
      and c.project_id in (1, 2)
      and c.joined_at >= v_start and c.joined_at < v_end
      and (c.source = 'external' or c.referred_by is not null)
      and not exists (
        select 1 from public.bonus_cancellations b
        where b.bonus_key = v_target.activist_code::text || '|בונוס-חדש|'
          || c.id::text || '|' || v_month_key
      );
    v_bonus := v_bonus + (v_new_count * v_cfg.bonus_new_participant);

    -- One-time Torani bonus: the third month of the first qualifying
    -- three-consecutive-calendar-month streak for each activist/contact.
    with torani_months as (
      select distinct i.contact_id, date_trunc('month', i.date::timestamp)::date as month_start
      from public.interactions i
      join public.contacts c on c.id = i.contact_id
      where i.actor_user_id = v_target.target_user_id
        and c.project_id = i.project_id
        and c.project_id = any(v_effective_projects)
        and i.project_id = any(v_effective_projects)
        and i.project_id in (1, 2)
        and i.quality = 'תורני'
        and coalesce(i.duration_minutes, 0) >= v_cfg.min_duration_minutes
        and not (coalesce(i.participants, '{}'::jsonb) ? 'derived_from')
    ), numbered as (
      select contact_id, month_start,
        month_start - (row_number() over (partition by contact_id order by month_start)::integer * interval '1 month') as streak_group
      from torani_months
    ), streaks as (
      select contact_id, min(month_start) as run_start, count(*)::integer as run_length
      from numbered
      group by contact_id, streak_group
    ), first_completions as (
      select contact_id, min((run_start + interval '2 months')::date) as completion_month
      from streaks
      where run_length >= 3
      group by contact_id
    )
    select count(*)::integer into v_torani_count
    from first_completions completion
    where completion.completion_month = v_start
      and not exists (
        select 1 from public.bonus_cancellations b
        where b.bonus_key = v_target.activist_code::text || '|בונוס-תורני|'
          || completion.contact_id::text || '|' || v_month_key
      );
    v_bonus := v_bonus + (v_torani_count * 1000);

    select coalesce(sum(e.amount), 0) into v_expense
    from public.expenses e
    where e.actor_user_id = v_target.target_user_id
      and e.project_id = any(v_effective_projects)
      and e.date >= v_start and e.date < v_end;

    select coalesce(count(*) * v_cfg.rate_tour_guide, 0) into v_tour
    from public.tours t
    where t.guide_user_id = v_target.target_user_id
      and t.project_id = any(v_effective_projects)
      and t.status = 'completed' and t.date >= v_start and t.date < v_end;

    user_id := v_target.target_user_id;
    name := v_target.target_name;
    period := p_period;
    activity_total := v_activity;
    bonus_total := v_bonus;
    tour_total := v_tour;
    expense_total := v_expense;
    grand_total := v_activity + v_bonus + v_tour + v_expense;
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', category_key,
      'count', category_count,
      'unitRate', unit_rate,
      'total', category_count * unit_rate
    ) order by ordinal), '[]'::jsonb)
      into activity_by_type
    from (values
      (1, 'phone-friendly', coalesce((v_activity_counts ->> 'phone-friendly')::integer, 0), v_cfg.rate_phone_friendly),
      (2, 'phone-torani', coalesce((v_activity_counts ->> 'phone-torani')::integer, 0), v_cfg.rate_phone_torani),
      (3, 'video-friendly', coalesce((v_activity_counts ->> 'video-friendly')::integer, 0), v_cfg.rate_video_friendly),
      (4, 'video-torani', coalesce((v_activity_counts ->> 'video-torani')::integer, 0), v_cfg.rate_video_torani),
      (5, 'frontal-friendly', coalesce((v_activity_counts ->> 'frontal-friendly')::integer, 0), v_cfg.rate_frontal_friendly),
      (6, 'frontal-torani', coalesce((v_activity_counts ->> 'frontal-torani')::integer, 0), v_cfg.rate_frontal_torani),
      (7, 'frontal-multi', coalesce((v_activity_counts ->> 'frontal-multi')::integer, 0), v_cfg.rate_multi),
      (8, 'shabbat-hosting', coalesce((v_activity_counts ->> 'shabbat-hosting')::integer, 0), v_cfg.rate_shabbat_hosting)
    ) category(ordinal, category_key, category_count, unit_rate);

    select coalesce(jsonb_agg(jsonb_build_object(
      'type', bonus_type, 'count', bonus_count, 'total', bonus_count * unit_amount
    ) order by ordinal), '[]'::jsonb)
      into bonus_by_type
    from (values
      (1, 'בונוס-לימוד-4', v_learning_4_count, v_cfg.bonus_loyalty_4),
      (2, 'בונוס-לימוד-6', v_learning_6_count, v_cfg.bonus_loyalty_6),
      (3, 'בונוס-מצוות', v_mitzvot_count, v_cfg.bonus_mitzvot_level),
      (4, 'בונוס-חדש', v_new_count, v_cfg.bonus_new_participant),
      (5, 'בונוס-תורני', v_torani_count, 1000::numeric)
    ) bonus(ordinal, bonus_type, bonus_count, unit_amount)
    where bonus_count > 0;

    select coalesce(jsonb_agg(jsonb_build_object(
      'reason', reason,
      'label', case reason
        when 'short-contact' then 'קשר קצרצר — אינו מזכה בתשלום'
        when 'min-duration' then 'פחות ממשך המינימום'
        when 'friendly-window' then 'קשר ידידותי מעבר לחלון הזכאות'
        when 'torani-transition' then 'הלקוח כבר עבר לקשר תורני'
        when 'friendly-frontal-cap' then 'חריגה ממכסת ידידותי-פרונטלי'
        when 'monthly-cap' then 'חריגה מהמכסה החודשית'
        when 'contact-cap' then 'חריגה מהמכסה מול לקוח'
        when 'unknown-type' then 'סוג קשר אינו מזכה'
        else 'הקשר אינו מזכה בתשלום'
      end,
      'count', reason_count
    ) order by reason), '[]'::jsonb)
      into unpaid_by_reason
    from (
      select key as reason, value::integer as reason_count
      from jsonb_each_text(v_unpaid_counts)
    ) reasons;
    v_row_count := v_row_count + 1;
    return next;
  end loop;

  -- The sensitive read and its redacted audit entry are one transaction. Any
  -- audit failure aborts the RPC, so no unaudited finance projection is returned.
  insert into app_private.audit_events (
    actor_user_id, effective_role, project_id, action, resource_type,
    resource_id, result, reason_code, metadata
  ) values (
    v_actor, v_effective_role, p_project_id, 'finance.summary.read', 'finance_summary',
    coalesce(p_user_id::text, 'all'), 'success', null,
    jsonb_build_object('period', p_period, 'rowCount', v_row_count)
  );
end $$;

comment on function public.app_finance_summary(text,integer,uuid) is
  'Owner: postgres. Authenticated execution only. Returns aggregate finance projection and writes redacted audit evidence atomically.';
alter function public.app_finance_summary(text,integer,uuid) owner to postgres;
revoke all on function public.app_finance_summary(text,integer,uuid) from public, anon, authenticated;
grant execute on function public.app_finance_summary(text,integer,uuid) to authenticated;

-- A cancellation is valid only while the exact derived candidate exists. The
-- caller supplies the opaque key; tenant, beneficiary, actor, type and amount
-- are recomputed under this owner-controlled boundary.
create or replace function public.app_cancel_bonus(p_bonus_key text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_aal text := coalesce(auth.jwt() ->> 'aal', 'aal1');
  v_parts text[];
  v_activist_code integer;
  v_bonus_type text;
  v_contact_id text;
  v_year integer;
  v_zero_month integer;
  v_start date;
  v_end date;
  v_actor_code integer;
  v_actor_global_role text;
  v_contact public.contacts%rowtype;
  v_beneficiary_user_id uuid;
  v_cfg public.payment_config%rowtype;
  v_learning_count integer := 0;
  v_amount numeric := 0;
begin
  if v_actor is null or p_bonus_key is null or length(p_bonus_key) > 512 then
    return false;
  end if;

  v_parts := regexp_split_to_array(p_bonus_key, '\|');
  if cardinality(v_parts) <> 4
    or v_parts[1] !~ '^[1-9][0-9]{0,9}$'
    or v_parts[1]::numeric > 2147483647
    or v_parts[2] not in ('בונוס-לימוד-4','בונוס-לימוד-6','בונוס-מצוות','בונוס-חדש','בונוס-תורני')
    or v_parts[3] !~ '^[A-Za-z0-9_-]{1,128}$'
    or v_parts[4] !~ '^\d{4}-\d{1,2}$' then
    return false;
  end if;

  v_activist_code := v_parts[1]::integer;
  v_bonus_type := v_parts[2];
  v_contact_id := v_parts[3];
  v_year := split_part(v_parts[4], '-', 1)::integer;
  v_zero_month := split_part(v_parts[4], '-', 2)::integer;
  if v_year < 1 or v_year > 9999 or v_zero_month < 0 or v_zero_month > 11 then
    return false;
  end if;
  v_start := make_date(v_year, v_zero_month + 1, 1);
  v_end := (v_start + interval '1 month')::date;

  select c.* into v_contact
  from public.contacts c
  where c.id::text = v_contact_id
  for update;
  if not found then
    return false;
  end if;

  select p.activist_code, p.global_role
    into v_actor_code, v_actor_global_role
  from public.profiles p
  where p.id = v_actor and p.disabled_at is null;
  if not found then
    return false;
  end if;
  if v_actor_code is null then
    raise exception 'bonus cancellation identity mapping unavailable' using errcode = '55000';
  end if;

  if not (
    (v_actor_global_role = 'ceo' and v_aal = 'aal2')
    or exists (
      select 1
      from public.project_memberships pm
      where pm.user_id = v_actor
        and pm.project_id = v_contact.project_id
        and pm.status = 'active'
        and pm.role in ('head','coord')
        and (pm.role = 'coord' or v_aal = 'aal2')
    )
  ) then
    return false;
  end if;

  select p.id into v_beneficiary_user_id
    from public.project_memberships pm
    join public.profiles p on p.id = pm.user_id
    where pm.project_id = v_contact.project_id
      and pm.status = 'active'
      and pm.role = 'activist'
      and p.disabled_at is null
      and p.activist_code = v_activist_code;
  if not found then
    return false;
  end if;
  if v_bonus_type in ('בונוס-מצוות','בונוס-חדש')
    and (v_contact.activist_id <> v_activist_code
      or v_contact.assigned_user_id is distinct from v_beneficiary_user_id) then
    return false;
  end if;

  select * into v_cfg from public.payment_config where id = 1;
  if not found then
    raise exception 'payment configuration unavailable' using errcode = '55000';
  end if;

  if v_bonus_type in ('בונוס-לימוד-4','בונוס-לימוד-6') then
    select count(*)::integer into v_learning_count
    from public.interactions i
    where i.actor_user_id = v_beneficiary_user_id
      and i.project_id = v_contact.project_id
      and i.contact_id::text = v_contact_id
      and i.date >= v_start and i.date < v_end
      and not (coalesce(i.participants, '{}'::jsonb) ? 'derived_from')
      and i.quality = 'תורני'
      and i.type in ('פרונטלי','וידאו')
      and coalesce(i.duration_minutes, 0) >= v_cfg.min_duration_minutes;
    if v_bonus_type = 'בונוס-לימוד-6' and v_learning_count >= 6 then
      v_amount := v_cfg.bonus_loyalty_6;
    elsif v_bonus_type = 'בונוס-לימוד-4' and v_learning_count between 4 and 5 then
      v_amount := v_cfg.bonus_loyalty_4;
    end if;
  elsif v_bonus_type = 'בונוס-מצוות' then
    select count(distinct h ->> 'mitzva')::numeric * v_cfg.bonus_mitzvot_level into v_amount
    from jsonb_array_elements(coalesce(v_contact.mitzvot_history, '[]'::jsonb)) h
    where nullif(h ->> 'mitzva', '') is not null
      and (case when coalesce(h ->> 'to', '') ~ '^-?\d+(?:\.\d+)?$' then (h ->> 'to')::numeric else 0 end)
        > (case when coalesce(h ->> 'from', '') ~ '^-?\d+(?:\.\d+)?$' then (h ->> 'from')::numeric else 0 end)
      and (case when coalesce(h ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}'
           then left(h ->> 'date', 10)::date else current_date end) >= v_start
      and (case when coalesce(h ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}'
           then left(h ->> 'date', 10)::date else current_date end) < v_end;
  elsif v_bonus_type = 'בונוס-חדש'
    and v_contact.joined_at >= v_start and v_contact.joined_at < v_end
    and (v_contact.source = 'external' or v_contact.referred_by is not null) then
    v_amount := v_cfg.bonus_new_participant;
  elsif v_bonus_type = 'בונוס-תורני' and exists (
    with torani_months as (
      select distinct date_trunc('month', i.date::timestamp)::date as month_start
      from public.interactions i
      where i.actor_user_id = v_beneficiary_user_id
        and i.project_id = v_contact.project_id
        and i.project_id in (1, 2)
        and i.contact_id::text = v_contact_id
        and i.quality = 'תורני'
        and coalesce(i.duration_minutes, 0) >= v_cfg.min_duration_minutes
        and not (coalesce(i.participants, '{}'::jsonb) ? 'derived_from')
    ), numbered as (
      select month_start,
        month_start - (row_number() over (order by month_start)::integer * interval '1 month') as streak_group
      from torani_months
    ), streaks as (
      select min(month_start) as run_start, count(*)::integer as run_length
      from numbered
      group by streak_group
    ), first_completion as (
      select min((run_start + interval '2 months')::date) as completion_month
      from streaks
      where run_length >= 3
    )
    select 1
    from first_completion
    where completion_month = v_start
  ) then
    v_amount := 1000;
  end if;

  if coalesce(v_amount, 0) <= 0 then
    return false;
  end if;

  insert into public.bonus_cancellations (
    bonus_key, activist_id, project_id, "desc", amount, cancelled_by,
    beneficiary_user_id, cancelled_by_user_id
  ) values (
    p_bonus_key, v_activist_code, v_contact.project_id, v_bonus_type, v_amount, v_actor_code,
    v_beneficiary_user_id, v_actor
  );
  return true;
end $$;

comment on function public.app_cancel_bonus(text) is
  'Owner: postgres. Authenticated execution only. Recomputes the exact derived bonus candidate before inserting a cancellation marker.';
alter function public.app_cancel_bonus(text) owner to postgres;
revoke all on function public.app_cancel_bonus(text) from public, anon, authenticated;
grant execute on function public.app_cancel_bonus(text) to authenticated;

commit;
