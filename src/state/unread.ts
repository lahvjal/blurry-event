import { useEffect, useSyncExternalStore } from 'react';

import { setBadge } from '@/lib/badge';
import {
  fetchConversationSummaries,
  subscribeToMessageReactions,
  subscribeToMessages,
} from '@/lib/chat';
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
let started = false;
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
export function setUnreadTotal(next: number): void {
  if (next === total) return;
  total = next;
  emit();
  void setBadge(next);
}

/** Asks the server for the current count. */
export async function refreshUnread(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setUnreadTotal(0);
      return;
    }
    const summaries = await fetchConversationSummaries();
    setUnreadTotal(summaries.reduce((sum, c) => sum + c.unreadCount, 0));
  } catch {
    // Hold the last known count. Flashing to zero on a dropped request would
    // read as "all caught up", which is worse than being slightly stale.
  }
}

export function useUnreadTotal(): number {
  useEffect(() => {
    // First mount anywhere starts the one subscription the app needs; the
    // module-level flag keeps later mounts from opening more.
    if (started) return;
    started = true;
    void refreshUnread();
    subscribeToMessages(null, () => void refreshUnread());
    subscribeToMessageReactions(() => void refreshUnread());
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => total,
    () => 0,
  );
}
