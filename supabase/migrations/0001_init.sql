-- Blurry Invitational — initial schema
-- Single-event app. Participants are pre-seeded from the paid list and claim
-- their account with an invite code plus a password they choose.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Event
-- ---------------------------------------------------------------------------

create type game_style as enum ('solo', 'scramble_2', 'scramble_4');

create table events (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  course_name   text        not null,
  -- Postal address, so the app can hand players a Directions link.
  address_line  text        not null default '',
  city          text        not null default '',
  state         text        not null default '',
  postal_code   text        not null default '',
  event_date    date        not null,
  check_in_time text        not null default '7:00 AM',
  game_style    game_style  not null default 'scramble_4',
  created_at    timestamptz not null default now()
);

create table holes (
  event_id uuid not null references events(id) on delete cascade,
  hole     int  not null check (hole between 1 and 18),
  par      int  not null check (par between 3 and 6),
  yards    int  not null,
  primary key (event_id, hole)
);

-- ---------------------------------------------------------------------------
-- Participants (your paid list) and their app profiles
-- ---------------------------------------------------------------------------

create table participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  full_name   text not null,
  -- Email used for Supabase auth. Real address when you have one, otherwise a
  -- synthetic <code>@invite.local so invite-code-only signup still works.
  auth_email  text not null unique,
  -- Generated server-side so the roster screen can add a participant without
  -- inventing a code, and so codes stay unguessable.
  invite_code text not null unique
                default 'BI-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  handicap    numeric(4,1),
  is_admin    boolean not null default false,
  claimed_by  uuid unique references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index participants_event_idx on participants(event_id);

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------

create table teams (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  name          text not null,
  tee_time      text,
  starting_hole int check (starting_hole between 1 and 18),
  cart          text,
  created_at    timestamptz not null default now()
);

create index teams_event_idx on teams(event_id);

create table team_members (
  team_id        uuid not null references teams(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  primary key (team_id, participant_id),
  -- A participant can only sit on one team per event.
  unique (participant_id)
);

create table team_invites (
  id                     uuid primary key default gen_random_uuid(),
  team_id                uuid not null references teams(id) on delete cascade,
  invited_participant_id uuid not null references participants(id) on delete cascade,
  invited_by             uuid not null references participants(id) on delete cascade,
  status                 text not null default 'pending'
                           check (status in ('pending', 'accepted', 'declined')),
  created_at             timestamptz not null default now(),
  unique (team_id, invited_participant_id)
);

-- ---------------------------------------------------------------------------
-- Rounds and scores
-- ---------------------------------------------------------------------------

-- One round per team under a scramble, or per participant under solo.
create table rounds (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  team_id        uuid references teams(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  status         text not null default 'in_progress'
                   check (status in ('in_progress', 'complete')),
  created_at     timestamptz not null default now(),
  -- Exactly one owner.
  check (num_nonnulls(team_id, participant_id) = 1)
);

create unique index rounds_team_uniq on rounds(event_id, team_id)
  where team_id is not null;
create unique index rounds_participant_uniq on rounds(event_id, participant_id)
  where participant_id is not null;

create table scores (
  round_id          uuid not null references rounds(id) on delete cascade,
  hole              int  not null check (hole between 1 and 18),
  strokes           int  not null check (strokes between 1 and 20),
  -- Set by the device that entered the score. Used to resolve offline conflicts
  -- last-write-wins, so a phone that was in airplane mode can't clobber a
  -- newer score entered by a teammate.
  client_updated_at timestamptz not null default now(),
  entered_by        uuid references participants(id) on delete set null,
  primary key (round_id, hole)
);

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

create table announcements (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  body       text not null,
  created_by uuid references participants(id) on delete set null,
  created_at timestamptz not null default now()
);

create index announcements_event_idx on announcements(event_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

create table conversations (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  kind       text not null check (kind in ('event_group', 'group', 'direct')),
  name       text,
  created_by uuid references participants(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Only one all-hands conversation per event.
create unique index conversations_event_group_uniq on conversations(event_id)
  where kind = 'event_group';

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  participant_id  uuid not null references participants(id) on delete cascade,
  last_read_at    timestamptz,
  primary key (conversation_id, participant_id)
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references participants(id) on delete cascade,
  body            text not null,
  -- Client-generated so an offline send retried on reconnect can't duplicate.
  client_id       uuid not null unique,
  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on messages(conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The participant row belonging to the caller.
create or replace function current_participant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from participants where claimed_by = auth.uid() limit 1;
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from participants where claimed_by = auth.uid() limit 1),
    false
  );
$$;

-- Membership check for chat policies. SECURITY DEFINER on purpose: reading
-- conversation_members from inside a policy on conversation_members would
-- recurse infinitely (42P17), so this bypasses RLS to break the cycle.
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

-- Participants on the same team as the caller may edit that team's round.
create or replace function can_write_round(target_round uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from rounds r
    left join team_members tm on tm.team_id = r.team_id
    where r.id = target_round
      and (
        tm.participant_id = current_participant_id()
        or r.participant_id = current_participant_id()
      )
  ) or is_admin();
$$;

-- ---------------------------------------------------------------------------
-- Invite redemption
-- ---------------------------------------------------------------------------

-- Returns the auth email for an invite code so the client can sign up or sign
-- in with it. Deliberately narrow: no names, no admin flags, no participant id.
-- Invite codes must be long and random — this is reachable by anonymous callers.
create or replace function lookup_invite(code text)
returns table (auth_email text, claimed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.auth_email, p.claimed_by is not null
  from participants p
  where upper(trim(p.invite_code)) = upper(trim(code))
  limit 1;
$$;

revoke all on function lookup_invite(text) from public;
grant execute on function lookup_invite(text) to anon, authenticated;

-- On signup, link the new auth user to their pre-seeded participant row,
-- create their profile, and drop them into the event group chat.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_participant participants;
  group_convo uuid;
begin
  select * into target_participant
  from participants
  where auth_email = new.email and claimed_by is null
  limit 1;

  if target_participant.id is null then
    -- Not on the paid list (or already claimed); leave the user unlinked.
    return new;
  end if;

  update participants
     set claimed_by = new.id
   where id = target_participant.id;

  insert into profiles (id, display_name)
  values (new.id, target_participant.full_name)
  on conflict (id) do nothing;

  select id into group_convo
  from conversations
  where event_id = target_participant.event_id and kind = 'event_group'
  limit 1;

  if group_convo is not null then
    insert into conversation_members (conversation_id, participant_id)
    values (group_convo, target_participant.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Every participant added to the roster (CSV import, manual add, or seed) joins
-- the all-hands conversation automatically.
create or replace function add_participant_to_event_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  group_convo uuid;
begin
  select id into group_convo
  from conversations
  where event_id = new.event_id and kind = 'event_group'
  limit 1;

  if group_convo is not null then
    insert into conversation_members (conversation_id, participant_id)
    values (group_convo, new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger on_participant_created
  after insert on participants
  for each row execute function add_participant_to_event_chat();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table events               enable row level security;
alter table holes                enable row level security;
alter table participants         enable row level security;
alter table profiles             enable row level security;
alter table teams                enable row level security;
alter table team_members         enable row level security;
alter table team_invites         enable row level security;
alter table rounds               enable row level security;
alter table scores               enable row level security;
alter table announcements        enable row level security;
alter table conversations        enable row level security;
alter table conversation_members enable row level security;
alter table messages             enable row level security;

-- Everything below requires a claimed participant, so unclaimed auth users
-- (someone who signed up with an email not on the list) see nothing.

create policy "participants read event" on events
  for select using (current_participant_id() is not null);
create policy "admins update event" on events
  for update using (is_admin());

create policy "participants read holes" on holes
  for select using (current_participant_id() is not null);
create policy "admins write holes" on holes
  for all using (is_admin());

create policy "participants read roster" on participants
  for select using (current_participant_id() is not null);
create policy "admins write roster" on participants
  for all using (is_admin());
create policy "update own participant" on participants
  for update using (claimed_by = auth.uid());

create policy "read profiles" on profiles
  for select using (current_participant_id() is not null);
create policy "write own profile" on profiles
  for all using (id = auth.uid());

create policy "participants read teams" on teams
  for select using (current_participant_id() is not null);
create policy "admins write teams" on teams
  for all using (is_admin());

create policy "participants read team members" on team_members
  for select using (current_participant_id() is not null);
create policy "admins write team members" on team_members
  for all using (is_admin());
-- Accepting an invite adds you to that team.
create policy "join team via invite" on team_members
  for insert with check (
    participant_id = current_participant_id()
    and exists (
      select 1 from team_invites ti
      where ti.team_id = team_members.team_id
        and ti.invited_participant_id = current_participant_id()
        and ti.status = 'accepted'
    )
  );

create policy "participants read invites" on team_invites
  for select using (current_participant_id() is not null);
-- Any member of a team may invite others to it.
create policy "team members create invites" on team_invites
  for insert with check (
    invited_by = current_participant_id()
    and exists (
      select 1 from team_members tm
      where tm.team_id = team_invites.team_id
        and tm.participant_id = current_participant_id()
    )
  );
create policy "invitee responds" on team_invites
  for update using (invited_participant_id = current_participant_id() or is_admin());
create policy "admins manage invites" on team_invites
  for all using (is_admin());

create policy "participants read rounds" on rounds
  for select using (current_participant_id() is not null);
create policy "participants create own round" on rounds
  for insert with check (
    is_admin()
    or participant_id = current_participant_id()
    or exists (
      select 1 from team_members tm
      where tm.team_id = rounds.team_id
        and tm.participant_id = current_participant_id()
    )
  );
create policy "round owners update" on rounds
  for update using (can_write_round(id));

create policy "participants read scores" on scores
  for select using (current_participant_id() is not null);
create policy "round owners write scores" on scores
  for all using (can_write_round(round_id))
  with check (can_write_round(round_id));

create policy "participants read announcements" on announcements
  for select using (current_participant_id() is not null);
create policy "admins write announcements" on announcements
  for all using (is_admin());

create policy "members read conversations" on conversations
  for select using (is_conversation_member(id));
create policy "participants create conversations" on conversations
  for insert with check (created_by = current_participant_id());

create policy "members read membership" on conversation_members
  for select using (
    participant_id = current_participant_id()
    or is_conversation_member(conversation_id)
  );
create policy "add conversation members" on conversation_members
  for insert with check (current_participant_id() is not null);
create policy "update own membership" on conversation_members
  for update using (participant_id = current_participant_id());

create policy "members read messages" on messages
  for select using (is_conversation_member(conversation_id));
create policy "members send messages" on messages
  for insert with check (
    sender_id = current_participant_id()
    and is_conversation_member(conversation_id)
  );

-- Realtime for live leaderboard and chat.
alter publication supabase_realtime add table scores;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table announcements;
