export type ScorecardSummaryHeights = {
  out: number;
  in: number;
  total: number;
};

/** Fixed viewport positions used by the scorecard's inverse-sticky summaries. */
export function scorecardSummarySlots(
  viewportHeight: number,
  navSpace: number,
  heights: ScorecardSummaryHeights,
): ScorecardSummaryHeights {
  return {
    total: viewportHeight - navSpace - heights.total,
    in: viewportHeight - navSpace - heights.total - heights.in,
    out:
      viewportHeight - navSpace - heights.total - heights.in - heights.out,
  };
}

/**
 * Places the active hole immediately above the next summary row in document
 * order. Front-nine holes lead into OUT; back-nine holes lead into IN. The
 * clamp keeps early holes at the natural top and lets the last hole settle at
 * the maximum valid scroll offset without adding artificial blank content.
 */
export function scorecardActiveHoleScrollTarget({
  activeHoleIndex,
  activeRowTop,
  activeRowHeight,
  viewportHeight,
  contentHeight,
  navSpace,
  summaryHeights,
}: {
  activeHoleIndex: number;
  activeRowTop: number;
  activeRowHeight: number;
  viewportHeight: number;
  contentHeight: number;
  navSpace: number;
  summaryHeights: ScorecardSummaryHeights;
}): number {
  const slots = scorecardSummarySlots(viewportHeight, navSpace, summaryHeights);
  const nextSummaryTop = activeHoleIndex < 9 ? slots.out : slots.in;
  const desiredOffset = activeRowTop + activeRowHeight - nextSummaryTop;
  const maximumOffset = Math.max(0, contentHeight - viewportHeight);

  return Math.min(maximumOffset, Math.max(0, desiredOffset));
}

/** A hole is positioned once, and never while a user-driven scroll is active. */
export function shouldAutoPositionScorecard({
  pendingHole,
  positionedHole,
  measuredHole,
  userIsDragging,
  userHasMomentum,
}: {
  pendingHole: number | null;
  positionedHole: number | null;
  measuredHole: number | null;
  userIsDragging: boolean;
  userHasMomentum: boolean;
}): boolean {
  return (
    pendingHole !== null &&
    pendingHole !== positionedHole &&
    pendingHole === measuredHole &&
    !userIsDragging &&
    !userHasMomentum
  );
}
