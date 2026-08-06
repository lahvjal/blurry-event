import { EventBundle } from '@/lib/api';
import { cacheStore } from '@/lib/offline/store';

/**
 * The last-known-good copy of everything the scorecard needs.
 *
 * Written whenever the event loads successfully online, read when it can't.
 * This is what makes a round playable with no signal: the course, the holes and
 * their pars, the roster, the teams, and every score already recorded are all
 * on the device, so moving between holes never touches the network.
 *
 * Deliberately one document rather than normalised tables — it's read and
 * written whole, it's a few kilobytes, and an all-or-nothing write means the
 * app can never boot from a half-updated snapshot.
 */

const SNAPSHOT_KEY = 'eventSnapshot.v1';

export type EventSnapshot = {
  /** Absent on legacy snapshots. */
  schemaVersion?: 1 | 2;
  savedAt: string;
  /** Whose device this was cached for; a different login must not read it. */
  userId: string | null;
  bundle: EventBundle;
};

export async function saveSnapshot(
  bundle: EventBundle,
  userId: string | null,
): Promise<void> {
  await cacheStore.set<EventSnapshot>(SNAPSHOT_KEY, {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    userId,
    bundle,
  });
}

/**
 * Returns the cached bundle when it belongs to the current user. A snapshot
 * from another account is ignored rather than shown — better an empty screen
 * than someone else's scorecard.
 */
export async function loadSnapshot(
  userId: string | null,
): Promise<EventSnapshot | null> {
  const snapshot = await cacheStore.get<EventSnapshot>(SNAPSHOT_KEY);
  if (!snapshot) return null;
  if (snapshot.userId && userId && snapshot.userId !== userId) return null;
  return snapshot;
}

export async function clearSnapshot(): Promise<void> {
  await cacheStore.remove(SNAPSHOT_KEY);
}
