import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScorecardReceipt,
  decodeScorecardReceipt,
  scorecardSourceRevision,
} from '../src/lib/scorecard-receipt.ts';

const scores = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4, 3, 5, 4, 3, 4];

test('a complete scorecard round-trips through the QR receipt', async () => {
  const created = await createScorecardReceipt({
    eventId: 'event-1',
    entrantId: 'team-4',
    entrantName: 'Team 4',
    entrantKind: 'team',
    scores,
    sourceUpdatedAt: '2026-08-10T18:00:00.000Z',
    sourceRevision: 1_786_382_400_000_000,
  });

  const decoded = await decodeScorecardReceipt(created.encoded);
  assert.deepEqual(decoded, created.receipt);
  assert.ok(created.encoded.length < 4096, 'receipt must fit the scanner limit');
  assert.equal(decoded.scores.reduce((total, score) => total + score, 0), 70);
});

test('a score changed after receipt creation fails the integrity check', async () => {
  const { encoded } = await createScorecardReceipt({
    eventId: 'event-1',
    entrantId: 'team-4',
    entrantName: 'Team 4',
    entrantKind: 'team',
    scores,
    sourceUpdatedAt: '2026-08-10T18:00:00.000Z',
    sourceRevision: 1_786_382_400_000_000,
  });
  const tampered = encoded.replace('"s":[4,4,3', '"s":[3,4,3');

  await assert.rejects(
    () => decodeScorecardReceipt(tampered),
    /changed after it was created/,
  );
});

test('incomplete cards cannot be exported', async () => {
  await assert.rejects(
    () =>
      createScorecardReceipt({
        eventId: 'event-1',
        entrantId: 'team-4',
        entrantName: 'Team 4',
        entrantKind: 'team',
        scores: [...scores.slice(0, 17), null],
        sourceUpdatedAt: '2026-08-10T18:00:00.000Z',
        sourceRevision: 1_786_382_400_000_000,
      }),
    /18 valid hole scores/,
  );
});

test('the latest source revision is stable across receipt screen remounts', () => {
  const revision = scorecardSourceRevision('team-4', [
    {
      entrantId: 'team-4',
      updatedAt: '2026-08-10T17:59:00.000Z',
      clientVersion: 100,
    },
    {
      entrantId: 'team-4',
      updatedAt: '2026-08-10T18:00:00.000Z',
      clientVersion: 101,
    },
    {
      entrantId: 'another-team',
      updatedAt: '2026-08-10T19:00:00.000Z',
      clientVersion: 999,
    },
  ]);

  assert.equal(revision.sourceUpdatedAt, '2026-08-10T18:00:00.000Z');
  assert.equal(revision.sourceRevision, 1_786_384_800_000_000);
});
