-- Seed the Blurry Invitational.
-- Safe to re-run: it no-ops if the event already exists.
--
-- REPLACE THE ROSTER BELOW with your real paid-participant list before you send
-- invites. Keep the shape; just swap names and (optionally) real email addresses.

do $$
declare
  ev        uuid;
  convo     uuid;
  team_ids  uuid[];
  roster    text[] := array[
    -- full name          | handicap | admin | real email (or '' for none)
    'Vel Monroe|4.7|true|',
    'Jake Halvorsen|9.8|false|',
    'Ryan Jessop|11.2|false|',
    'Matt Kimball|5.4|false|',
    'Jordan Reed|4.2|false|',
    'Marcus Thorne|7.1|false|',
    'Ethan Vance|12.3|false|',
    'Avery Brooks|2.9|false|',
    'Maya Gomez|8.4|false|',
    'Marco Silva|11.6|false|',
    'Noah Kim|6.8|false|',
    'Cole Rivera|14.1|false|',
    'Drew Sable|3.6|false|',
    'Ellis Pratt|10.2|false|',
    'Grant Mullen|15.7|false|',
    'Wes Tanner|8.9|false|'
  ];
  entry     text;
  parts     text[];
  code      text;
  email     text;
  pid       uuid;
  idx       int := 0;
  pars      int[] := array[5,4,3,3,5,5,4,4,3,4,5,3,4,4,3,3,5,5];
  yards     int[] := array[520,410,175,168,545,530,428,402,155,415,538,182,420,395,160,148,512,550];
  h         int;
begin
  select id into ev from events where name = 'Blurry Invitational' limit 1;
  if ev is not null then
    raise notice 'Event already seeded (%). Nothing to do.', ev;
    return;
  end if;

  -- Date, times, and address here are placeholders; an admin sets the real
  -- values in Event Details once the app is running.
  insert into events (name, course_name, city, state, event_date, check_in_time, game_style)
  values ('Blurry Invitational', 'Arrowhead Golf Club', 'Littleton', 'CO',
          '2026-08-24', '7:00 AM', 'scramble_4')
  returning id into ev;

  -- Course card
  for h in 1..18 loop
    insert into holes (event_id, hole, par, yards)
    values (ev, h, pars[h], yards[h]);
  end loop;

  -- All-hands conversation. New signups are added by the auth trigger.
  insert into conversations (event_id, kind, name)
  values (ev, 'event_group', 'Blurry Invitational')
  returning id into convo;

  -- Four teams
  insert into teams (event_id, name, tee_time, starting_hole, cart) values
    (ev, 'Team 4',          '8:40 AM', 1, 'Cart 14'),
    (ev, 'The Turn Dogs',   '8:20 AM', 1, 'Cart 11'),
    (ev, 'Sunday Service',  '8:30 AM', 1, 'Cart 12'),
    (ev, 'Green Jackets',   '8:50 AM', 1, 'Cart 13');

  -- Explicit order so roster position maps predictably onto teams.
  team_ids := array[
    (select id from teams where event_id = ev and name = 'Team 4'),
    (select id from teams where event_id = ev and name = 'The Turn Dogs'),
    (select id from teams where event_id = ev and name = 'Sunday Service'),
    (select id from teams where event_id = ev and name = 'Green Jackets')
  ];

  -- Participants. Each gets a random invite code; four per team in roster order.
  foreach entry in array roster loop
    parts := string_to_array(entry, '|');
    -- Random 8-char code. Anonymous callers can probe lookup_invite, so this
    -- needs to be unguessable, not a sequence.
    code := 'BI-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));

    -- Lowercased because the signup trigger matches on auth.users.email,
    -- which Supabase normalises to lower case.
    email := lower(nullif(trim(parts[4]), ''));
    if email is null then
      email := lower(code) || '@invite.blurrygolf.app';
    end if;

    insert into participants (event_id, full_name, auth_email, invite_code, handicap, is_admin)
    values (ev, parts[1], email, code, nullif(parts[2], '')::numeric, parts[3]::boolean)
    returning id into pid;

    -- Distribute round-robin-free: first 4 to team 1, next 4 to team 2, etc.
    insert into team_members (team_id, participant_id)
    values (team_ids[(idx / 4) + 1], pid);

    -- The on_participant_created trigger has already joined them to the event
    -- chat, so this is belt-and-braces for a roster seeded before that trigger.
    insert into conversation_members (conversation_id, participant_id)
    values (convo, pid)
    on conflict do nothing;

    idx := idx + 1;
  end loop;

  -- A couple of announcements so the event page isn't empty
  insert into announcements (event_id, body, created_by)
  select ev, 'Range balls and breakfast burritos are on the club. Arrive early.',
         id from participants where event_id = ev and is_admin limit 1;
  insert into announcements (event_id, body, created_by)
  select ev, 'Pairings are final. Check your team and tee time on the event page.',
         id from participants where event_id = ev and is_admin limit 1;

  raise notice 'Seeded event %', ev;
end $$;

-- Export the invite codes to send out:
--   select full_name, invite_code, auth_email from participants order by full_name;
