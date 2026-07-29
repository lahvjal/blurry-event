-- Treat a reaction as unread activity for the author of the message being
-- reacted to. Reactions from other people do not light up the entire group:
-- only the person whose message received the reaction gets the unread count
-- and push notification.

-- ---------------------------------------------------------------------------
-- Conversation summaries
-- ---------------------------------------------------------------------------

-- The return row gains reaction-specific activity fields, so PostgreSQL needs
-- the old function dropped before it can be recreated with the wider shape.
drop function if exists conversation_summaries();

create function conversation_summaries()
returns table (
  id                         uuid,
  kind                       text,
  name                       text,
  created_by                 uuid,
  member_ids                 uuid[],
  last_message_body          text,
  last_message_at            timestamptz,
  last_sender_id             uuid,
  last_activity_at           timestamptz,
  last_activity_kind         text,
  last_reaction_emoji        text,
  last_reactor_id            uuid,
  last_reaction_message_body text,
  unread_count               int
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
    latest_message.body,
    latest_message.created_at,
    latest_message.sender_id,
    case
      when latest_reaction.created_at is not null
        and (
          latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at
        )
        then latest_reaction.created_at
      else latest_message.created_at
    end,
    case
      when latest_reaction.created_at is not null
        and (
          latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at
        )
        then 'reaction'
      when latest_message.created_at is not null then 'message'
      else null
    end,
    case
      when latest_reaction.created_at is not null
        and (
          latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at
        )
        then latest_reaction.emoji
      else null
    end,
    case
      when latest_reaction.created_at is not null
        and (
          latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at
        )
        then latest_reaction.participant_id
      else null
    end,
    case
      when latest_reaction.created_at is not null
        and (
          latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at
        )
        then latest_reaction.message_body
      else null
    end,
    (
      (
        select count(*)
        from messages m
        where m.conversation_id = c.id
          and m.sender_id <> cm.participant_id
          and (cm.last_read_at is null or m.created_at > cm.last_read_at)
      )
      +
      (
        select count(*)
        from message_reactions r
        join messages m on m.id = r.message_id
        where m.conversation_id = c.id
          and m.sender_id = cm.participant_id
          and r.participant_id <> cm.participant_id
          and (cm.last_read_at is null or r.created_at > cm.last_read_at)
      )
    )::int
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  left join lateral (
    select m.body, m.created_at, m.sender_id
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) latest_message on true
  left join lateral (
    select
      r.created_at,
      r.emoji,
      r.participant_id,
      m.body as message_body
    from message_reactions r
    join messages m on m.id = r.message_id
    where m.conversation_id = c.id
      and m.sender_id = cm.participant_id
      and r.participant_id <> cm.participant_id
    order by r.created_at desc
    limit 1
  ) latest_reaction on true
  where cm.participant_id = current_participant_id()
  order by coalesce(
    case
      when latest_reaction.created_at is not null
        and (
          latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at
        )
        then latest_reaction.created_at
      else latest_message.created_at
    end,
    c.created_at
  ) desc;
$$;

revoke all on function conversation_summaries() from public, anon;
grant execute on function conversation_summaries() to authenticated;

-- ---------------------------------------------------------------------------
-- App-icon and navigation badge totals
-- ---------------------------------------------------------------------------

create or replace function unread_totals(user_ids uuid[])
returns table (user_id uuid, unread bigint)
language sql
stable
security definer
set search_path = public
as $$
  with unread_activity as (
    select cm.participant_id
    from conversation_members cm
    join messages m on m.conversation_id = cm.conversation_id
    where m.sender_id <> cm.participant_id
      and (cm.last_read_at is null or m.created_at > cm.last_read_at)

    union all

    select cm.participant_id
    from conversation_members cm
    join messages m
      on m.conversation_id = cm.conversation_id
      and m.sender_id = cm.participant_id
    join message_reactions r on r.message_id = m.id
    where r.participant_id <> cm.participant_id
      and (cm.last_read_at is null or r.created_at > cm.last_read_at)
  )
  select p.claimed_by, count(*)
  from unread_activity activity
  join participants p on p.id = activity.participant_id
  where p.claimed_by = any (user_ids)
  group by p.claimed_by;
$$;

revoke all on function unread_totals(uuid[]) from public, anon, authenticated;
grant execute on function unread_totals(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Push dispatch
-- ---------------------------------------------------------------------------

create or replace function on_message_reaction_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_push(jsonb_build_object(
    'type',           'reaction',
    'message_id',     new.message_id,
    'participant_id', new.participant_id,
    'emoji',          new.emoji
  ));
  return null;
end;
$$;

drop trigger if exists message_reactions_push on message_reactions;
create trigger message_reactions_push
  after insert on message_reactions
  for each row execute function on_message_reaction_push();

