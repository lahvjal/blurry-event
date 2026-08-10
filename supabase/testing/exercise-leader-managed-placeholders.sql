-- NON-PRODUCTION TRANSACTIONAL TEST ONLY.
-- Exercises authorization, invite lifecycle, claiming, and shared scoring,
-- then rolls every fixture row back.

\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'leader-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'leader@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'nonleader@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'scorer@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'placeholder@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'wrong-account@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name)
values
  ('10000000-0000-4000-8000-000000000001', 'Fixture Admin'),
  ('10000000-0000-4000-8000-000000000002', 'Fixture Leader'),
  ('10000000-0000-4000-8000-000000000003', 'Fixture Nonleader'),
  ('10000000-0000-4000-8000-000000000004', 'Fixture Scorer'),
  ('10000000-0000-4000-8000-000000000005', 'Fixture Placeholder Account'),
  ('10000000-0000-4000-8000-000000000006', 'Fixture Wrong Account');

insert into public.events (
  id, name, course_name, event_date, lifecycle_status, game_style
) values (
  '20000000-0000-4000-8000-000000000001',
  '[TEST] Leader-managed placeholders',
  'Fixture Course',
  current_date + 1,
  'draft',
  'scramble_4'
);

insert into public.participants (
  id, event_id, full_name, auth_email, invite_code,
  is_admin, claimed_by, invite_enabled, claim_email_bound
) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fixture Admin', 'leader-admin@example.test', 'TEST-LEADER-ADMIN', true,  '10000000-0000-4000-8000-000000000001', false, false),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Fixture Leader', 'leader@example.test', 'TEST-LEADER', false, '10000000-0000-4000-8000-000000000002', false, false),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Fixture Nonleader', 'nonleader@example.test', 'TEST-NONLEADER', false, '10000000-0000-4000-8000-000000000003', false, false),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Fixture Scorer', 'scorer@example.test', 'TEST-SCORER', false, '10000000-0000-4000-8000-000000000004', false, false),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'Placeholder Name', 'test-placeholder@invite.blurrygolf.app', 'TEST-PLACEHOLDER-OLD', false, null, false, false);

insert into public.teams (id, event_id, name)
values (
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Fixture Team'
);

insert into public.team_members (team_id, participant_id)
values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004'),
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005');

-- Force only the fixture event public so the edit below proves the RPC does
-- not depend on draft state. Production publication still uses the trigger.
alter table public.events disable trigger events_scoring_identity_and_readiness;
update public.events
set lifecycle_status = 'published'
where id = '20000000-0000-4000-8000-000000000001';
alter table public.events enable trigger events_scoring_identity_and_readiness;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select public.set_team_leader(
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select * from public.update_leader_managed_teammate(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000005',
  0,
  'Corrected Placeholder',
  'placeholder@example.test'
);

do $test$
declare
  sent_before timestamptz;
begin
  select invite_sent_at into sent_before
  from public.participants
  where id = '30000000-0000-4000-8000-000000000005';
  if sent_before is not null then
    raise exception 'Saving an email sent an invitation automatically';
  end if;
end
$test$;

select * from public.invite_payloads(
  array['30000000-0000-4000-8000-000000000005'::uuid]
);
select public.mark_invites_sent(
  array['30000000-0000-4000-8000-000000000005'::uuid]
);

select public.submit_offline_score(
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  null,
  1,
  4,
  '30000000-0000-4000-8000-000000000002',
  now(),
  1,
  '50000000-0000-4000-8000-000000000001'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
set local role authenticated;

do $test$
begin
  begin
    perform * from public.update_leader_managed_teammate(
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000005',
      2,
      'Unauthorized Change',
      'placeholder@example.test'
    );
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'A nonleader edited the placeholder';
end
$test$;

select public.submit_offline_score(
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  null,
  2,
  5,
  '30000000-0000-4000-8000-000000000003',
  now(),
  1,
  '50000000-0000-4000-8000-000000000002'
);
reset role;

select set_config(
  'app.blurry_fixture_invite_code',
  (select invite_code from public.participants
   where id = '30000000-0000-4000-8000-000000000005'),
  true
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
set local role authenticated;
do $test$
begin
  begin
    perform public.claim_event_invite(
      current_setting('app.blurry_fixture_invite_code')
    );
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'A wrong-email account claimed the placeholder';
end
$test$;
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select public.claim_event_invite(
  current_setting('app.blurry_fixture_invite_code')
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $test$
begin
  begin
    perform * from public.update_leader_managed_teammate(
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000005',
      2,
      'Claimed Change',
      'placeholder@example.test'
    );
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'A leader edited a claimed teammate';
end
$test$;
reset role;

select *
from (values
  (
    'leader remains explicitly assigned',
    (select leader_participant_id = '30000000-0000-4000-8000-000000000002'
     from public.teams
     where id = '40000000-0000-4000-8000-000000000001')
  ),
  (
    'placeholder email was bound and explicitly sent',
    (select
       full_name = 'Corrected Placeholder'
       and claim_email_bound
       and invite_enabled
       and invite_sent_at is not null
       and claimed_by = '10000000-0000-4000-8000-000000000005'
     from public.participants
     where id = '30000000-0000-4000-8000-000000000005')
  ),
  (
    'two claimed teammates wrote the shared team round',
    (select count(*) = 2
     from public.scores score
     join public.rounds round on round.id = score.round_id
     where round.team_id = '40000000-0000-4000-8000-000000000001'
       and score.hole in (1, 2))
  ),
  (
    'leader assignment and placeholder edit were audited',
    (select count(*) = 2
     from private.team_management_audit audit
     where audit.event_id = '20000000-0000-4000-8000-000000000001'
       and audit.action in ('assign_leader', 'edit_placeholder'))
  )
) checks(check_name, passed)
order by passed, check_name;

rollback;
