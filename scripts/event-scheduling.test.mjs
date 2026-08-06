import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canMovePlayingUnit,
  movePlayingUnit,
  nextUnscoredHoleIndex,
  playOrder,
  playingGroupRemaining,
  seatPlayingGroups,
  startSlots,
} from '../src/lib/scheduling.ts';

const group = (id, memberIds = [], teeTime = null, startingHole = null) => ({
  id,
  name: id,
  teeTime,
  startingHole,
  cart: `${id}-cart`,
  memberIds,
});

test('start formats produce independent, mode-correct slots', () => {
  assert.deepEqual(startSlots('staggered', '8:00 AM', ['8:00 AM', '8:10 AM']), [
    { teeTime: '8:00 AM', startingHole: 1 },
    { teeTime: '8:10 AM', startingHole: 1 },
  ]);

  const shotgun = startSlots('shotgun', '9:00 AM', ['ignored']);
  assert.equal(shotgun.length, 18);
  assert.deepEqual(
    shotgun.map((slot) => slot.startingHole),
    Array.from({ length: 18 }, (_, index) => index + 1),
  );
  assert.ok(shotgun.every((slot) => slot.teeTime === '9:00 AM'));

  assert.deepEqual(startSlots('split_tee', '8:00 AM', ['8:00 AM', '8:10 AM']), [
    { teeTime: '8:00 AM', startingHole: 1 },
    { teeTime: '8:00 AM', startingHole: 10 },
    { teeTime: '8:10 AM', startingHole: 1 },
    { teeTime: '8:10 AM', startingHole: 10 },
  ]);
});

test('format changes re-seat groups without changing membership, name, or cart', () => {
  const original = [
    group('A', ['p1', 'p2'], '8:00 AM', 1),
    group('B', ['p3', 'p4'], '8:10 AM', 1),
  ];
  const seated = seatPlayingGroups(original, 'shotgun', '9:00 AM', []);
  assert.deepEqual(
    seated.map(({ teeTime, startingHole }) => ({ teeTime, startingHole })),
    [
      { teeTime: '9:00 AM', startingHole: 1 },
      { teeTime: '9:00 AM', startingHole: 2 },
    ],
  );
  assert.deepEqual(seated.map((item) => item.memberIds), [original[0].memberIds, original[1].memberIds]);
  assert.deepEqual(seated.map((item) => item.cart), ['A-cart', 'B-cart']);
});

test('four solo golfers pack into one group and a fifth is rejected', () => {
  let groups = [group('A')];
  for (const participantId of ['p1', 'p2', 'p3', 'p4']) {
    const moved = movePlayingUnit(groups, [participantId], 'A');
    assert.ok(moved);
    groups = moved;
  }
  assert.equal(playingGroupRemaining(groups[0]), 0);
  assert.equal(canMovePlayingUnit(groups, ['p5'], 'A'), false);
  assert.equal(movePlayingUnit(groups, ['p5'], 'A'), null);
});

test('two paired scramble teams share a group without splitting either side', () => {
  let groups = [group('A'), group('B', ['t1a', 't1b'])];
  groups = movePlayingUnit(groups, ['t1a', 't1b'], 'A');
  assert.ok(groups);
  groups = movePlayingUnit(groups, ['t2a', 't2b'], 'A');
  assert.ok(groups);
  assert.deepEqual(groups[0].memberIds, ['t1a', 't1b', 't2a', 't2b']);
  assert.deepEqual(groups[1].memberIds, []);
});

test('start-hole play order wraps after eighteen', () => {
  assert.deepEqual(playOrder(18).slice(0, 4), [18, 1, 2, 3]);
  assert.deepEqual(playOrder(10).slice(0, 4), [10, 11, 12, 13]);

  const scores = Array(18).fill(null);
  scores[17] = 5;
  scores[0] = 4;
  assert.equal(nextUnscoredHoleIndex(scores, 18), 1);
});

test('migration keeps scoring identity additive and enforces physical capacity', () => {
  const migration = readFileSync(
    'supabase/migrations/20260806000400_playing_group_scheduling.sql',
    'utf8',
  );

  assert.match(migration, /add column if not exists start_format event_start_format/);
  assert.match(migration, /add column if not exists individual_exception boolean/);
  assert.match(migration, /create table if not exists playing_groups/);
  assert.match(migration, /create table if not exists playing_group_members/);
  assert.match(migration, /occupied >= 4/);
  assert.match(migration, /playing_group_members.*enable row level security/s);
  assert.doesNotMatch(migration, /alter table teams rename|drop table teams/i);
});

test('migration makes scheduling atomic and publication readiness server-enforced', () => {
  const migration = readFileSync(
    'supabase/migrations/20260806000400_playing_group_scheduling.sql',
    'utf8',
  );

  assert.match(migration, /create or replace function apply_event_schedule/);
  assert.match(migration, /Use apply_event_schedule to change a playing-group schedule/);
  assert.match(migration, /Every participant needs one playing group before publication/);
  assert.match(migration, /event_has_split_scoring_team\(new\.id\)/);
  assert.match(migration, /individual_exception.*count\(\*\).* = 1/s);
  assert.match(migration, /playing_group_update/);
});

test('legacy score queues resolve to ordinary team-owned scramble rounds', () => {
  const migration = readFileSync(
    'supabase/migrations/20260806000400_playing_group_scheduling.sql',
    'utf8',
  );

  assert.match(migration, /create or replace function submit_offline_score/);
  assert.match(migration, /select membership\.team_id into effective_team_id/);
  assert.match(migration, /values \(p_event_id, effective_team_id, null\)/);
  assert.match(migration, /on conflict \(event_id, team_id\).*team_id is not null/s);
});
