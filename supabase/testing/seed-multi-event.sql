-- NON-PRODUCTION TEST FIXTURE ONLY.
--
-- Creates one deterministic test event and links two existing test auth
-- accounts to it. Account A is also linked to the existing Invitational so it
-- can exercise event switching. Account B belongs only to the test event and
-- is used to prove RLS isolation.
--
-- Run with psql only after migrations 0022 and 0023:
--   psql "$TEST_DATABASE_URL" \
--     -v confirm_non_production=true \
--     -v user_a_email='multi-a@example.test' \
--     -v user_b_email='multi-b@example.test' \
--     -f supabase/testing/seed-multi-event.sql

\set ON_ERROR_STOP on

\if :{?confirm_non_production}
\else
  \echo 'Refusing to seed: pass -v confirm_non_production=true.'
  \quit
\endif

\if :confirm_non_production
\else
  \echo 'Refusing to seed: confirm_non_production must be true.'
  \quit
\endif

\if :{?user_a_email}
\else
  \echo 'Missing -v user_a_email=...'
  \quit
\endif

\if :{?user_b_email}
\else
  \echo 'Missing -v user_b_email=...'
  \quit
\endif

begin;

select set_config(
  'app.blurry_fixture_user_a_email', lower(trim(:'user_a_email')), true
);
select set_config(
  'app.blurry_fixture_user_b_email', lower(trim(:'user_b_email')), true
);

do $fixture$
declare
  account_a uuid;
  account_b uuid;
  account_a_email text := current_setting('app.blurry_fixture_user_a_email');
  account_b_email text := current_setting('app.blurry_fixture_user_b_email');
  invitational_id uuid;
  test_event_id constant uuid := '00000000-0000-4000-8000-0000000000b2';
  test_team_id constant uuid := '00000000-0000-4000-8000-0000000000c2';
  test_conversation_id constant uuid := '00000000-0000-4000-8000-0000000000d2';
  participant_a_invitational uuid;
  participant_a_test uuid;
  participant_b_test uuid;
begin
  if account_a_email = account_b_email then
    raise exception 'Use two different test accounts';
  end if;

  select id into account_a from auth.users where lower(email) = account_a_email;
  select id into account_b from auth.users where lower(email) = account_b_email;
  if account_a is null or account_b is null then
    raise exception 'Create both test users in Supabase Auth before running this fixture';
  end if;

  select id into invitational_id
  from events
  where id <> test_event_id
  order by (name = 'Blurry Invitational') desc, created_at
  limit 1;
  if invitational_id is null then
    raise exception 'The existing Invitational event is required';
  end if;

  if exists (
    select 1 from profiles where id in (account_a, account_b) and is_club_admin
  ) then
    raise exception 'Use non-club-admin accounts so the isolation check is meaningful';
  end if;
  if exists (
    select 1 from participants
    where claimed_by = account_b and event_id <> test_event_id
  ) then
    raise exception 'Account B must be a clean test account with no other registrations';
  end if;

  insert into profiles (id, display_name)
  values
    (account_a, 'Multi Event A'),
    (account_b, 'Multi Event B')
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();

  insert into events (
    id, name, course_name, event_date, lifecycle_status,
    check_in_time, start_time, tee_times, tee_color
  ) values (
    test_event_id,
    '[TEST] Multi Event Preview',
    'Fixture Golf Club',
    current_date + 30,
    'published',
    '7:30 AM',
    '8:30 AM',
    array['8:30 AM'],
    'White'
  )
  on conflict (id) do update
    set name = excluded.name,
        course_name = excluded.course_name,
        event_date = excluded.event_date,
        lifecycle_status = excluded.lifecycle_status;

  insert into holes (event_id, hole, par, yards)
  select test_event_id, hole, par, yards
  from holes
  where event_id = invitational_id
  on conflict (event_id, hole) do update
    set par = excluded.par, yards = excluded.yards;

  if (select count(*) from holes where event_id = test_event_id) <> 18 then
    raise exception 'The source Invitational must have all 18 holes';
  end if;

  select id into participant_a_invitational
  from participants
  where event_id = invitational_id and claimed_by = account_a;
  if participant_a_invitational is null then
    select id into participant_a_invitational
    from participants
    where event_id = invitational_id
      and lower(auth_email) = account_a_email
      and claimed_by is null;
    if participant_a_invitational is null then
      insert into participants (
        event_id, full_name, auth_email, invite_code, handicap, is_admin, claimed_by
      ) values (
        invitational_id, 'Multi Event A', account_a_email,
        'TEST-MULTI-A1', 8.0, true, account_a
      ) returning id into participant_a_invitational;
    else
      update participants
      set claimed_by = account_a, is_admin = true
      where id = participant_a_invitational;
    end if;
  end if;

  select id into participant_a_test
  from participants
  where event_id = test_event_id and claimed_by = account_a;
  if participant_a_test is null then
    insert into participants (
      event_id, full_name, auth_email, invite_code, handicap, is_admin, claimed_by
    ) values (
      test_event_id, 'Multi Event A', account_a_email,
      'TEST-MULTI-A2', 8.0, true, account_a
    ) returning id into participant_a_test;
  end if;

  select id into participant_b_test
  from participants
  where event_id = test_event_id and claimed_by = account_b;
  if participant_b_test is null then
    insert into participants (
      event_id, full_name, auth_email, invite_code, handicap, is_admin, claimed_by
    ) values (
      test_event_id, 'Multi Event B', account_b_email,
      'TEST-MULTI-B2', 12.0, false, account_b
    ) returning id into participant_b_test;
  end if;

  insert into teams (id, event_id, name, tee_time, starting_hole, cart)
  values (test_team_id, test_event_id, 'Fixture Team', '8:30 AM', 1, 'Test Cart')
  on conflict (id) do update set name = excluded.name;

  insert into team_members (team_id, participant_id)
  values
    (test_team_id, participant_a_test),
    (test_team_id, participant_b_test)
  on conflict do nothing;

  insert into conversations (id, event_id, kind, name, created_by)
  values (
    test_conversation_id, test_event_id, 'event_group',
    '[TEST] Event Chat', participant_a_test
  )
  on conflict (id) do update set name = excluded.name;

  insert into conversation_members (conversation_id, participant_id)
  values
    (test_conversation_id, participant_a_test),
    (test_conversation_id, participant_b_test)
  on conflict do nothing;

  insert into announcements (event_id, body, created_by)
  select test_event_id, '[TEST] Multi-event fixture is ready.', participant_a_test
  where not exists (
    select 1 from announcements
    where event_id = test_event_id and body = '[TEST] Multi-event fixture is ready.'
  );
end
$fixture$;

commit;

select id, name, lifecycle_status
from events
where id = '00000000-0000-4000-8000-0000000000b2';

select lower(account.email) as account, event.name, registration.is_admin
from participants registration
join auth.users account on account.id = registration.claimed_by
join events event on event.id = registration.event_id
where lower(account.email) in (lower(:'user_a_email'), lower(:'user_b_email'))
order by account, event.name;
