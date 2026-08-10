-- A published event may still gain late registrations. Administrators can add
-- new scoring teams and fill a team that has not begun scoring, but cannot
-- reshape or delete an established/scored side.

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
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  target_event := case when tg_op = 'DELETE' then old.event_id else new.event_id end;

  if scoring_identity_is_locked(target_event) then
    if not (tg_op = 'INSERT' and is_event_admin(target_event)) then
      raise exception 'Existing scoring teams cannot change after publication or score entry'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'INSERT'
     and (select game_style from events where id = target_event) = 'solo' then
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
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select team.event_id into target_event
  from teams team
  where team.id = case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  if target_event is null then
    raise exception 'Scoring team does not exist' using errcode = '23503';
  end if;

  if scoring_identity_is_locked(target_event) then
    if not (
      tg_op = 'INSERT'
      and is_event_admin(target_event)
      and not exists (select 1 from rounds round where round.team_id = new.team_id)
    ) then
      raise exception 'Existing or scored team membership cannot change after publication'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  select event.game_style, team.individual_exception
  into event_style, is_exception
  from teams team join events event on event.id = team.event_id
  where team.id = new.team_id;
  select event_id into participant_event from participants where id = new.participant_id;
  if participant_event is null or participant_event <> target_event then
    raise exception 'Scoring-team members must belong to the same event' using errcode = '23503';
  end if;
  if event_style = 'solo' then
    raise exception 'Solo events use participant-owned rounds, not scoring teams' using errcode = '23514';
  end if;
  required_size := case when event_style = 'scramble_2' then 2 else 4 end;
  perform 1 from teams where id = new.team_id for update;
  if tg_op = 'UPDATE' and old.team_id = new.team_id then
    select count(*) into occupied from team_members membership
    where membership.team_id = new.team_id
      and membership.participant_id <> old.participant_id;
  else
    select count(*) into occupied from team_members membership
    where membership.team_id = new.team_id;
  end if;
  if occupied >= required_size then
    raise exception 'Scoring team is already at capacity' using errcode = '23514';
  end if;
  if is_exception and occupied >= 1 then
    raise exception 'An individual-exception team can contain only one player' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Trigger functions are not an API surface.
revoke all on function guard_scoring_team_identity() from public, anon, authenticated;
revoke all on function validate_scoring_team_member() from public, anon, authenticated;
