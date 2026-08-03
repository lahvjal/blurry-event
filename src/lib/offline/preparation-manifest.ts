export type OfflinePreparationManifestStatus =
  | 'preparing'
  | 'ready'
  | 'incomplete'
  | 'error';

export type OfflinePreparedEvent = {
  eventId: string;
  dataFingerprint: string;
  snapshotSavedAt: string;
  mediaUrls: string[];
  unavailableMediaUrls: string[];
  conversationCount?: number;
  chatPreparedAt?: string | null;
};

/** Durable, exact-account receipt for the automatic offline bootstrap. */
export type OfflinePreparationManifest = {
  schemaVersion: 1;
  accountId: string;
  status: OfflinePreparationManifestStatus;
  buildFingerprint: string;
  accessFingerprint: string;
  selectedEventIds: string[];
  completedEventIds: string[];
  events: Record<string, OfflinePreparedEvent>;
  shellCacheVersion: string | null;
  shellAssetCount: number;
  persistentStorageGranted: boolean;
  warnings: string[];
  lastPreparedAt: string | null;
  updatedAt: string;
  lastError: string | null;
};
