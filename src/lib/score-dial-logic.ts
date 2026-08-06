export const SCORE_DIAL_STEP = 46;

export function clampScoreDialIndex(index: number, lastIndex: number): number {
  return Math.min(Math.max(index, 0), lastIndex);
}

/**
 * Positive travel pulls the higher score from above into the selected row.
 * Rounding gives each score a stable half-step dead zone around its detent.
 */
export function scoreDialIndexForDrag(
  startIndex: number,
  distanceY: number,
  lastIndex: number,
): number {
  const steps =
    Math.sign(distanceY) *
    Math.round(Math.abs(distanceY) / SCORE_DIAL_STEP);
  return clampScoreDialIndex(startIndex + steps, lastIndex);
}

export function scoreDialIndexForAdjacentTap(
  currentIndex: number,
  position: 'above' | 'below',
  lastIndex: number,
): number {
  const delta = position === 'above' ? 1 : -1;
  return clampScoreDialIndex(currentIndex + delta, lastIndex);
}

/** Values increase upward, so their visual position runs opposite the index. */
export function scoreDialDisplayPosition(
  index: number,
  lastIndex: number,
): number {
  return lastIndex - index;
}
