import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scorecardActiveHoleScrollTarget,
  scorecardSummarySlots,
  shouldAutoPositionScorecard,
} from '../src/lib/scorecard-scroll.ts';

const viewportHeight = 800;
const navSpace = 100;
const summaryHeights = { out: 50, in: 50, total: 100 };

test('summary slots stack above the floating navigation', () => {
  assert.deepEqual(
    scorecardSummarySlots(viewportHeight, navSpace, summaryHeights),
    { out: 500, in: 550, total: 600 },
  );
});

test('a front-nine active row settles directly above OUT', () => {
  const activeRowTop = 600;
  const activeRowHeight = 110;
  const target = scorecardActiveHoleScrollTarget({
    activeHoleIndex: 8,
    activeRowTop,
    activeRowHeight,
    viewportHeight,
    contentHeight: 1400,
    navSpace,
    summaryHeights,
  });

  assert.equal(target, 210);
  assert.equal(activeRowTop + activeRowHeight - target, 500);
});

test('a back-nine active row settles directly above IN, after OUT has released', () => {
  const activeRowTop = 820;
  const activeRowHeight = 110;
  const target = scorecardActiveHoleScrollTarget({
    activeHoleIndex: 11,
    activeRowTop,
    activeRowHeight,
    viewportHeight,
    contentHeight: 1400,
    navSpace,
    summaryHeights,
  });

  assert.equal(target, 380);
  assert.equal(activeRowTop + activeRowHeight - target, 550);
});

test('early holes remain at the natural top instead of forcing an invalid offset', () => {
  assert.equal(
    scorecardActiveHoleScrollTarget({
      activeHoleIndex: 0,
      activeRowTop: 200,
      activeRowHeight: 110,
      viewportHeight,
      contentHeight: 1400,
      navSpace,
      summaryHeights,
    }),
    0,
  );
});

test('the last hole uses the valid maximum offset and still meets IN', () => {
  const activeRowTop = 1000;
  const activeRowHeight = 110;
  const contentHeight =
    activeRowTop + activeRowHeight + summaryHeights.in + summaryHeights.total + navSpace;
  const target = scorecardActiveHoleScrollTarget({
    activeHoleIndex: 17,
    activeRowTop,
    activeRowHeight,
    viewportHeight,
    contentHeight,
    navSpace,
    summaryHeights,
  });

  assert.equal(target, contentHeight - viewportHeight);
  assert.equal(activeRowTop + activeRowHeight - target, 550);
});

test('auto-positioning happens once per measured hole and waits for manual scrolling', () => {
  const ready = {
    pendingHole: 12,
    positionedHole: 11,
    measuredHole: 12,
    userIsDragging: false,
    userHasMomentum: false,
  };

  assert.equal(shouldAutoPositionScorecard(ready), true);
  assert.equal(
    shouldAutoPositionScorecard({ ...ready, positionedHole: 12 }),
    false,
  );
  assert.equal(
    shouldAutoPositionScorecard({ ...ready, measuredHole: 11 }),
    false,
  );
  assert.equal(
    shouldAutoPositionScorecard({ ...ready, userIsDragging: true }),
    false,
  );
  assert.equal(
    shouldAutoPositionScorecard({ ...ready, userHasMomentum: true }),
    false,
  );
});
