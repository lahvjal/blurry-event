import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';

import { cacheStore, mutationStore, requestPersistentStorage } from '@/lib/offline/store';
import {
  ServerScoreRevision,
  compareScoreRevision,
  serverHasCaughtUp,
} from '@/lib/offline/score-revisions';
import {
  MutationPayload,
  QueuedMutation,
  dedupeKeyFor,
  uuid,
} from '@/lib/offline/types';
import { isPermanentError, supabase } from '@/lib/supabase';
import type { ChatMessage } from '@/state/types';

/**
 * Offline-first write queue.
 *
 * Every mutation is committed to durable local storage *before* the UI is told
 * it succeeded, then drained to Supabase in the background. Nothing is deleted
 * locally until the server confirms it, so closing the app the instant after
 * entering a score cannot lose it.
 *
 * Score conflict policy lives in submit_offline_score: a mutation UUID makes
 * retries idempotent and (clientUpdatedAt, clientVersion, mutation UUID)
 * deterministically rejects an older arrival instead of arrival-last-wins.
 */

export type ConnectionState = 'online' | 'offline' | 'syncing' | 'error';

export type SyncStatus = {
  connection: ConnectionState;
  /** Writes still waiting for the server. */
  pending: number;
  /** Waiting writes belonging to the event currently on screen. */
  focusedPending: number;
  /** Focused-event writes that need an explicit retry. */
  focusedFailed: number;
  /** Account-wide failures remain on-device until a human retries them. */
  failed: number;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type ScoreMutationPayload = Extract<MutationPayload, { kind: 'score' }>;
type EnqueuePayload =
  | Exclude<MutationPayload, ScoreMutationPayload>
  | (Omit<ScoreMutationPayload, 'clientVersion'> & { clientVersion?: number });

type Listener = (status: SyncStatus) => void;
export type ScoreConflictResolution = {
  eventId: string;
  entrantId: string;
  hole: number;
  strokes: number;
  updatedAt: string;
  clientVersion: number;
  mutationId: string | null;
};
type ScoreConflictListener = (resolution: ScoreConflictResolution) => void;
type SendResult = {
  disposition: 'remove' | 'retain-overlay';
  conflict?: ScoreConflictResolution;
};

const LAST_SYNCED_PREFIX = 'lastSyncedAt.v2';
/** Periodic sweep while the app is open, in case every other trigger misses. */
const POLL_MS = 30_000;

let pendingCount = 0;
let focusedPendingCount = 0;
let focusedFailedCount = 0;
let failedCount = 0;
let networkUp = true;
/** Set false when a request actually fails despite the OS reporting a network. */
let serverReachable = true;
let syncing = false;
let flushRequested = false;
let lastSyncedAt: string | null = null;
let lastError: string | null = null;
let started = false;
let activeScope: {
  userId: string;
  eventId: string;
  accessibleEventIds: ReadonlySet<string>;
} | null = null;

let lastClientVersion = 0;

function nextClientVersion(): number {
  const timeVersion = Date.now() * 1_000;
  lastClientVersion = Math.max(timeVersion, lastClientVersion + 1);
  return lastClientVersion;
}

const listeners = new Set<Listener>();
const scoreConflictListeners = new Set<ScoreConflictListener>();

function connection(): ConnectionState {
  if (syncing) return 'syncing';
  if (lastError || failedCount > 0) return 'error';
  if (!networkUp || !serverReachable) return 'offline';
  return 'online';
}

function status(): SyncStatus {
  return {
    connection: connection(),
    pending: pendingCount,
    focusedPending: focusedPendingCount,
    focusedFailed: focusedFailedCount,
    failed: failedCount,
    lastSyncedAt,
    lastError,
  };
}

function emit() {
  const snapshot = status();
  listeners.forEach((listener) => listener(snapshot));
}

async function refreshCount() {
  if (!activeScope) {
    pendingCount = 0;
    focusedPendingCount = 0;
    focusedFailedCount = 0;
    failedCount = 0;
    return;
  }
  const queue = await mutationStore.outstanding();
  const scoped = queue.filter(mutationMatchesActiveAccount);
  pendingCount = scoped.filter(
    (mutation) => mutation.syncStatus !== 'failed',
  ).length;
  focusedPendingCount = scoped.filter(
    (mutation) => mutation.eventId === activeScope?.eventId,
  ).length;
  focusedFailedCount = scoped.filter(
    (mutation) =>
      mutation.eventId === activeScope?.eventId &&
      mutation.syncStatus === 'failed',
  ).length;
  failedCount = scoped.filter((mutation) => mutation.syncStatus === 'failed').length;
}

function mutationMatchesActiveAccount(mutation: QueuedMutation): boolean {
  return Boolean(activeScope && mutationMatchesScope(mutation, activeScope));
}

function mutationMatchesScope(
  mutation: QueuedMutation,
  scope: {
    userId: string;
    accessibleEventIds: ReadonlySet<string>;
  },
): boolean {
  return (
    mutation.userId === scope.userId &&
    (mutation.payload.kind === 'message' ||
      scope.accessibleEventIds.has(mutation.eventId))
  );
}

function lastSyncedKey(scope: { userId: string; eventId: string }): string {
  return `${LAST_SYNCED_PREFIX}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.eventId)}`;
}

/** Push one mutation to Supabase. Throws to keep it queued. */
async function send(mutation: QueuedMutation): Promise<SendResult> {
  const payload = mutation.payload;

  switch (payload.kind) {
    case 'score': {
      const { data, error } = await supabase
        .rpc('submit_offline_score', {
          p_event_id: payload.eventId,
          p_team_id: payload.teamId,
          p_participant_id: payload.participantId,
          p_hole: payload.hole,
          p_strokes: payload.strokes,
          p_entered_by: payload.enteredBy,
          p_client_updated_at: payload.clientUpdatedAt,
          p_client_version: payload.clientVersion ?? mutation.generation ?? 0,
          p_mutation_id: mutation.id,
        })
        .single<{
          applied: boolean;
          score_strokes: number;
          score_hole: number;
          score_client_updated_at: string;
          score_client_version: number;
          score_mutation_id: string | null;
        }>();
      if (error) throw error;
      // Keep an accepted score as a local overlay until a subsequent server
      // bundle contains it. This closes the "sync, kill app, reopen offline"
      // window where the queue was gone but the cached snapshot was still old.
      if (data?.applied) return { disposition: 'retain-overlay' };
      const entrantId = payload.teamId ?? payload.participantId;
      return {
        disposition: 'remove',
        ...(data && entrantId
          ? {
              conflict: {
                eventId: payload.eventId,
                entrantId,
                hole: data.score_hole,
                strokes: data.score_strokes,
                updatedAt: data.score_client_updated_at,
                clientVersion: Number(data.score_client_version),
                mutationId: data.score_mutation_id,
              },
            }
          : {}),
      };
    }
    case 'message': {
      const { error } = await supabase.from('messages').insert({
        event_id: payload.eventId,
        conversation_id: payload.conversationId,
        sender_id: payload.senderId,
        body: payload.body,
        client_id: payload.clientId,
        ...(payload.replyToId ? { reply_to_id: payload.replyToId } : {}),
        ...(payload.media
          ? {
              media_url: payload.media.url,
              media_mime_type: payload.media.mimeType,
              media_width: payload.media.width,
              media_height: payload.media.height,
            }
          : {}),
      });
      // A duplicate client_id means a previous attempt actually landed.
      if (error && error.code !== '23505') throw error;
      // Keep the optimistic bubble until a later authoritative message page
      // contains this client ID. This mirrors score overlays and closes the
      // successful-sync/app-close/cache-still-old gap.
      return { disposition: 'retain-overlay' };
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
      return { disposition: 'remove' };
    }
  }
}

/** Ensure queued writes cannot be replayed under a stale or different login. */
async function prepareAuthentication(userId: string): Promise<void> {
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  let session = current.data.session;
  if (!session || session.user.id !== userId) {
    throw Object.assign(
      new Error('Sign in to the account that saved these scores before syncing.'),
      { code: 'AUTH_SCOPE_MISMATCH' },
    );
  }

  // Supabase normally refreshes automatically. Do it explicitly before a
  // drain when the token is close to expiry so an 18-hole offline queue does
  // not partly upload and then stall on an expired JWT.
  const expiresAtMs = (session.expires_at ?? 0) * 1_000;
  if (expiresAtMs > Date.now() + 5 * 60_000) return;
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;
  session = refreshed.data.session;
  if (!session || session.user.id !== userId) {
    throw Object.assign(new Error('The saved score account could not be refreshed.'), {
      code: 'AUTH_SCOPE_MISMATCH',
    });
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
  if (syncing) {
    flushRequested = true;
    return;
  }
  if (!activeScope) {
    pendingCount = 0;
    focusedPendingCount = 0;
    focusedFailedCount = 0;
    failedCount = 0;
    emit();
    return;
  }
  const scope = activeScope;

  // Failed rows stay visible but automatic retry stops. A human can reset
  // them through syncNow after correcting auth/permissions/connectivity.
  const queue = (await mutationStore.outstanding()).filter(
    (mutation) =>
      mutation.syncStatus !== 'failed' && mutationMatchesScope(mutation, scope),
  );
  if (queue.length === 0) {
    await refreshCount();
    emit();
    return;
  }
  if (!networkUp) {
    await refreshCount();
    emit();
    return;
  }

  syncing = true;
  flushRequested = false;
  emit();

  try {
    try {
      await prepareAuthentication(scope.userId);
    } catch (error) {
      const err = error as { message?: string };
      serverReachable = false;
      lastError = err.message ?? 'Could not refresh sign-in before syncing';
      return;
    }

    for (const mutation of queue) {
      if (activeScope?.userId !== scope.userId) break;
      await mutationStore.put({
        ...mutation,
        syncStatus: 'syncing',
        updatedAt: new Date().toISOString(),
      });

      try {
        const result = await send(mutation);
        if (result.disposition === 'retain-overlay') {
          // Server-confirmed scores remain as a zero-count overlay only until
          // the next authoritative event bundle observes them.
          await mutationStore.put({
            ...mutation,
            syncStatus: 'synced',
            attemptCount: mutation.attemptCount,
            lastError: null,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Exact id + generation acknowledgement cannot remove a newer edit.
          await mutationStore.remove(mutation.id, mutation.generation ?? 0);
        }
        if (result.conflict) {
          scoreConflictListeners.forEach((listener) => listener(result.conflict!));
        }
        serverReachable = true;
        lastError = null;
      } catch (error) {
        const err = error as { code?: string; message?: string };
        const attemptCount = mutation.attemptCount + 1;
        const permanent = isPermanentError(err);

        await mutationStore.put({
          ...mutation,
          syncStatus: permanent ? 'failed' : 'pending',
          attemptCount,
          lastError: err?.message ?? 'Sync failed',
          updatedAt: new Date().toISOString(),
        });

        if (permanent) {
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
    if (pendingCount === 0 && failedCount === 0 && !lastError) {
      lastSyncedAt = new Date().toISOString();
      void cacheStore.set(lastSyncedKey(scope), lastSyncedAt);
    }
  } finally {
    syncing = false;
    emit();
    if (activeScope && (activeScope.userId !== scope.userId || flushRequested)) {
      flushRequested = false;
      void flush();
    }
  }
}

/**
 * Records a mutation durably, then tries to send it.
 *
 * Resolves once the write is committed locally — that is the point at which the
 * UI may report the score as saved.
 */
export async function enqueue(payload: EnqueuePayload): Promise<void> {
  if (!activeScope) {
    throw new Error('No signed-in event is selected for offline writes.');
  }
  if (
    payload.kind === 'score' &&
    payload.eventId !== activeScope.eventId
  ) {
    throw new Error('Refusing to queue a write for a different event.');
  }
  if (payload.kind === 'profile' && payload.userId !== activeScope.userId) {
    throw new Error('Refusing to queue a profile write for a different account.');
  }
  const normalizedPayload: MutationPayload =
    payload.kind === 'score'
      ? { ...payload, clientVersion: payload.clientVersion ?? nextClientVersion() }
      : payload;
  const dedupeKey = [
    'scope',
    encodeURIComponent(activeScope.userId),
    encodeURIComponent(activeScope.eventId),
    dedupeKeyFor(normalizedPayload),
  ].join(':');
  const now = new Date().toISOString();

  // Every correction is a new immutable row. Reusing the older row is unsafe:
  // its in-flight acknowledgement could otherwise delete the replacement.
  const generation =
    normalizedPayload.kind === 'score'
      ? normalizedPayload.clientVersion
      : nextClientVersion();
  const mutation: QueuedMutation = {
    id: uuid(),
    userId: activeScope.userId,
    eventId: payload.kind === 'message' ? payload.eventId : activeScope.eventId,
    dedupeKey,
    generation,
    payload: normalizedPayload,
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

export type CollectedScoreRevision = {
  mutationId: string;
  hole: number;
  clientVersion: number;
};

/**
 * Atomically queues a collector's complete 18-hole card. The receipt remains
 * one user action in the UI, while the existing per-hole RPC retains its
 * conflict and idempotency behavior on the server.
 */
export async function enqueueCollectedScorecard(input: {
  eventId: string;
  teamId: string | null;
  participantId: string | null;
  scores: readonly number[];
  enteredBy: string;
  clientUpdatedAt: string;
  clientVersion: number;
}): Promise<CollectedScoreRevision[]> {
  if (!activeScope) {
    throw new Error('No signed-in event is selected for offline writes.');
  }
  if (input.eventId !== activeScope.eventId) {
    throw new Error('Refusing to collect a scorecard for a different event.');
  }
  if (Number(Boolean(input.teamId)) + Number(Boolean(input.participantId)) !== 1) {
    throw new Error('A collected scorecard must belong to one team or player.');
  }
  if (
    input.scores.length !== 18 ||
    !input.scores.every(
      (score) => Number.isInteger(score) && score >= 1 && score <= 20,
    )
  ) {
    throw new Error('A collected scorecard must contain 18 valid scores.');
  }
  if (
    !Number.isSafeInteger(input.clientVersion) ||
    input.clientVersion < 0 ||
    input.clientVersion > Number.MAX_SAFE_INTEGER - input.scores.length
  ) {
    throw new Error('The collected scorecard has an invalid revision.');
  }

  const now = new Date().toISOString();
  const mutations = input.scores.map((strokes, index): QueuedMutation => {
    const payload: ScoreMutationPayload = {
      kind: 'score',
      eventId: input.eventId,
      teamId: input.teamId,
      participantId: input.participantId,
      hole: index + 1,
      strokes,
      enteredBy: input.enteredBy,
      clientUpdatedAt: input.clientUpdatedAt,
      clientVersion: input.clientVersion + index,
    };
    const dedupeKey = [
      'scope',
      encodeURIComponent(activeScope!.userId),
      encodeURIComponent(activeScope!.eventId),
      dedupeKeyFor(payload),
    ].join(':');
    const id = uuid();
    return {
      id,
      userId: activeScope!.userId,
      eventId: activeScope!.eventId,
      dedupeKey,
      generation: payload.clientVersion,
      payload,
      syncStatus: 'pending',
      attemptCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  // One IndexedDB transaction means a dead battery cannot leave a card half
  // collected. Native is retained for source parity even though this is a PWA.
  await mutationStore.putMany(mutations);
  lastClientVersion = Math.max(
    lastClientVersion,
    input.clientVersion + input.scores.length - 1,
  );
  await refreshCount();
  emit();
  void flush();

  return mutations.map((mutation) => ({
    mutationId: mutation.id,
    hole: (mutation.payload as ScoreMutationPayload).hole,
    clientVersion: mutation.generation,
  }));
}

export type LocalScoreOverlay = {
  mutationId: string;
  entrantId: string;
  hole: number;
  strokes: number;
  enteredBy: string | null;
  clientUpdatedAt: string;
  clientVersion: number;
  syncStatus: QueuedMutation['syncStatus'];
};

export async function loadMessageOverlays(params: {
  userId: string;
  eventId: string;
  conversationId: string;
  authoritativeMessages?: ChatMessage[];
}): Promise<ChatMessage[]> {
  const rows = (await mutationStore.all()).filter(
    (mutation) =>
      mutation.userId === params.userId &&
      mutation.eventId === params.eventId &&
      mutation.payload.kind === 'message' &&
      mutation.payload.conversationId === params.conversationId,
  );
  const authoritativeClientIds = new Set(
    params.authoritativeMessages?.map((message) => message.clientId) ?? [],
  );
  const overlays: ChatMessage[] = [];
  for (const mutation of rows) {
    const payload = mutation.payload;
    if (payload.kind !== 'message') continue;
    if (
      mutation.syncStatus === 'synced' &&
      authoritativeClientIds.has(payload.clientId)
    ) {
      await mutationStore.remove(mutation.id, mutation.generation ?? 0);
      continue;
    }
    overlays.push({
      id: `local-${payload.clientId}`,
      eventId: payload.eventId,
      conversationId: payload.conversationId,
      senderId: payload.senderId,
      body: payload.body,
      replyToId: payload.replyToId ?? null,
      clientId: payload.clientId,
      createdAt: mutation.createdAt,
      editedAt: null,
      media: payload.media ?? null,
      reactions: [],
      pending: mutation.syncStatus !== 'synced',
      deliveryState:
        mutation.syncStatus === 'failed'
          ? 'failed'
          : mutation.syncStatus === 'synced'
            ? 'sent'
            : 'queued',
    });
  }
  return overlays.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Loads the locally authoritative card edits for an account/event. Pending and
 * failed writes always overlay cached/server state. A server-confirmed row is
 * retained only until an authoritative bundle catches up with (or supersedes)
 * it, closing the app-kill-after-sync snapshot race without masking later
 * teammate edits forever.
 */
export async function loadScoreOverlays(params: {
  userId: string;
  eventId: string;
  authoritativeScores?: ServerScoreRevision[];
}): Promise<LocalScoreOverlay[]> {
  const rows = (await mutationStore.all()).filter(
    (mutation) =>
      mutation.userId === params.userId &&
      mutation.eventId === params.eventId &&
      mutation.payload.kind === 'score',
  );

  const serverByHole = new Map(
    (params.authoritativeScores ?? []).map((score) => [
      `${score.entrantId}:${score.hole}`,
      score,
    ]),
  );
  const overlays: LocalScoreOverlay[] = [];

  for (const mutation of rows) {
    const payload = mutation.payload;
    if (payload.kind !== 'score') continue;
    const entrantId = payload.teamId ?? payload.participantId;
    if (!entrantId) continue;
    const clientVersion = payload.clientVersion ?? mutation.generation ?? 0;

    if (mutation.syncStatus === 'synced' && params.authoritativeScores) {
      const server = serverByHole.get(`${entrantId}:${payload.hole}`);
      const serverCaughtUp = serverHasCaughtUp(
        {
          mutationId: mutation.id,
          entrantId,
          hole: payload.hole,
          clientUpdatedAt: payload.clientUpdatedAt,
          clientVersion,
        },
        server,
      );
      if (serverCaughtUp) {
        await mutationStore.remove(mutation.id, mutation.generation ?? 0);
        continue;
      }
    }

    overlays.push({
      mutationId: mutation.id,
      entrantId,
      hole: payload.hole,
      strokes: payload.strokes,
      enteredBy: payload.enteredBy,
      clientUpdatedAt: payload.clientUpdatedAt,
      clientVersion,
      syncStatus: mutation.syncStatus,
    });
  }

  // Apply older revisions first so the latest edit owns each final card slot.
  return overlays.sort((left, right) =>
    compareScoreRevision(left, right),
  );
}

export function subscribeToSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(status());
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeToScoreConflicts(
  listener: ScoreConflictListener,
): () => void {
  scoreConflictListeners.add(listener);
  return () => scoreConflictListeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status();
}

/** User-initiated retry. Clears the sticky error so the state can recover. */
export async function syncNow(): Promise<void> {
  lastError = null;
  serverReachable = true;
  // Failed writes are worth one more try when a human explicitly asks.
  const queue = (await mutationStore.outstanding()).filter(
    mutationMatchesActiveAccount,
  );
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

/**
 * Selects the signed-in account and every event it may drain. The focused
 * event remains separate for UI counts and enqueue validation. Legacy rows
 * without exact scope fields stay inert under a different login or event.
 */
export function setSyncScope(
  userId: string | null,
  eventId: string | null,
  accessibleEventIds: readonly string[] = eventId ? [eventId] : [],
): void {
  const nextEventIds = new Set(accessibleEventIds);
  if (eventId) nextEventIds.add(eventId);
  const next = userId
    ? {
        userId,
        eventId: eventId ?? 'account',
        accessibleEventIds: nextEventIds,
      }
    : null;
  const sameEvents = Boolean(
    activeScope &&
      next &&
      activeScope.accessibleEventIds.size === next.accessibleEventIds.size &&
      [...activeScope.accessibleEventIds].every((id) =>
        next.accessibleEventIds.has(id),
      ),
  );
  if (
    activeScope?.userId === next?.userId &&
    activeScope?.eventId === next?.eventId &&
    sameEvents
  ) {
    return;
  }
  activeScope = next;
  pendingCount = 0;
  focusedPendingCount = 0;
  focusedFailedCount = 0;
  failedCount = 0;
  lastSyncedAt = null;
  lastError = null;
  emit();

  if (!next) return;
  void cacheStore.get<string>(lastSyncedKey(next)).then((value) => {
    if (
      activeScope?.userId !== next.userId ||
      activeScope?.eventId !== next.eventId
    ) return;
    lastSyncedAt = value;
    emit();
  });
  void refreshCount().then(() => {
    emit();
    return flush();
  });
}
