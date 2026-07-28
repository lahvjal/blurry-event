-- Closes the gap between what the earlier `revoke ... from public` lines meant
-- and what they did.
--
-- Supabase ships default privileges that grant EXECUTE on every new function in
-- the public schema to anon, authenticated, and service_role. Those are grants to
-- the anon *role*, so revoking from PUBLIC (the pseudo-role) never removed them
-- and the chat functions stayed callable without signing in.
--
-- Nothing was exposed by this: each one derives the caller from
-- current_participant_id(), which is null for an anonymous request, so they
-- return nothing or raise. This just makes the privileges say what was intended.

revoke execute on function conversation_summaries() from anon;
revoke execute on function find_direct_conversation(uuid) from anon;
revoke execute on function open_direct_conversation(uuid) from anon;
revoke execute on function create_group_conversation(text, uuid[]) from anon;
revoke execute on function add_conversation_members(uuid, uuid[]) from anon;
revoke execute on function leave_conversation(uuid) from anon;

-- Deliberately left callable by anon:
--   lookup_invite, resolve_login, prepare_invite_signup — all three run before
--     the user has an account, which is the whole point of them.
--   current_participant_id, is_admin, is_conversation_member, can_write_round —
--     these are evaluated inside RLS policies as the querying role. Revoking
--     them from anon would turn an anonymous read that currently returns an
--     empty set into a permission error, which is noisier and no safer.
