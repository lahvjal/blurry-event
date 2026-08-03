import React, { createContext, useContext } from 'react';

import type { OfflinePreparationManifest } from '@/lib/offline/event-snapshot';
import type { OfflinePreparationProgress } from '@/lib/offline/preparation';

export type OfflinePreparationPhase =
  | 'disabled'
  | 'signed-out'
  | 'checking'
  | 'preparing'
  | 'refreshing'
  | 'ready'
  | 'incomplete'
  | 'error';

export type OfflinePreparationContextValue = {
  phase: OfflinePreparationPhase;
  accountId: string | null;
  progress: OfflinePreparationProgress | null;
  manifest: OfflinePreparationManifest | null;
  error: string | null;
  isReady: boolean;
};

const VALUE: OfflinePreparationContextValue = {
  phase: 'disabled',
  accountId: null,
  progress: null,
  manifest: null,
  error: null,
  isReady: false,
};

const OfflinePreparationContext = createContext(VALUE);

/** Native retains its existing path; this compatibility provider is a no-op. */
export function OfflinePreparationProvider({ children }: { enabled?: boolean; children: React.ReactNode }) {
  return (
    <OfflinePreparationContext.Provider value={VALUE}>
      {children}
    </OfflinePreparationContext.Provider>
  );
}

export function OfflinePreparationGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useOfflinePreparation(): OfflinePreparationContextValue {
  return useContext(OfflinePreparationContext);
}
