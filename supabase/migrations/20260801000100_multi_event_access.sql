-- Multi-event account and permission foundation.
--
-- Profiles are account-level. Participants remain event registrations. Every
-- permission below derives an event explicitly; no policy may use the legacy
-- first/current-participant helpers to choose one implicitly.

-- ---------------------------------------------------------------------------
-- Account + registration shape
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_lifecycle_status') then
    create type event_lifecycle_status as enum (
      'draft',
      'published',
      'live',
      'completed',
      'archived'
    );
  end if;
end
$$;

alter table events
  add column if not exists lifecycle_status event_lifecycle_status
    not null default 'published';

alter table profiles
  add column if not exists username text,
  add column if not exists is_club_admin boolean not null default false;

-- Existing usernames belonged to the account in practice. Move their source of
-- truth to profiles before allowing one account to own several registrations.
update profiles profile
set username = registration.username
from (
  select distinct on (claimed_by) claimed_by, username
  from participants
  where claimed_by is not null and username is not null
  order by claimed_by, created_at
) registration
where profile.id = registration.claimed_by
  and profile.username is null;

create unique index if not exists profiles_username_lower_uniq
  on profiles (lower(username))
  where username is not null;

alter table participants
  drop constraint if exists participants_auth_email_key,
  drop constraint if exists participants_claimed_by_key,
  drop constraint if exists participants_username_key;

create index if not exists participants_claimed_by_idx
  on participants (claimed_by)
  where claimed_by is not null;

create unique index if not exists participants_event_account_uniq
  on participants (event_id, claimed_by)
  where claimed_by is not null;

create unique index if not exists participants_event_auth_email_uniq
  on participants (event_id, lower(auth_email));

-- Realtime rows need an event column because Postgres Changes filters cannot
-- join through conversations/messages. The guard below keeps these denormalised
-- values identical to their parent event.
alter table scores add column if not exists event_id uuid references events(id);
update scores score
set event_id = round.event_id
from rounds round
where round.id = score.round_id and score.event_id is null;
alter table scores alter column event_id set not null;
create index if not exists scores_event_idx on scores (event_id, client_updated_at desc);
-- Event-filtered DELETE notifications need the old row's event_id too.
alter table scores replica identity full;

alter table messages add column if not exists event_id uuid references events(id);
alter table messages disable trigger messages_guard_actions;
update messages message
set event_id = conversation.event_id
from conversations conversation
where conversation.id = message.conversation_id
  and message.event_id is null;
alter table messages enable trigger messages_guard_actions;
alter table messages alter column event_id set not null;
create index if not exists messages_event_idx
  on messages (event_id, created_at desc);

alter table message_reactions
  add column if not exists event_id uuid references events(id);
update message_reactions reaction
set event_id = message.event_id
from messages message
where message.id = reaction.message_id
  and reaction.event_id is null;
alter table message_reactions alter column event_id set not null;
create index if not exists message_reactions_event_idx
  on message_reactions (event_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Explicit event/account helpers
-- ---------------------------------------------------------------------------

create or replace function is_club_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select profile.is_club_admin from profiles profile where profile.id = auth.uid()),
    false
  );
$$;

create or replace function event_participant_id(target_event uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select registration.id
  from participants registration
  where registration.event_id = target_event
    and registration.claimed_by = auth.uid()
  limit 1;
$$;

create or replace function has_event_access(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_club_admin() or exists (
    select 1
    from participants registration
    where registration.event_id = target_event
      and registration.claimed_by = auth.uid()
  );
$$;

create or replace function is_event_admin(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_club_admin() or coalesce(
    (
      select registration.is_admin
      from participants registration
      where registration.event_id = target_event
        and registration.claimed_by = auth.uid()
      limit 1
    ),
    false
  );
$$;

-- Compatibility helpers fail closed for accounts with more than one event.
-- All new policies and RPCs use their event-parameterized counterparts above.
create or replace function current_participant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) = 1 then (array_agg(id order by id))[1] else null end
  from participants
  where claimed_by = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_club_admin() or coalesce(
    (
      select bool_and(registration.is_admin)
      from participants registration
      where registration.claimed_by = auth.uid()
      having count(*) = 1
    ),
    false
  );
$$;

create or replace function team_event_id(target_team uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select event_id from teams where id = target_team $$;

create or replace function round_event_id(target_round uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select event_id from rounds where id = target_round $$;

create or replace function conversation_event_id(target_conversation uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select event_id from conversations where id = target_conversation $$;

create or replace function message_event_id(target_message uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select event_id from messages where id = target_message $$;

create or replace function is_conversation_member(convo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from conversations conversation
    join conversation_members membership
      on membership.conversation_id = conversation.id
    where conversation.id = convo
      and membership.participant_id = event_participant_id(conversation.event_id)
  );
$$;

create or replace function can_write_round(target_round uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from rounds round
    left join team_members membership on membership.team_id = round.team_id
    where round.id = target_round
      and (
        is_event_admin(round.event_id)
        or membership.participant_id = event_participant_id(round.event_id)
        or round.participant_id = event_participant_id(round.event_id)
      )
  );
$$;

create or replace function can_read_profile(target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_profile = auth.uid()
    or is_club_admin()
    or exists (
      select 1
      from participants target_registration
      join participants my_registration
        on my_registration.event_id = target_registration.event_id
      where target_registration.claimed_by = target_profile
        and my_registration.claimed_by = auth.uid()
    );
$$;

revoke all on function is_club_admin() from public;
revoke all on function event_participant_id(uuid) from public;
revoke all on function has_event_access(uuid) from public;
revoke all on function is_event_admin(uuid) from public;
revoke all on function team_event_id(uuid) from public;
revoke all on function round_event_id(uuid) from public;
revoke all on function conversation_event_id(uuid) from public;
revoke all on function message_event_id(uuid) from public;
revoke all on function can_read_profile(uuid) from public;
revoke all on function is_conversation_member(uuid) from public;
revoke all on function can_write_round(uuid) from public;
revoke all on function is_managed_conversation(uuid) from public;
grant execute on function is_club_admin() to authenticated;
grant execute on function event_participant_id(uuid) to authenticated;
grant execute on function has_event_access(uuid) to authenticated;
grant execute on function is_event_admin(uuid) to authenticated;
grant execute on function team_event_id(uuid) to authenticated;
grant execute on function round_event_id(uuid) to authenticated;
grant execute on function conversation_event_id(uuid) to authenticated;
grant execute on function message_event_id(uuid) to authenticated;
grant execute on function can_read_profile(uuid) to authenticated;
grant execute on function is_conversation_member(uuid) to authenticated;
grant execute on function can_write_round(uuid) to authenticated;
grant execute on function is_managed_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cross-table event integrity
-- ---------------------------------------------------------------------------

create or replace function guard_event_scope_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_event uuid;
  related_event uuid;
begin
  if tg_table_name = 'team_members' then
    select event_id into parent_event from teams where id = new.team_id;
    select event_id into related_event from participants where id = new.participant_id;
  elsif tg_table_name = 'team_invites' then
    select event_id into parent_event from teams where id = new.team_id;
    if not exists (
      select 1 from participants
      where id in (new.invited_participant_id, new.invited_by)
        and event_id = parent_event
      group by event_id having count(*) = 2
    ) then
      raise exception 'Team invites cannot cross events' using errcode = '23514';
    end if;
    return new;
  elsif tg_table_name = 'rounds' then
    parent_event := new.event_id;
    if new.team_id is not null then
      select event_id into related_event from teams where id = new.team_id;
    else
      select event_id into related_event from participants where id = new.participant_id;
    end if;
  elsif tg_table_name = 'scores' then
    select event_id into parent_event from rounds where id = new.round_id;
    if new.event_id is null then new.event_id := parent_event; end if;
    if new.event_id is distinct from parent_event then
      raise exception 'Score event does not match its round' using errcode = '23514';
    end if;
    if new.entered_by is null then return new; end if;
    select event_id into related_event from participants where id = new.entered_by;
  elsif tg_table_name = 'announcements' then
    parent_event := new.event_id;
    if new.created_by is null then return new; end if;
    select event_id into related_event from participants where id = new.created_by;
  elsif tg_table_name = 'conversations' then
    parent_event := new.event_id;
    if new.created_by is not null then
      select event_id into related_event from participants where id = new.created_by;
    elsif new.team_id is not null then
      select event_id into related_event from teams where id = new.team_id;
    else
      return new;
    end if;
  elsif tg_table_name = 'conversation_members' then
    select event_id into parent_event from conversations where id = new.conversation_id;
    select event_id into related_event from participants where id = new.participant_id;
  elsif tg_table_name = 'messages' then
    select event_id into parent_event from conversations where id = new.conversation_id;
    select event_id into related_event from participants where id = new.sender_id;
    if new.event_id is null then new.event_id := parent_event; end if;
    if new.event_id is distinct from parent_event then
      raise exception 'Message event does not match its conversation' using errcode = '23514';
    end if;
  elsif tg_table_name = 'message_reactions' then
    select event_id into parent_event from messages where id = new.message_id;
    select event_id into related_event from participants where id = new.participant_id;
    if new.event_id is null then new.event_id := parent_event; end if;
    if new.event_id is distinct from parent_event then
      raise exception 'Reaction event does not match its message' using errcode = '23514';
    end if;
  end if;

  if parent_event is null or related_event is null or parent_event <> related_event then
    raise exception '% rows cannot cross events', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function guard_event_scope_integrity()
  from public, anon, authenticated;

-- A row is moved between events by recreating it, never by changing event_id
-- in place. Otherwise club admins could strand child rows under another event
-- without firing those children's integrity triggers.
create or replace function guard_event_id_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception '% rows cannot move between events', tg_table_name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function guard_event_id_immutable()
  from public, anon, authenticated;

drop trigger if exists holes_event_id_immutable on holes;
create trigger holes_event_id_immutable before update on holes
  for each row execute function guard_event_id_immutable();
drop trigger if exists participants_event_id_immutable on participants;
create trigger participants_event_id_immutable before update on participants
  for each row execute function guard_event_id_immutable();
drop trigger if exists teams_event_id_immutable on teams;
create trigger teams_event_id_immutable before update on teams
  for each row execute function guard_event_id_immutable();
drop trigger if exists rounds_event_id_immutable on rounds;
create trigger rounds_event_id_immutable before update on rounds
  for each row execute function guard_event_id_immutable();
drop trigger if exists scores_event_id_immutable on scores;
create trigger scores_event_id_immutable before update on scores
  for each row execute function guard_event_id_immutable();
drop trigger if exists announcements_event_id_immutable on announcements;
create trigger announcements_event_id_immutable before update on announcements
  for each row execute function guard_event_id_immutable();
drop trigger if exists conversations_event_id_immutable on conversations;
create trigger conversations_event_id_immutable before update on conversations
  for each row execute function guard_event_id_immutable();
drop trigger if exists messages_event_id_immutable on messages;
create trigger messages_event_id_immutable before update on messages
  for each row execute function guard_event_id_immutable();
drop trigger if exists message_reactions_event_id_immutable on message_reactions;
create trigger message_reactions_event_id_immutable before update on message_reactions
  for each row execute function guard_event_id_immutable();

drop trigger if exists team_members_event_scope on team_members;
create trigger team_members_event_scope before insert or update on team_members
  for each row execute function guard_event_scope_integrity();
drop trigger if exists team_invites_event_scope on team_invites;
create trigger team_invites_event_scope before insert or update on team_invites
  for each row execute function guard_event_scope_integrity();
drop trigger if exists rounds_event_scope on rounds;
create trigger rounds_event_scope before insert or update on rounds
  for each row execute function guard_event_scope_integrity();
drop trigger if exists scores_event_scope on scores;
create trigger scores_event_scope before insert or update on scores
  for each row execute function guard_event_scope_integrity();
drop trigger if exists announcements_event_scope on announcements;
create trigger announcements_event_scope before insert or update on announcements
  for each row execute function guard_event_scope_integrity();
drop trigger if exists conversations_event_scope on conversations;
create trigger conversations_event_scope before insert or update on conversations
  for each row execute function guard_event_scope_integrity();
drop trigger if exists conversation_members_event_scope on conversation_members;
create trigger conversation_members_event_scope before insert or update on conversation_members
  for each row execute function guard_event_scope_integrity();
drop trigger if exists messages_event_scope on messages;
create trigger messages_event_scope before insert or update on messages
  for each row execute function guard_event_scope_integrity();
drop trigger if exists message_reactions_event_scope on message_reactions;
create trigger message_reactions_event_scope before insert or update on message_reactions
  for each row execute function guard_event_scope_integrity();

-- Prevent account owners from promoting themselves to club admin.
create or replace function guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or is_club_admin() then return new; end if;
  if tg_op = 'INSERT' and new.is_club_admin then
    raise exception 'Only a club admin can change club access' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.is_club_admin is distinct from old.is_club_admin then
    raise exception 'Only a club admin can change club access' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on profiles;
create trigger profiles_guard_privileges before insert or update on profiles
  for each row execute function guard_profile_privileges();
revoke all on function guard_profile_privileges() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Strict event-scoped RLS
-- ---------------------------------------------------------------------------

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'events', 'holes', 'participants', 'profiles', 'teams',
        'team_members', 'team_invites', 'rounds', 'scores', 'announcements',
        'conversations', 'conversation_members', 'messages', 'message_reactions'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

create policy "account reads accessible events" on events
  for select to authenticated using (has_event_access(id));
create policy "club admins create events" on events
  for insert to authenticated with check (is_club_admin());
create policy "event admins update events" on events
  for update to authenticated using (is_event_admin(id)) with check (is_event_admin(id));
create policy "club admins delete events" on events
  for delete to authenticated using (is_club_admin());

create policy "account reads event holes" on holes
  for select to authenticated using (has_event_access(event_id));
create policy "event admins manage holes" on holes
  for all to authenticated using (is_event_admin(event_id)) with check (is_event_admin(event_id));

create policy "account reads event roster" on participants
  for select to authenticated using (has_event_access(event_id));
create policy "event admins manage roster" on participants
  for all to authenticated using (is_event_admin(event_id)) with check (is_event_admin(event_id));
create policy "account updates own registration" on participants
  for update to authenticated
  using (claimed_by = auth.uid())
  with check (claimed_by = auth.uid());

create policy "account reads shared profiles" on profiles
  for select to authenticated using (can_read_profile(id));
create policy "account inserts own profile" on profiles
  for insert to authenticated with check (id = auth.uid());
create policy "account updates own profile" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "club admins manage profiles" on profiles
  for all to authenticated using (is_club_admin()) with check (is_club_admin());

create policy "account reads event teams" on teams
  for select to authenticated using (has_event_access(event_id));
create policy "event admins manage teams" on teams
  for all to authenticated using (is_event_admin(event_id)) with check (is_event_admin(event_id));

create policy "account reads event team members" on team_members
  for select to authenticated using (has_event_access(team_event_id(team_id)));
create policy "event admins manage team members" on team_members
  for all to authenticated
  using (is_event_admin(team_event_id(team_id)))
  with check (is_event_admin(team_event_id(team_id)));
create policy "invitee joins event team" on team_members
  for insert to authenticated with check (
    participant_id = event_participant_id(team_event_id(team_id))
    and exists (
      select 1 from team_invites invite
      where invite.team_id = team_members.team_id
        and invite.invited_participant_id = team_members.participant_id
        and invite.status = 'accepted'
    )
  );

create policy "account reads event team invites" on team_invites
  for select to authenticated using (has_event_access(team_event_id(team_id)));
create policy "team members create event invites" on team_invites
  for insert to authenticated with check (
    invited_by = event_participant_id(team_event_id(team_id))
    and exists (
      select 1 from team_members membership
      where membership.team_id = team_invites.team_id
        and membership.participant_id = event_participant_id(team_event_id(team_invites.team_id))
    )
  );
create policy "invitee responds in event" on team_invites
  for update to authenticated
  using (
    invited_participant_id = event_participant_id(team_event_id(team_id))
    or is_event_admin(team_event_id(team_id))
  )
  with check (
    invited_participant_id = event_participant_id(team_event_id(team_id))
    or is_event_admin(team_event_id(team_id))
  );
create policy "event admins manage team invites" on team_invites
  for all to authenticated
  using (is_event_admin(team_event_id(team_id)))
  with check (is_event_admin(team_event_id(team_id)));

create policy "account reads event rounds" on rounds
  for select to authenticated using (has_event_access(event_id));
create policy "round owners create event rounds" on rounds
  for insert to authenticated with check (
    is_event_admin(event_id)
    or participant_id = event_participant_id(event_id)
    or exists (
      select 1 from team_members membership
      where membership.team_id = rounds.team_id
        and membership.participant_id = event_participant_id(rounds.event_id)
    )
  );
create policy "round owners update event rounds" on rounds
  for update to authenticated using (can_write_round(id)) with check (can_write_round(id));
create policy "event admins delete rounds" on rounds
  for delete to authenticated using (is_event_admin(event_id));

create policy "account reads event scores" on scores
  for select to authenticated using (has_event_access(round_event_id(round_id)));
create policy "round owners write event scores" on scores
  for all to authenticated using (can_write_round(round_id)) with check (can_write_round(round_id));

create policy "account reads event announcements" on announcements
  for select to authenticated using (has_event_access(event_id));
create policy "event admins manage announcements" on announcements
  for all to authenticated using (is_event_admin(event_id)) with check (is_event_admin(event_id));

create policy "members read event conversations" on conversations
  for select to authenticated using (is_conversation_member(id));
create policy "participants create event conversations" on conversations
  for insert to authenticated with check (
    created_by = event_participant_id(event_id)
  );

create policy "members read event memberships" on conversation_members
  for select to authenticated using (
    participant_id = event_participant_id(conversation_event_id(conversation_id))
    or is_conversation_member(conversation_id)
  );
create policy "members add unmanaged event memberships" on conversation_members
  for insert to authenticated with check (
    is_conversation_member(conversation_id)
    and not is_managed_conversation(conversation_id)
  );
create policy "members update own event membership" on conversation_members
  for update to authenticated
  using (participant_id = event_participant_id(conversation_event_id(conversation_id)))
  with check (participant_id = event_participant_id(conversation_event_id(conversation_id)));
create policy "members leave unmanaged event conversations" on conversation_members
  for delete to authenticated using (
    participant_id = event_participant_id(conversation_event_id(conversation_id))
    and not is_managed_conversation(conversation_id)
  );

create policy "members read event messages" on messages
  for select to authenticated using (is_conversation_member(conversation_id));
create policy "members send event messages" on messages
  for insert to authenticated with check (
    sender_id = event_participant_id(event_id)
    and event_id = conversation_event_id(conversation_id)
    and is_conversation_member(conversation_id)
  );
create policy "senders edit event messages" on messages
  for update to authenticated
  using (
    sender_id = event_participant_id(event_id)
    and is_conversation_member(conversation_id)
  )
  with check (
    sender_id = event_participant_id(event_id)
    and is_conversation_member(conversation_id)
  );
create policy "senders unsend event messages" on messages
  for delete to authenticated using (
    sender_id = event_participant_id(event_id)
    and is_conversation_member(conversation_id)
  );

create policy "members read event reactions" on message_reactions
  for select to authenticated using (
    event_id = message_event_id(message_id)
    and exists (
      select 1 from messages message
      where message.id = message_reactions.message_id
        and is_conversation_member(message.conversation_id)
    )
  );
create policy "members add own event reactions" on message_reactions
  for insert to authenticated with check (
    participant_id = event_participant_id(event_id)
    and event_id = message_event_id(message_id)
    and exists (
      select 1 from messages message
      where message.id = message_reactions.message_id
        and is_conversation_member(message.conversation_id)
    )
  );
create policy "members remove own event reactions" on message_reactions
  for delete to authenticated using (
    participant_id = event_participant_id(event_id)
    and event_id = message_event_id(message_id)
    and exists (
      select 1 from messages message
      where message.id = message_reactions.message_id
        and is_conversation_member(message.conversation_id)
    )
  );

-- New course-map objects are namespaced course/<event id>/..., allowing the
-- storage policy to authorize the exact event. Existing public URLs keep
-- working; only future writes use the stricter path.
drop policy if exists "admins write course map" on storage.objects;
create policy "event admins write scoped course map" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'event-media'
    and (storage.foldername(name))[1] = 'course'
    and exists (
      select 1 from events event
      where event.id::text = (storage.foldername(name))[2]
        and is_event_admin(event.id)
    )
  )
  with check (
    bucket_id = 'event-media'
    and (storage.foldername(name))[1] = 'course'
    and exists (
      select 1 from events event
      where event.id::text = (storage.foldername(name))[2]
        and is_event_admin(event.id)
    )
  );
