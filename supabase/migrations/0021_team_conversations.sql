-- Official team conversations.
--
-- A normal group is owned by its members: they can add people or leave. A team
-- conversation is owned by the event's team assignment instead. It is created
-- lazily the first time a member opens it, then team_members changes keep the
-- thread roster in sync automatically.

alter table conversations
  add column team_id uuid references teams(id) on delete cascade;

alter table conversations
  add constraint conversations_team_kind_check
  check (team_id is null or kind = 'group');

create unique index conversations_team_uniq
  on conversations(team_id)
  where team_id is not null;

comment on column conversations.team_id is
  'The team that owns this official group conversation; null for ordinary chats.';

-- Managed conversations cannot be joined or left directly. SECURITY DEFINER
-- avoids recursion when this helper is used by conversation_members policies.
create or replace function is_managed_conversation(convo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.kind = 'event_group' or c.team_id is not null
      from conversations c
      where c.id = convo
    ),
    false
  );
$$;

-- Existing policies allowed direct table writes as well as the RPCs, so lock
-- both paths. Team/event memberships are maintained by trusted triggers.
drop policy if exists "members add conversation members" on conversation_members;
create policy "members add conversation members" on conversation_members
  for insert with check (
    is_conversation_member(conversation_id)
    and not is_managed_conversation(conversation_id)
  );

drop policy if exists "leave conversations" on conversation_members;
create policy "leave conversations" on conversation_members
  for delete using (
    participant_id = current_participant_id()
    and not is_managed_conversation(conversation_id)
  );

create or replace function open_team_conversation(target_team uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := current_participant_id();
  team_event uuid;
  team_name text;
  convo     uuid;
begin
  if me is null then
    raise exception 'Only participants can open team chat';
  end if;

  select t.event_id, t.name
    into team_event, team_name
  from teams t
  join team_members tm on tm.team_id = t.id
  where t.id = target_team
    and tm.participant_id = me;

  if team_event is null then
    raise exception 'You are not a member of that team' using errcode = '42501';
  end if;

  insert into conversations (event_id, kind, name, created_by, team_id)
  values (team_event, 'group', team_name, null, target_team)
  on conflict (team_id) where team_id is not null
  do update set name = excluded.name
  returning id into convo;

  -- Reconcile in both directions in case assignments changed while no member
  -- had the thread open.
  delete from conversation_members cm
  where cm.conversation_id = convo
    and not exists (
      select 1
      from team_members tm
      where tm.team_id = target_team
        and tm.participant_id = cm.participant_id
    );

  insert into conversation_members (conversation_id, participant_id)
  select convo, tm.participant_id
  from team_members tm
  where tm.team_id = target_team
  on conflict do nothing;

  return convo;
end;
$$;

revoke all on function open_team_conversation(uuid) from public, anon;
grant execute on function open_team_conversation(uuid) to authenticated;

-- Once a team thread exists, moving a player updates it immediately.
create or replace function sync_team_conversation_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  convo       uuid;
  target_team uuid;
begin
  target_team := case when tg_op = 'INSERT' then new.team_id else old.team_id end;

  select c.id into convo
  from conversations c
  where c.team_id = target_team;

  if convo is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into conversation_members (conversation_id, participant_id)
    values (convo, new.participant_id)
    on conflict do nothing;
  else
    delete from conversation_members
    where conversation_id = convo
      and participant_id = old.participant_id;
  end if;

  return null;
end;
$$;

drop trigger if exists team_conversation_membership on team_members;
create trigger team_conversation_membership
  after insert or delete on team_members
  for each row execute function sync_team_conversation_member();

create or replace function sync_team_conversation_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update conversations
  set name = new.name
  where team_id = new.id;
  return null;
end;
$$;

drop trigger if exists team_conversation_name on teams;
create trigger team_conversation_name
  after update of name on teams
  for each row execute function sync_team_conversation_name();

-- Keep the existing public RPCs from mutating managed membership.
create or replace function add_conversation_members(convo uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me          uuid := current_participant_id();
  convo_kind  text;
  convo_event uuid;
  convo_team  uuid;
begin
  if me is null or not is_conversation_member(convo) then
    raise exception 'You are not in that conversation';
  end if;

  select kind, event_id, team_id
    into convo_kind, convo_event, convo_team
  from conversations
  where id = convo;

  if convo_kind = 'direct' then
    raise exception 'A direct message is between two people';
  end if;
  if convo_kind = 'event_group' or convo_team is not null then
    raise exception 'Membership in this chat follows the event roster';
  end if;

  insert into conversation_members (conversation_id, participant_id)
  select convo, p.id
  from participants p
  where p.event_id = convo_event
    and p.id = any (coalesce(member_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$$;

revoke all on function add_conversation_members(uuid, uuid[]) from public, anon;
grant execute on function add_conversation_members(uuid, uuid[]) to authenticated;

create or replace function leave_conversation(convo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me          uuid := current_participant_id();
  convo_kind  text;
  convo_team  uuid;
begin
  if me is null then
    raise exception 'Only participants can leave conversations';
  end if;

  select kind, team_id into convo_kind, convo_team
  from conversations
  where id = convo;

  if convo_kind = 'event_group' or convo_team is not null then
    raise exception 'Membership in this chat follows the event roster';
  end if;

  delete from conversation_members
  where conversation_id = convo
    and participant_id = me;
end;
$$;

revoke all on function leave_conversation(uuid) from public, anon;
grant execute on function leave_conversation(uuid) to authenticated;
