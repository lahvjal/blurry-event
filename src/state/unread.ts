import { useEffect, useSyncExternalStore } from 'react';

import { setBadge } from '@/lib/badge';
import {
  fetchConversationSummaries,
  subscribeToMessageReactions,
  subscribeToMessages,
} from '@/lib/chat';
import {
  isBrowserDefinitelyOffline,
  useBrowserDefinitelyOffline,
} from '@/lib/offline/network';
import { supabase } from '@/lib/supabase';

/**
 * One source of truth for unread chat activity, read by the nav tab
 * badge, the inbox, and the home screen icon.
 *
 * A module-level store rather than context because FloatingNav renders on
 * nearly every screen. Per-mount state would mean a query on every navigation
 * and several realtime subscriptions open at once; worse, the nav badge and the
 * icon badge could drift apart and disagree about the same number.
 */

let total = 0;
let activeEventId = '';
let activeBrowserOffline = false;
let stopRealtime: (() => void) | null = null;
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

/**
 * Publishes a total the caller already has — the inbox computes one as a side
 * effect of loading, so it would be wasteful to go and ask again.
 */
export function setUnreadTotal(eventId: string, next: number): void {
  if (eventId !== activeEventId) return;
  if (next === total) return;
  total = next;
  emit();
  void setBadge(next);
}

/** Asks the server for the current count. */
export async function refreshUnread(eventId: string): Promise<void> {
  if (eventId !== activeEventId || isBrowserDefinitelyOffline()) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setUnreadTotal(eventId, 0);
      return;
    }
    const summaries = await fetchConversationSummaries(eventId);
    setUnreadTotal(
      eventId,
      summaries.reduce((sum, c) => sum + c.unreadCount, 0),
    );
  } catch {
    // Hold the last known count. Flashing to zero on a dropped request would
    // read as "all caught up", which is worse than being slightly stale.
  }
}

function activateUnreadEvent(eventId: string, browserOffline: boolean): void {
  if (
    activeEventId === eventId &&
    activeBrowserOffline === browserOffline
  ) {
    return;
  }
  const eventChanged = activeEventId !== eventId;
  stopRealtime?.();
  stopRealtime = null;
  activeEventId = eventId;
  activeBrowserOffline = browserOffline;
  if (eventChanged) {
    total = 0;
    emit();
    void setBadge(0);
  }

  // Offline preparation already stored the inbox. The inbox hook publishes
  // its cached unread total when opened; until then, preserve the last known
  // value and do not start a doomed HTTP/WebSocket connection.
  if (browserOffline) return;

  const stopMessages = subscribeToMessages(eventId, null, () =>
    void refreshUnread(eventId),
  );
  const stopReactions = subscribeToMessageReactions(eventId, () =>
    void refreshUnread(eventId),
  );
  stopRealtime = () => {
    stopMessages();
    stopReactions();
  };
  void refreshUnread(eventId);
}

export function useUnreadTotal(eventId: string): number {
  const browserOffline = useBrowserDefinitelyOffline();

  useEffect(() => {
    activateUnreadEvent(eventId, browserOffline);
  }, [browserOffline, eventId]);

  return useSyncExternalStore(
    subscribe,
    () => total,
    () => 0,
  );
}
