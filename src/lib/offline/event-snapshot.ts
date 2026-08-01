import type { EventBundle } from '@/lib/api';
import {
  loadSnapshot,
  saveSnapshot,
} from '@/lib/offline/snapshot';
import type { EventSnapshot as LegacyEventSnapshot } from '@/lib/offline/snapshot';
import type { AccountEventAccess } from '@/state/types';

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
