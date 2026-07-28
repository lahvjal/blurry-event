-- Username / email login and invite-first-time setup.

alter table participants
  add column if not exists username text unique;

create index if not exists participants_username_idx
  on participants (lower(username))
  where username is not null;

-- Maps a login identifier (email or username) to the auth email for sign-in.
create or replace function resolve_login(login text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(login));
  resolved text;
begin
  if normalized = '' then
    return null;
  end if;

  if position('@' in normalized) > 0 then
    select p.auth_email into resolved
    from participants p
    where lower(p.auth_email) = normalized
      and p.claimed_by is not null
    limit 1;
  else
    select p.auth_email into resolved
    from participants p
    where lower(p.username) = normalized
      and p.claimed_by is not null
    limit 1;
  end if;

  return resolved;
end;
$$;

revoke all on function resolve_login(text) from public;
grant execute on function resolve_login(text) to anon, authenticated;

-- Sets auth_email (and optional username) on an unclaimed invite before signUp.
create or replace function prepare_invite_signup(code text, login text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(trim(code));
  normalized_login text := lower(trim(login));
  target participants;
  next_email text;
  next_username text;
begin
  if normalized_code = '' or normalized_login = '' then
    raise exception 'Invite code and login are required';
  end if;

  select * into target
  from participants
  where upper(trim(invite_code)) = normalized_code
  limit 1;

  if target.id is null then
    raise exception 'Invalid invite code';
  end if;

  if target.claimed_by is not null then
    raise exception 'This invite has already been claimed. Sign in with your email or username.';
  end if;

  if position('@' in normalized_login) > 0 then
    next_email := normalized_login;
    next_username := null;
  else
    if length(normalized_login) < 3 then
      raise exception 'Username must be at least 3 characters';
    end if;
    if normalized_login !~ '^[a-z0-9._-]+$' then
      raise exception 'Username can only use letters, numbers, dots, dashes, and underscores';
    end if;
    next_email := normalized_login || '@invite.blurrygolf.app';
    next_username := normalized_login;
  end if;

  if exists (
    select 1 from participants
    where lower(auth_email) = next_email and id <> target.id
  ) then
    raise exception 'That email is already in use';
  end if;

  if next_username is not null and exists (
    select 1 from participants
    where lower(username) = next_username and id <> target.id
  ) then
    raise exception 'That username is already taken';
  end if;

  update participants
     set auth_email = next_email,
         username = next_username
   where id = target.id;

  return next_email;
end;
$$;

revoke all on function prepare_invite_signup(text, text) from public;
grant execute on function prepare_invite_signup(text, text) to anon, authenticated;
