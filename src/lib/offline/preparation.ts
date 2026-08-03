import type { OfflinePreparationManifest } from '@/lib/offline/event-snapshot';

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
  percent: number;
};

export type OfflinePreparationResult = {
  manifest: OfflinePreparationManifest;
  access: never;
};

export type RunOfflinePreparationOptions = {
  accountId: string;
  signal?: AbortSignal;
  forceRefresh?: boolean;
  onProgress?: (progress: OfflinePreparationProgress) => void;
};

/** Native builds retain their existing storage path; preparation is PWA-only. */
export async function inspectOfflineReadiness(
  _accountId: string,
): Promise<OfflinePreparationManifest | null> {
  return null;
}

export async function runAutomaticOfflinePreparation(
  _options: RunOfflinePreparationOptions,
): Promise<OfflinePreparationResult> {
  throw new Error('Offline preparation is only available in the installed web app.');
}

export async function recordOfflinePreparationError(
  _accountId: string,
  _error: unknown,
): Promise<void> {}
