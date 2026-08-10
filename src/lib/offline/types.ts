/**
 * Durable offline storage contracts.
 *
 * Two stores back the offline experience:
 *  - the mutation queue, which must never lose a write, and
 *  - the event snapshot, which lets the scorecard open with no signal.
 *
 * Both are described here as interfaces so web can use IndexedDB (Dexie) while
 * native keeps AsyncStorage, with one implementation swapped in at import time.
 */

/** Where a queued write is in its journey to Supabase. */
export type SyncState = 'pending' | 'syncing' | 'synced' | 'failed';

/** The payloads the queue knows how to send. */
export type MutationPayload =
  | {
      kind: 'score';
      eventId: string;
      /** Set under a scramble, where the card belongs to the team. */
      teamId: string | null;
      /** Set under solo play. Exactly one of the two is set. */
      participantId: string | null;
      hole: number;
      strokes: number;
      enteredBy: string | null;
      /** When the device recorded it — the tiebreaker for last-write-wins. */
      clientUpdatedAt: string;
      /** Monotonic on this JS runtime; breaks same-timestamp edit ties. */
      clientVersion: number;
    }
  | {
      kind: 'message';
      eventId: string;
      conversationId: string;
      senderId: string;
      body: string;
      replyToId?: string | null;
      media?: {
        url: string;
        mimeType: string;
        width: number | null;
        height: number | null;
      } | null;
      clientId: string;
    }
  | {
      kind: 'profile';
      userId: string;
      displayName?: string;
      avatarUrl?: string;
    };

export type QueuedMutation = {
  /** Client-generated UUID, so a record created offline is already addressable. */
  id: string;
  /** Exact authenticated account that created this write. */
  userId: string;
  /** Exact focused event; account-level writes still retain their source event. */
  eventId: string;
  /**
   * Identifies the thing being written, not the write itself. Two edits to the
   * same hole share a key but remain immutable revisions. That lets the server
   * order them while an old in-flight acknowledgement targets only its row.
   */
  dedupeKey: string;
  /**
   * Immutable revision for this logical write. Score corrections create a new
   * row instead of replacing an in-flight row, so acknowledging an old send
   * can never delete a newer edit.
   */
  generation: number;
  payload: MutationPayload;
  syncStatus: SyncState;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface MutationStore {
  /** All rows, including short-lived server-confirmed score overlays. */
  all(): Promise<QueuedMutation[]>;
  /** Everything not yet confirmed by the server, oldest first. */
  outstanding(): Promise<QueuedMutation[]>;
  get(id: string): Promise<QueuedMutation | undefined>;
  put(mutation: QueuedMutation): Promise<void>;
  /** Commits a complete group of related writes in one durable transaction. */
  putMany(mutations: QueuedMutation[]): Promise<void>;
  /** Delete only when both the id and immutable generation still match. */
  remove(id: string, generation?: number): Promise<boolean>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

/** RFC4122-ish v4, using crypto when available. */
export function uuid(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** One canonical write per entrant + hole; later edits supersede earlier ones. */
export function dedupeKeyFor(payload: MutationPayload): string {
  switch (payload.kind) {
    case 'score': {
      const entrant = payload.teamId ?? payload.participantId ?? 'unknown';
      return `score:${payload.eventId}:${entrant}:${payload.hole}`;
    }
    case 'message':
      // Messages are append-only, so each one is its own key.
      return `message:${payload.clientId}`;
    case 'profile':
      return `profile:${payload.userId}`;
  }
}
