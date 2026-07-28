-- Applies a whole team arrangement in one transaction.
--
-- Auto-balance replaces every team at once. Done as a series of client calls, a
-- dropped connection halfway through leaves players seated on no team and, since
-- deleting a team cascades to its round, can take scores with it. This does the
-- lot atomically: either the new arrangement lands or nothing moves.
--
-- The snake draft itself stays on the client so there's one implementation of it;
-- this only applies the result.

create or replace function apply_team_assignments(
  p_event_id uuid,
  -- [{ id: uuid | null, name, tee_time, starting_hole, cart, member_ids: [uuid] }]
  -- A null id creates the team. Order is preserved in the returned ids.
  p_teams jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry   jsonb;
  v_team_id uuid;
  v_ids     uuid[] := '{}';
begin
  if not is_admin() then
    raise exception 'Only an admin can change teams' using errcode = '42501';
  end if;

  if jsonb_typeof(p_teams) is distinct from 'array' then
    raise exception 'p_teams must be a JSON array' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_teams)
  loop
    v_team_id := nullif(v_entry->>'id', '')::uuid;

    if v_team_id is null then
      insert into teams (event_id, name, tee_time, starting_hole, cart)
      values (
        p_event_id,
        coalesce(nullif(v_entry->>'name', ''), 'Team'),
        v_entry->>'tee_time',
        (v_entry->>'starting_hole')::int,
        v_entry->>'cart'
      )
      returning teams.id into v_team_id;
    else
      update teams
         set name          = coalesce(nullif(v_entry->>'name', ''), teams.name),
             tee_time      = v_entry->>'tee_time',
             starting_hole = (v_entry->>'starting_hole')::int,
             cart          = v_entry->>'cart'
       where teams.id = v_team_id
         and teams.event_id = p_event_id;

      if not found then
        raise exception 'Team % is not part of this event', v_team_id
          using errcode = '23503';
      end if;
    end if;

    v_ids := v_ids || v_team_id;

    -- team_members is unique on participant_id, so lift these players off
    -- whatever team they were on before seating them here.
    delete from team_members
     where participant_id in (
       select value::uuid
         from jsonb_array_elements_text(coalesce(v_entry->'member_ids', '[]'::jsonb))
     );

    insert into team_members (team_id, participant_id)
    select v_team_id, value::uuid
      from jsonb_array_elements_text(coalesce(v_entry->'member_ids', '[]'::jsonb))
    on conflict do nothing;
  end loop;

  -- Teams left out of the arrangement are gone. Skipped for an empty array so a
  -- malformed call can't wipe the event's teams.
  if array_length(v_ids, 1) > 0 then
    delete from teams
     where teams.event_id = p_event_id
       and not (teams.id = any(v_ids));
  end if;

  return v_ids;
end;
$$;

revoke all on function apply_team_assignments(uuid, jsonb) from public, anon;
grant execute on function apply_team_assignments(uuid, jsonb) to authenticated;
