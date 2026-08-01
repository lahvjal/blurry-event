import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

import { useUnreadTotal } from '@/state/unread';

const SEEN_KEY_PREFIX = 'blurry.notification-center.seen.';

let activeScope = '';
let announcementUnread = 0;
let requestVersion = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setAnnouncementUnread(scope: string, count: number) {
  const changed = activeScope !== scope || announcementUnread !== count;
  activeScope = scope;
  announcementUnread = count;
  if (changed) emit();
}

async function readSeenIds(scope: string): Promise<Set<string> | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SEEN_KEY_PREFIX}${scope}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [],
    );
  } catch {
    return null;
  }
}

async function refreshAnnouncementUnread(scope: string, ids: string[]) {
  const version = ++requestVersion;
  const seen = await readSeenIds(scope);
  if (version !== requestVersion) return;

  // If device storage is unavailable, avoid showing a badge that can never be
  // dismissed. Message unread state remains live and server-backed.
  const count = seen ? ids.reduce((total, id) => total + (seen.has(id) ? 0 : 1), 0) : 0;
  setAnnouncementUnread(scope, count);
}

export async function markAnnouncementsSeen(
  scope: string,
  ids: string[],
): Promise<void> {
  ++requestVersion;
  setAnnouncementUnread(scope, 0);

  const seen = await readSeenIds(scope);
  if (!seen) return;
  ids.forEach((id) => seen.add(id));

  try {
    await AsyncStorage.setItem(
      `${SEEN_KEY_PREFIX}${scope}`,
      JSON.stringify([...seen]),
    );
  } catch {
    // The in-memory badge is still dismissed for this session.
  }
}

/**
 * The bell represents two things the app can reconstruct reliably today:
 * unread chat activity from the server and announcements not yet viewed on
 * this device.
 */
export function useNotificationUnread(
  scope: string,
  announcementIds: string[],
  eventId: string,
): number {
  const messageUnread = useUnreadTotal(eventId);

  useFocusEffect(
    useCallback(() => {
      void refreshAnnouncementUnread(scope, announcementIds);
    }, [scope, announcementIds]),
  );

  const unseenAnnouncements = useSyncExternalStore(
    subscribe,
    () => (activeScope === scope ? announcementUnread : 0),
    () => 0,
  );

  return messageUnread + unseenAnnouncements;
}
