-- Lets a player save their own name and handicap without letting them promote
-- themselves.
--
-- A player editing their profile writes to participants.full_name and
-- participants.handicap, which the "update own participant" policy from 0001
-- already permits. But RLS only decides *which rows* you may touch, never which
-- columns, so that same policy let any signed-in player run
--   update participants set is_admin = true where claimed_by = auth.uid()
-- and hand themselves the roster and event screens.
--
-- Column-level grants can't fix this: admins and players are both the
-- `authenticated` role, so anything revoked from players is revoked from admins
-- too. A trigger is the only place the two can be told apart.

create or replace function guard_participant_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No JWT means there's no end user to police: the signup trigger claiming a
  -- row, a service-role call, or someone in the SQL editor. All already trusted.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.is_admin    is distinct from old.is_admin
     or new.event_id    is distinct from old.event_id
     or new.auth_email  is distinct from old.auth_email
     or new.invite_code is distinct from old.invite_code
     or new.claimed_by  is distinct from old.claimed_by
  then
    raise exception 'Only an admin can change roster fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists participants_guard_self_update on participants;
create trigger participants_guard_self_update
  before update on participants
  for each row execute function guard_participant_self_update();

-- Postgres checks EXECUTE on a trigger function when the trigger is created, not
-- each time it fires, so taking the default grants back doesn't stop the guard.
revoke all on function guard_participant_self_update() from public, anon, authenticated;
