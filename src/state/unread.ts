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
let activeAccountId: string | null = null;
let activeEventScope = '';
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
export function setUnreadTotal(accountId: string | null, next: number): void {
  if (accountId !== activeAccountId) return;
  if (next === total) return;
  total = next;
  emit();
  void setBadge(next);
}

/** Asks the server for the current count. */
export async function refreshUnread(
  eventScope = activeEventScope,
  accountId = activeAccountId,
): Promise<void> {
  if (
    accountId !== activeAccountId ||
    eventScope !== activeEventScope ||
    isBrowserDefinitelyOffline()
  ) {
    return;
  }
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setUnreadTotal(accountId, 0);
      return;
    }
    const summaries = await fetchConversationSummaries();
    if (accountId !== activeAccountId || eventScope !== activeEventScope) return;
    setUnreadTotal(
      accountId,
      summaries.reduce((sum, c) => sum + c.unreadCount, 0),
    );
  } catch {
    // Hold the last known count. Flashing to zero on a dropped request would
    // read as "all caught up", which is worse than being slightly stale.
  }
}

function activateUnreadEvents(
  accountId: string | null,
  eventIds: string[],
  browserOffline: boolean,
): void {
  const normalizedEventIds = [...new Set(eventIds)].sort();
  const eventScope = normalizedEventIds.join(':');
  if (
    activeAccountId === accountId &&
    activeEventScope === eventScope &&
    activeBrowserOffline === browserOffline
  ) {
    return;
  }
  const accountOrEventsChanged =
    activeAccountId !== accountId || activeEventScope !== eventScope;
  stopRealtime?.();
  stopRealtime = null;
  activeAccountId = accountId;
  activeEventScope = eventScope;
  activeBrowserOffline = browserOffline;
  if (accountOrEventsChanged) {
    total = 0;
    emit();
    void setBadge(0);
  }

  // Offline preparation already stored the inbox. The inbox hook publishes
  // its cached unread total when opened; until then, preserve the last known
  // value and do not start a doomed HTTP/WebSocket connection.
  if (browserOffline || !accountId) return;

  const stops = [
    subscribeToMessages(null, null, () =>
      void refreshUnread(eventScope, accountId),
    ),
    subscribeToMessageReactions(null, () =>
      void refreshUnread(eventScope, accountId),
    ),
  ];
  stopRealtime = () => {
    stops.forEach((stop) => stop());
  };
  void refreshUnread(eventScope, accountId);
}

export function useUnreadTotal(
  accountId: string | null,
  eventIds: string[],
): number {
  const browserOffline = useBrowserDefinitelyOffline();
  const eventScope = [...new Set(eventIds)].sort().join(':');

  useEffect(() => {
    activateUnreadEvents(
      accountId,
      eventScope ? eventScope.split(':') : [],
      browserOffline,
    );
  }, [accountId, browserOffline, eventScope]);

  return useSyncExternalStore(
    subscribe,
    () => total,
    () => 0,
  );
}
