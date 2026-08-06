-- The multi-event team-chat RPC used a local variable named conversation_id,
-- which is also a conversation_members column. PL/pgSQL can reject the cleanup
-- query as ambiguous. Rename only the local value; behavior and authorization
-- remain unchanged.

create or replace function open_team_conversation(target_team uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  team_event uuid := team_event_id(target_team);
  me uuid;
  team_name text;
  opened_conversation_id uuid;
begin
  me := event_participant_id(team_event);
  select team.name into team_name
  from teams team
  join team_members membership on membership.team_id = team.id
  where team.id = target_team and membership.participant_id = me;
  if team_name is null then
    raise exception 'You are not a member of that team' using errcode = '42501';
  end if;

  insert into conversations (event_id, kind, name, created_by, team_id)
  values (team_event, 'group', team_name, null, target_team)
  on conflict (team_id) where team_id is not null
  do update set name = excluded.name
  returning id into opened_conversation_id;

  delete from conversation_members membership
  where membership.conversation_id = opened_conversation_id
    and not exists (
      select 1 from team_members current_member
      where current_member.team_id = target_team
        and current_member.participant_id = membership.participant_id
    );
  insert into conversation_members (conversation_id, participant_id)
  select opened_conversation_id, participant_id
  from team_members
  where team_id = target_team
  on conflict do nothing;
  return opened_conversation_id;
end;
$$;

revoke all on function open_team_conversation(uuid) from public, anon;
grant execute on function open_team_conversation(uuid) to authenticated;
