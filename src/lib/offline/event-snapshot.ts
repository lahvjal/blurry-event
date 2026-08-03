import type { EventBundle } from '@/lib/api';
import {
  loadSnapshot,
  saveSnapshot,
} from '@/lib/offline/snapshot';
import type { EventSnapshot as LegacyEventSnapshot } from '@/lib/offline/snapshot';
import type { AccountEventAccess } from '@/state/types';
import type { OfflinePreparationManifest } from '@/lib/offline/preparation-manifest';

export type {
  OfflinePreparationManifest,
  OfflinePreparationManifestStatus,
  OfflinePreparedEvent,
} from '@/lib/offline/preparation-manifest';

/**
 * Non-web compatibility adapter. The PWA replaces this module with the .web
 * implementation; other platforms retain the existing snapshot behavior.
 */
export type EventSnapshot = LegacyEventSnapshot;

export async function saveEventSnapshot(
  bundle: EventBundle,
  userId: string,
  _eventId: string,
): Promise<void> {
  await saveSnapshot(bundle, userId);
}

export async function loadEventSnapshot(
  userId: string,
  _eventId: string,
): Promise<EventSnapshot | null> {
  return loadSnapshot(userId);
}

export async function loadLastEventSnapshot(
  userId: string,
): Promise<EventSnapshot | null> {
  return loadSnapshot(userId);
}

export async function saveAccountEventAccess(
  _access: AccountEventAccess,
): Promise<void> {}

export async function loadAccountEventAccess(
  _userId: string,
): Promise<AccountEventAccess | null> {
  return null;
}

/** Offline preparation is a PWA-only concern; native keeps its existing cache. */
export async function saveOfflinePreparationManifest(
  _manifest: OfflinePreparationManifest,
): Promise<void> {}

export async function loadOfflinePreparationManifest(
  _userId: string,
): Promise<OfflinePreparationManifest | null> {
  return null;
}

export const saveOfflinePreparationProgressManifest =
  saveOfflinePreparationManifest;

export const loadOfflinePreparationProgressManifest =
  loadOfflinePreparationManifest;

export async function clearOfflinePreparationProgressManifest(
  _userId: string,
): Promise<void> {}

export async function clearOfflinePreparationManifest(
  _userId: string,
): Promise<void> {}

export async function savePreparedOfflineAccountId(
  _userId: string,
): Promise<void> {}

export async function loadPreparedOfflineAccountId(): Promise<string | null> {
  return null;
}

export async function clearPreparedOfflineAccountId(): Promise<void> {}
