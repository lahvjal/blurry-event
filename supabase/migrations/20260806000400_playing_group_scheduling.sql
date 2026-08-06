-- Playing groups are the physical foursomes on the course. They own scheduling;
-- scoring teams and participant-owned rounds remain independent.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_start_format') then
    create type event_start_format as enum ('staggered', 'shotgun', 'split_tee');
  end if;
end
$$;

alter table events
  add column if not exists start_format event_start_format
    not null default 'staggered';

-- A rare unpaired golfer in a scramble remains a normal team-owned scoring
-- entry. The explicit flag distinguishes that intentional exception from an
-- accidentally incomplete team without changing round or leaderboard identity.
alter table teams
  add column if not exists individual_exception boolean not null default false;

create table if not exists playing_groups (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  name              text not null,
  tee_time          text,
  starting_hole     int check (starting_hole between 1 and 18),
  cart              text,
  sort_order        int not null default 0,
  -- Retained only to make the first backfill and rollback window traceable.
  legacy_team_id    uuid unique references teams(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (num_nonnulls(tee_time, starting_hole) in (0, 2))
);

create index if not exists playing_groups_event_idx
  on playing_groups(event_id, sort_order, created_at);

create table if not exists playing_group_members (
  playing_group_id uuid not null references playing_groups(id) on delete cascade,
  participant_id   uuid not null references participants(id) on delete cascade,
  sort_order       int not null default 0,
  primary key (playing_group_id, participant_id),
  -- Participant registrations are event-scoped, so this means one group in
  -- their event without needing a denormalised event_id here.
  unique (participant_id)
);

-- Backfill one physical group per legacy team without touching the team,
-- membership, round, conversation, or score rows.
insert into playing_groups (
  event_id, name, tee_time, starting_hole, cart, sort_order, legacy_team_id, created_at
)
select
  team.event_id,
  team.name,
  team.tee_time,
  case when team.tee_time is null then null else coalesce(team.starting_hole, 1) end,
  team.cart,
  row_number() over (partition by team.event_id order by team.tee_time nulls last, team.created_at) - 1,
  team.id,
  team.created_at
from teams team
where not exists (
  select 1 from playing_groups existing where existing.legacy_team_id = team.id
);

-- Old clients prevented duplicate tee times, but repair unexpected legacy
-- conflicts safely before adding the canonical unique slot constraint. The
-- original team columns remain intact for an admin-visible recovery path.
with ranked as (
  select
    id,
    row_number() over (
      partition by event_id, tee_time, starting_hole
      order by created_at, id
    ) as occurrence
  from playing_groups
  where tee_time is not null and starting_hole is not null
)
update playing_groups target
set tee_time = null, starting_hole = null
from ranked
where target.id = ranked.id and ranked.occurrence > 1;

create unique index if not exists playing_groups_event_slot_uniq
  on playing_groups(event_id, tee_time, starting_hole)
  where tee_time is not null and starting_hole is not null;

-- Preserve at most four players in each new physical group. Oversized legacy
-- scoring teams remain untouched; extra players simply surface as unscheduled.
insert into playing_group_members (playing_group_id, participant_id, sort_order)
select seeded.playing_group_id, seeded.participant_id, seeded.member_order
from (
  select
    physical.id as playing_group_id,
    membership.participant_id,
    row_number() over (
      partition by physical.id order by registration.full_name, membership.participant_id
    ) - 1 as member_order
  from playing_groups physical
  join team_members membership on membership.team_id = physical.legacy_team_id
  join participants registration on registration.id = membership.participant_id
) seeded
where seeded.member_order < 4
on conflict (participant_id) do nothing;

create or replace function playing_group_event_id(target_group uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select event_id from playing_groups where id = target_group $$;

create or replace function validate_playing_group_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_format event_start_format;
  event_start text;
  event_times text[];
begin
  if new.tee_time is null and new.starting_hole is null then
    new.updated_at := now();
    return new;
  end if;
  if new.tee_time is null or new.starting_hole is null then
    raise exception 'A playing group needs both a start time and starting hole'
      using errcode = '23514';
  end if;

  select start_format, start_time, tee_times
  into event_format, event_start, event_times
  from events where id = new.event_id;

  if event_format = 'staggered' then
    if new.starting_hole <> 1 or not (new.tee_time = any(event_times)) then
      raise exception 'Staggered groups must use an available Hole 1 tee time'
        using errcode = '23514';
    end if;
  elsif event_format = 'shotgun' then
    if new.tee_time <> event_start then
      raise exception 'Shotgun groups must share the event start time'
        using errcode = '23514';
    end if;
  elsif event_format = 'split_tee' then
    if new.starting_hole not in (1, 10)
       or not (new.tee_time = any(event_times)) then
      raise exception 'Split-tee groups must use an available Hole 1 or Hole 10 slot'
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists playing_groups_validate_schedule on playing_groups;
create trigger playing_groups_validate_schedule
  before insert or update of event_id, tee_time, starting_hole on playing_groups
  for each row execute function validate_playing_group_schedule();

create or replace function validate_playing_group_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  group_event uuid;
  participant_event uuid;
  occupied int;
begin
  -- Serialise assignments into one group so concurrent fourth/fifth inserts
  -- cannot both pass the capacity check.
  select event_id into group_event
  from playing_groups where id = new.playing_group_id for update;
  select event_id into participant_event
  from participants where id = new.participant_id;

  if group_event is null or participant_event is null or group_event <> participant_event then
    raise exception 'Playing-group members must belong to the same event'
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' then
    select count(*) into occupied
    from playing_group_members membership
    where membership.playing_group_id = new.playing_group_id
      and membership.participant_id <> old.participant_id;
  else
    select count(*) into occupied
    from playing_group_members membership
    where membership.playing_group_id = new.playing_group_id;
  end if;

  if occupied >= 4 then
    raise exception 'A playing group cannot contain more than four players'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists playing_group_members_validate on playing_group_members;
create trigger playing_group_members_validate
  before insert or update on playing_group_members
  for each row execute function validate_playing_group_member();

create or replace function event_has_split_scoring_team(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select game_style <> 'solo' from events where id = target_event), false)
    and exists (
      select 1
      from teams scoring_team
      where scoring_team.event_id = target_event
        and (
          (
            select count(*)
            from playing_group_members physical_member
            join team_members membership
              on membership.participant_id = physical_member.participant_id
            where membership.team_id = scoring_team.id
          ) not in (
            0,
            (select count(*) from team_members where team_id = scoring_team.id)
          )
          or (
            select count(distinct physical_member.playing_group_id)
            from playing_group_members physical_member
            join team_members membership
              on membership.participant_id = physical_member.participant_id
            where membership.team_id = scoring_team.id
          ) > 1
        )
    )
$$;

-- Once physical groups exist, schedule fields are a single atomic document.
-- This prevents a direct/older client write from changing the event mode while
-- leaving its groups in slots that are valid only under the previous mode.
create or replace function guard_atomic_event_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.schedule_apply', true) is distinct from 'on'
     and (
       new.start_format is distinct from old.start_format
       or new.start_time is distinct from old.start_time
       or new.tee_times is distinct from old.tee_times
     )
     and exists (select 1 from playing_groups where event_id = new.id)
  then
    raise exception 'Use apply_event_schedule to change a playing-group schedule'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists events_guard_atomic_schedule on events;
create trigger events_guard_atomic_schedule
  before update of start_format, start_time, tee_times on events
  for each row execute function guard_atomic_event_schedule();

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

  -- A participant may appear only once in the complete submitted arrangement.
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

  -- The payload is authoritative. Clearing first supports moving participants
  -- between groups while the unique participant constraint stays enabled.
  -- Clearing slots also makes a two-group slot swap possible without a
  -- transient unique-index collision inside this transaction.
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

  -- A scramble side is one scheduling unit. Two 2-player teams may share a
  -- foursome, and a one-player exception occupies one seat, but a scoring team
  -- may never be partly assigned or split across physical groups.
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
    if exists (
      select 1
      from playing_groups physical
      where physical.event_id = p_event_id
        and exists (
          select 1 from playing_group_members membership
          where membership.playing_group_id = physical.id
        )
        and (physical.tee_time is null or physical.starting_hole is null)
    ) then
      raise exception 'Every occupied playing group needs a start slot in a published event'
        using errcode = '23514';
    end if;
  end if;

  -- Compatibility mirror: if every member of a legacy scoring team is together,
  -- older clients receive the group's logistics from the existing team columns.
  -- Suppress the legacy team trigger: the group job below is authoritative and
  -- fans out once to the complete physical group.
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

-- The legacy logistics trigger stays in place for old-client writes, but mirror
-- updates from apply_event_schedule must not deliver a second notification.
create or replace function on_team_logistics_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.schedule_mirror', true) = 'on' then
    return null;
  end if;
  if new.tee_time is distinct from old.tee_time
     or new.starting_hole is distinct from old.starting_hole then
    perform notify_push(jsonb_build_object('type', 'team_update', 'id', new.id));
  end if;
  return null;
end;
$$;

-- Scoring identities become immutable once an event is public or any score
-- exists. Names and legacy logistics may still be edited without changing who
-- owns a round.
create or replace function scoring_identity_is_locked(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select lifecycle_status <> 'draft' from events where id = target_event), true)
    or exists (
      select 1
      from scores score
      join rounds round on round.id = score.round_id
      where round.event_id = target_event
    )
$$;

create or replace function guard_scoring_team_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_event uuid;
  event_style game_style;
  member_count int;
begin
  target_event := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  if scoring_identity_is_locked(target_event) then
    raise exception 'Scoring teams cannot change after publication or score entry'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT'
     and (select game_style from events where id = target_event) = 'solo'
  then
    raise exception 'Solo events do not use scoring teams' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.individual_exception then
    select game_style into event_style from events where id = target_event;
    select count(*) into member_count from team_members where team_id = new.id;
    if event_style = 'solo' or member_count <> 1 then
      raise exception 'An individual exception must be a one-member team in a scramble event'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists teams_guard_identity_insert_delete on teams;
create trigger teams_guard_identity_insert_delete
  before insert or delete on teams
  for each row execute function guard_scoring_team_identity();
drop trigger if exists teams_guard_identity_update on teams;
create trigger teams_guard_identity_update
  before update of event_id, individual_exception on teams
  for each row execute function guard_scoring_team_identity();

create or replace function validate_scoring_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_event uuid;
  participant_event uuid;
  event_style game_style;
  required_size int;
  occupied int;
  is_exception boolean;
begin
  select team.event_id into target_event
  from teams team
  where team.id = case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  if target_event is null then
    raise exception 'Scoring team does not exist' using errcode = '23503';
  end if;
  if scoring_identity_is_locked(target_event) then
    raise exception 'Scoring-team membership cannot change after publication or score entry'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  select event.game_style, team.individual_exception
  into event_style, is_exception
  from teams team
  join events event on event.id = team.event_id
  where team.id = new.team_id;
  select event_id into participant_event from participants where id = new.participant_id;
  if participant_event is null or participant_event <> target_event then
    raise exception 'Scoring-team members must belong to the same event'
      using errcode = '23503';
  end if;
  if event_style = 'solo' then
    raise exception 'Solo events use participant-owned rounds, not scoring teams'
      using errcode = '23514';
  end if;
  required_size := case when event_style = 'scramble_2' then 2 else 4 end;

  perform 1 from teams where id = new.team_id for update;
  if tg_op = 'UPDATE' and old.team_id = new.team_id then
    select count(*) into occupied
    from team_members membership
    where membership.team_id = new.team_id
      and membership.participant_id <> old.participant_id;
  else
    select count(*) into occupied
    from team_members membership
    where membership.team_id = new.team_id;
  end if;
  if occupied >= required_size then
    raise exception 'Scoring team is already at capacity' using errcode = '23514';
  end if;
  if is_exception and occupied >= 1 then
    raise exception 'An individual-exception team can contain only one player'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_validate_format on team_members;
create trigger team_members_validate_format
  before insert or update or delete on team_members
  for each row execute function validate_scoring_team_member();

-- Moving a player is one transaction. This avoids the legacy delete-then-insert
-- window that could leave the golfer unassigned when the target is invalid.
create or replace function assign_scoring_team_member(
  p_event_id uuid,
  p_participant_id uuid,
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_event_admin(p_event_id) then
    raise exception 'Only an event admin can change scoring teams'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from participants
    where id = p_participant_id and event_id = p_event_id
  ) then
    raise exception 'Participant does not belong to this event'
      using errcode = '23503';
  end if;
  if p_team_id is not null and not exists (
    select 1 from teams where id = p_team_id and event_id = p_event_id
  ) then
    raise exception 'Scoring team does not belong to this event'
      using errcode = '23503';
  end if;

  -- Moving the only member out also clears the explicit exception marker.
  update teams scoring_team
  set individual_exception = false
  where scoring_team.individual_exception
    and exists (
      select 1 from team_members membership
      where membership.team_id = scoring_team.id
        and membership.participant_id = p_participant_id
    );
  delete from team_members where participant_id = p_participant_id;
  if p_team_id is not null then
    insert into team_members (team_id, participant_id)
    values (p_team_id, p_participant_id);
  end if;
end;
$$;

-- Replace the legacy bulk RPC with the same shape plus explicit exception and
-- cross-event/capacity validation. Existing callers that omit the flag retain
-- the normal-team default.
create or replace function apply_team_assignments(p_event_id uuid, p_teams jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  target_team uuid;
  team_ids uuid[] := '{}'::uuid[];
  member_ids uuid[];
  required_size int;
  event_style game_style;
  exception_requested boolean;
begin
  if not is_event_admin(p_event_id) then
    raise exception 'Only an admin can change scoring teams' using errcode = '42501';
  end if;
  if jsonb_typeof(p_teams) is distinct from 'array' then
    raise exception 'p_teams must be a JSON array' using errcode = '22023';
  end if;
  select game_style into event_style from events where id = p_event_id;
  if event_style = 'solo' then
    raise exception 'Solo events do not use scoring teams' using errcode = '23514';
  end if;
  required_size := case when event_style = 'scramble_2' then 2 else 4 end;
  if exists (
    select member.value
    from jsonb_array_elements(p_teams) scoring_team
    cross join lateral jsonb_array_elements_text(
      coalesce(scoring_team.value->'member_ids', '[]'::jsonb)
    ) member
    group by member.value
    having count(*) > 1
  ) then
    raise exception 'A player cannot belong to more than one scoring team'
      using errcode = '23505';
  end if;

  -- Clear exception flags before rearranging members so a flagged singleton can
  -- safely receive a normal teammate or become empty within this transaction.
  update teams set individual_exception = false where event_id = p_event_id;
  delete from team_members membership
  using teams scoring_team
  where membership.team_id = scoring_team.id
    and scoring_team.event_id = p_event_id;

  for entry in select value from jsonb_array_elements(p_teams)
  loop
    member_ids := array(
      select value::uuid
      from jsonb_array_elements_text(coalesce(entry->'member_ids', '[]'::jsonb))
    );
    exception_requested := coalesce((entry->>'individual_exception')::boolean, false);
    if coalesce(array_length(member_ids, 1), 0) > required_size then
      raise exception 'Scoring team exceeds the selected game format capacity'
        using errcode = '23514';
    end if;
    if exception_requested and coalesce(array_length(member_ids, 1), 0) <> 1 then
      raise exception 'An individual exception must have exactly one member'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from unnest(member_ids) member_id
      where not exists (
        select 1 from participants participant
        where participant.id = member_id and participant.event_id = p_event_id
      )
    ) then
      raise exception 'Every scoring-team member must belong to this event'
        using errcode = '23503';
    end if;

    target_team := nullif(entry->>'id', '')::uuid;
    if target_team is null then
      insert into teams (event_id, name, tee_time, starting_hole, cart)
      values (
        p_event_id,
        coalesce(nullif(entry->>'name', ''), 'Team'),
        entry->>'tee_time',
        (entry->>'starting_hole')::int,
        entry->>'cart'
      ) returning id into target_team;
    else
      update teams
      set name = coalesce(nullif(entry->>'name', ''), teams.name),
          tee_time = entry->>'tee_time',
          starting_hole = (entry->>'starting_hole')::int,
          cart = entry->>'cart'
      where id = target_team and event_id = p_event_id;
      if not found then
        raise exception 'Scoring team % is not part of this event', target_team
          using errcode = '23503';
      end if;
    end if;

    team_ids := team_ids || target_team;
    insert into team_members (team_id, participant_id)
    select target_team, member_id from unnest(member_ids) member_id;
    update teams
    set individual_exception = exception_requested
    where id = target_team;
  end loop;

  delete from teams
  where event_id = p_event_id
    and (array_length(team_ids, 1) is null or not (id = any(team_ids)));
  return team_ids;
end;
$$;

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
         select 1 from scores score
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
    if exists (
      select 1 from playing_groups physical
      where physical.event_id = new.id
        and exists (
          select 1 from playing_group_members membership
          where membership.playing_group_id = physical.id
        )
        and (physical.tee_time is null or physical.starting_hole is null)
    ) then
      raise exception 'Every occupied playing group needs a valid start slot'
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from playing_groups physical
      where physical.event_id = new.id
        and exists (
          select 1 from playing_group_members membership
          where membership.playing_group_id = physical.id
        )
        and not (
          (
            new.start_format = 'staggered'
            and physical.starting_hole = 1
            and physical.tee_time = any(coalesce(new.tee_times, '{}'::text[]))
          )
          or (
            new.start_format = 'shotgun'
            and physical.tee_time = new.start_time
          )
          or (
            new.start_format = 'split_tee'
            and physical.starting_hole in (1, 10)
            and physical.tee_time = any(coalesce(new.tee_times, '{}'::text[]))
          )
        )
    ) then
      raise exception 'Every occupied playing group needs a slot valid for the selected start format'
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

drop trigger if exists events_scoring_identity_and_readiness on events;
create trigger events_scoring_identity_and_readiness
  before update of game_style, lifecycle_status on events
  for each row execute function enforce_event_scoring_identity_and_readiness();

-- Keep the existing RPC signature so every queued legacy score remains
-- retryable. A legacy participant-owned score queued for a scramble is safely
-- resolved to that participant's current scoring team; new incompatible owner
-- kinds are rejected. This is especially important for a one-member team,
-- whose ordinary team-owned round needs no special client or leaderboard path.
create or replace function submit_offline_score(
  p_event_id uuid,
  p_team_id uuid,
  p_participant_id uuid,
  p_hole integer,
  p_strokes integer,
  p_entered_by uuid,
  p_client_updated_at timestamptz,
  p_client_version bigint,
  p_mutation_id uuid
)
returns table (
  applied boolean,
  score_round_id uuid,
  score_hole integer,
  score_strokes integer,
  score_client_updated_at timestamptz,
  score_client_version bigint,
  score_mutation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  registration_id uuid;
  target_round_id uuid;
  current_score scores%rowtype;
  event_style game_style;
  effective_team_id uuid := p_team_id;
  effective_participant_id uuid := p_participant_id;
begin
  if auth.uid() is null then
    raise exception 'Sign in before syncing scores' using errcode = '42501';
  end if;
  if p_event_id is null or not has_event_access(p_event_id) then
    raise exception 'Event is not available to this account' using errcode = '42501';
  end if;
  if num_nonnulls(p_team_id, p_participant_id) <> 1 then
    raise exception 'A score must have exactly one team or participant owner'
      using errcode = '22023';
  end if;
  if p_hole not between 1 and 18 or p_strokes not between 1 and 20 then
    raise exception 'Score hole or strokes are out of range' using errcode = '22023';
  end if;
  if p_client_updated_at is null or p_client_version is null or p_client_version < 0
     or p_mutation_id is null then
    raise exception 'Score revision metadata is required' using errcode = '22023';
  end if;

  select game_style into event_style from events where id = p_event_id;
  if event_style is null then
    raise exception 'Event does not exist' using errcode = '23503';
  end if;
  if event_style = 'solo' and p_team_id is not null then
    raise exception 'Solo events require participant-owned rounds'
      using errcode = '23514';
  elsif event_style <> 'solo' and p_participant_id is not null then
    -- Compatibility for scores queued by a legacy client while the golfer was
    -- unpaired. The admin must have placed them on exactly one normal or
    -- individual-exception scoring team before this upload can land.
    select membership.team_id into effective_team_id
    from team_members membership
    join teams team on team.id = membership.team_id
    where membership.participant_id = p_participant_id
      and team.event_id = p_event_id;
    if effective_team_id is null then
      raise exception 'Scramble scores require a scoring-team assignment'
        using errcode = '23514';
    end if;
    effective_participant_id := null;
  end if;

  registration_id := event_participant_id(p_event_id);
  if registration_id is null or p_entered_by is distinct from registration_id then
    raise exception 'The scorer is not registered for this event' using errcode = '42501';
  end if;

  if effective_team_id is not null then
    if not exists (
      select 1 from teams team
      where team.id = effective_team_id and team.event_id = p_event_id
    ) then
      raise exception 'Team does not belong to this event' using errcode = '23514';
    end if;
    if not is_event_admin(p_event_id) and not exists (
      select 1 from team_members membership
      where membership.team_id = effective_team_id
        and membership.participant_id = registration_id
    ) then
      raise exception 'Only a teammate or event admin can score this round'
        using errcode = '42501';
    end if;

    insert into rounds (event_id, team_id, participant_id)
    values (p_event_id, effective_team_id, null)
    on conflict (event_id, team_id) where team_id is not null
    do update set event_id = excluded.event_id
    returning id into target_round_id;
  else
    if not exists (
      select 1 from participants participant
      where participant.id = effective_participant_id
        and participant.event_id = p_event_id
    ) then
      raise exception 'Participant does not belong to this event' using errcode = '23514';
    end if;
    if effective_participant_id <> registration_id and not is_event_admin(p_event_id) then
      raise exception 'Only the player or event admin can score this round'
        using errcode = '42501';
    end if;

    insert into rounds (event_id, team_id, participant_id)
    values (p_event_id, null, effective_participant_id)
    on conflict (event_id, participant_id) where participant_id is not null
    do update set event_id = excluded.event_id
    returning id into target_round_id;
  end if;

  select score.* into current_score
  from scores score
  where score.last_mutation_id = p_mutation_id;
  if found then
    if current_score.round_id <> target_round_id or current_score.hole <> p_hole then
      raise exception 'Mutation ID was already used for another score'
        using errcode = '22023';
    end if;
    return query select
      true,
      current_score.round_id,
      current_score.hole,
      current_score.strokes,
      current_score.client_updated_at,
      current_score.client_version,
      current_score.last_mutation_id;
    return;
  end if;

  insert into scores as stored (
    event_id,
    round_id,
    hole,
    strokes,
    entered_by,
    client_updated_at,
    client_version,
    last_mutation_id
  ) values (
    p_event_id,
    target_round_id,
    p_hole,
    p_strokes,
    registration_id,
    p_client_updated_at,
    p_client_version,
    p_mutation_id
  )
  on conflict (round_id, hole) do update
  set strokes = excluded.strokes,
      entered_by = excluded.entered_by,
      client_updated_at = excluded.client_updated_at,
      client_version = excluded.client_version,
      last_mutation_id = excluded.last_mutation_id
  where excluded.client_updated_at > stored.client_updated_at
     or (
       excluded.client_updated_at = stored.client_updated_at
       and excluded.client_version > stored.client_version
     )
     or (
       excluded.client_updated_at = stored.client_updated_at
       and excluded.client_version = stored.client_version
       and excluded.last_mutation_id::text > coalesce(stored.last_mutation_id::text, '')
     )
  returning stored.* into current_score;

  if current_score.round_id is null then
    select score.* into current_score
    from scores score
    where score.round_id = target_round_id and score.hole = p_hole;
  end if;

  return query select
    current_score.last_mutation_id = p_mutation_id,
    current_score.round_id,
    current_score.hole,
    current_score.strokes,
    current_score.client_updated_at,
    current_score.client_version,
    current_score.last_mutation_id;
end;
$$;

alter table playing_groups enable row level security;
alter table playing_group_members enable row level security;

drop policy if exists "account reads event playing groups" on playing_groups;
create policy "account reads event playing groups" on playing_groups
  for select to authenticated using (has_event_access(event_id));
drop policy if exists "event admins manage playing groups" on playing_groups;
create policy "event admins manage playing groups" on playing_groups
  for all to authenticated using (is_event_admin(event_id)) with check (is_event_admin(event_id));

drop policy if exists "account reads event playing group members" on playing_group_members;
create policy "account reads event playing group members" on playing_group_members
  for select to authenticated using (has_event_access(playing_group_event_id(playing_group_id)));
drop policy if exists "event admins manage playing group members" on playing_group_members;
create policy "event admins manage playing group members" on playing_group_members
  for all to authenticated
  using (is_event_admin(playing_group_event_id(playing_group_id)))
  with check (is_event_admin(playing_group_event_id(playing_group_id)));

revoke all on function playing_group_event_id(uuid) from public;
revoke all on function apply_event_schedule(uuid, event_start_format, text, text[], jsonb)
  from public, anon;
revoke all on function scoring_identity_is_locked(uuid) from public, anon;
revoke all on function event_has_split_scoring_team(uuid) from public, anon, authenticated;
revoke all on function assign_scoring_team_member(uuid, uuid, uuid) from public, anon;
revoke all on function apply_team_assignments(uuid, jsonb) from public, anon;
grant execute on function playing_group_event_id(uuid) to authenticated;
grant execute on function apply_event_schedule(uuid, event_start_format, text, text[], jsonb)
  to authenticated;
grant execute on function assign_scoring_team_member(uuid, uuid, uuid) to authenticated;
grant execute on function apply_team_assignments(uuid, jsonb) to authenticated;
