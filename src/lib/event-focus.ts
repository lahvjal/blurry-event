import type { AccessibleEvent } from '@/state/types';

export type DefaultEventFocusReason =
  | 'live'
  | 'upcoming'
  | 'ended'
  | 'remaining'
  | 'empty';

export type DefaultEventFocus = {
  event: AccessibleEvent | null;
  reason: DefaultEventFocusReason;
};

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function stableId(a: AccessibleEvent, b: AccessibleEvent): number {
  return a.id.localeCompare(b.id);
}

/**
 * Chooses the Home event without consulting previous navigation state.
 *
 * Precedence is product-defined: current Live, nearest future Published, then
 * most recently ended. Drafts (and a stale past Published event) are a final
 * admin-safety fallback only when none of those product states exists.
 */
export function selectDefaultEventFocus(
  events: AccessibleEvent[],
  now = new Date(),
): DefaultEventFocus {
  if (events.length === 0) return { event: null, reason: 'empty' };

  const today = localIsoDate(now);
  const todayNumber = dayNumber(today);
  const live = events
    .filter((event) => event.lifecycleStatus === 'live')
    .sort((a, b) => {
      const distance =
        Math.abs(dayNumber(a.eventDate) - todayNumber) -
        Math.abs(dayNumber(b.eventDate) - todayNumber);
      return distance || a.eventDate.localeCompare(b.eventDate) || stableId(a, b);
    });
  if (live[0]) return { event: live[0], reason: 'live' };

  const upcoming = events
    .filter(
      (event) =>
        event.lifecycleStatus === 'published' && event.eventDate >= today,
    )
    .sort(
      (a, b) => a.eventDate.localeCompare(b.eventDate) || stableId(a, b),
    );
  if (upcoming[0]) return { event: upcoming[0], reason: 'upcoming' };

  const ended = events
    .filter(
      (event) =>
        event.lifecycleStatus === 'completed' ||
        event.lifecycleStatus === 'archived',
    )
    .sort(
      (a, b) => b.eventDate.localeCompare(a.eventDate) || stableId(a, b),
    );
  if (ended[0]) return { event: ended[0], reason: 'ended' };

  const remaining = [...events].sort((a, b) => {
    const aFuture = a.eventDate >= today;
    const bFuture = b.eventDate >= today;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    const dateOrder = aFuture
      ? a.eventDate.localeCompare(b.eventDate)
      : b.eventDate.localeCompare(a.eventDate);
    return dateOrder || stableId(a, b);
  });
  return { event: remaining[0], reason: 'remaining' };
}
