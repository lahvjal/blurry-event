-- Delegate unclaimed teammate identity management without changing scoring
-- authority. Team leadership is an event-scoped roster role; every claimed
-- scoring-team member continues to share the team's scorecard.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.teams
  add column if not exists leader_participant_id uuid;

alter table public.teams
  drop constraint if exists teams_leader_participant_id_fkey;
alter table public.teams
  add constraint teams_leader_participant_id_fkey
  foreign key (leader_participant_id)
  references public.participants(id)
  on delete set null;

create index if not exists teams_leader_participant_idx
  on public.teams (leader_participant_id)
  where leader_participant_id is not null;

alter table public.participants
  add column if not exists leader_managed boolean not null default false,
  add column if not exists invite_enabled boolean not null default true,
  add column if not exists claim_email_bound boolean not null default false,
  add column if not exists identity_version bigint not null default 0;

-- Existing rows keep their working invite behavior. New rows must explicitly
-- opt in once they have an address; this makes future email-less placeholders
-- unclaimable without invalidating already-shared legacy deep links.
alter table public.participants
  alter column invite_enabled set default false;

create table if not exists private.team_management_audit (
  id                    bigint generated always as identity primary key,
  event_id              uuid not null references public.events(id) on delete cascade,
  team_id               uuid references public.teams(id) on delete set null,
  actor_account_id      uuid not null,
  actor_participant_id  uuid references public.participants(id) on delete set null,
  target_participant_id uuid references public.participants(id) on delete set null,
  action                text not null check (action in ('assign_leader', 'clear_leader', 'edit_placeholder')),
  changed_fields        text[] not null default '{}'::text[],
  occurred_at           timestamptz not null default now()
);

revoke all on table private.team_management_audit from public, anon, authenticated;
revoke all on sequence private.team_management_audit_id_seq from public, anon, authenticated;

-- A leader must be a member of the same scoring team and event. Deferring the
-- check lets the existing atomic assignment RPC rebuild memberships in-place.
create or replace function private.validate_team_leader_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.leader_participant_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.participants leader
    join public.team_members membership
      on membership.participant_id = leader.id
     and membership.team_id = new.id
    where leader.id = new.leader_participant_id
      and leader.event_id = new.event_id
  ) then
    raise exception 'A team leader must be a member of that event team'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_team_leader_membership() from public, anon, authenticated;

drop trigger if exists teams_validate_leader_membership on public.teams;
create constraint trigger teams_validate_leader_membership
  after insert or update of event_id, leader_participant_id on public.teams
  deferrable initially deferred
  for each row execute function private.validate_team_leader_membership();

create or replace function private.validate_membership_team_leader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_team public.teams%rowtype;
begin
  for affected_team in
    select team.*
    from public.teams team
    where team.id in (
      case when tg_op <> 'INSERT' then old.team_id else null end,
      case when tg_op <> 'DELETE' then new.team_id else null end
    )
      and team.leader_participant_id is not null
  loop
    if not exists (
      select 1
      from public.participants leader
      join public.team_members membership
        on membership.participant_id = leader.id
       and membership.team_id = affected_team.id
      where leader.id = affected_team.leader_participant_id
        and leader.event_id = affected_team.event_id
    ) then
      raise exception 'A team leader must remain a member of that event team'
        using errcode = '23514';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.validate_membership_team_leader() from public, anon, authenticated;

drop trigger if exists team_members_validate_leader on public.team_members;
create constraint trigger team_members_validate_leader
  after insert or update or delete on public.team_members
  deferrable initially deferred
  for each row execute function private.validate_membership_team_leader();

-- Returns the one team on which the actor is the assigned, claimed leader and
-- the target is an unclaimed, explicitly delegated teammate.
create or replace function private.managed_teammate_team(
  p_target_participant_id uuid,
  p_actor_account_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select scoring_team.id
  from public.teams scoring_team
  join public.team_members target_membership
    on target_membership.team_id = scoring_team.id
   and target_membership.participant_id = p_target_participant_id
  join public.participants target
    on target.id = target_membership.participant_id
   and target.event_id = scoring_team.event_id
  join public.participants leader
    on leader.id = scoring_team.leader_participant_id
   and leader.event_id = scoring_team.event_id
   and leader.claimed_by = p_actor_account_id
  join public.team_members leader_membership
    on leader_membership.team_id = scoring_team.id
   and leader_membership.participant_id = leader.id
  where target.claimed_by is null
    and target.leader_managed
  limit 1;
$$;

revoke all on function private.managed_teammate_team(uuid, uuid) from public, anon;
grant execute on function private.managed_teammate_team(uuid, uuid) to authenticated;

create or replace function private.set_team_leader(
  p_event_id uuid,
  p_team_id uuid,
  p_leader_participant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_participant uuid;
  target_team public.teams%rowtype;
begin
  if actor_id is null or not public.is_event_admin(p_event_id) then
    raise exception 'Only an event admin can assign a team leader'
      using errcode = '42501';
  end if;

  select team.* into target_team
  from public.teams team
  where team.id = p_team_id and team.event_id = p_event_id
  for update;
  if target_team.id is null then
    raise exception 'Scoring team does not belong to this event'
      using errcode = '23503';
  end if;

  if p_leader_participant_id is not null and not exists (
    select 1
    from public.participants participant
    join public.team_members membership
      on membership.participant_id = participant.id
     and membership.team_id = p_team_id
    where participant.id = p_leader_participant_id
      and participant.event_id = p_event_id
  ) then
    raise exception 'Choose a leader from this scoring team'
      using errcode = '23514';
  end if;

  update public.teams
  set leader_participant_id = p_leader_participant_id
  where id = p_team_id;

  -- Assigning a leader explicitly delegates only the currently unclaimed
  -- placeholders on that team. Existing invite codes remain valid until an
  -- identity/email edit rotates them, preserving already-shared deep links.
  if p_leader_participant_id is not null then
    update public.participants participant
    set leader_managed = true
    from public.team_members membership
    where membership.team_id = p_team_id
      and membership.participant_id = participant.id
      and participant.event_id = p_event_id
      and participant.claimed_by is null;
  end if;

  actor_participant := public.event_participant_id(p_event_id);
  insert into private.team_management_audit (
    event_id,
    team_id,
    actor_account_id,
    actor_participant_id,
    target_participant_id,
    action,
    changed_fields
  ) values (
    p_event_id,
    p_team_id,
    actor_id,
    actor_participant,
    p_leader_participant_id,
    case when p_leader_participant_id is null then 'clear_leader' else 'assign_leader' end,
    array['leader_participant_id']::text[]
  );

  return p_leader_participant_id;
end;
$$;

revoke all on function private.set_team_leader(uuid, uuid, uuid) from public, anon;
grant execute on function private.set_team_leader(uuid, uuid, uuid) to authenticated;

create or replace function public.set_team_leader(
  p_event_id uuid,
  p_team_id uuid,
  p_leader_participant_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.set_team_leader(p_event_id, p_team_id, p_leader_participant_id);
$$;

revoke all on function public.set_team_leader(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_team_leader(uuid, uuid, uuid) to authenticated;

create or replace function private.update_leader_managed_teammate(
  p_event_id uuid,
  p_target_participant_id uuid,
  p_expected_version bigint,
  p_full_name text,
  p_email text
)
returns table (
  id uuid,
  full_name text,
  auth_email text,
  invite_code text,
  claimed boolean,
  invite_sent_at timestamptz,
  leader_managed boolean,
  invite_enabled boolean,
  claim_email_bound boolean,
  identity_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_participant uuid;
  target public.participants%rowtype;
  managed_team_id uuid;
  cleaned_name text := nullif(btrim(p_full_name), '');
  normalized_email text := nullif(lower(btrim(p_email)), '');
  current_real_email text;
  next_code text;
  next_email text;
  name_changed boolean;
  email_changed boolean;
  conflicting_account uuid;
  changed text[];
begin
  if actor_id is null then
    raise exception 'Sign in before editing a teammate'
      using errcode = '42501';
  end if;
  if cleaned_name is null then
    raise exception 'A teammate name is required' using errcode = '22023';
  end if;
  if char_length(cleaned_name) > 100 then
    raise exception 'A teammate name must be 100 characters or fewer'
      using errcode = '22023';
  end if;
  if normalized_email is not null
     and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  select participant.* into target
  from public.participants participant
  where participant.id = p_target_participant_id
    and participant.event_id = p_event_id
  for update;
  if target.id is null then
    raise exception 'Teammate does not belong to this event'
      using errcode = '23503';
  end if;

  managed_team_id := private.managed_teammate_team(target.id, actor_id);
  if managed_team_id is null then
    raise exception 'Only the assigned team leader can edit an unclaimed teammate on their team'
      using errcode = '42501';
  end if;
  if target.identity_version is distinct from p_expected_version then
    raise exception 'This teammate changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  current_real_email := case
    when lower(target.auth_email) like '%@invite.blurrygolf.app'
      or lower(target.auth_email) like '%@invite.local'
      then null
    else lower(target.auth_email)
  end;
  name_changed := cleaned_name is distinct from target.full_name;
  email_changed :=
    normalized_email is distinct from current_real_email
    or (
      normalized_email is not null
      and (not target.claim_email_bound or not target.invite_enabled)
    );

  if not name_changed and not email_changed then
    return query select
      target.id,
      target.full_name,
      target.auth_email,
      target.invite_code,
      target.claimed_by is not null,
      target.invite_sent_at,
      target.leader_managed,
      target.invite_enabled,
      target.claim_email_bound,
      target.identity_version;
    return;
  end if;

  if normalized_email is not null and exists (
    select 1
    from public.participants other
    where other.event_id = p_event_id
      and other.id <> target.id
      and lower(other.auth_email) = normalized_email
  ) then
    raise exception 'That email cannot be used for this teammate. Ask an event admin to resolve it.'
      using errcode = '23505';
  end if;

  if normalized_email is not null then
    select account.id into conflicting_account
    from auth.users account
    where lower(account.email) = normalized_email
    limit 1;

    if conflicting_account is not null and exists (
      select 1
      from public.participants registration
      where registration.event_id = p_event_id
        and registration.id <> target.id
        and registration.claimed_by = conflicting_account
    ) then
      raise exception 'That email cannot be used for this teammate. Ask an event admin to resolve it.'
        using errcode = '23505';
    end if;
  end if;

  if email_changed then
    next_code := 'BI-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    next_email := coalesce(
      normalized_email,
      lower(next_code) || '@invite.blurrygolf.app'
    );
  else
    next_code := target.invite_code;
    next_email := target.auth_email;
  end if;

  update public.participants participant
  set full_name = cleaned_name,
      auth_email = next_email,
      invite_code = next_code,
      invite_sent_at = case when email_changed then null else participant.invite_sent_at end,
      invite_enabled = case
        when not email_changed then participant.invite_enabled
        when normalized_email is null then false
        else true
      end,
      claim_email_bound = case
        when not email_changed then participant.claim_email_bound
        when normalized_email is null then false
        else true
      end,
      identity_version = participant.identity_version + 1
  where participant.id = target.id
  returning participant.* into target;

  changed := array_remove(array[
    case when name_changed then 'full_name' else null end,
    case when email_changed then 'auth_email' else null end,
    case when email_changed then 'invite_lifecycle' else null end
  ]::text[], null);

  actor_participant := public.event_participant_id(p_event_id);
  insert into private.team_management_audit (
    event_id,
    team_id,
    actor_account_id,
    actor_participant_id,
    target_participant_id,
    action,
    changed_fields
  ) values (
    p_event_id,
    managed_team_id,
    actor_id,
    actor_participant,
    target.id,
    'edit_placeholder',
    changed
  );

  return query select
    target.id,
    target.full_name,
    target.auth_email,
    target.invite_code,
    target.claimed_by is not null,
    target.invite_sent_at,
    target.leader_managed,
    target.invite_enabled,
    target.claim_email_bound,
    target.identity_version;
end;
$$;

revoke all on function private.update_leader_managed_teammate(uuid, uuid, bigint, text, text)
  from public, anon;
grant execute on function private.update_leader_managed_teammate(uuid, uuid, bigint, text, text)
  to authenticated;

create or replace function public.update_leader_managed_teammate(
  p_event_id uuid,
  p_target_participant_id uuid,
  p_expected_version bigint,
  p_full_name text,
  p_email text
)
returns table (
  id uuid,
  full_name text,
  auth_email text,
  invite_code text,
  claimed boolean,
  invite_sent_at timestamptz,
  leader_managed boolean,
  invite_enabled boolean,
  claim_email_bound boolean,
  identity_version bigint
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.update_leader_managed_teammate(
    p_event_id,
    p_target_participant_id,
    p_expected_version,
    p_full_name,
    p_email
  );
$$;

revoke all on function public.update_leader_managed_teammate(uuid, uuid, bigint, text, text)
  from public, anon;
grant execute on function public.update_leader_managed_teammate(uuid, uuid, bigint, text, text)
  to authenticated;

-- Preserve the existing participant self-edit and admin rules while allowing
-- only the controlled leader RPC to change delegated identity/invite fields.
create or replace function public.guard_participant_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if old.claimed_by is null
     and new.claimed_by = auth.uid()
     and new.event_id is not distinct from old.event_id
     and new.is_admin is not distinct from old.is_admin
     and new.auth_email is not distinct from old.auth_email
     and new.invite_code is not distinct from old.invite_code
     and new.invite_sent_at is not distinct from old.invite_sent_at
     and new.leader_managed is not distinct from old.leader_managed
     and new.invite_enabled is not distinct from old.invite_enabled
     and new.claim_email_bound is not distinct from old.claim_email_bound
     and new.identity_version is not distinct from old.identity_version
  then
    return new;
  end if;

  if public.is_event_admin(old.event_id) then
    if new.event_id is distinct from old.event_id then
      raise exception 'Move registrations by creating one in the target event'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.claimed_by is null
     and private.managed_teammate_team(old.id, auth.uid()) is not null
     and new.claimed_by is not distinct from old.claimed_by
     and new.event_id is not distinct from old.event_id
     and new.handicap is not distinct from old.handicap
     and new.is_admin is not distinct from old.is_admin
     and new.username is not distinct from old.username
     and new.created_at is not distinct from old.created_at
     and new.leader_managed is not distinct from old.leader_managed
     and new.identity_version = old.identity_version + 1
  then
    return new;
  end if;

  if old.claimed_by <> auth.uid()
     or new.claimed_by is distinct from old.claimed_by
     or new.event_id is distinct from old.event_id
     or new.is_admin is distinct from old.is_admin
     or new.auth_email is distinct from old.auth_email
     or new.invite_code is distinct from old.invite_code
     or new.invite_sent_at is distinct from old.invite_sent_at
     or new.leader_managed is distinct from old.leader_managed
     or new.invite_enabled is distinct from old.invite_enabled
     or new.claim_email_bound is distinct from old.claim_email_bound
     or new.identity_version is distinct from old.identity_version
  then
    raise exception 'Only an event admin can change roster fields'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_participant_self_update() from public, anon, authenticated;

-- Keep no-email delegated placeholders unclaimable, and bind every email added
-- by a leader to that exact authenticated email address. Legacy invite rows
-- retain invite_enabled=true and claim_email_bound=false for deep-link safety.
create or replace function public.lookup_invite(code text)
returns table (auth_email text, claimed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select participant.auth_email, participant.claimed_by is not null
  from public.participants participant
  where upper(btrim(participant.invite_code)) = upper(btrim(code))
    and (participant.invite_enabled or participant.claimed_by is not null)
  limit 1;
$$;

revoke all on function public.lookup_invite(text) from public;
grant execute on function public.lookup_invite(text) to anon, authenticated;

create or replace function public.claim_event_invite(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
  actor_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before adding another event' using errcode = '42501';
  end if;

  select participant.* into target
  from public.participants participant
  where upper(btrim(participant.invite_code)) = upper(btrim(code))
    and (participant.invite_enabled or participant.claimed_by is not null)
  limit 1;

  if target.id is null then
    raise exception 'Invalid invite code';
  end if;
  if target.claimed_by = auth.uid() then
    return target.event_id;
  end if;
  if target.claimed_by is not null then
    raise exception 'This invite has already been claimed';
  end if;
  if exists (
    select 1 from public.participants registration
    where registration.event_id = target.event_id
      and registration.claimed_by = auth.uid()
  ) then
    raise exception 'This account is already registered for that event';
  end if;

  if target.claim_email_bound then
    select lower(account.email) into actor_email
    from auth.users account
    where account.id = auth.uid();
    if actor_email is distinct from lower(target.auth_email) then
      raise exception 'Sign in with the invited email address to claim this spot'
        using errcode = '42501';
    end if;
  end if;

  update public.participants
  set claimed_by = auth.uid()
  where id = target.id;

  insert into public.profiles (id, display_name)
  values (auth.uid(), target.full_name)
  on conflict (id) do nothing;

  return target.event_id;
end;
$$;

revoke all on function public.claim_event_invite(text) from public, anon;
grant execute on function public.claim_event_invite(text) to authenticated;

create or replace function public.prepare_invite_signup(code text, login text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text := upper(btrim(code));
  normalized_login text := lower(btrim(login));
  target public.participants%rowtype;
  next_email text;
  next_username text;
begin
  if normalized_code = '' or normalized_login = '' then
    raise exception 'Invite code and login are required';
  end if;

  select participant.* into target
  from public.participants participant
  where upper(btrim(participant.invite_code)) = normalized_code
    and participant.invite_enabled
  limit 1;

  if target.id is null then raise exception 'Invalid invite code'; end if;
  if target.claimed_by is not null then
    raise exception 'This invite has already been claimed. Sign in with your email or username.';
  end if;

  if target.claim_email_bound then
    if normalized_login is distinct from lower(target.auth_email) then
      raise exception 'Use the email address this invitation was sent to'
        using errcode = '42501';
    end if;
    next_email := lower(target.auth_email);
    next_username := null;
  elsif position('@' in normalized_login) > 0 then
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

  if exists (select 1 from auth.users account where lower(account.email) = next_email) then
    raise exception 'That account already exists. Sign in, then redeem this event invite.';
  end if;
  if next_username is not null and exists (
    select 1 from public.profiles profile where lower(profile.username) = next_username
  ) then
    raise exception 'That username is already taken';
  end if;

  if not target.claim_email_bound then
    update public.participants
    set auth_email = next_email,
        username = next_username
    where id = target.id;
  end if;

  return next_email;
end;
$$;

revoke all on function public.prepare_invite_signup(text, text) from public;
grant execute on function public.prepare_invite_signup(text, text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
begin
  select participant.* into target
  from public.participants participant
  where lower(participant.auth_email) = lower(new.email)
    and participant.claimed_by is null
    and participant.invite_enabled
  order by participant.created_at
  limit 1;

  if target.id is null then return new; end if;

  insert into public.profiles (id, display_name, username)
  values (new.id, target.full_name, target.username)
  on conflict (id) do update
    set display_name = coalesce(profiles.display_name, excluded.display_name),
        username = coalesce(profiles.username, excluded.username);

  update public.participants participant
  set claimed_by = new.id
  where lower(participant.auth_email) = lower(new.email)
    and participant.claimed_by is null
    and participant.invite_enabled;

  return new;
end;
$$;

-- Both the event admin and the one assigned team leader may request payloads,
-- but a leader receives only an unclaimed, delegated teammate on their team.
drop function if exists public.invite_payloads(uuid[]);
create function public.invite_payloads(participant_ids uuid[])
returns table (
  id uuid,
  event_id uuid,
  full_name text,
  auth_email text,
  invite_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before sending invites' using errcode = '42501';
  end if;
  if coalesce(array_length(participant_ids, 1), 0) = 0 then
    return;
  end if;
  if (
    select count(distinct participant.id)
    from public.participants participant
    where participant.id = any(participant_ids)
  ) <> (
    select count(distinct requested_id)
    from unnest(participant_ids) requested_id
  ) then
    raise exception 'One or more invite recipients were not found'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.participants participant
    where participant.id = any(participant_ids)
      and not public.is_event_admin(participant.event_id)
      and private.managed_teammate_team(participant.id, auth.uid()) is null
  ) then
    raise exception 'You cannot send one or more of these invites'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.participants participant
    where participant.id = any(participant_ids)
      and (
        not participant.invite_enabled
        or lower(participant.auth_email) like '%@invite.blurrygolf.app'
        or lower(participant.auth_email) like '%@invite.local'
        or (
          not public.is_event_admin(participant.event_id)
          and not participant.claim_email_bound
        )
      )
  ) then
    raise exception 'Add a valid teammate email before sending the invite'
      using errcode = '23514';
  end if;

  return query
    select
      participant.id,
      participant.event_id,
      participant.full_name,
      participant.auth_email,
      participant.invite_code
    from public.participants participant
    where participant.id = any(participant_ids);
end;
$$;

revoke all on function public.invite_payloads(uuid[]) from public, anon;
grant execute on function public.invite_payloads(uuid[]) to authenticated;

create or replace function public.mark_invites_sent(participant_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before sending invites' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.participants participant
    where participant.id = any(participant_ids)
      and not public.is_event_admin(participant.event_id)
      and private.managed_teammate_team(participant.id, auth.uid()) is null
  ) then
    raise exception 'You cannot mark one or more of these invites as sent'
      using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.participants participant
    where participant.id = any(participant_ids)
      and (
        not participant.invite_enabled
        or lower(participant.auth_email) like '%@invite.blurrygolf.app'
        or lower(participant.auth_email) like '%@invite.local'
        or (
          not public.is_event_admin(participant.event_id)
          and not participant.claim_email_bound
        )
      )
  ) then
    raise exception 'Add a valid teammate email before marking the invite as sent'
      using errcode = '23514';
  end if;

  update public.participants participant
  set invite_sent_at = now(),
      identity_version = participant.identity_version + 1
  where participant.id = any(participant_ids);
end;
$$;

revoke all on function public.mark_invites_sent(uuid[]) from public, anon;
grant execute on function public.mark_invites_sent(uuid[]) to authenticated;

-- Moving a leader out clears only that team's delegated identity role. Moving
-- or clearing a leader does not affect the participant's score permissions.
create or replace function public.assign_scoring_team_member(
  p_event_id uuid,
  p_participant_id uuid,
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_event_admin(p_event_id) then
    raise exception 'Only an event admin can change scoring teams'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from participants
    where id = p_participant_id and event_id = p_event_id
  ) then
    raise exception 'Participant does not belong to this event'
      using errcode = '23503';
  end if;
  if p_team_id is not null and not exists (
    select 1 from teams where id = p_team_id and event_id = p_event_id
  ) then
    raise exception 'Scoring team does not belong to this event'
      using errcode = '23503';
  end if;

  update teams scoring_team
  set individual_exception = false
  where scoring_team.individual_exception
    and exists (
      select 1 from team_members membership
      where membership.team_id = scoring_team.id
        and membership.participant_id = p_participant_id
    );
  update teams scoring_team
  set leader_participant_id = null
  where scoring_team.event_id = p_event_id
    and scoring_team.leader_participant_id = p_participant_id
    and scoring_team.id is distinct from p_team_id;
  delete from team_members where participant_id = p_participant_id;
  if p_team_id is not null then
    insert into team_members (team_id, participant_id)
    values (p_team_id, p_participant_id);
  end if;
end;
$$;

-- Preserve a leader only when the submitted arrangement keeps that person on
-- the same team. This extends the existing atomic assignment RPC shape.
create or replace function public.apply_team_assignments(p_event_id uuid, p_teams jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  target_team uuid;
  team_ids uuid[] := '{}'::uuid[];
  member_ids uuid[];
  required_size int;
  event_style game_style;
  exception_requested boolean;
begin
  if not is_event_admin(p_event_id) then
    raise exception 'Only an admin can change scoring teams' using errcode = '42501';
  end if;
  if jsonb_typeof(p_teams) is distinct from 'array' then
    raise exception 'p_teams must be a JSON array' using errcode = '22023';
  end if;
  select game_style into event_style from events where id = p_event_id;
  if event_style = 'solo' then
    raise exception 'Solo events do not use scoring teams' using errcode = '23514';
  end if;
  required_size := case when event_style = 'scramble_2' then 2 else 4 end;
  if exists (
    select member.value
    from jsonb_array_elements(p_teams) scoring_team
    cross join lateral jsonb_array_elements_text(
      coalesce(scoring_team.value->'member_ids', '[]'::jsonb)
    ) member
    group by member.value
    having count(*) > 1
  ) then
    raise exception 'A player cannot belong to more than one scoring team'
      using errcode = '23505';
  end if;

  update teams scoring_team
  set leader_participant_id = null
  where scoring_team.event_id = p_event_id
    and scoring_team.leader_participant_id is not null
    and not exists (
      select 1
      from jsonb_array_elements(p_teams) submitted
      where nullif(submitted.value->>'id', '')::uuid = scoring_team.id
        and scoring_team.leader_participant_id in (
          select member_id::uuid
          from jsonb_array_elements_text(
            coalesce(submitted.value->'member_ids', '[]'::jsonb)
          ) member_id
        )
    );

  update teams set individual_exception = false where event_id = p_event_id;
  delete from team_members membership
  using teams scoring_team
  where membership.team_id = scoring_team.id
    and scoring_team.event_id = p_event_id;

  for entry in select value from jsonb_array_elements(p_teams)
  loop
    member_ids := array(
      select value::uuid
      from jsonb_array_elements_text(coalesce(entry->'member_ids', '[]'::jsonb))
    );
    exception_requested := coalesce((entry->>'individual_exception')::boolean, false);
    if coalesce(array_length(member_ids, 1), 0) > required_size then
      raise exception 'Scoring team exceeds the selected game format capacity'
        using errcode = '23514';
    end if;
    if exception_requested and coalesce(array_length(member_ids, 1), 0) <> 1 then
      raise exception 'An individual exception must have exactly one member'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from unnest(member_ids) member_id
      where not exists (
        select 1 from participants participant
        where participant.id = member_id and participant.event_id = p_event_id
      )
    ) then
      raise exception 'Every scoring-team member must belong to this event'
        using errcode = '23503';
    end if;

    target_team := nullif(entry->>'id', '')::uuid;
    if target_team is null then
      insert into teams (event_id, name, tee_time, starting_hole, cart)
      values (
        p_event_id,
        coalesce(nullif(entry->>'name', ''), 'Team'),
        entry->>'tee_time',
        (entry->>'starting_hole')::int,
        entry->>'cart'
      ) returning id into target_team;
    else
      update teams
      set name = coalesce(nullif(entry->>'name', ''), teams.name),
          tee_time = entry->>'tee_time',
          starting_hole = (entry->>'starting_hole')::int,
          cart = entry->>'cart'
      where id = target_team and event_id = p_event_id;
      if not found then
        raise exception 'Scoring team % is not part of this event', target_team
          using errcode = '23503';
      end if;
    end if;

    team_ids := team_ids || target_team;
    insert into team_members (team_id, participant_id)
    select target_team, member_id from unnest(member_ids) member_id;
    update teams
    set individual_exception = exception_requested
    where id = target_team;
  end loop;

  delete from teams
  where event_id = p_event_id
    and (array_length(team_ids, 1) is null or not (id = any(team_ids)));
  return team_ids;
end;
$$;

-- Do not redefine can_write_round or submit_offline_score here: their existing
-- team-membership/admin authorization is intentionally preserved.

notify pgrst, 'reload schema';
