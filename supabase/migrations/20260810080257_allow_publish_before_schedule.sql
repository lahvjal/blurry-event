-- Publishing makes a roster visible. It is not a promise that every physical
-- group has already received a shotgun hole. Keep group/scoring integrity
-- strict, but permit an event admin to finish or revise the schedule live.

create or replace function enforce_event_scoring_identity_and_readiness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  roster_count int;
  grouped_count int;
  scoring_count int;
  required_team_size int;
begin
  if new.game_style is distinct from old.game_style then
    if old.lifecycle_status <> 'draft'
       or exists (
         select 1
         from scores score
         join rounds round on round.id = score.round_id
         where round.event_id = old.id
       ) then
      raise exception 'Scoring format cannot change after publication or score entry'
        using errcode = '55000';
    end if;
  end if;

  if new.lifecycle_status in ('published', 'live')
     and (old.lifecycle_status = 'draft' or new.lifecycle_status is distinct from old.lifecycle_status)
  then
    select count(*) into roster_count from participants where event_id = new.id;
    select count(*) into grouped_count
    from playing_group_members membership
    join playing_groups physical on physical.id = membership.playing_group_id
    where physical.event_id = new.id;

    if roster_count = 0 or grouped_count <> roster_count then
      raise exception 'Every participant needs one playing group before publication'
        using errcode = '23514';
    end if;
    if event_has_split_scoring_team(new.id) then
      raise exception 'Every scoring team must stay together in one playing group'
        using errcode = '23514';
    end if;

    if new.game_style <> 'solo' then
      required_team_size := case when new.game_style = 'scramble_2' then 2 else 4 end;
      select count(distinct membership.participant_id) into scoring_count
      from team_members membership
      join teams scoring_team on scoring_team.id = membership.team_id
      where scoring_team.event_id = new.id;
      if scoring_count <> roster_count then
        raise exception 'Every participant needs a scoring team before publication'
          using errcode = '23514';
      end if;
      if exists (
        select 1 from teams scoring_team
        where scoring_team.event_id = new.id
          and not (
            (
              not scoring_team.individual_exception
              and (select count(*) from team_members membership
                   where membership.team_id = scoring_team.id) = required_team_size
            )
            or (
              scoring_team.individual_exception
              and (select count(*) from team_members membership
                   where membership.team_id = scoring_team.id) = 1
            )
          )
      ) then
        raise exception 'Every scoring team must be complete or an explicit one-player exception before publication'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Retain atomic group updates and roster completeness after publication, while
-- allowing a saved group to have no tee time/hole until an admin assigns it.
create or replace function apply_event_schedule(
  p_event_id uuid,
  p_start_format event_start_format,
  p_start_time text,
  p_tee_times text[],
  p_groups jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  target_group uuid;
  group_ids uuid[] := '{}'::uuid[];
  member_ids uuid[];
begin
  if not is_event_admin(p_event_id) then
    raise exception 'Only an event admin can change the schedule' using errcode = '42501';
  end if;
  if jsonb_typeof(p_groups) is distinct from 'array' then
    raise exception 'p_groups must be a JSON array' using errcode = '22023';
  end if;
  if p_start_time is null or btrim(p_start_time) = '' then
    raise exception 'The event needs a start time' using errcode = '23514';
  end if;

  if exists (
    select member.value
    from jsonb_array_elements(p_groups) physical
    cross join lateral jsonb_array_elements_text(
      coalesce(physical.value->'member_ids', '[]'::jsonb)
    ) member
    group by member.value
    having count(*) > 1
  ) then
    raise exception 'A player cannot be assigned to more than one playing group'
      using errcode = '23505';
  end if;

  perform set_config('app.schedule_apply', 'on', true);
  update events
  set start_format = p_start_format,
      start_time = p_start_time,
      tee_times = case
        when p_start_format = 'shotgun' then array[p_start_time]
        else coalesce(p_tee_times, '{}')
      end
  where id = p_event_id;
  perform set_config('app.schedule_apply', 'off', true);

  update playing_groups
  set tee_time = null, starting_hole = null
  where event_id = p_event_id;
  delete from playing_group_members membership
  using playing_groups physical
  where membership.playing_group_id = physical.id
    and physical.event_id = p_event_id;

  for entry in select value from jsonb_array_elements(p_groups)
  loop
    member_ids := array(
      select value::uuid
      from jsonb_array_elements_text(coalesce(entry->'member_ids', '[]'::jsonb))
    );
    if coalesce(array_length(member_ids, 1), 0) > 4 then
      raise exception 'A playing group cannot contain more than four players'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from unnest(member_ids) member_id
      where not exists (
        select 1 from participants participant
        where participant.id = member_id and participant.event_id = p_event_id
      )
    ) then
      raise exception 'Every playing-group member must belong to this event'
        using errcode = '23503';
    end if;

    target_group := nullif(entry->>'id', '')::uuid;
    if target_group is null then
      insert into playing_groups (
        event_id, name, tee_time, starting_hole, cart, sort_order
      ) values (
        p_event_id,
        coalesce(nullif(btrim(entry->>'name'), ''), 'Group'),
        nullif(entry->>'tee_time', ''),
        nullif(entry->>'starting_hole', '')::int,
        nullif(entry->>'cart', ''),
        coalesce((entry->>'sort_order')::int, array_length(group_ids, 1), 0)
      ) returning id into target_group;
    else
      update playing_groups
      set name = coalesce(nullif(btrim(entry->>'name'), ''), playing_groups.name),
          tee_time = nullif(entry->>'tee_time', ''),
          starting_hole = nullif(entry->>'starting_hole', '')::int,
          cart = nullif(entry->>'cart', ''),
          sort_order = coalesce((entry->>'sort_order')::int, playing_groups.sort_order)
      where id = target_group and event_id = p_event_id;
      if not found then
        raise exception 'Playing group % is not part of this event', target_group
          using errcode = '23503';
      end if;
    end if;

    group_ids := group_ids || target_group;
    insert into playing_group_members (playing_group_id, participant_id, sort_order)
    select target_group, member_id, member_order - 1
    from unnest(member_ids) with ordinality as member(member_id, member_order);
  end loop;

  delete from playing_groups
  where event_id = p_event_id
    and (array_length(group_ids, 1) is null or not (id = any(group_ids)));

  if event_has_split_scoring_team(p_event_id) then
    raise exception 'A scoring team must stay together in one playing group'
      using errcode = '23514';
  end if;

  if (select lifecycle_status in ('published', 'live') from events where id = p_event_id)
  then
    if (select count(*) from participants where event_id = p_event_id) <>
       (
         select count(*)
         from playing_group_members membership
         join playing_groups physical on physical.id = membership.playing_group_id
         where physical.event_id = p_event_id
       )
    then
      raise exception 'Every participant needs one playing group in a published event'
        using errcode = '23514';
    end if;
  end if;

  perform set_config('app.schedule_mirror', 'on', true);
  update teams scoring_team
  set tee_time = colocated.tee_time,
      starting_hole = colocated.starting_hole,
      cart = coalesce(colocated.cart, scoring_team.cart)
  from (
    select membership.team_id, min(physical.tee_time) as tee_time,
           min(physical.starting_hole) as starting_hole, min(physical.cart) as cart
    from team_members membership
    join playing_group_members physical_member
      on physical_member.participant_id = membership.participant_id
    join playing_groups physical on physical.id = physical_member.playing_group_id
    where physical.event_id = p_event_id
    group by membership.team_id
    having count(distinct physical.id) = 1
  ) colocated
  where scoring_team.id = colocated.team_id
    and scoring_team.event_id = p_event_id;
  perform set_config('app.schedule_mirror', 'off', true);

  foreach target_group in array group_ids
  loop
    perform notify_push(jsonb_build_object('type', 'playing_group_update', 'id', target_group));
  end loop;

  return group_ids;
end;
$$;
