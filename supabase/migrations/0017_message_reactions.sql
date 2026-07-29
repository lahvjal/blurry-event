-- Emoji reactions on messages. A participant can add multiple different
-- reactions to a message, but can only add each emoji once.

create table message_reactions (
  message_id     uuid not null references messages(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  emoji          text not null check (
    char_length(trim(emoji)) between 1 and 16
  ),
  created_at     timestamptz not null default now(),
  primary key (message_id, participant_id, emoji)
);

create index message_reactions_message_idx
  on message_reactions(message_id, created_at);

alter table message_reactions enable row level security;

-- The message policy already limits this lookup to conversations the caller
-- belongs to. Reactions therefore inherit the same membership boundary.
create policy "members read message reactions" on message_reactions
  for select using (
    exists (
      select 1
      from messages m
      where m.id = message_reactions.message_id
        and is_conversation_member(m.conversation_id)
    )
  );

create policy "members add own message reactions" on message_reactions
  for insert with check (
    participant_id = current_participant_id()
    and exists (
      select 1
      from messages m
      where m.id = message_reactions.message_id
        and is_conversation_member(m.conversation_id)
    )
  );

create policy "members remove own message reactions" on message_reactions
  for delete using (
    participant_id = current_participant_id()
    and exists (
      select 1
      from messages m
      where m.id = message_reactions.message_id
        and is_conversation_member(m.conversation_id)
    )
  );

revoke all on table message_reactions from anon;
grant select, insert, delete on table message_reactions to authenticated;

-- DELETE events need the composite key in the old row so an open thread can
-- remove the right optimistic reaction without refetching every message.
alter table message_reactions replica identity full;
alter publication supabase_realtime add table message_reactions;
