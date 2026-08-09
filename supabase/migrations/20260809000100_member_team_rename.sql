-- Allow a registered scoring-team member to rename only their own team.
-- This deliberately does not broaden teams RLS or expose any other team field.

create or replace function rename_own_scoring_team(
  p_event_id uuid,
  p_team_id uuid,
  p_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_name text := btrim(p_name);
  authorized_team uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before renaming a team' using errcode = '42501';
  end if;

  if cleaned_name is null or cleaned_name = '' then
    raise exception 'Team name cannot be empty' using errcode = '22023';
  end if;

  if char_length(cleaned_name) > 50 then
    raise exception 'Team name cannot exceed 50 characters' using errcode = '22023';
  end if;

  select scoring_team.id into authorized_team
  from teams scoring_team
  join team_members membership on membership.team_id = scoring_team.id
  join participants registration
    on registration.id = membership.participant_id
   and registration.event_id = scoring_team.event_id
  where scoring_team.id = p_team_id
    and scoring_team.event_id = p_event_id
    and registration.claimed_by = auth.uid()
  limit 1;

  if authorized_team is null then
    -- One message for missing, cross-event, and non-member targets avoids
    -- revealing whether another event's team id exists.
    raise exception 'You are not a member of this event team' using errcode = '42501';
  end if;

  update teams
  set name = cleaned_name
  where id = authorized_team and event_id = p_event_id;

  return cleaned_name;
end;
$$;

revoke all on function rename_own_scoring_team(uuid, uuid, text) from public, anon;
grant execute on function rename_own_scoring_team(uuid, uuid, text) to authenticated;
