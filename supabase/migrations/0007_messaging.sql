-- Messaging: the reads and writes the chat screens need, plus tighter
-- membership rules now that creation no longer happens table-by-table.
--
-- Creating a conversation means inserting the conversation and its members
-- together. Doing that from the client needed a membership INSERT policy that
-- let any participant add anybody to any conversation. These SECURITY DEFINER
-- functions do it in one call instead, so the policy can be narrowed to
-- "existing members may add people".

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

-- One row per conversation the caller belongs to, newest activity first, with
-- the preview line and unread count the list needs. Rolled into a function so
-- the inbox is a single round trip instead of four dependent queries.
create or replace function conversation_summaries()
returns table (
  id                uuid,
  kind              text,
  name              text,
  created_by        uuid,
  member_ids        uuid[],
  last_message_body text,
  last_message_at   timestamptz,
  last_sender_id    uuid,
  unread_count      int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.kind,
    c.name,
    c.created_by,
    coalesce(
      (
        select array_agg(other.participant_id order by p.full_name)
        from conversation_members other
        join participants p on p.id = other.participant_id
        where other.conversation_id = c.id
      ),
      '{}'::uuid[]
    ),
    latest.body,
    latest.created_at,
    latest.sender_id,
    coalesce(
      (
        select count(*)
        from messages m
        where m.conversation_id = c.id
          and m.sender_id <> cm.participant_id
          and (cm.last_read_at is null or m.created_at > cm.last_read_at)
      ),
      0
    )::int
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  left join lateral (
    select m.body, m.created_at, m.sender_id
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) latest on true
  where cm.participant_id = current_participant_id()
  order by coalesce(latest.created_at, c.created_at) desc;
$$;

-- anon is named explicitly: Supabase's default privileges grant EXECUTE on new
-- public-schema functions to the anon role, which revoking from PUBLIC leaves in
-- place. Chat is signed-in only.
revoke all on function conversation_summaries() from public, anon;
grant execute on function conversation_summaries() to authenticated;

-- ---------------------------------------------------------------------------
-- Starting conversations
-- ---------------------------------------------------------------------------

-- The existing 1:1 thread with another player, or null. Opening a chat from the
-- roster looks it up with this and only creates a row once something is
-- actually said, so browsing the roster doesn't litter the inbox with empties.
create or replace function find_direct_conversation(other_participant uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from conversations c
  where c.kind = 'direct'
    and exists (
      select 1 from conversation_members mine
      where mine.conversation_id = c.id
        and mine.participant_id = current_participant_id()
    )
    and exists (
      select 1 from conversation_members theirs
      where theirs.conversation_id = c.id
        and theirs.participant_id = other_participant
    )
    and (
      select count(*) from conversation_members all_members
      where all_members.conversation_id = c.id
    ) = 2
  limit 1;
$$;

revoke all on function find_direct_conversation(uuid) from public, anon;
grant execute on function find_direct_conversation(uuid) to authenticated;

-- Find-or-create the 1:1 thread with another player. Idempotent so a second
-- send can't fork a duplicate thread.
create or replace function open_direct_conversation(other_participant uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid := current_participant_id();
  my_event   uuid;
  their_event uuid;
  convo      uuid;
begin
  if me is null then
    raise exception 'Only participants can send messages';
  end if;
  if other_participant = me then
    raise exception 'You cannot message yourself';
  end if;

  select event_id into my_event from participants where id = me;
  select event_id into their_event from participants where id = other_participant;

  if their_event is null or their_event <> my_event then
    raise exception 'That player is not in this event';
  end if;

  convo := find_direct_conversation(other_participant);

  if convo is not null then
    return convo;
  end if;

  insert into conversations (event_id, kind, created_by)
  values (my_event, 'direct', me)
  returning id into convo;

  insert into conversation_members (conversation_id, participant_id)
  values (convo, me), (convo, other_participant);

  return convo;
end;
$$;

revoke all on function open_direct_conversation(uuid) from public, anon;
grant execute on function open_direct_conversation(uuid) to authenticated;

-- The creator is always a member, so a group can't be created that its author
-- then can't read.
create or replace function create_group_conversation(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := current_participant_id();
  my_event uuid;
  trimmed  text := nullif(trim(coalesce(group_name, '')), '');
  convo    uuid;
begin
  if me is null then
    raise exception 'Only participants can create groups';
  end if;
  if trimmed is null then
    raise exception 'Give the group a name';
  end if;

  select event_id into my_event from participants where id = me;

  insert into conversations (event_id, kind, name, created_by)
  values (my_event, 'group', trimmed, me)
  returning id into convo;

  -- Filtering on event_id drops any id that isn't a player in this event.
  insert into conversation_members (conversation_id, participant_id)
  select convo, p.id
  from participants p
  where p.event_id = my_event
    and (p.id = me or p.id = any (coalesce(member_ids, '{}'::uuid[])))
  on conflict do nothing;

  return convo;
end;
$$;

revoke all on function create_group_conversation(text, uuid[]) from public, anon;
grant execute on function create_group_conversation(text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Membership changes
-- ---------------------------------------------------------------------------

create or replace function add_conversation_members(convo uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid := current_participant_id();
  convo_kind text;
  convo_event uuid;
begin
  if me is null or not is_conversation_member(convo) then
    raise exception 'You are not in that conversation';
  end if;

  select kind, event_id into convo_kind, convo_event
  from conversations where id = convo;

  if convo_kind = 'direct' then
    raise exception 'A direct message is between two people';
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
  me         uuid := current_participant_id();
  convo_kind text;
begin
  if me is null then
    raise exception 'Only participants can leave conversations';
  end if;

  select kind into convo_kind from conversations where id = convo;

  -- The all-hands thread is everyone on the roster by definition; leaving it
  -- would only last until the next roster change re-added them.
  if convo_kind = 'event_group' then
    raise exception 'The event chat includes everyone and cannot be left';
  end if;

  delete from conversation_members
  where conversation_id = convo and participant_id = me;
end;
$$;

revoke all on function leave_conversation(uuid) from public, anon;
grant execute on function leave_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Was: any claimed participant could add anyone to any conversation.
drop policy if exists "add conversation members" on conversation_members;
drop policy if exists "members add conversation members" on conversation_members;
create policy "members add conversation members" on conversation_members
  for insert with check (is_conversation_member(conversation_id));

-- Leaving a group deletes your own row and nobody else's.
drop policy if exists "leave conversations" on conversation_members;
create policy "leave conversations" on conversation_members
  for delete using (participant_id = current_participant_id());
