import type { EventBundle } from '@/lib/api';
import { cacheStore } from '@/lib/offline/store';
import type { EventSnapshot as LegacyEventSnapshot } from '@/lib/offline/snapshot';
import type { OfflinePreparationManifest } from '@/lib/offline/preparation-manifest';
import type { AccountEventAccess } from '@/state/types';

export type {
  OfflinePreparationManifest,
  OfflinePreparationManifestStatus,
  OfflinePreparedEvent,
} from '@/lib/offline/preparation-manifest';

const LEGACY_SNAPSHOT_KEY = 'eventSnapshot.v1';
const EVENT_SNAPSHOT_PREFIX = 'eventSnapshot.v2';
const LAST_EVENT_PREFIX = 'eventSnapshot.v2.last';
const ACCOUNT_ACCESS_PREFIX = 'eventAccess.v1';
const OFFLINE_PREPARATION_PREFIX = 'offlinePreparation.v1';
const OFFLINE_PREPARATION_STAGING_PREFIX = 'offlinePreparation.staging.v1';
const PREPARED_ACCOUNT_KEY = 'offlinePreparation.lastReadyAccount.v1';

export type EventSnapshot = {
  savedAt: string;
  userId: string;
  eventId: string;
  bundle: EventBundle;
};

function eventSnapshotKey(userId: string, eventId: string): string {
  return `${EVENT_SNAPSHOT_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(eventId)}`;
}

function lastEventKey(userId: string): string {
  return `${LAST_EVENT_PREFIX}:${encodeURIComponent(userId)}`;
}

function accountAccessKey(userId: string): string {
  return `${ACCOUNT_ACCESS_PREFIX}:${encodeURIComponent(userId)}`;
}

function offlinePreparationKey(userId: string): string {
  return `${OFFLINE_PREPARATION_PREFIX}:${encodeURIComponent(userId)}`;
}

function offlinePreparationStagingKey(userId: string): string {
  return `${OFFLINE_PREPARATION_STAGING_PREFIX}:${encodeURIComponent(userId)}`;
}

function matchesScope(
  snapshot: EventSnapshot | null,
  userId: string,
  eventId: string,
): snapshot is EventSnapshot {
  return Boolean(
    snapshot &&
      snapshot.userId === userId &&
      snapshot.eventId === eventId &&
      snapshot.bundle?.event?.id === eventId,
  );
}

function withLifecycle(snapshot: EventSnapshot): EventSnapshot {
  if (snapshot.bundle.event.lifecycleStatus) return snapshot;
  return {
    ...snapshot,
    bundle: {
      ...snapshot.bundle,
      event: { ...snapshot.bundle.event, lifecycleStatus: 'published' },
    },
  };
}

async function writeSnapshot(snapshot: EventSnapshot): Promise<void> {
  await cacheStore.set(
    eventSnapshotKey(snapshot.userId, snapshot.eventId),
    snapshot,
  );
  await cacheStore.set(lastEventKey(snapshot.userId), snapshot.eventId);
}

/** Saves a last-known-good PWA bundle under the exact account and event. */
export async function saveEventSnapshot(
  bundle: EventBundle,
  userId: string,
  eventId: string,
): Promise<void> {
  if (bundle.event.id !== eventId) {
    throw new Error('Refusing to cache an event bundle under a different event ID.');
  }
  await writeSnapshot({
    savedAt: new Date().toISOString(),
    userId,
    eventId,
    bundle,
  });
}

/**
 * Reads the v1 cache only when its non-null owner and event match exactly. This
 * preserves an existing install's Invitational cache without ever replaying an
 * anonymous, cross-account, or cross-event bundle.
 */
async function loadSafeLegacySnapshot(
  userId: string,
  eventId?: string,
): Promise<EventSnapshot | null> {
  const legacy = await cacheStore.get<LegacyEventSnapshot>(LEGACY_SNAPSHOT_KEY);
  const legacyEventId = legacy?.bundle?.event?.id;
  if (
    !legacy ||
    legacy.userId !== userId ||
    typeof legacyEventId !== 'string' ||
    (eventId !== undefined && legacyEventId !== eventId)
  ) {
    return null;
  }

  const migrated: EventSnapshot = {
    savedAt: legacy.savedAt,
    userId,
    eventId: legacyEventId,
    bundle: {
      ...legacy.bundle,
      event: {
        ...legacy.bundle.event,
        lifecycleStatus: legacy.bundle.event.lifecycleStatus ?? 'published',
      },
    },
  };
  await writeSnapshot(migrated);
  return migrated;
}

export async function loadEventSnapshot(
  userId: string,
  eventId: string,
): Promise<EventSnapshot | null> {
  const snapshot = await cacheStore.get<EventSnapshot>(
    eventSnapshotKey(userId, eventId),
  );
  if (matchesScope(snapshot, userId, eventId)) return withLifecycle(snapshot);
  return loadSafeLegacySnapshot(userId, eventId);
}

/**
 * Offline bootstrap before access can be refreshed. The pointer is per-account
 * and is validated again against the scoped document before use.
 */
export async function loadLastEventSnapshot(
  userId: string,
): Promise<EventSnapshot | null> {
  const eventId = await cacheStore.get<string>(lastEventKey(userId));
  if (typeof eventId === 'string' && eventId.length > 0) {
    return loadEventSnapshot(userId, eventId);
  }
  return loadSafeLegacySnapshot(userId);
}

/** Accessible-event metadata is safe to use offline only for its exact owner. */
export async function saveAccountEventAccess(
  access: AccountEventAccess,
): Promise<void> {
  await cacheStore.set(accountAccessKey(access.accountId), access);
}

export async function loadAccountEventAccess(
  userId: string,
): Promise<AccountEventAccess | null> {
  const access = await cacheStore.get<AccountEventAccess>(accountAccessKey(userId));
  if (!access || access.accountId !== userId || !Array.isArray(access.events)) {
    return null;
  }
  return {
    ...access,
    events: access.events.map((event) => ({
      ...event,
      lifecycleStatus: event.lifecycleStatus ?? 'published',
    })),
  };
}

export async function saveOfflinePreparationManifest(
  manifest: OfflinePreparationManifest,
): Promise<void> {
  await cacheStore.set(offlinePreparationKey(manifest.accountId), manifest);
}

/**
 * In-progress work is deliberately separate from the last ready receipt. A
 * refresh may be interrupted at any point without invalidating files and data
 * that were already verified for event-day use.
 */
export async function saveOfflinePreparationProgressManifest(
  manifest: OfflinePreparationManifest,
): Promise<void> {
  await cacheStore.set(offlinePreparationStagingKey(manifest.accountId), manifest);
}

export async function loadOfflinePreparationProgressManifest(
  userId: string,
): Promise<OfflinePreparationManifest | null> {
  const manifest = await cacheStore.get<OfflinePreparationManifest>(
    offlinePreparationStagingKey(userId),
  );
  return manifest?.schemaVersion === 1 && manifest.accountId === userId
    ? manifest
    : null;
}

export async function clearOfflinePreparationProgressManifest(
  userId: string,
): Promise<void> {
  await cacheStore.remove(offlinePreparationStagingKey(userId));
}

export async function loadOfflinePreparationManifest(
  userId: string,
): Promise<OfflinePreparationManifest | null> {
  const manifest = await cacheStore.get<OfflinePreparationManifest>(
    offlinePreparationKey(userId),
  );
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.accountId !== userId ||
    !Array.isArray(manifest.selectedEventIds) ||
    !Array.isArray(manifest.completedEventIds)
  ) {
    return null;
  }
  return manifest;
}

export async function clearOfflinePreparationManifest(
  userId: string,
): Promise<void> {
  await cacheStore.remove(offlinePreparationKey(userId));
}

/** Exact owner allowed to reopen a verified install when auth cannot refresh. */
export async function savePreparedOfflineAccountId(userId: string): Promise<void> {
  await cacheStore.set(PREPARED_ACCOUNT_KEY, userId);
}

export async function loadPreparedOfflineAccountId(): Promise<string | null> {
  const userId = await cacheStore.get<string>(PREPARED_ACCOUNT_KEY);
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

export async function clearPreparedOfflineAccountId(): Promise<void> {
  await cacheStore.remove(PREPARED_ACCOUNT_KEY);
}
