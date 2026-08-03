-- Atomic, idempotent score submission for long offline sessions.
--
-- The client keeps immutable score revisions. This RPC creates/fetches the
-- owner's round and conditionally applies one revision in the same database
-- transaction, so concurrent first-hole uploads cannot strand a score.

alter table scores
  add column if not exists client_version bigint not null default 0,
  add column if not exists last_mutation_id uuid;

create unique index if not exists scores_last_mutation_id_uniq
  on scores (last_mutation_id)
  where last_mutation_id is not null;

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

  registration_id := event_participant_id(p_event_id);
  if registration_id is null or p_entered_by is distinct from registration_id then
    raise exception 'The scorer is not registered for this event' using errcode = '42501';
  end if;

  if p_team_id is not null then
    if not exists (
      select 1
      from teams team
      where team.id = p_team_id and team.event_id = p_event_id
    ) then
      raise exception 'Team does not belong to this event' using errcode = '23514';
    end if;
    if not is_event_admin(p_event_id) and not exists (
      select 1
      from team_members membership
      where membership.team_id = p_team_id
        and membership.participant_id = registration_id
    ) then
      raise exception 'Only a teammate or event admin can score this round'
        using errcode = '42501';
    end if;

    insert into rounds (event_id, team_id, participant_id)
    values (p_event_id, p_team_id, null)
    on conflict (event_id, team_id) where team_id is not null
    do update set event_id = excluded.event_id
    returning id into target_round_id;
  else
    if not exists (
      select 1
      from participants participant
      where participant.id = p_participant_id
        and participant.event_id = p_event_id
    ) then
      raise exception 'Participant does not belong to this event' using errcode = '23514';
    end if;
    if p_participant_id <> registration_id and not is_event_admin(p_event_id) then
      raise exception 'Only the player or event admin can score this round'
        using errcode = '42501';
    end if;

    insert into rounds (event_id, team_id, participant_id)
    values (p_event_id, null, p_participant_id)
    on conflict (event_id, participant_id) where participant_id is not null
    do update set event_id = excluded.event_id
    returning id into target_round_id;
  end if;

  -- A response can be lost after commit. Repeating the exact UUID is success,
  -- but reusing it for another hole/round is rejected explicitly.
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

revoke all on function submit_offline_score(
  uuid, uuid, uuid, integer, integer, uuid, timestamptz, bigint, uuid
) from public, anon;
grant execute on function submit_offline_score(
  uuid, uuid, uuid, integer, integer, uuid, timestamptz, bigint, uuid
) to authenticated;
