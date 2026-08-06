-- Club-wide messaging visibility.
--
-- Conversations, memberships, messages, and queued writes keep their immutable
-- event of origin. That event remains the integrity and authorization boundary;
-- it is no longer the default inbox filter. This account-scoped read model
-- returns every conversation membership held by any registration claimed by the
-- signed-in account, with enough origin and participant metadata to render the
-- inbox without borrowing the currently focused event's roster.

create or replace function club_conversation_summaries()
returns table (
  id                                      uuid,
  event_id                                uuid,
  event_name                              text,
  kind                                    text,
  name                                    text,
  created_by                              uuid,
  my_participant_id                       uuid,
  member_ids                              uuid[],
  direct_participant_id                   uuid,
  direct_participant_name                 text,
  direct_participant_avatar_url           text,
  last_message_body                       text,
  last_message_at                         timestamptz,
  last_sender_id                          uuid,
  last_sender_name                        text,
  last_message_media_mime_type            text,
  last_activity_at                        timestamptz,
  last_activity_kind                      text,
  last_reaction_emoji                     text,
  last_reactor_id                         uuid,
  last_reactor_name                       text,
  last_reaction_message_body              text,
  last_reaction_message_media_mime_type   text,
  unread_count                            int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    conversation.id,
    conversation.event_id,
    event.name,
    conversation.kind,
    conversation.name,
    conversation.created_by,
    registration.id,
    coalesce(
      (
        select array_agg(other.participant_id order by participant.full_name)
        from conversation_members other
        join participants participant on participant.id = other.participant_id
        where other.conversation_id = conversation.id
      ),
      '{}'::uuid[]
    ),
    direct_participant.id,
    direct_participant.full_name,
    direct_participant.avatar_url,
    latest_message.body,
    latest_message.created_at,
    latest_message.sender_id,
    latest_message.sender_name,
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
        then latest_reaction.reactor_name
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
        select count(*)
        from messages message
        where message.conversation_id = conversation.id
          and message.sender_id <> registration.id
          and (membership.last_read_at is null
            or message.created_at > membership.last_read_at)
      )
      +
      (
        select count(*)
        from message_reactions reaction
        join messages message on message.id = reaction.message_id
        where message.conversation_id = conversation.id
          and message.sender_id = registration.id
          and reaction.participant_id <> registration.id
          and (membership.last_read_at is null
            or reaction.created_at > membership.last_read_at)
      )
    )::int
  from participants registration
  join conversation_members membership
    on membership.participant_id = registration.id
  join conversations conversation
    on conversation.id = membership.conversation_id
   and conversation.event_id = registration.event_id
  join events event on event.id = conversation.event_id
  left join lateral (
    select
      participant.id,
      participant.full_name,
      profile.avatar_url
    from conversation_members other
    join participants participant on participant.id = other.participant_id
    left join profiles profile on profile.id = participant.claimed_by
    where other.conversation_id = conversation.id
      and other.participant_id <> registration.id
    order by participant.full_name, participant.id
    limit 1
  ) direct_participant on conversation.kind = 'direct'
  left join lateral (
    select
      message.body,
      message.created_at,
      message.sender_id,
      sender.full_name as sender_name,
      message.media_mime_type
    from messages message
    join participants sender on sender.id = message.sender_id
    where message.conversation_id = conversation.id
    order by message.created_at desc
    limit 1
  ) latest_message on true
  left join lateral (
    select
      reaction.created_at,
      reaction.emoji,
      reaction.participant_id,
      reactor.full_name as reactor_name,
      message.body as message_body,
      message.media_mime_type as message_media_mime_type
    from message_reactions reaction
    join messages message on message.id = reaction.message_id
    join participants reactor on reactor.id = reaction.participant_id
    where message.conversation_id = conversation.id
      and message.sender_id = registration.id
      and reaction.participant_id <> registration.id
    order by reaction.created_at desc
    limit 1
  ) latest_reaction on true
  where auth.uid() is not null
    and registration.claimed_by = auth.uid()
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

revoke all on function club_conversation_summaries() from public, anon;
grant execute on function club_conversation_summaries() to authenticated;

comment on function club_conversation_summaries() is
  'Every conversation membership owned by the signed-in account across all event registrations.';
