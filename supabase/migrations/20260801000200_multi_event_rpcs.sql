-- Event-aware account, invitation, admin, and chat RPCs.

-- ---------------------------------------------------------------------------
-- Accessible events and invite claiming
-- ---------------------------------------------------------------------------

create or replace function accessible_events()
returns table (
  id                    uuid,
  name                  text,
  course_name           text,
  event_date            date,
  lifecycle_status      event_lifecycle_status,
  participant_id        uuid,
  event_is_admin        boolean,
  account_is_club_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    event.id,
    event.name,
    event.course_name,
    event.event_date,
    event.lifecycle_status,
    registration.id,
    coalesce(registration.is_admin, false),
    is_club_admin()
  from events event
  left join participants registration
    on registration.event_id = event.id
   and registration.claimed_by = auth.uid()
  where auth.uid() is not null
    and (registration.id is not null or is_club_admin())
  order by event.event_date desc, event.created_at desc;
$$;

revoke all on function accessible_events() from public, anon;
grant execute on function accessible_events() to authenticated;

create or replace function claim_event_invite(code text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target participants;
begin
  if auth.uid() is null then
    raise exception 'Sign in before adding another event' using errcode = '42501';
  end if;

  select * into target
  from participants
  where upper(trim(invite_code)) = upper(trim(code))
  limit 1;

  if target.id is null then
    raise exception 'Invalid invite code';
  end if;
  if target.claimed_by = auth.uid() then
    return target.event_id;
  end if;
  if target.claimed_by is not null then
    raise exception 'This invite has already been claimed';
  end if;
  if exists (
    select 1 from participants
    where event_id = target.event_id and claimed_by = auth.uid()
  ) then
    raise exception 'This account is already registered for that event';
  end if;

  update participants set claimed_by = auth.uid() where id = target.id;

  insert into profiles (id, display_name)
  values (auth.uid(), target.full_name)
  on conflict (id) do nothing;

  return target.event_id;
end;
$$;

revoke all on function claim_event_invite(text) from public, anon;
grant execute on function claim_event_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Login and signup compatibility
-- ---------------------------------------------------------------------------

create or replace function resolve_login(login text)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  normalized text := lower(trim(login));
  resolved text;
begin
  if normalized = '' then return null; end if;

  if position('@' in normalized) > 0 then
    select account.email into resolved
    from auth.users account
    where lower(account.email) = normalized
    limit 1;
  else
    select account.email into resolved
    from profiles profile
    join auth.users account on account.id = profile.id
    where lower(profile.username) = normalized
    limit 1;
  end if;
  return resolved;
end;
$$;

revoke all on function resolve_login(text) from public;
grant execute on function resolve_login(text) to anon, authenticated;

create or replace function prepare_invite_signup(code text, login text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_code text := upper(trim(code));
  normalized_login text := lower(trim(login));
  target participants;
  next_email text;
  next_username text;
begin
  if normalized_code = '' or normalized_login = '' then
    raise exception 'Invite code and login are required';
  end if;

  select * into target
  from participants
  where upper(trim(invite_code)) = normalized_code
  limit 1;

  if target.id is null then raise exception 'Invalid invite code'; end if;
  if target.claimed_by is not null then
    raise exception 'This invite has already been claimed. Sign in with your email or username.';
  end if;

  if position('@' in normalized_login) > 0 then
    next_email := normalized_login;
    next_username := null;
  else
    if length(normalized_login) < 3 then
      raise exception 'Username must be at least 3 characters';
    end if;
    if normalized_login !~ '^[a-z0-9._-]+$' then
      raise exception 'Username can only use letters, numbers, dots, dashes, and underscores';
    end if;
    next_email := normalized_login || '@invite.blurrygolf.app';
    next_username := normalized_login;
  end if;

  if exists (select 1 from auth.users where lower(email) = next_email) then
    raise exception 'That account already exists. Sign in, then redeem this event invite.';
  end if;
  if next_username is not null and exists (
    select 1 from profiles where lower(username) = next_username
  ) then
    raise exception 'That username is already taken';
  end if;

  update participants
  set auth_email = next_email,
      username = next_username
  where id = target.id;

  return next_email;
end;
$$;

revoke all on function prepare_invite_signup(text, text) from public;
grant execute on function prepare_invite_signup(text, text) to anon, authenticated;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target participants;
begin
  select * into target
  from participants
  where lower(auth_email) = lower(new.email)
    and claimed_by is null
  order by created_at
  limit 1;

  if target.id is null then return new; end if;

  insert into profiles (id, display_name, username)
  values (new.id, target.full_name, target.username)
  on conflict (id) do update
    set display_name = coalesce(profiles.display_name, excluded.display_name),
        username = coalesce(profiles.username, excluded.username);

  -- Claim every pre-seeded registration carrying this account email. Event
  -- chat memberships were already created with each roster row.
  update participants
  set claimed_by = new.id
  where lower(auth_email) = lower(new.email)
    and claimed_by is null;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registration and admin write guards/RPCs
-- ---------------------------------------------------------------------------

create or replace function guard_participant_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;

  -- Invite claiming is only reachable through the SECURITY DEFINER RPC because
  -- RLS cannot target an unclaimed row directly.
  if old.claimed_by is null
     and new.claimed_by = auth.uid()
     and new.event_id is not distinct from old.event_id
     and new.is_admin is not distinct from old.is_admin
     and new.auth_email is not distinct from old.auth_email
     and new.invite_code is not distinct from old.invite_code
  then
    return new;
  end if;

  if is_event_admin(old.event_id) then
    if new.event_id is distinct from old.event_id then
      raise exception 'Move registrations by creating one in the target event'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.claimed_by <> auth.uid()
     or new.claimed_by is distinct from old.claimed_by
     or new.event_id is distinct from old.event_id
     or new.is_admin is distinct from old.is_admin
     or new.auth_email is distinct from old.auth_email
     or new.invite_code is distinct from old.invite_code
  then
    raise exception 'Only an event admin can change roster fields'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function apply_team_assignments(p_event_id uuid, p_teams jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  target_team uuid;
  team_ids uuid[] := '{}';
begin
  if not is_event_admin(p_event_id) then
    raise exception 'Only an admin can change teams' using errcode = '42501';
  end if;
  if jsonb_typeof(p_teams) is distinct from 'array' then
    raise exception 'p_teams must be a JSON array' using errcode = '22023';
  end if;

  for entry in select value from jsonb_array_elements(p_teams)
  loop
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
        raise exception 'Team % is not part of this event', target_team
          using errcode = '23503';
      end if;
    end if;

    team_ids := team_ids || target_team;
    delete from team_members
    where participant_id in (
      select participant.id
      from participants participant
      where participant.event_id = p_event_id
        and participant.id in (
          select value::uuid
          from jsonb_array_elements_text(coalesce(entry->'member_ids', '[]'::jsonb))
        )
    );
    insert into team_members (team_id, participant_id)
    select target_team, participant.id
    from participants participant
    where participant.event_id = p_event_id
      and participant.id in (
        select value::uuid
        from jsonb_array_elements_text(coalesce(entry->'member_ids', '[]'::jsonb))
      )
    on conflict do nothing;
  end loop;

  if array_length(team_ids, 1) > 0 then
    delete from teams
    where event_id = p_event_id and not (id = any(team_ids));
  end if;
  return team_ids;
end;
$$;

create or replace function invite_payloads(participant_ids uuid[])
returns table (id uuid, full_name text, auth_email text, invite_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from participants participant
    where participant.id = any(participant_ids)
      and not is_event_admin(participant.event_id)
  ) then
    raise exception 'Only event admins can send invites' using errcode = '42501';
  end if;
  return query
    select participant.id, participant.full_name,
           participant.auth_email, participant.invite_code
    from participants participant
    where participant.id = any(participant_ids);
end;
$$;

create or replace function mark_invites_sent(participant_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from participants participant
    where participant.id = any(participant_ids)
      and not is_event_admin(participant.event_id)
  ) then
    raise exception 'Only event admins can send invites' using errcode = '42501';
  end if;
  update participants set invite_sent_at = now() where id = any(participant_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- Event-scoped chat
-- ---------------------------------------------------------------------------

create or replace function conversation_summaries(p_event_id uuid)
returns table (
  id uuid,
  kind text,
  name text,
  created_by uuid,
  member_ids uuid[],
  last_message_body text,
  last_message_at timestamptz,
  last_sender_id uuid,
  last_message_media_mime_type text,
  last_activity_at timestamptz,
  last_activity_kind text,
  last_reaction_emoji text,
  last_reactor_id uuid,
  last_reaction_message_body text,
  last_reaction_message_media_mime_type text,
  unread_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    conversation.id,
    conversation.kind,
    conversation.name,
    conversation.created_by,
    coalesce(
      (
        select array_agg(other.participant_id order by participant.full_name)
        from conversation_members other
        join participants participant on participant.id = other.participant_id
        where other.conversation_id = conversation.id
      ),
      '{}'::uuid[]
    ),
    latest_message.body,
    latest_message.created_at,
    latest_message.sender_id,
    latest_message.media_mime_type,
    case
      when latest_reaction.created_at is not null
        and (latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at)
        then latest_reaction.created_at
      else latest_message.created_at
    end,
    case
      when latest_reaction.created_at is not null
        and (latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at)
        then 'reaction'
      when latest_message.created_at is not null then 'message'
      else null
    end,
    case
      when latest_reaction.created_at is not null
        and (latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at)
        then latest_reaction.emoji
      else null
    end,
    case
      when latest_reaction.created_at is not null
        and (latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at)
        then latest_reaction.participant_id
      else null
    end,
    case
      when latest_reaction.created_at is not null
        and (latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at)
        then latest_reaction.message_body
      else null
    end,
    case
      when latest_reaction.created_at is not null
        and (latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at)
        then latest_reaction.message_media_mime_type
      else null
    end,
    (
      (
        select count(*) from messages message
        where message.conversation_id = conversation.id
          and message.sender_id <> membership.participant_id
          and (membership.last_read_at is null
            or message.created_at > membership.last_read_at)
      )
      +
      (
        select count(*)
        from message_reactions reaction
        join messages message on message.id = reaction.message_id
        where message.conversation_id = conversation.id
          and message.sender_id = membership.participant_id
          and reaction.participant_id <> membership.participant_id
          and (membership.last_read_at is null
            or reaction.created_at > membership.last_read_at)
      )
    )::int
  from conversation_members membership
  join conversations conversation on conversation.id = membership.conversation_id
  left join lateral (
    select message.body, message.created_at, message.sender_id, message.media_mime_type
    from messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc
    limit 1
  ) latest_message on true
  left join lateral (
    select reaction.created_at, reaction.emoji, reaction.participant_id,
           message.body as message_body,
           message.media_mime_type as message_media_mime_type
    from message_reactions reaction
    join messages message on message.id = reaction.message_id
    where message.conversation_id = conversation.id
      and message.sender_id = membership.participant_id
      and reaction.participant_id <> membership.participant_id
    order by reaction.created_at desc
    limit 1
  ) latest_reaction on true
  where conversation.event_id = p_event_id
    and membership.participant_id = event_participant_id(p_event_id)
  order by coalesce(
    case
      when latest_reaction.created_at is not null
        and (latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at)
        then latest_reaction.created_at
      else latest_message.created_at
    end,
    conversation.created_at
  ) desc;
$$;

create or replace function find_direct_conversation(
  p_event_id uuid,
  other_participant uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select conversation.id
  from conversations conversation
  where conversation.event_id = p_event_id
    and conversation.kind = 'direct'
    and exists (
      select 1 from conversation_members mine
      where mine.conversation_id = conversation.id
        and mine.participant_id = event_participant_id(p_event_id)
    )
    and exists (
      select 1 from conversation_members theirs
      where theirs.conversation_id = conversation.id
        and theirs.participant_id = other_participant
    )
    and (select count(*) from conversation_members all_members
         where all_members.conversation_id = conversation.id) = 2
  limit 1;
$$;

create or replace function open_direct_conversation(
  p_event_id uuid,
  other_participant uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := event_participant_id(p_event_id);
  conversation_id uuid;
begin
  if me is null then raise exception 'Only event participants can send messages'; end if;
  if other_participant = me then raise exception 'You cannot message yourself'; end if;
  if not exists (
    select 1 from participants where id = other_participant and event_id = p_event_id
  ) then
    raise exception 'That player is not in this event';
  end if;

  conversation_id := find_direct_conversation(p_event_id, other_participant);
  if conversation_id is not null then return conversation_id; end if;

  insert into conversations (event_id, kind, created_by)
  values (p_event_id, 'direct', me)
  returning id into conversation_id;
  insert into conversation_members (conversation_id, participant_id)
  values (conversation_id, me), (conversation_id, other_participant);
  return conversation_id;
end;
$$;

create or replace function create_group_conversation(
  p_event_id uuid,
  group_name text,
  member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := event_participant_id(p_event_id);
  trimmed text := nullif(trim(coalesce(group_name, '')), '');
  conversation_id uuid;
begin
  if me is null then raise exception 'Only event participants can create groups'; end if;
  if trimmed is null then raise exception 'Give the group a name'; end if;

  insert into conversations (event_id, kind, name, created_by)
  values (p_event_id, 'group', trimmed, me)
  returning id into conversation_id;
  insert into conversation_members (conversation_id, participant_id)
  select conversation_id, participant.id
  from participants participant
  where participant.event_id = p_event_id
    and (participant.id = me
      or participant.id = any(coalesce(member_ids, '{}'::uuid[])))
  on conflict do nothing;
  return conversation_id;
end;
$$;

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
  conversation_id uuid;
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
  returning id into conversation_id;

  delete from conversation_members membership
  where membership.conversation_id = conversation_id
    and not exists (
      select 1 from team_members current_member
      where current_member.team_id = target_team
        and current_member.participant_id = membership.participant_id
    );
  insert into conversation_members (conversation_id, participant_id)
  select conversation_id, participant_id from team_members where team_id = target_team
  on conflict do nothing;
  return conversation_id;
end;
$$;

create or replace function add_conversation_members(convo uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_event uuid := conversation_event_id(convo);
  me uuid;
  convo_kind text;
  convo_team uuid;
begin
  me := event_participant_id(target_event);
  if me is null or not is_conversation_member(convo) then
    raise exception 'You are not in that conversation';
  end if;
  select kind, team_id into convo_kind, convo_team from conversations where id = convo;
  if convo_kind = 'direct' then raise exception 'A direct message is between two people'; end if;
  if convo_kind = 'event_group' or convo_team is not null then
    raise exception 'Membership in this chat follows the event roster';
  end if;
  insert into conversation_members (conversation_id, participant_id)
  select convo, participant.id
  from participants participant
  where participant.event_id = target_event
    and participant.id = any(coalesce(member_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$$;

create or replace function leave_conversation(convo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_event uuid := conversation_event_id(convo);
  me uuid;
  convo_kind text;
  convo_team uuid;
begin
  me := event_participant_id(target_event);
  if me is null then raise exception 'Only participants can leave conversations'; end if;
  select kind, team_id into convo_kind, convo_team from conversations where id = convo;
  if convo_kind = 'event_group' or convo_team is not null then
    raise exception 'Membership in this chat follows the event roster';
  end if;
  delete from conversation_members
  where conversation_id = convo and participant_id = me;
end;
$$;

revoke all on function conversation_summaries(uuid) from public, anon;
revoke all on function find_direct_conversation(uuid, uuid) from public, anon;
revoke all on function open_direct_conversation(uuid, uuid) from public, anon;
revoke all on function create_group_conversation(uuid, text, uuid[]) from public, anon;
revoke all on function open_team_conversation(uuid) from public, anon;
revoke all on function add_conversation_members(uuid, uuid[]) from public, anon;
revoke all on function leave_conversation(uuid) from public, anon;
grant execute on function conversation_summaries(uuid) to authenticated;
grant execute on function find_direct_conversation(uuid, uuid) to authenticated;
grant execute on function open_direct_conversation(uuid, uuid) to authenticated;
grant execute on function create_group_conversation(uuid, text, uuid[]) to authenticated;
grant execute on function open_team_conversation(uuid) to authenticated;
grant execute on function add_conversation_members(uuid, uuid[]) to authenticated;
grant execute on function leave_conversation(uuid) to authenticated;

revoke all on function apply_team_assignments(uuid, jsonb) from public, anon;
revoke all on function invite_payloads(uuid[]) from public, anon;
revoke all on function mark_invites_sent(uuid[]) from public, anon;
grant execute on function apply_team_assignments(uuid, jsonb) to authenticated;
grant execute on function invite_payloads(uuid[]) to authenticated;
grant execute on function mark_invites_sent(uuid[]) to authenticated;
