-- Read-only RLS verification for seed-multi-event.sql.
-- Every row in both result sets should be true.
--
--   psql "$TEST_DATABASE_URL" \
--     -v user_a_email='multi-a@example.test' \
--     -v user_b_email='multi-b@example.test' \
--     -f supabase/testing/verify-multi-event-isolation.sql

\set ON_ERROR_STOP on

select id::text as user_a_id
from auth.users where lower(email) = lower(:'user_a_email') \gset
select id::text as user_b_id
from auth.users where lower(email) = lower(:'user_b_email') \gset
select id::text as invitational_id
from events
where id <> '00000000-0000-4000-8000-0000000000b2'
order by (name = 'Blurry Invitational') desc, created_at
limit 1 \gset

begin;
select set_config('request.jwt.claim.sub', :'user_a_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select * from (values
  ('A sees the Invitational', exists (
    select 1 from accessible_events() where id = :'invitational_id'::uuid
  )),
  ('A sees the test event', exists (
    select 1 from accessible_events()
    where id = '00000000-0000-4000-8000-0000000000b2'
  )),
  ('A has separate registrations', (
    select count(distinct participant_id) from accessible_events()
  ) >= 2),
  ('A event-scoped inbox opens the test event chat', exists (
    select 1 from conversation_summaries(
      '00000000-0000-4000-8000-0000000000b2'
    )
  )),
  ('A sees only event-matching test messages', not exists (
    select 1
    from messages message
    join conversations conversation on conversation.id = message.conversation_id
    where message.event_id <> conversation.event_id
  ))
) checks(check_name, passed)
order by passed, check_name;
rollback;

begin;
select set_config('request.jwt.claim.sub', :'user_b_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select * from (values
  ('B sees exactly one accessible event', (
    select count(*) from accessible_events()
  ) = 1),
  ('B sees the test event', exists (
    select 1 from events
    where id = '00000000-0000-4000-8000-0000000000b2'
  )),
  ('B cannot read the Invitational event', not exists (
    select 1 from events where id = :'invitational_id'::uuid
  )),
  ('B cannot read Invitational holes', not exists (
    select 1 from holes where event_id = :'invitational_id'::uuid
  )),
  ('B cannot read Invitational participants', not exists (
    select 1 from participants where event_id = :'invitational_id'::uuid
  )),
  ('B cannot read Invitational teams', not exists (
    select 1 from teams where event_id = :'invitational_id'::uuid
  )),
  ('B cannot read Invitational rounds', not exists (
    select 1 from rounds where event_id = :'invitational_id'::uuid
  )),
  ('B cannot read Invitational announcements', not exists (
    select 1 from announcements where event_id = :'invitational_id'::uuid
  )),
  ('B cannot read Invitational conversations', not exists (
    select 1 from conversations where event_id = :'invitational_id'::uuid
  )),
  ('B Invitational inbox RPC returns no rows', not exists (
    select 1 from conversation_summaries(:'invitational_id'::uuid)
  )),
  ('B event-access helper denies the Invitational', not has_event_access(
    :'invitational_id'::uuid
  ))
) checks(check_name, passed)
order by passed, check_name;
rollback;
