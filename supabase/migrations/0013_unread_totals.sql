-- Unread totals, for the home screen icon badge.
--
-- The badge has to be set from the service worker, which is running with no
-- session and can't query anything itself — so the count has to arrive inside
-- the push payload. The send-push function looks it up here, for every
-- recipient of a given notification in one round trip.
--
-- Counts unread *messages* only. Announcements and tee time changes still
-- notify, but there's no read state for them in the schema to count against,
-- and inventing one to make a number go up isn't worth it.

create or replace function unread_totals(user_ids uuid[])
returns table (user_id uuid, unread bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.claimed_by, count(m.id)
  from participants p
  join conversation_members cm on cm.participant_id = p.id
  join messages m             on m.conversation_id = cm.conversation_id
  where p.claimed_by = any (user_ids)
    -- Your own messages are never unread, and last_read_at null means the
    -- thread has never been opened, so everything in it counts.
    and m.sender_id <> p.id
    and (cm.last_read_at is null or m.created_at > cm.last_read_at)
  group by p.claimed_by;
$$;

-- Only the push sender needs this. It reads across every participant, so it has
-- no business being callable from a browser.
revoke all on function unread_totals(uuid[]) from public, anon, authenticated;
grant execute on function unread_totals(uuid[]) to service_role;
