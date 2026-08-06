import {
  fetchAccountEventAccess,
  fetchEventBundle,
  type EventBundle,
} from '@/lib/api';
import {
  fetchConversation,
  fetchConversationSummaries,
  fetchMessages,
} from '@/lib/chat';
import {
  saveOfflineConversation,
  saveOfflineConversationSummaries,
  saveOfflineMessages,
} from '@/lib/offline/chat-cache';
import {
  loadAccountEventAccess,
  loadEventSnapshot,
  loadOfflinePreparationManifest,
  loadOfflinePreparationProgressManifest,
  saveAccountEventAccess,
  saveEventSnapshot,
  saveOfflinePreparationManifest,
  saveOfflinePreparationProgressManifest,
  clearOfflinePreparationProgressManifest,
  savePreparedOfflineAccountId,
  type OfflinePreparationManifest,
  type OfflinePreparedEvent,
} from '@/lib/offline/event-snapshot';
import {
  preparePwaShell,
  subscribePwaPrepareProgress,
} from '@/lib/offline/pwa';
import { requestPersistentStorage } from '@/lib/offline/store';
import { hasCompletePreparedEventData } from '@/lib/offline/startup';
import type { AccessibleEvent, AccountEventAccess } from '@/state/types';

export type OfflinePreparationStage =
  | 'checking-storage'
  | 'caching-app'
  | 'loading-events'
  | 'saving-events'
  | 'caching-media'
  | 'finalizing';

export type OfflinePreparationProgress = {
  stage: OfflinePreparationStage;
  message: string;
  completedItems: number;
  totalItems: number;
  /** Weighted overall progress. Item counts above always describe real work. */
  percent: number;
};

export type OfflinePreparationResult = {
  manifest: OfflinePreparationManifest;
  access: AccountEventAccess;
};

export type RunOfflinePreparationOptions = {
  accountId: string;
  signal?: AbortSignal;
  /** A ready install refreshes quietly; first-run and interrupted work resume. */
  forceRefresh?: boolean;
  onProgress?: (progress: OfflinePreparationProgress) => void;
};

type ShellCacheResult = {
  cacheVersion: string | null;
  completed: number;
  total: number;
  failedUrls: string[];
};

type MediaCandidate = {
  url: string;
  required: boolean;
};

const MEDIA_CACHE = 'blurry-event-media-v1';

function abortError(): Error {
  return new DOMException('Offline preparation was cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function stableEventOrder(a: AccessibleEvent, b: AccessibleEvent): number {
  return a.eventDate.localeCompare(b.eventDate) || a.id.localeCompare(b.id);
}

/**
 * Every event visible in the installed app is prepared so the selector never
 * offers a destination that becomes a dead end without signal.
 */
export function selectEventsForOfflinePreparation(
  events: AccessibleEvent[],
  _now = new Date(),
): AccessibleEvent[] {
  // Every event exposed by the selector must have an exact snapshot before
  // the app claims to be offline-ready. This also covers ended events a golfer
  // may revisit and club-admin event switching.
  return [...events].sort((a, b) => {
      if (a.lifecycleStatus === 'live' && b.lifecycleStatus !== 'live') return -1;
      if (b.lifecycleStatus === 'live' && a.lifecycleStatus !== 'live') return 1;
      return stableEventOrder(a, b);
    });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fingerprint(value: unknown): string {
  return fnv1a(JSON.stringify(stableValue(value)));
}

export function accountAccessFingerprint(access: AccountEventAccess): string {
  return fingerprint({
    accountId: access.accountId,
    profile: access.profile,
    events: access.events.map((event) => ({
      id: event.id,
      eventDate: event.eventDate,
      lifecycleStatus: event.lifecycleStatus,
      registration: event.registration,
    })),
  });
}

export function eventBundleFingerprint(bundle: EventBundle): string {
  return fingerprint(bundle);
}

/** Uses Expo's hashed entry asset URLs, with an optional injected build ID. */
export function currentOfflineBuildFingerprint(): string {
  if (typeof document === 'undefined') return 'non-web';
  const explicit = document
    .querySelector('meta[name="blurry-build-id"]')
    ?.getAttribute('content');
  if (explicit) return explicit;

  const assetUrls = Array.from(
    document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
      'script[src], link[rel="stylesheet"][href]',
    ),
  )
    .map((element) =>
      element instanceof HTMLScriptElement ? element.src : element.href,
    )
    .filter(Boolean)
    .sort();
  return `web-${fingerprint(assetUrls)}`;
}

function progress(
  onProgress: RunOfflinePreparationOptions['onProgress'],
  stage: OfflinePreparationStage,
  message: string,
  completedItems: number,
  totalItems: number,
  percent: number,
): void {
  onProgress?.({
    stage,
    message,
    completedItems,
    totalItems,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
  });
}

function initialManifest(params: {
  accountId: string;
  buildFingerprint: string;
  accessFingerprint: string;
  selectedEventIds: string[];
  persistentStorageGranted: boolean;
  previous: OfflinePreparationManifest | null;
}): OfflinePreparationManifest {
  const resumable =
    params.previous?.buildFingerprint === params.buildFingerprint &&
    params.previous.accessFingerprint === params.accessFingerprint &&
    params.previous.selectedEventIds.join('|') === params.selectedEventIds.join('|');

  return {
    schemaVersion: 1,
    accountId: params.accountId,
    status: 'preparing',
    buildFingerprint: params.buildFingerprint,
    accessFingerprint: params.accessFingerprint,
    selectedEventIds: params.selectedEventIds,
    completedEventIds: resumable ? params.previous!.completedEventIds : [],
    events: resumable ? params.previous!.events : {},
    shellCacheVersion: resumable ? params.previous!.shellCacheVersion : null,
    shellAssetCount: resumable ? params.previous!.shellAssetCount : 0,
    persistentStorageGranted: params.persistentStorageGranted,
    warnings: params.persistentStorageGranted
      ? []
      : ['This browser did not grant persistent storage. Offline data may be removed under storage pressure.'],
    lastPreparedAt: resumable ? params.previous!.lastPreparedAt : null,
    updatedAt: new Date().toISOString(),
    lastError: null,
  };
}

async function cacheApplicationShell(
  signal: AbortSignal | undefined,
  onItem: (completed: number, total: number) => void,
): Promise<ShellCacheResult> {
  throwIfAborted(signal);
  const unsubscribe = subscribePwaPrepareProgress((shellProgress) => {
    onItem(shellProgress.completed, shellProgress.total);
  });
  try {
    const prepared = await (signal
      ? Promise.race([
          preparePwaShell(),
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(abortError()), {
              once: true,
            });
          }),
        ])
      : preparePwaShell());
    return {
      cacheVersion: prepared.fingerprint,
      completed: prepared.completed,
      total: prepared.total,
      failedUrls: [],
    };
  } finally {
    unsubscribe();
  }
}

function collectMedia(
  bundle: EventBundle,
  access: AccountEventAccess,
  messageMediaUrls: string[] = [],
): MediaCandidate[] {
  const byUrl = new Map<string, MediaCandidate>();
  const add = (url: string | null | undefined, required: boolean) => {
    const trimmed = url?.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return;
    const existing = byUrl.get(trimmed);
    byUrl.set(trimmed, { url: trimmed, required: required || Boolean(existing?.required) });
  };

  add(bundle.event.courseMapUrl, true);
  add(access.profile?.avatarUrl, false);
  bundle.participants.forEach((participant) => add(participant.avatarUrl, false));
  messageMediaUrls.forEach((url) => add(url, false));
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

async function cacheMedia(
  candidate: MediaCandidate,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  const url = new URL(candidate.url);
  const sameOrigin = url.origin === window.location.origin;
  const request = new Request(url.href, {
    mode: sameOrigin ? 'same-origin' : 'cors',
    credentials: sameOrigin ? 'same-origin' : 'omit',
  });
  const response = await fetch(request, { signal });
  if (!response.ok) return false;
  const cache = await caches.open(MEDIA_CACHE);
  await cache.put(request, response);
  return true;
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Offline preparation did not finish.';
}

export async function inspectOfflineReadiness(
  accountId: string,
): Promise<OfflinePreparationManifest | null> {
  const manifest =
    (await loadOfflinePreparationManifest(accountId)) ??
    (await loadOfflinePreparationProgressManifest(accountId));
  if (!manifest || manifest.status !== 'ready') return manifest;

  // Opening is data-first. A running page already proves that the active
  // service worker supplied a complete, atomically installed shell. A build
  // fingerprint change, retired historical shell cache, or missing optional
  // media must schedule a refresh, but must never lock a verified event
  // snapshot behind the setup screen.
  const access = await loadAccountEventAccess(accountId);
  const snapshots = await Promise.all(
    manifest.selectedEventIds.map((eventId) =>
      loadEventSnapshot(accountId, eventId),
    ),
  );
  const complete = hasCompletePreparedEventData({
    manifestAccountId: manifest.accountId,
    manifestStatus: manifest.status,
    selectedEventIds: manifest.selectedEventIds,
    accessAccountId: access?.accountId ?? null,
    accessibleEventIds: new Set(access?.events.map((event) => event.id) ?? []),
    snapshotEventIds: new Set(
      snapshots
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot))
        .map((snapshot) => snapshot.bundle.event.id),
    ),
  });
  return complete ? manifest : { ...manifest, status: 'incomplete' };
}

export async function runAutomaticOfflinePreparation(
  options: RunOfflinePreparationOptions,
): Promise<OfflinePreparationResult> {
  const { accountId, onProgress, signal } = options;
  throwIfAborted(signal);
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    throw new Error('Offline preparation is only available in the installed web app.');
  }
  if (!navigator.onLine) {
    throw new Error('Connect to the internet to finish offline setup.');
  }

  progress(onProgress, 'checking-storage', 'Securing device storage', 0, 1, 1);
  const persistentStorageGranted = await requestPersistentStorage();
  progress(onProgress, 'checking-storage', 'Device storage checked', 1, 1, 5);
  throwIfAborted(signal);

  progress(onProgress, 'loading-events', 'Finding your events', 0, 1, 6);
  const access = await fetchAccountEventAccess(accountId);
  if (access.accountId !== accountId) {
    throw new Error('The event list did not belong to the signed-in account.');
  }
  const selected = selectEventsForOfflinePreparation(access.events);
  const selectedEventIds = selected.map((event) => event.id);
  const buildFingerprint = currentOfflineBuildFingerprint();
  const accessFingerprint = accountAccessFingerprint(access);
  const previous =
    (await loadOfflinePreparationProgressManifest(accountId)) ??
    (await loadOfflinePreparationManifest(accountId));
  let manifest = initialManifest({
    accountId,
    buildFingerprint,
    accessFingerprint,
    selectedEventIds,
    persistentStorageGranted,
    previous,
  });
  await saveOfflinePreparationProgressManifest(manifest);
  progress(onProgress, 'loading-events', `${selected.length} event${selected.length === 1 ? '' : 's'} selected`, 1, 1, 10);

  progress(onProgress, 'caching-app', 'Saving the app for offline use', 0, 0, 11);
  const shell = await cacheApplicationShell(signal, (completed, total) => {
    const ratio = total > 0 ? completed / total : 0;
    progress(onProgress, 'caching-app', 'Saving app files', completed, total, 10 + ratio * 30);
  });
  manifest = {
    ...manifest,
    shellCacheVersion: shell.cacheVersion,
    shellAssetCount: shell.completed,
    warnings: [
      ...manifest.warnings,
      ...(shell.failedUrls.length > 0
        ? [`${shell.failedUrls.length} app file${shell.failedUrls.length === 1 ? '' : 's'} could not be cached.`]
        : []),
    ],
    updatedAt: new Date().toISOString(),
  };
  await saveOfflinePreparationProgressManifest(manifest);

  const bundles = new Map<string, EventBundle>();
  const messageMediaByEvent = new Map<string, string[]>();
  for (let index = 0; index < selected.length; index += 1) {
    throwIfAborted(signal);
    const event = selected[index];
    progress(
      onProgress,
      'saving-events',
      `Saving ${event.name}`,
      index,
      selected.length,
      40 + (selected.length > 0 ? (index / selected.length) * 35 : 35),
    );

    const bundle = await fetchEventBundle(event.id);
    if (bundle.event.id !== event.id) {
      throw new Error(`Event ${event.name} returned data for a different event.`);
    }
    await saveEventSnapshot(bundle, accountId, event.id);
    bundles.set(event.id, bundle);

    let conversationCount = 0;
    let chatPreparedAt: string | null = null;
    if (event.registration) {
      const summaries = await fetchConversationSummaries(event.id);
      await saveOfflineConversationSummaries(accountId, event.id, summaries);
      conversationCount = summaries.length;
      const eventMessageMedia: string[] = [];
      for (const summary of summaries) {
        const [conversation, page] = await Promise.all([
          fetchConversation(event.id, summary.id),
          fetchMessages(event.id, summary.id),
        ]);
        if (conversation) {
          await saveOfflineConversation(accountId, event.id, conversation);
        }
        await saveOfflineMessages(
          accountId,
          event.id,
          summary.id,
          page.messages,
        );
        page.messages.forEach((message) => {
          if (message.media?.url) eventMessageMedia.push(message.media.url);
        });
      }
      messageMediaByEvent.set(event.id, eventMessageMedia);
      chatPreparedAt = new Date().toISOString();
    }

    const prepared: OfflinePreparedEvent = {
      eventId: event.id,
      dataFingerprint: eventBundleFingerprint(bundle),
      snapshotSavedAt: new Date().toISOString(),
      mediaUrls: manifest.events[event.id]?.mediaUrls ?? [],
      unavailableMediaUrls: manifest.events[event.id]?.unavailableMediaUrls ?? [],
      conversationCount,
      chatPreparedAt,
    };
    manifest = {
      ...manifest,
      completedEventIds: [...new Set([...manifest.completedEventIds, event.id])],
      events: { ...manifest.events, [event.id]: prepared },
      updatedAt: new Date().toISOString(),
    };
    await saveOfflinePreparationProgressManifest(manifest);
    progress(
      onProgress,
      'saving-events',
      `${event.name} saved`,
      index + 1,
      selected.length,
      40 + (selected.length > 0 ? ((index + 1) / selected.length) * 35 : 35),
    );
  }

  const media = [...bundles.entries()].flatMap(([eventId, bundle]) =>
    collectMedia(bundle, access, messageMediaByEvent.get(eventId)).map(
      (candidate) => ({ ...candidate, eventId }),
    ),
  );
  const unavailableRequired: string[] = [];
  const unavailableOptional: string[] = [];
  for (let index = 0; index < media.length; index += 1) {
    throwIfAborted(signal);
    const item = media[index];
    let cached = false;
    try {
      cached = await cacheMedia(item, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    const eventRecord = manifest.events[item.eventId];
    const mediaUrls = new Set(eventRecord.mediaUrls);
    const unavailableMediaUrls = new Set(eventRecord.unavailableMediaUrls);
    if (cached) {
      mediaUrls.add(item.url);
      unavailableMediaUrls.delete(item.url);
    } else {
      unavailableMediaUrls.add(item.url);
      if (item.required) unavailableRequired.push(item.url);
      else unavailableOptional.push(item.url);
    }
    manifest = {
      ...manifest,
      events: {
        ...manifest.events,
        [item.eventId]: {
          ...eventRecord,
          mediaUrls: [...mediaUrls],
          unavailableMediaUrls: [...unavailableMediaUrls],
        },
      },
      updatedAt: new Date().toISOString(),
    };
    await saveOfflinePreparationProgressManifest(manifest);
    progress(
      onProgress,
      'caching-media',
      'Saving event images',
      index + 1,
      media.length,
      75 + (media.length > 0 ? ((index + 1) / media.length) * 20 : 20),
    );
  }

  progress(onProgress, 'finalizing', 'Verifying offline access', 0, 1, 96);
  const incompleteReasons = [
    ...(shell.failedUrls.length > 0 ? ['Some required app files were not saved.'] : []),
    ...(unavailableRequired.length > 0 ? ['The course map could not be saved for offline use.'] : []),
  ];
  const now = new Date().toISOString();
  manifest = {
    ...manifest,
    status: incompleteReasons.length > 0 ? 'incomplete' : 'ready',
    warnings: [
      ...new Set([
        ...manifest.warnings,
        ...incompleteReasons,
        ...(unavailableOptional.length > 0
          ? [`${unavailableOptional.length} optional profile image${unavailableOptional.length === 1 ? '' : 's'} could not be saved; initials remain available offline.`]
          : []),
      ]),
    ],
    lastPreparedAt: incompleteReasons.length > 0 ? manifest.lastPreparedAt : now,
    updatedAt: now,
    lastError: incompleteReasons.length > 0 ? incompleteReasons.join(' ') : null,
  };
  if (manifest.status === 'ready') {
    // Publish data access and the ready receipt only after every required file,
    // event snapshot, and course map has completed successfully.
    await saveAccountEventAccess(access);
    await saveOfflinePreparationManifest(manifest);
    await savePreparedOfflineAccountId(accountId);
    await clearOfflinePreparationProgressManifest(accountId);
  } else {
    await saveOfflinePreparationProgressManifest(manifest);
  }
  progress(onProgress, 'finalizing', manifest.status === 'ready' ? 'Offline access is ready' : 'Offline setup needs attention', 1, 1, 100);
  return { manifest, access };
}

export async function recordOfflinePreparationError(
  accountId: string,
  error: unknown,
): Promise<void> {
  const ready = await loadOfflinePreparationManifest(accountId);
  const manifest =
    (await loadOfflinePreparationProgressManifest(accountId)) ?? ready;
  if (!manifest) return;
  await saveOfflinePreparationProgressManifest({
    ...manifest,
    status: navigator.onLine ? 'error' : 'incomplete',
    updatedAt: new Date().toISOString(),
    lastError: reasonFor(error),
  });
}
