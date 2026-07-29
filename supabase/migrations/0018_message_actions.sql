-- Message replies, edits, and sender-controlled unsend.

alter table messages
  add column reply_to_id uuid references messages(id) on delete set null,
  add column edited_at timestamptz;

create index messages_reply_to_idx
  on messages(reply_to_id)
  where reply_to_id is not null;

-- Reply targets must live in the same conversation. On edits, ownership,
-- threading, timestamps, and idempotency keys stay immutable; the server owns
-- edited_at so clients cannot forge it.
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
     -- The foreign key is allowed to clear a reply reference when its parent
     -- is unsent. Clients cannot set or change the target after insertion.
     or (
       new.reply_to_id is distinct from old.reply_to_id
       and new.reply_to_id is not null
     )
     or new.client_id is distinct from old.client_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Message identity and threading cannot be changed'
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

drop trigger if exists messages_guard_actions on messages;
create trigger messages_guard_actions
  before insert or update on messages
  for each row execute function guard_message_actions();

revoke all on function guard_message_actions()
  from public, anon, authenticated;

create policy "senders edit own messages" on messages
  for update
  using (
    sender_id = current_participant_id()
    and is_conversation_member(conversation_id)
  )
  with check (
    sender_id = current_participant_id()
    and is_conversation_member(conversation_id)
  );

create policy "senders unsend own messages" on messages
  for delete using (
    sender_id = current_participant_id()
    and is_conversation_member(conversation_id)
  );

revoke update on table messages from authenticated;
grant update(body), delete on table messages to authenticated;

-- UPDATE and DELETE realtime events need the complete old row so open threads
-- can update or remove the correct bubble without refetching everything.
alter table messages replica identity full;
