-- Track which invites have actually been emailed.
--
-- Without this the roster can't tell "never invited" from "invited last week
-- and they haven't got round to it", which is the difference between someone
-- who needs chasing and someone who needs a second email. It's also what the
-- bulk send filters on, so running it twice doesn't spam the whole field.

alter table participants
  add column if not exists invite_sent_at timestamptz;

-- Admin-only, and only ever the addresses of players in your own event. The
-- send-invite function calls this with the caller's JWT, so authorization is
-- decided here rather than being taken on trust from the edge.
create or replace function invite_payloads(participant_ids uuid[])
returns table (
  id          uuid,
  full_name   text,
  auth_email  text,
  invite_code text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only event admins can send invites';
  end if;

  return query
    select p.id, p.full_name, p.auth_email, p.invite_code
    from participants p
    where p.id = any (participant_ids);
end;
$$;

revoke all on function invite_payloads(uuid[]) from public, anon;
grant execute on function invite_payloads(uuid[]) to authenticated;

-- Stamped after Resend accepts the message, so a failed send stays visibly
-- un-invited and gets picked up by the next bulk run.
create or replace function mark_invites_sent(participant_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only event admins can send invites';
  end if;

  update participants
  set invite_sent_at = now()
  where id = any (participant_ids);
end;
$$;

revoke all on function mark_invites_sent(uuid[]) from public, anon;
grant execute on function mark_invites_sent(uuid[]) to authenticated;
