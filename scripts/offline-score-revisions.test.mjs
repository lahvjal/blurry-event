import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareScoreRevision,
  isExactRevision,
  serverHasCaughtUp,
} from '../src/lib/offline/score-revisions.ts';

const older = {
  mutationId: '00000000-0000-4000-8000-000000000001',
  entrantId: 'team-1',
  hole: 7,
  clientUpdatedAt: '2026-08-03T12:00:00.000Z',
  clientVersion: 10,
};
const newer = {
  ...older,
  mutationId: '00000000-0000-4000-8000-000000000002',
  clientVersion: 11,
};

test('an old acknowledgement cannot remove a newer immutable correction', () => {
  assert.equal(isExactRevision({ id: older.mutationId, generation: 10 }, older.mutationId, 10), true);
  assert.equal(isExactRevision({ id: newer.mutationId, generation: 11 }, older.mutationId, 10), false);
  assert.equal(isExactRevision({ id: older.mutationId, generation: 11 }, older.mutationId, 10), false);
});

test('same-timestamp score corrections are ordered by client version', () => {
  assert.ok(compareScoreRevision(older, newer) < 0);
  assert.ok(compareScoreRevision(newer, older) > 0);
});

test('a confirmed overlay is removed only after the server catches up', () => {
  assert.equal(serverHasCaughtUp(newer, undefined), false);
  assert.equal(
    serverHasCaughtUp(newer, {
      entrantId: newer.entrantId,
      hole: newer.hole,
      updatedAt: older.clientUpdatedAt,
      clientVersion: older.clientVersion,
      mutationId: older.mutationId,
    }),
    false,
  );
  assert.equal(
    serverHasCaughtUp(newer, {
      entrantId: newer.entrantId,
      hole: newer.hole,
      updatedAt: newer.clientUpdatedAt,
      clientVersion: newer.clientVersion,
      mutationId: newer.mutationId,
    }),
    true,
  );
});
