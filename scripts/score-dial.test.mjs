import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCORE_DIAL_STEP,
  scoreDialDisplayPosition,
  scoreDialIndexForAdjacentTap,
  scoreDialIndexForDrag,
} from '../src/lib/score-dial-logic.ts';

test('drag changes only after crossing a half-step detent', () => {
  assert.equal(scoreDialIndexForDrag(4, SCORE_DIAL_STEP / 2 - 0.01, 11), 4);
  assert.equal(scoreDialIndexForDrag(4, SCORE_DIAL_STEP / 2, 11), 5);
  assert.equal(scoreDialIndexForDrag(4, -SCORE_DIAL_STEP / 2 + 0.01, 11), 4);
  assert.equal(scoreDialIndexForDrag(4, -SCORE_DIAL_STEP / 2, 11), 3);
});

test('drag distance supports multiple steps and clamps at both ends', () => {
  assert.equal(scoreDialIndexForDrag(4, SCORE_DIAL_STEP * 3, 11), 7);
  assert.equal(scoreDialIndexForDrag(4, -SCORE_DIAL_STEP * 2, 11), 2);
  assert.equal(scoreDialIndexForDrag(10, SCORE_DIAL_STEP * 5, 11), 11);
  assert.equal(scoreDialIndexForDrag(1, -SCORE_DIAL_STEP * 5, 11), 0);
});

test('adjacent taps change exactly one score and clamp at the bounds', () => {
  assert.equal(scoreDialIndexForAdjacentTap(4, 'above', 11), 5);
  assert.equal(scoreDialIndexForAdjacentTap(4, 'below', 11), 3);
  assert.equal(scoreDialIndexForAdjacentTap(11, 'above', 11), 11);
  assert.equal(scoreDialIndexForAdjacentTap(0, 'below', 11), 0);
});

test('higher scores render one row above the active score', () => {
  assert.equal(
    scoreDialDisplayPosition(5, 11),
    scoreDialDisplayPosition(4, 11) - 1,
  );
  assert.equal(
    scoreDialDisplayPosition(3, 11),
    scoreDialDisplayPosition(4, 11) + 1,
  );
});
