-- Fixes: 42P17 infinite recursion in policy for relation "conversation_members".
--
-- The original SELECT policy on conversation_members contained a subquery
-- against conversation_members, so evaluating the policy re-invoked the policy.
-- The conversations and messages policies inherited the recursion through it.
--
-- A SECURITY DEFINER helper reads membership with RLS bypassed, which breaks
-- the cycle. It is stable and takes the conversation id only, so it can't be
-- used to enumerate anything the caller isn't already entitled to see.

create or replace function is_conversation_member(convo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from conversation_members cm
    where cm.conversation_id = convo
      and cm.participant_id = current_participant_id()
  );
$$;

revoke all on function is_conversation_member(uuid) from public;
grant execute on function is_conversation_member(uuid) to authenticated;

-- conversations
drop policy if exists "members read conversations" on conversations;
create policy "members read conversations" on conversations
  for select using (is_conversation_member(id));

-- conversation_members
drop policy if exists "members read membership" on conversation_members;
create policy "members read membership" on conversation_members
  for select using (
    participant_id = current_participant_id()
    or is_conversation_member(conversation_id)
  );

-- messages
drop policy if exists "members read messages" on messages;
create policy "members read messages" on messages
  for select using (is_conversation_member(conversation_id));

drop policy if exists "members send messages" on messages;
create policy "members send messages" on messages
  for insert with check (
    sender_id = current_participant_id()
    and is_conversation_member(conversation_id)
  );
