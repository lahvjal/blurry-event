-- Durable account-owned chat history.
--
-- Event registrations are disposable scheduling/scoring records. Direct
-- messages and ordinary member-created groups are social records owned by
-- accounts, so they must not disappear when their event of origin is removed.
-- Event all-hands conversations and team-managed conversations intentionally
-- remain event-owned and continue to cascade with the event.

-- ---------------------------------------------------------------------------
-- Durable identity and origin metadata
-- ---------------------------------------------------------------------------

alter table conversations
  add column if not exists origin_event_id uuid,
  add column if not exists origin_event_name text,
  add column if not exists created_by_account_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by_name text;

update conversations conversation
set origin_event_id = conversation.event_id,
    origin_event_name = event.name,
    created_by_account_id = (
      select creator.claimed_by from participants creator
      where creator.id = conversation.created_by
    ),
    created_by_name = (
      select creator.full_name from participants creator
      where creator.id = conversation.created_by
    )
from events event
where event.id = conversation.event_id
  and (
    conversation.origin_event_id is null
    or conversation.origin_event_name is null
    or (conversation.created_by is not null and conversation.created_by_account_id is null)
    or (conversation.created_by is not null and conversation.created_by_name is null)
  );

alter table conversations
  alter column origin_event_id set not null,
  alter column origin_event_name set not null;

create index if not exists conversations_origin_event_idx
  on conversations(origin_event_id, created_at desc);
create index if not exists conversations_created_by_account_idx
  on conversations(created_by_account_id)
  where created_by_account_id is not null;

create table if not exists conversation_account_members (
  conversation_id      uuid not null references conversations(id) on delete cascade,
  account_id           uuid not null references auth.users(id) on delete cascade,
  display_name         text not null,
  avatar_url           text,
  source_participant_id uuid,
  last_read_at         timestamptz,
  notifications_enabled boolean not null default true,
  joined_at            timestamptz not null default now(),
  primary key (conversation_id, account_id)
);

comment on table conversation_account_members is
  'Account-level membership for direct and ordinary custom chats; survives deletion of event registrations.';

create index if not exists conversation_account_members_account_idx
  on conversation_account_members(account_id, conversation_id);

-- Refuse a partial migration. A roster placeholder that never claimed an
-- account cannot own durable chat membership, and silently dropping one would
-- violate the preservation contract.
do $$
begin
  if exists (
    select 1
    from conversation_members membership
    join conversations conversation on conversation.id = membership.conversation_id
    join participants participant on participant.id = membership.participant_id
    where (conversation.kind = 'direct'
      or (conversation.kind = 'group' and conversation.team_id is null))
      and participant.claimed_by is null
  ) then
    raise exception 'Cannot preserve chats: an ordinary chat member has no claimed account';
  end if;
end;
$$;

insert into conversation_account_members (
  conversation_id,
  account_id,
  display_name,
  avatar_url,
  source_participant_id,
  last_read_at,
  notifications_enabled,
  joined_at
)
select
  membership.conversation_id,
  participant.claimed_by,
  coalesce(nullif(trim(profile.display_name), ''), participant.full_name),
  profile.avatar_url,
  participant.id,
  membership.last_read_at,
  membership.notifications_enabled,
  conversation.created_at
from conversation_members membership
join conversations conversation on conversation.id = membership.conversation_id
join participants participant on participant.id = membership.participant_id
left join profiles profile on profile.id = participant.claimed_by
where conversation.kind = 'direct'
   or (conversation.kind = 'group' and conversation.team_id is null)
on conflict (conversation_id, account_id) do update
set display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    source_participant_id = excluded.source_participant_id,
    last_read_at = excluded.last_read_at,
    notifications_enabled = excluded.notifications_enabled;

alter table messages
  add column if not exists sender_account_id uuid references auth.users(id) on delete set null,
  add column if not exists sender_name text,
  add column if not exists sender_avatar_url text;

update messages message
set sender_account_id = sender.claimed_by,
    sender_name = sender.full_name,
    sender_avatar_url = profile.avatar_url
from participants sender
left join profiles profile on profile.id = sender.claimed_by
where sender.id = message.sender_id
  and (message.sender_account_id is null or message.sender_name is null);

do $$
begin
  if exists (
    select 1
    from messages message
    join conversations conversation on conversation.id = message.conversation_id
    where (conversation.kind = 'direct'
      or (conversation.kind = 'group' and conversation.team_id is null))
      and (message.sender_account_id is null or message.sender_name is null)
  ) then
    raise exception 'Cannot preserve chats: an ordinary chat message has no account identity';
  end if;
end;
$$;

create index if not exists messages_sender_account_idx
  on messages(sender_account_id, created_at desc)
  where sender_account_id is not null;

alter table message_reactions
  add column if not exists reactor_account_id uuid references auth.users(id) on delete set null,
  add column if not exists reactor_name text;

update message_reactions reaction
set reactor_account_id = reactor.claimed_by,
    reactor_name = reactor.full_name
from participants reactor
where reactor.id = reaction.participant_id
  and (reaction.reactor_account_id is null or reaction.reactor_name is null);

do $$
begin
  if exists (
    select 1
    from message_reactions reaction
    join messages message on message.id = reaction.message_id
    join conversations conversation on conversation.id = message.conversation_id
    where (conversation.kind = 'direct'
      or (conversation.kind = 'group' and conversation.team_id is null))
      and (reaction.reactor_account_id is null or reaction.reactor_name is null)
  ) then
    raise exception 'Cannot preserve chats: an ordinary chat reaction has no account identity';
  end if;
end;
$$;

-- The legacy primary key includes participant_id, which must become nullable
-- when its event registration is removed. Account identity is the durable
-- uniqueness boundary; the partial legacy index retains compatibility for any
-- event-owned reaction whose participant has not claimed an account yet.
alter table message_reactions
  drop constraint if exists message_reactions_pkey;
alter table message_reactions
  alter column participant_id drop not null,
  add column if not exists id uuid default gen_random_uuid();
update message_reactions set id = gen_random_uuid() where id is null;
alter table message_reactions alter column id set not null;
alter table message_reactions
  add constraint message_reactions_pkey primary key (id);
create unique index if not exists message_reactions_account_uniq
  on message_reactions(message_id, reactor_account_id, emoji)
  where reactor_account_id is not null;
create unique index if not exists message_reactions_participant_uniq
  on message_reactions(message_id, participant_id, emoji)
  where reactor_account_id is null and participant_id is not null;
alter table message_reactions
  add constraint message_reactions_actor_check
  check (
    participant_id is not null
    or reactor_account_id is not null
    or nullif(trim(reactor_name), '') is not null
  ) not valid;
alter table message_reactions validate constraint message_reactions_actor_check;
-- Realtime DELETE payloads must retain the durable actor/message fields even
-- though the row now uses a surrogate primary key.
alter table message_reactions replica identity full;

-- ---------------------------------------------------------------------------
-- Deletion semantics
-- ---------------------------------------------------------------------------

-- Published scoring identities remain immutable to direct edits, but their
-- guards must not veto a parent-event FK cascade. pg_trigger_depth() is greater
-- than one only when these row deletes were invoked by another trigger (the
-- event cascade), not by a direct teams/team_members API request.
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
    raise exception 'Scoring teams cannot change after publication or score entry'
      using errcode = '55000';
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
    raise exception 'Scoring-team membership cannot change after publication or score entry'
      using errcode = '55000';
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

create or replace function delete_event_owned_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversations conversation
  where conversation.event_id = old.id
    and (conversation.kind = 'event_group' or conversation.team_id is not null);
  return old;
end;
$$;

revoke all on function delete_event_owned_conversations()
  from public, anon, authenticated;

drop trigger if exists events_delete_owned_conversations on events;
create trigger events_delete_owned_conversations
  before delete on events
  for each row execute function delete_event_owned_conversations();

-- Persistent conversations and their content detach from the deleted event.
-- Official conversations were removed by the trigger above, so SET NULL can
-- only apply to direct/custom history.
alter table conversations drop constraint if exists conversations_event_id_fkey;
alter table conversations alter column event_id drop not null;
alter table conversations
  add constraint conversations_event_id_fkey
  foreign key (event_id) references events(id) on delete set null;

alter table messages drop constraint if exists messages_event_id_fkey;
alter table messages alter column event_id drop not null;
alter table messages
  add constraint messages_event_id_fkey
  foreign key (event_id) references events(id) on delete set null;

alter table messages drop constraint if exists messages_sender_id_fkey;
alter table messages alter column sender_id drop not null;
alter table messages
  add constraint messages_sender_id_fkey
  foreign key (sender_id) references participants(id) on delete set null;

alter table message_reactions drop constraint if exists message_reactions_event_id_fkey;
alter table message_reactions alter column event_id drop not null;
alter table message_reactions
  add constraint message_reactions_event_id_fkey
  foreign key (event_id) references events(id) on delete set null;

alter table message_reactions drop constraint if exists message_reactions_participant_id_fkey;
alter table message_reactions
  add constraint message_reactions_participant_id_fkey
  foreign key (participant_id) references participants(id) on delete set null;

alter table conversations
  drop constraint if exists conversations_event_ownership_check,
  add constraint conversations_event_ownership_check check (
    (kind <> 'event_group' and team_id is null)
    or event_id is not null
  );

-- Existing generic event guards correctly protect event-owned objects, but
-- they intentionally reject detachment. Replace only the chat triggers with
-- account-aware guards. Table/column grants still prevent clients from moving
-- event ids directly.
drop trigger if exists conversations_event_id_immutable on conversations;
drop trigger if exists conversations_event_scope on conversations;
drop trigger if exists messages_event_id_immutable on messages;
drop trigger if exists messages_event_scope on messages;
drop trigger if exists message_reactions_event_id_immutable on message_reactions;
drop trigger if exists message_reactions_event_scope on message_reactions;

-- ---------------------------------------------------------------------------
-- Account membership helpers and RLS
-- ---------------------------------------------------------------------------

create or replace function is_conversation_member(convo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.conversation_account_members membership
      where membership.conversation_id = convo
        and membership.account_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.conversation_members membership
      join public.participants participant on participant.id = membership.participant_id
      where membership.conversation_id = convo
        and participant.claimed_by = (select auth.uid())
    )
  );
$$;

revoke all on function is_conversation_member(uuid) from public, anon;
grant execute on function is_conversation_member(uuid) to authenticated;

alter table conversation_account_members enable row level security;
revoke all on table conversation_account_members from public, anon;
grant select on table conversation_account_members to authenticated;

drop policy if exists "members read account chat memberships" on conversation_account_members;
create policy "members read account chat memberships"
  on conversation_account_members
  for select to authenticated
  using (is_conversation_member(conversation_id));

drop policy if exists "members read event conversations" on conversations;
create policy "members read account or event conversations" on conversations
  for select to authenticated using (is_conversation_member(id));

drop policy if exists "members read event messages" on messages;
create policy "members read account or event messages" on messages
  for select to authenticated using (is_conversation_member(conversation_id));

drop policy if exists "members send event messages" on messages;
create policy "members send account or event messages" on messages
  for insert to authenticated with check (
    sender_account_id = (select auth.uid())
    and is_conversation_member(conversation_id)
    and event_id is not distinct from conversation_event_id(conversation_id)
  );

drop policy if exists "senders edit event messages" on messages;
create policy "account senders edit messages" on messages
  for update to authenticated
  using (
    sender_account_id = (select auth.uid())
    and is_conversation_member(conversation_id)
  )
  with check (
    sender_account_id = (select auth.uid())
    and is_conversation_member(conversation_id)
  );

drop policy if exists "senders unsend event messages" on messages;
create policy "account senders unsend messages" on messages
  for delete to authenticated using (
    sender_account_id = (select auth.uid())
    and is_conversation_member(conversation_id)
  );

drop policy if exists "members read event reactions" on message_reactions;
create policy "members read account or event reactions" on message_reactions
  for select to authenticated using (
    exists (
      select 1 from messages message
      where message.id = message_reactions.message_id
        and is_conversation_member(message.conversation_id)
    )
  );

drop policy if exists "members add own event reactions" on message_reactions;
create policy "members add own account reactions" on message_reactions
  for insert to authenticated with check (
    reactor_account_id = (select auth.uid())
    and exists (
      select 1 from messages message
      where message.id = message_reactions.message_id
        and is_conversation_member(message.conversation_id)
    )
  );

drop policy if exists "members remove own event reactions" on message_reactions;
create policy "members remove own account reactions" on message_reactions
  for delete to authenticated using (
    reactor_account_id = (select auth.uid())
    and exists (
      select 1 from messages message
      where message.id = message_reactions.message_id
        and is_conversation_member(message.conversation_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Insert/update guards and legacy queued-write compatibility
-- ---------------------------------------------------------------------------

create or replace function guard_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_event uuid;
  team_event uuid;
begin
  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id
       and not (
         old.event_id is not null
         and new.event_id is null
         and old.kind <> 'event_group'
         and old.team_id is null
       ) then
      raise exception 'Conversations cannot move between events' using errcode = '23514';
    end if;
    if new.origin_event_id is distinct from old.origin_event_id
       or new.origin_event_name is distinct from old.origin_event_name
       or (new.created_by is distinct from old.created_by and new.created_by is not null)
       or (
         new.created_by_account_id is distinct from old.created_by_account_id
         and new.created_by_account_id is not null
       )
       or new.team_id is distinct from old.team_id
       or new.kind is distinct from old.kind then
      raise exception 'Conversation ownership is immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.event_id is null then
    raise exception 'New conversations need an event of origin' using errcode = '23514';
  end if;
  if new.origin_event_id is null then new.origin_event_id := new.event_id; end if;
  if new.origin_event_id <> new.event_id then
    raise exception 'Conversation origin does not match its event' using errcode = '23514';
  end if;
  if new.origin_event_name is null then
    select event.name into new.origin_event_name from public.events event where event.id = new.event_id;
  end if;
  if new.created_by is not null then
    select participant.event_id, participant.claimed_by, participant.full_name
      into creator_event, new.created_by_account_id, new.created_by_name
    from public.participants participant where participant.id = new.created_by;
    if creator_event is distinct from new.event_id then
      raise exception 'Conversation creator does not belong to its event' using errcode = '23514';
    end if;
  elsif new.team_id is not null then
    select team.event_id into team_event from public.teams team where team.id = new.team_id;
    if team_event is distinct from new.event_id then
      raise exception 'Team conversation does not belong to its event' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function guard_chat_conversation() from public, anon, authenticated;
drop trigger if exists conversations_account_scope on conversations;
create trigger conversations_account_scope
  before insert or update on conversations
  for each row execute function guard_chat_conversation();

create or replace function guard_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event uuid;
  target_kind text;
  target_team uuid;
  sender_participant uuid;
  sender_display text;
  sender_avatar text;
begin
  select conversation.event_id, conversation.kind, conversation.team_id
    into target_event, target_kind, target_team
  from public.conversations conversation
  where conversation.id = new.conversation_id;
  if not found then
    raise exception 'Conversation not found' using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id
       and not (old.event_id is not null and new.event_id is null and target_event is null) then
      raise exception 'Messages cannot move between events' using errcode = '23514';
    end if;
    return new;
  end if;

  if (select auth.uid()) is null then
    return new;
  end if;
  if not public.is_conversation_member(new.conversation_id) then
    raise exception 'You are not in that conversation' using errcode = '42501';
  end if;

  new.sender_account_id := (select auth.uid());
  select
    coalesce(nullif(trim(profile.display_name), ''), participant.full_name, 'Member'),
    profile.avatar_url
    into sender_display, sender_avatar
  from public.profiles profile
  left join lateral (
    select registration.full_name
    from public.participants registration
    where registration.claimed_by = profile.id
    order by registration.created_at desc
    limit 1
  ) participant on true
  where profile.id = (select auth.uid());
  new.sender_name := coalesce(sender_display, new.sender_name, 'Member');
  new.sender_avatar_url := coalesce(sender_avatar, new.sender_avatar_url);
  new.event_id := target_event;

  if target_event is null then
    new.sender_id := null;
  else
    select registration.id into sender_participant
    from public.participants registration
    where registration.event_id = target_event
      and registration.claimed_by = (select auth.uid())
    limit 1;
    if sender_participant is null then
      raise exception 'You are not registered for that event' using errcode = '42501';
    end if;
    new.sender_id := sender_participant;
  end if;
  return new;
end;
$$;

revoke all on function guard_chat_message() from public, anon, authenticated;

-- Run before the existing action guard so legacy queued sender/event ids are
-- normalized before immutability and RLS checks.
drop trigger if exists messages_account_scope on messages;
create trigger messages_account_scope
  before insert or update on messages
  for each row execute function guard_chat_message();

create or replace function guard_message_actions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages parent
    where parent.id = new.reply_to_id
      and parent.conversation_id = new.conversation_id
  ) then
    raise exception 'Reply target is not in this conversation' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.edited_at := null;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or (new.sender_id is distinct from old.sender_id and new.sender_id is not null)
     or (
       new.sender_account_id is distinct from old.sender_account_id
       and new.sender_account_id is not null
     )
     or new.sender_name is distinct from old.sender_name
     or new.sender_avatar_url is distinct from old.sender_avatar_url
     or (new.event_id is distinct from old.event_id and new.event_id is not null)
     or (new.reply_to_id is distinct from old.reply_to_id and new.reply_to_id is not null)
     or new.client_id is distinct from old.client_id
     or new.created_at is distinct from old.created_at
     or new.media_url is distinct from old.media_url
     or new.media_mime_type is distinct from old.media_mime_type
     or new.media_width is distinct from old.media_width
     or new.media_height is distinct from old.media_height then
    raise exception 'Message identity, threading, and media cannot be changed' using errcode = '42501';
  end if;
  if new.body is not distinct from old.body then
    new.edited_at := old.edited_at;
    return new;
  end if;
  new.edited_at := now();
  return new;
end;
$$;

revoke all on function guard_message_actions() from public, anon, authenticated;

create or replace function guard_chat_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event uuid;
  target_conversation uuid;
  reactor_participant uuid;
  reactor_display text;
begin
  select message.event_id, message.conversation_id
    into target_event, target_conversation
  from public.messages message where message.id = new.message_id;
  if not found then
    raise exception 'Message not found' using errcode = '23503';
  end if;
  if (select auth.uid()) is null then return new; end if;
  if not public.is_conversation_member(target_conversation) then
    raise exception 'You are not in that conversation' using errcode = '42501';
  end if;
  new.reactor_account_id := (select auth.uid());
  select coalesce(nullif(trim(profile.display_name), ''), participant.full_name, 'Member')
    into reactor_display
  from public.profiles profile
  left join lateral (
    select registration.full_name
    from public.participants registration
    where registration.claimed_by = profile.id
    order by registration.created_at desc limit 1
  ) participant on true
  where profile.id = (select auth.uid());
  new.reactor_name := coalesce(reactor_display, new.reactor_name, 'Member');
  new.event_id := target_event;
  if target_event is null then
    new.participant_id := null;
  else
    select registration.id into reactor_participant
    from public.participants registration
    where registration.event_id = target_event
      and registration.claimed_by = (select auth.uid())
    limit 1;
    if reactor_participant is null then
      raise exception 'You are not registered for that event' using errcode = '42501';
    end if;
    new.participant_id := reactor_participant;
  end if;
  return new;
end;
$$;

revoke all on function guard_chat_reaction() from public, anon, authenticated;
drop trigger if exists message_reactions_account_scope on message_reactions;
create trigger message_reactions_account_scope
  before insert on message_reactions
  for each row execute function guard_chat_reaction();

-- ---------------------------------------------------------------------------
-- Account-level RPC surface
-- ---------------------------------------------------------------------------

drop function if exists club_conversation_summaries();
create function club_conversation_summaries()
returns table (
  id uuid,
  event_id uuid,
  event_name text,
  event_active boolean,
  event_owned boolean,
  kind text,
  name text,
  created_by uuid,
  created_by_account_id uuid,
  my_participant_id uuid,
  my_account_id uuid,
  member_ids uuid[],
  member_account_ids uuid[],
  direct_participant_id uuid,
  direct_account_id uuid,
  direct_participant_name text,
  direct_participant_avatar_url text,
  last_message_body text,
  last_message_at timestamptz,
  last_sender_id uuid,
  last_sender_account_id uuid,
  last_sender_name text,
  last_message_media_mime_type text,
  last_activity_at timestamptz,
  last_activity_kind text,
  last_reaction_emoji text,
  last_reactor_id uuid,
  last_reactor_account_id uuid,
  last_reactor_name text,
  last_reaction_message_body text,
  last_reaction_message_media_mime_type text,
  unread_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_memberships as (
    select
      conversation.id as conversation_id,
      account_membership.account_id,
      account_membership.last_read_at
    from public.conversations conversation
    join public.conversation_account_members account_membership
      on account_membership.conversation_id = conversation.id
     and account_membership.account_id = (select auth.uid())
    where conversation.kind = 'direct'
       or (conversation.kind = 'group' and conversation.team_id is null)

    union all

    select
      conversation.id,
      participant.claimed_by,
      legacy_membership.last_read_at
    from public.conversations conversation
    join public.conversation_members legacy_membership
      on legacy_membership.conversation_id = conversation.id
    join public.participants participant
      on participant.id = legacy_membership.participant_id
     and participant.claimed_by = (select auth.uid())
    where conversation.kind = 'event_group' or conversation.team_id is not null
  )
  select
    conversation.id,
    conversation.origin_event_id,
    conversation.origin_event_name,
    conversation.event_id is not null,
    conversation.kind = 'event_group' or conversation.team_id is not null,
    conversation.kind,
    conversation.name,
    conversation.created_by,
    conversation.created_by_account_id,
    current_registration.id,
    membership.account_id,
    coalesce(member_list.participant_ids, '{}'::uuid[]),
    coalesce(member_list.account_ids, '{}'::uuid[]),
    direct_member.source_participant_id,
    direct_member.account_id,
    direct_member.display_name,
    direct_member.avatar_url,
    latest_message.body,
    latest_message.created_at,
    latest_message.sender_id,
    latest_message.sender_account_id,
    latest_message.sender_name,
    latest_message.media_mime_type,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.created_at else latest_message.created_at end,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then 'reaction' when latest_message.created_at is not null then 'message' else null end,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.emoji else null end,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.participant_id else null end,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.reactor_account_id else null end,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.reactor_name else null end,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.message_body else null end,
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.message_media_mime_type else null end,
    (
      (select count(*) from public.messages message
       where message.conversation_id = conversation.id
         and message.sender_account_id is distinct from membership.account_id
         and (membership.last_read_at is null or message.created_at > membership.last_read_at))
      +
      (select count(*) from public.message_reactions reaction
       join public.messages message on message.id = reaction.message_id
       where message.conversation_id = conversation.id
         and message.sender_account_id = membership.account_id
         and reaction.reactor_account_id is distinct from membership.account_id
         and (membership.last_read_at is null or reaction.created_at > membership.last_read_at))
    )::int
  from my_memberships membership
  join public.conversations conversation on conversation.id = membership.conversation_id
  left join lateral (
    select registration.id from public.participants registration
    where registration.event_id = conversation.event_id
      and registration.claimed_by = membership.account_id
    limit 1
  ) current_registration on true
  left join lateral (
    select
      array_agg(identity_row.source_participant_id order by identity_row.display_name)
        filter (where identity_row.source_participant_id is not null) as participant_ids,
      array_agg(identity_row.account_id order by identity_row.display_name)
        filter (where identity_row.account_id is not null) as account_ids
    from (
      select account_member.account_id, account_member.source_participant_id,
             account_member.display_name
      from public.conversation_account_members account_member
      where account_member.conversation_id = conversation.id
      union all
      select participant.claimed_by, participant.id, participant.full_name
      from public.conversation_members legacy_member
      join public.participants participant on participant.id = legacy_member.participant_id
      where legacy_member.conversation_id = conversation.id
        and (conversation.kind = 'event_group' or conversation.team_id is not null)
    ) identity_row
  ) member_list on true
  left join lateral (
    select other.account_id, other.source_participant_id, other.display_name, other.avatar_url
    from public.conversation_account_members other
    where other.conversation_id = conversation.id
      and other.account_id <> membership.account_id
    order by other.display_name, other.account_id limit 1
  ) direct_member on conversation.kind = 'direct'
  left join lateral (
    select message.body, message.created_at, message.sender_id,
           message.sender_account_id, message.sender_name, message.media_mime_type
    from public.messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc limit 1
  ) latest_message on true
  left join lateral (
    select reaction.created_at, reaction.emoji, reaction.participant_id,
           reaction.reactor_account_id, reaction.reactor_name,
           message.body as message_body,
           message.media_mime_type as message_media_mime_type
    from public.message_reactions reaction
    join public.messages message on message.id = reaction.message_id
    where message.conversation_id = conversation.id
      and message.sender_account_id = membership.account_id
      and reaction.reactor_account_id is distinct from membership.account_id
    order by reaction.created_at desc limit 1
  ) latest_reaction on true
  where (select auth.uid()) is not null
  order by coalesce(
    case when latest_reaction.created_at is not null
           and (latest_message.created_at is null or latest_reaction.created_at > latest_message.created_at)
      then latest_reaction.created_at else latest_message.created_at end,
    conversation.created_at
  ) desc;
$$;

create or replace function account_conversation_detail(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_conversation_member(conversation.id) then
    jsonb_build_object(
      'id', conversation.id,
      'kind', conversation.kind,
      'name', conversation.name,
      'team_id', conversation.team_id,
      'event_id', conversation.origin_event_id,
      'event_active', conversation.event_id is not null,
      'event_owned', conversation.kind = 'event_group' or conversation.team_id is not null,
      'created_by', conversation.created_by,
      'created_by_account_id', conversation.created_by_account_id,
      'created_by_name', conversation.created_by_name,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'account_id', identity_row.account_id,
          'participant_id', identity_row.participant_id,
          'display_name', identity_row.display_name,
          'avatar_url', identity_row.avatar_url
        ) order by identity_row.display_name)
        from (
          select member.account_id, member.source_participant_id as participant_id,
                 member.display_name, member.avatar_url
          from public.conversation_account_members member
          where member.conversation_id = conversation.id
          union all
          select participant.claimed_by, participant.id, participant.full_name, profile.avatar_url
          from public.conversation_members membership
          join public.participants participant on participant.id = membership.participant_id
          left join public.profiles profile on profile.id = participant.claimed_by
          where membership.conversation_id = conversation.id
            and (conversation.kind = 'event_group' or conversation.team_id is not null)
        ) identity_row
      ), '[]'::jsonb)
    ) else null end
  from public.conversations conversation
  where conversation.id = p_conversation_id;
$$;

create or replace function find_direct_conversation(p_event_id uuid, other_participant uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with identities as (
    select (select auth.uid()) as mine,
           (select participant.claimed_by from public.participants participant
            where participant.id = other_participant and participant.event_id = p_event_id) as theirs
  )
  select conversation.id
  from public.conversations conversation, identities
  where conversation.kind = 'direct'
    and identities.mine is not null and identities.theirs is not null
    and identities.mine <> identities.theirs
    and exists (select 1 from public.conversation_account_members member
                where member.conversation_id = conversation.id and member.account_id = identities.mine)
    and exists (select 1 from public.conversation_account_members member
                where member.conversation_id = conversation.id and member.account_id = identities.theirs)
    and (select count(*) from public.conversation_account_members member
         where member.conversation_id = conversation.id) = 2
  order by conversation.created_at limit 1;
$$;

create or replace function open_direct_conversation(p_event_id uuid, other_participant uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  other_account uuid;
  conversation_id uuid;
begin
  select participant.id into me from public.participants participant
  where participant.event_id = p_event_id and participant.claimed_by = (select auth.uid());
  if me is null then raise exception 'Only event participants can send messages' using errcode = '42501'; end if;
  select participant.claimed_by into other_account from public.participants participant
  where participant.id = other_participant and participant.event_id = p_event_id;
  if other_account is null then raise exception 'That player has not joined the app yet'; end if;
  if other_account = (select auth.uid()) then raise exception 'You cannot message yourself'; end if;
  -- Serialize creation for the unordered account pair so two simultaneous
  -- opens cannot create duplicate direct threads.
  perform pg_advisory_xact_lock(hashtextextended(
    least((select auth.uid())::text, other_account::text) || ':' ||
    greatest((select auth.uid())::text, other_account::text),
    0
  ));
  conversation_id := public.find_direct_conversation(p_event_id, other_participant);
  if conversation_id is not null then return conversation_id; end if;

  insert into public.conversations (event_id, kind, created_by)
  values (p_event_id, 'direct', me) returning id into conversation_id;
  insert into public.conversation_members (conversation_id, participant_id)
  values (conversation_id, me), (conversation_id, other_participant)
  on conflict do nothing;
  insert into public.conversation_account_members (
    conversation_id, account_id, display_name, avatar_url, source_participant_id
  )
  select conversation_id, participant.claimed_by,
         coalesce(nullif(trim(profile.display_name), ''), participant.full_name),
         profile.avatar_url, participant.id
  from public.participants participant
  left join public.profiles profile on profile.id = participant.claimed_by
  where participant.id in (me, other_participant);
  return conversation_id;
end;
$$;

create or replace function create_group_conversation(p_event_id uuid, group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  trimmed text := nullif(trim(coalesce(group_name, '')), '');
  conversation_id uuid;
begin
  select participant.id into me from public.participants participant
  where participant.event_id = p_event_id and participant.claimed_by = (select auth.uid());
  if me is null then raise exception 'Only event participants can create groups' using errcode = '42501'; end if;
  if trimmed is null then raise exception 'Give the group a name'; end if;
  if char_length(trimmed) > 80 then raise exception 'Group names must be 80 characters or fewer'; end if;
  if exists (
    select 1
    from unnest(coalesce(member_ids, '{}'::uuid[])) requested(id)
    left join public.participants participant
      on participant.id = requested.id and participant.event_id = p_event_id
    where participant.id is null
  ) then raise exception 'Group members must belong to the same event' using errcode = '23514'; end if;
  if exists (
    select 1 from public.participants participant
    where participant.event_id = p_event_id
      and participant.id = any(coalesce(member_ids, '{}'::uuid[]))
      and participant.claimed_by is null
  ) then raise exception 'Everyone in a group must have joined the app'; end if;

  insert into public.conversations (event_id, kind, name, created_by)
  values (p_event_id, 'group', trimmed, me) returning id into conversation_id;
  insert into public.conversation_members (conversation_id, participant_id)
  select conversation_id, participant.id from public.participants participant
  where participant.event_id = p_event_id
    and (participant.id = me or participant.id = any(coalesce(member_ids, '{}'::uuid[])))
  on conflict do nothing;
  insert into public.conversation_account_members (
    conversation_id, account_id, display_name, avatar_url, source_participant_id
  )
  select conversation_id, participant.claimed_by,
         coalesce(nullif(trim(profile.display_name), ''), participant.full_name),
         profile.avatar_url, participant.id
  from public.participants participant
  left join public.profiles profile on profile.id = participant.claimed_by
  where participant.event_id = p_event_id
    and participant.claimed_by is not null
    and (participant.id = me or participant.id = any(coalesce(member_ids, '{}'::uuid[])))
  on conflict do nothing;
  return conversation_id;
end;
$$;

create or replace function add_conversation_members(convo uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event uuid;
  convo_kind text;
  convo_team uuid;
begin
  if not public.is_conversation_member(convo) then
    raise exception 'You are not in that conversation' using errcode = '42501';
  end if;
  select conversation.event_id, conversation.kind, conversation.team_id
    into target_event, convo_kind, convo_team
  from public.conversations conversation where conversation.id = convo;
  if convo_kind = 'direct' then raise exception 'A direct message is between two people'; end if;
  if convo_kind = 'event_group' or convo_team is not null then
    raise exception 'Membership in this chat follows the event roster';
  end if;
  if target_event is null then
    raise exception 'Add people from an active event directory';
  end if;
  if not exists (
    select 1 from public.participants participant
    where participant.event_id = target_event
      and participant.claimed_by = (select auth.uid())
  ) then raise exception 'Only current event participants can add people' using errcode = '42501'; end if;
  if exists (
    select 1
    from unnest(coalesce(member_ids, '{}'::uuid[])) requested(id)
    left join public.participants participant
      on participant.id = requested.id and participant.event_id = target_event
    where participant.id is null
  ) then raise exception 'Group members must belong to the same event' using errcode = '23514'; end if;
  if exists (
    select 1 from public.participants participant
    where participant.event_id = target_event
      and participant.id = any(coalesce(member_ids, '{}'::uuid[]))
      and participant.claimed_by is null
  ) then raise exception 'Everyone added must have joined the app'; end if;
  insert into public.conversation_members (conversation_id, participant_id)
  select convo, participant.id from public.participants participant
  where participant.event_id = target_event
    and participant.id = any(coalesce(member_ids, '{}'::uuid[]))
  on conflict do nothing;
  insert into public.conversation_account_members (
    conversation_id, account_id, display_name, avatar_url, source_participant_id
  )
  select convo, participant.claimed_by,
         coalesce(nullif(trim(profile.display_name), ''), participant.full_name),
         profile.avatar_url, participant.id
  from public.participants participant
  left join public.profiles profile on profile.id = participant.claimed_by
  where participant.event_id = target_event
    and participant.id = any(coalesce(member_ids, '{}'::uuid[]))
    and participant.claimed_by is not null
  on conflict do nothing;
end;
$$;

create or replace function leave_conversation(convo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  convo_kind text;
  convo_team uuid;
begin
  select conversation.kind, conversation.team_id into convo_kind, convo_team
  from public.conversations conversation where conversation.id = convo;
  if convo_kind = 'event_group' or convo_team is not null then
    raise exception 'Membership in this chat follows the event roster';
  end if;
  delete from public.conversation_account_members membership
  where membership.conversation_id = convo
    and membership.account_id = (select auth.uid());
  delete from public.conversation_members membership
  using public.participants participant
  where membership.conversation_id = convo
    and participant.id = membership.participant_id
    and participant.claimed_by = (select auth.uid());
end;
$$;

create or replace function mark_conversation_read(convo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_account_members membership
  set last_read_at = now()
  where membership.conversation_id = convo
    and membership.account_id = (select auth.uid());
  if not found then
    update public.conversation_members membership
    set last_read_at = now()
    from public.participants participant
    where membership.conversation_id = convo
      and participant.id = membership.participant_id
      and participant.claimed_by = (select auth.uid());
  end if;
end;
$$;

create or replace function conversation_notifications_enabled(convo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select membership.notifications_enabled
     from public.conversation_account_members membership
     where membership.conversation_id = convo
       and membership.account_id = (select auth.uid())),
    (select membership.notifications_enabled
     from public.conversation_members membership
     join public.participants participant on participant.id = membership.participant_id
     where membership.conversation_id = convo
       and participant.claimed_by = (select auth.uid())
     limit 1)
  );
$$;

create or replace function set_conversation_notifications(convo uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_account_members membership
  set notifications_enabled = enabled
  where membership.conversation_id = convo
    and membership.account_id = (select auth.uid());
  if not found then
    update public.conversation_members membership
    set notifications_enabled = enabled
    from public.participants participant
    where membership.conversation_id = convo
      and participant.id = membership.participant_id
      and participant.claimed_by = (select auth.uid());
  end if;
end;
$$;

create or replace function unread_totals(user_ids uuid[])
returns table (user_id uuid, unread bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with all_memberships as (
    select membership.conversation_id, membership.account_id, membership.last_read_at
    from public.conversation_account_members membership
    where membership.account_id = any(user_ids)
    union all
    select membership.conversation_id, participant.claimed_by, membership.last_read_at
    from public.conversation_members membership
    join public.participants participant on participant.id = membership.participant_id
    join public.conversations conversation on conversation.id = membership.conversation_id
    where participant.claimed_by = any(user_ids)
      and (conversation.kind = 'event_group' or conversation.team_id is not null)
  ), unread_activity as (
    select membership.account_id
    from all_memberships membership
    join public.messages message on message.conversation_id = membership.conversation_id
    where message.sender_account_id is distinct from membership.account_id
      and (membership.last_read_at is null or message.created_at > membership.last_read_at)
    union all
    select membership.account_id
    from all_memberships membership
    join public.messages message on message.conversation_id = membership.conversation_id
      and message.sender_account_id = membership.account_id
    join public.message_reactions reaction on reaction.message_id = message.id
    where reaction.reactor_account_id is distinct from membership.account_id
      and (membership.last_read_at is null or reaction.created_at > membership.last_read_at)
  )
  select activity.account_id, count(*) from unread_activity activity
  group by activity.account_id;
$$;

create or replace function on_message_reaction_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_push(jsonb_build_object(
    'type', 'reaction',
    'message_id', new.message_id,
    'participant_id', new.participant_id,
    'account_id', new.reactor_account_id,
    'emoji', new.emoji
  ));
  return null;
end;
$$;

-- Keep pre-multi-event clients working without letting them create a new
-- participant-owned chat. The participant argument supplies an unambiguous
-- event scope, then the durable account-aware implementation does the work.
create or replace function find_direct_conversation(other_participant uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select public.find_direct_conversation(participant.event_id, participant.id)
  from public.participants participant
  where participant.id = other_participant;
$$;

create or replace function open_direct_conversation(other_participant uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.open_direct_conversation(participant.event_id, participant.id)
  from public.participants participant
  where participant.id = other_participant;
$$;

create or replace function create_group_conversation(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inferred_event uuid;
begin
  if coalesce(cardinality(member_ids), 0) = 0 then
    raise exception 'This app version needs at least one selected group member to determine the event';
  end if;
  if (select count(distinct participant.event_id)
      from public.participants participant
      where participant.id = any(member_ids)) <> 1
     or (select count(*) from public.participants participant
         where participant.id = any(member_ids)) <> cardinality(member_ids) then
    raise exception 'Group members must all belong to one event' using errcode = '23514';
  end if;
  select participant.event_id into inferred_event
  from public.participants participant
  where participant.id = any(member_ids)
  limit 1;
  return public.create_group_conversation(inferred_event, group_name, member_ids);
end;
$$;

-- SECURITY DEFINER functions in the exposed schema are closed by default.
revoke all on function club_conversation_summaries() from public, anon;
revoke all on function account_conversation_detail(uuid) from public, anon;
revoke all on function find_direct_conversation(uuid, uuid) from public, anon;
revoke all on function open_direct_conversation(uuid, uuid) from public, anon;
revoke all on function create_group_conversation(uuid, text, uuid[]) from public, anon;
revoke all on function add_conversation_members(uuid, uuid[]) from public, anon;
revoke all on function leave_conversation(uuid) from public, anon;
revoke all on function mark_conversation_read(uuid) from public, anon;
revoke all on function conversation_notifications_enabled(uuid) from public, anon;
revoke all on function set_conversation_notifications(uuid, boolean) from public, anon;
revoke all on function unread_totals(uuid[]) from public, anon, authenticated;
revoke all on function on_message_reaction_push() from public, anon, authenticated;
revoke all on function find_direct_conversation(uuid) from public, anon;
revoke all on function open_direct_conversation(uuid) from public, anon;
revoke all on function create_group_conversation(text, uuid[]) from public, anon;
revoke all on function open_team_conversation(uuid) from public, anon;
revoke all on function conversation_event_id(uuid) from public, anon;
revoke all on function message_event_id(uuid) from public, anon;
revoke all on function is_managed_conversation(uuid) from public, anon;

grant execute on function club_conversation_summaries() to authenticated;
grant execute on function account_conversation_detail(uuid) to authenticated;
grant execute on function find_direct_conversation(uuid, uuid) to authenticated;
grant execute on function open_direct_conversation(uuid, uuid) to authenticated;
grant execute on function create_group_conversation(uuid, text, uuid[]) to authenticated;
grant execute on function add_conversation_members(uuid, uuid[]) to authenticated;
grant execute on function leave_conversation(uuid) to authenticated;
grant execute on function mark_conversation_read(uuid) to authenticated;
grant execute on function conversation_notifications_enabled(uuid) to authenticated;
grant execute on function set_conversation_notifications(uuid, boolean) to authenticated;
grant execute on function find_direct_conversation(uuid) to authenticated;
grant execute on function open_direct_conversation(uuid) to authenticated;
grant execute on function create_group_conversation(text, uuid[]) to authenticated;
grant execute on function open_team_conversation(uuid) to authenticated;
grant execute on function conversation_event_id(uuid) to authenticated;
grant execute on function message_event_id(uuid) to authenticated;
grant execute on function is_managed_conversation(uuid) to authenticated;
grant execute on function unread_totals(uuid[]) to service_role;
