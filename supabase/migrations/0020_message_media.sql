-- One photo or animated GIF can be attached to a message. The file itself
-- lives in Storage; the message stores the stable public URL and display
-- metadata needed by chat, inbox previews, and push notifications.

alter table messages
  add column if not exists media_url text,
  add column if not exists media_mime_type text,
  add column if not exists media_width int,
  add column if not exists media_height int;

alter table messages
  drop constraint if exists messages_media_complete,
  add constraint messages_media_complete check (
    (
      media_url is null
      and media_mime_type is null
      and media_width is null
      and media_height is null
    )
    or (
      media_url is not null
      and media_mime_type like 'image/%'
      and (media_width is null or media_width > 0)
      and (media_height is null or media_height > 0)
    )
  );

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "message media readable" on storage.objects;
create policy "message media readable" on storage.objects
  for select using (bucket_id = 'message-media');

-- Files are namespaced by auth user first. A user can upload or remove only
-- their own media objects; message RLS still controls which URLs the app shows.
drop policy if exists "players upload own message media" on storage.objects;
create policy "players upload own message media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "players delete own message media" on storage.objects;
create policy "players delete own message media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'message-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Message action guard
-- ---------------------------------------------------------------------------

-- Media is chosen at send time and immutable after insert. Edits remain
-- caption-only, while the foreign key may still clear reply_to_id when its
-- parent is unsent.
create or replace function guard_message_actions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1
    from messages parent
    where parent.id = new.reply_to_id
      and parent.conversation_id = new.conversation_id
  ) then
    raise exception 'Reply target is not in this conversation'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.edited_at := null;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or (
       new.reply_to_id is distinct from old.reply_to_id
       and new.reply_to_id is not null
     )
     or new.client_id is distinct from old.client_id
     or new.created_at is distinct from old.created_at
     or new.media_url is distinct from old.media_url
     or new.media_mime_type is distinct from old.media_mime_type
     or new.media_width is distinct from old.media_width
     or new.media_height is distinct from old.media_height
  then
    raise exception 'Message identity, threading, and media cannot be changed'
      using errcode = '42501';
  end if;

  if new.body is not distinct from old.body
     and old.reply_to_id is not null
     and new.reply_to_id is null
  then
    new.edited_at := old.edited_at;
    return new;
  end if;

  new.edited_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conversation summaries
-- ---------------------------------------------------------------------------

drop function if exists conversation_summaries();

create function conversation_summaries()
returns table (
  id                                       uuid,
  kind                                     text,
  name                                     text,
  created_by                               uuid,
  member_ids                               uuid[],
  last_message_body                        text,
  last_message_at                          timestamptz,
  last_sender_id                           uuid,
  last_message_media_mime_type             text,
  last_activity_at                         timestamptz,
  last_activity_kind                       text,
  last_reaction_emoji                      text,
  last_reactor_id                          uuid,
  last_reaction_message_body               text,
  last_reaction_message_media_mime_type    text,
  unread_count                             int
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
    latest_message.media_mime_type,
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
    case
      when latest_reaction.created_at is not null
        and (
          latest_message.created_at is null
          or latest_reaction.created_at > latest_message.created_at
        )
        then latest_reaction.message_media_mime_type
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
    select
      m.body,
      m.created_at,
      m.sender_id,
      m.media_mime_type
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
      m.body as message_body,
      m.media_mime_type as message_media_mime_type
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
