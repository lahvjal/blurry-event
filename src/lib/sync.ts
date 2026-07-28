import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';

import { ensureRound } from '@/lib/api';
import { cacheStore, mutationStore, requestPersistentStorage } from '@/lib/offline/store';
import {
  MutationPayload,
  QueuedMutation,
  dedupeKeyFor,
  uuid,
} from '@/lib/offline/types';
import { isPermanentError, supabase } from '@/lib/supabase';

/**
 * Offline-first write queue.
 *
 * Every mutation is committed to durable local storage *before* the UI is told
 * it succeeded, then drained to Supabase in the background. Nothing is deleted
 * locally until the server confirms it, so closing the app the instant after
 * entering a score cannot lose it.
 *
 * Conflict policy: writes are idempotent upserts keyed on (round, hole) and
 * carry the device's `clientUpdatedAt`. If two devices score the same hole, the
 * last write to reach Supabase wins the row, and `client_updated_at` records
 * which device's clock produced it. That is deliberately simple — for a
 * one-day event, predictable beats clever.
 */

export type ConnectionState = 'online' | 'offline' | 'syncing' | 'error';

export type SyncStatus = {
  connection: ConnectionState;
  /** Writes still waiting for the server. */
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type Listener = (status: SyncStatus) => void;

const LAST_SYNCED_KEY = 'lastSyncedAt';
/** Give up retrying one mutation after this many attempts; keep it, flag it. */
const MAX_ATTEMPTS = 8;
/** Periodic sweep while the app is open, in case every other trigger misses. */
const POLL_MS = 30_000;

let pendingCount = 0;
let networkUp = true;
/** Set false when a request actually fails despite the OS reporting a network. */
let serverReachable = true;
let syncing = false;
let lastSyncedAt: string | null = null;
let lastError: string | null = null;
let started = false;

const listeners = new Set<Listener>();

function connection(): ConnectionState {
  if (syncing) return 'syncing';
  if (!networkUp || !serverReachable) return 'offline';
  if (lastError) return 'error';
  return 'online';
}

function status(): SyncStatus {
  return { connection: connection(), pending: pendingCount, lastSyncedAt, lastError };
}

function emit() {
  const snapshot = status();
  listeners.forEach((listener) => listener(snapshot));
}

async function refreshCount() {
  pendingCount = await mutationStore.count();
}

/** Push one mutation to Supabase. Throws to keep it queued. */
async function send(mutation: QueuedMutation): Promise<void> {
  const payload = mutation.payload;

  switch (payload.kind) {
    case 'score': {
      // Resolved at send time, not enqueue time, so the first score of a round
      // can be entered with no signal — the round is created on the way out.
      const roundId = await ensureRound({
        eventId: payload.eventId,
        teamId: payload.teamId,
        participantId: payload.participantId,
      });

      const { error } = await supabase.from('scores').upsert(
        {
          round_id: roundId,
          hole: payload.hole,
          strokes: payload.strokes,
          entered_by: payload.enteredBy,
          client_updated_at: payload.clientUpdatedAt,
        },
        { onConflict: 'round_id,hole' },
      );
      if (error) throw error;
      return;
    }
    case 'message': {
      const { error } = await supabase.from('messages').insert({
        conversation_id: payload.conversationId,
        sender_id: payload.senderId,
        body: payload.body,
        client_id: payload.clientId,
      });
      // A duplicate client_id means a previous attempt actually landed.
      if (error && error.code !== '23505') throw error;
      return;
    }
    case 'profile': {
      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: payload.displayName,
          avatar_url: payload.avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.userId);
      if (error) throw error;
      return;
    }
  }
}

/**
 * Drains outstanding mutations oldest-first.
 *
 * A transport failure (no signal, server unreachable) stops the drain and
 * leaves everything queued — the write is not lost and ordering holds. A
 * *rejected* write is different: retrying it forever would strand everything
 * behind it, so it's marked failed and the drain continues past it.
 */
export async function flush(): Promise<void> {
  if (syncing) return;

  const queue = await mutationStore.outstanding();
  if (queue.length === 0) {
    pendingCount = 0;
    emit();
    return;
  }
  if (!networkUp) {
    pendingCount = queue.length;
    emit();
    return;
  }

  syncing = true;
  emit();

  try {
    for (const mutation of queue) {
      await mutationStore.put({
        ...mutation,
        syncStatus: 'syncing',
        updatedAt: new Date().toISOString(),
      });

      try {
        await send(mutation);
        // Confirmed by the server — only now is it safe to drop locally.
        await mutationStore.remove(mutation.id);
        serverReachable = true;
        lastError = null;
      } catch (error) {
        const err = error as { code?: string; message?: string };
        const attemptCount = mutation.attemptCount + 1;
        const permanent = isPermanentError(err);
        const exhausted = attemptCount >= MAX_ATTEMPTS;

        await mutationStore.put({
          ...mutation,
          syncStatus: permanent || exhausted ? 'failed' : 'pending',
          attemptCount,
          lastError: err?.message ?? 'Sync failed',
          updatedAt: new Date().toISOString(),
        });

        if (permanent || exhausted) {
          // Skip it and keep going so one bad write can't block the round.
          lastError = err?.message ?? 'A write was rejected';
          continue;
        }

        // Transport problem: the device says it's online but the server isn't
        // answering. Stop here and try the whole queue again later.
        serverReachable = false;
        lastError = err?.message ?? 'Could not reach the server';
        break;
      }
    }

    await refreshCount();
    if (pendingCount === 0 && !lastError) {
      lastSyncedAt = new Date().toISOString();
      void cacheStore.set(LAST_SYNCED_KEY, lastSyncedAt);
    }
  } finally {
    syncing = false;
    emit();
  }
}

/**
 * Records a mutation durably, then tries to send it.
 *
 * Resolves once the write is committed locally — that is the point at which the
 * UI may report the score as saved.
 */
export async function enqueue(payload: MutationPayload): Promise<void> {
  const dedupeKey = dedupeKeyFor(payload);
  const now = new Date().toISOString();

  // Re-editing a hole updates the existing queued write rather than adding a
  // second one, so a golfer changing 5 → 4 → 3 sends one score, not three.
  const existing = await mutationStore.findByDedupeKey(dedupeKey);

  const mutation: QueuedMutation = existing
    ? {
        ...existing,
        payload,
        syncStatus: 'pending',
        attemptCount: 0,
        lastError: null,
        updatedAt: now,
      }
    : {
        id: uuid(),
        dedupeKey,
        payload,
        syncStatus: 'pending',
        attemptCount: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };

  await mutationStore.put(mutation);
  await refreshCount();
  emit();

  void flush();
}

export function subscribeToSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(status());
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatus(): SyncStatus {
  return status();
}

/** User-initiated retry. Clears the sticky error so the state can recover. */
export async function syncNow(): Promise<void> {
  lastError = null;
  serverReachable = true;
  // Failed writes are worth one more try when a human explicitly asks.
  const queue = await mutationStore.outstanding();
  await Promise.all(
    queue
      .filter((m) => m.syncStatus === 'failed')
      .map((m) =>
        mutationStore.put({ ...m, syncStatus: 'pending', attemptCount: 0 }),
      ),
  );
  emit();
  await flush();
}

/**
 * Starts connectivity watching and every retry trigger.
 *
 * Browser Background Sync is deliberately not the mechanism here — iOS doesn't
 * support it — so retries are driven in-app: on launch, on regaining focus, on
 * the network coming back, on a timer, and on demand.
 */
export function startSync(): () => void {
  if (started) return () => {};
  started = true;

  const teardown: (() => void)[] = [];

  void requestPersistentStorage();
  void cacheStore.get<string>(LAST_SYNCED_KEY).then((value) => {
    if (value) {
      lastSyncedAt = value;
      emit();
    }
  });

  // 1. Network transitions.
  const netInfoUnsub = NetInfo.addEventListener((state) => {
    const nowOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
    const cameBack = !networkUp && nowOnline;
    networkUp = nowOnline;
    if (cameBack) serverReachable = true;
    emit();
    if (cameBack) void flush();
  });
  teardown.push(netInfoUnsub);

  // 2. App returning to the foreground.
  const appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') void flush();
  });
  teardown.push(() => appStateSub.remove());

  // 3. Browser-specific signals. `navigator.onLine` is only a hint — a phone
  //    attached to a course wifi portal reports online while nothing resolves —
  //    so it triggers an attempt rather than being trusted as truth.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const onOnline = () => {
      networkUp = true;
      serverReachable = true;
      emit();
      void flush();
    };
    const onOffline = () => {
      networkUp = false;
      emit();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flush();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    teardown.push(() => window.removeEventListener('online', onOnline));
    teardown.push(() => window.removeEventListener('offline', onOffline));
    teardown.push(() => document.removeEventListener('visibilitychange', onVisible));

    networkUp = navigator.onLine !== false;
  }

  // 4. Periodic sweep.
  const timer = setInterval(() => {
    void flush();
  }, POLL_MS);
  teardown.push(() => clearInterval(timer));

  // 5. Launch.
  void refreshCount().then(() => {
    emit();
    return flush();
  });

  return () => {
    teardown.forEach((fn) => fn());
    started = false;
  };
}
