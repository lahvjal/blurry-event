import type { Session } from '@supabase/supabase-js';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  OfflinePreparationScreen,
  type OfflinePreparationScreenPhase,
} from '@/components/offline-preparation-screen';
import {
  loadPreparedOfflineAccountId,
  type OfflinePreparationManifest,
} from '@/lib/offline/event-snapshot';
import {
  inspectOfflineReadiness,
  recordOfflinePreparationError,
  runAutomaticOfflinePreparation,
  type OfflinePreparationProgress,
} from '@/lib/offline/preparation';
import { supabase } from '@/lib/supabase';

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
  /** True only after exact scoped snapshots and app assets are verified. */
  isReady: boolean;
};

const INITIAL_VALUE: OfflinePreparationContextValue = {
  phase: 'disabled',
  accountId: null,
  progress: null,
  manifest: null,
  error: null,
  isReady: false,
};

const OfflinePreparationContext = createContext(INITIAL_VALUE);
const RETRY_DELAY_MS = 15_000;

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Offline setup did not finish.';
}

/**
 * Owns automatic preparation after authentication.
 *
 * Integration should pass `enabled={isStandalone}` so a normal browser stays
 * on the separate installation-instructions flow. Once enabled, no user
 * action is required: incomplete work retries on connectivity, foreground,
 * and a short backoff while the app remains open.
 */
export function OfflinePreparationProvider({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [offlineAccountId, setOfflineAccountId] = useState<string | null>(null);
  const [value, setValue] = useState<OfflinePreparationContextValue>(
    enabled ? { ...INITIAL_VALUE, phase: 'checking' } : INITIAL_VALUE,
  );

  useEffect(() => {
    let mounted = true;
    let authRevision = 0;
    const initialRevision = authRevision;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (initialRevision !== authRevision) return;
      if (!mounted) return;
      if (data.session) {
        setOfflineAccountId(null);
        setSession(data.session);
        return;
      }
      const preparedId = await loadPreparedOfflineAccountId().catch(() => null);
      if (!mounted || initialRevision !== authRevision) return;
      setOfflineAccountId(preparedId);
      setSession(null);
    }).catch(async () => {
      const preparedId = await loadPreparedOfflineAccountId().catch(() => null);
      if (!mounted || initialRevision !== authRevision) return;
      setOfflineAccountId(preparedId);
      setSession(null);
    });
    const { data } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      authRevision += 1;
      const eventRevision = authRevision;
      if (nextSession) {
        setOfflineAccountId(null);
        setSession(nextSession);
        return;
      }
      const preparedId = await loadPreparedOfflineAccountId().catch(() => null);
      if (!mounted || eventRevision !== authRevision) return;
      setOfflineAccountId(preparedId);
      setSession(null);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const accountId = session?.user.id ?? offlineAccountId;

  useEffect(() => {
    if (!enabled) {
      setValue(INITIAL_VALUE);
      return;
    }
    if (session === undefined) {
      setValue({ ...INITIAL_VALUE, phase: 'checking' });
      return;
    }
    if (!accountId) {
      setValue({ ...INITIAL_VALUE, phase: 'signed-out' });
      return;
    }

    let disposed = false;
    let inFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let knownReady = false;

    const scheduleRetry = () => {
      if (disposed || retryTimer !== null || !navigator.onLine) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void prepare(false);
      }, RETRY_DELAY_MS);
    };

    const prepare = async (refreshReadyInstall: boolean) => {
      if (disposed || inFlight || !navigator.onLine) return;
      inFlight = true;
      controller = new AbortController();
      setValue((current) => ({
        ...current,
        accountId,
        phase: knownReady || refreshReadyInstall ? 'refreshing' : 'preparing',
        error: null,
      }));
      try {
        const result = await runAutomaticOfflinePreparation({
          accountId,
          forceRefresh: refreshReadyInstall,
          signal: controller.signal,
          onProgress: (progress) => {
            if (disposed) return;
            setValue((current) => ({ ...current, progress }));
          },
        });
        if (disposed) return;
        knownReady = result.manifest.status === 'ready';
        const finishedProgress: OfflinePreparationProgress = knownReady
          ? {
              stage: 'finalizing',
              message: 'Offline access is ready',
              completedItems: 1,
              totalItems: 1,
              percent: 100,
            }
          : {
              stage: 'finalizing',
              message: 'Offline setup needs attention',
              completedItems: result.manifest.completedEventIds.length,
              totalItems: result.manifest.selectedEventIds.length,
              percent: 95,
            };
        setValue({
          phase: knownReady ? 'ready' : 'incomplete',
          accountId,
          progress: finishedProgress,
          manifest: result.manifest,
          error: result.manifest.lastError,
          isReady: knownReady,
        });
        if (!knownReady) scheduleRetry();
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const message = reasonFor(error);
        await recordOfflinePreparationError(accountId, error).catch(() => {});
        if (disposed) return;
        setValue((current) => ({
          ...current,
          accountId,
          phase: knownReady ? 'ready' : navigator.onLine ? 'error' : 'incomplete',
          error: message,
          isReady: knownReady,
        }));
        if (!knownReady) scheduleRetry();
      } finally {
        inFlight = false;
      }
    };

    const bootstrap = async () => {
      setValue({ ...INITIAL_VALUE, phase: 'checking', accountId });
      const existing = await inspectOfflineReadiness(accountId).catch(() => null);
      if (disposed) return;
      knownReady = existing?.status === 'ready';
      if (knownReady) {
        setValue({
          phase: navigator.onLine ? 'refreshing' : 'ready',
          accountId,
          progress: null,
          manifest: existing,
          error: null,
          isReady: true,
        });
        if (navigator.onLine) void prepare(true);
        return;
      }
      setValue({
        phase: navigator.onLine ? 'preparing' : 'incomplete',
        accountId,
        progress: null,
        manifest: existing,
        error: navigator.onLine
          ? null
          : 'Connect to the internet to finish offline setup.',
        isReady: false,
      });
      if (navigator.onLine) void prepare(false);
    };

    const retryNow = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      void prepare(knownReady);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retryNow();
    };

    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', onVisibility);
    void bootstrap();

    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer !== null) clearTimeout(retryTimer);
      window.removeEventListener('online', retryNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [accountId, enabled, session]);

  const contextValue = useMemo(() => value, [value]);
  return (
    <OfflinePreparationContext.Provider value={contextValue}>
      {children}
    </OfflinePreparationContext.Provider>
  );
}

export function useOfflinePreparation(): OfflinePreparationContextValue {
  return useContext(OfflinePreparationContext);
}

/**
 * Mandatory preparation gate. A refresh finishes before EventProvider mounts,
 * preventing two independent server reads from racing to overwrite the same
 * last-known-good event snapshot.
 */
export function OfflinePreparationGate({ children }: { children: React.ReactNode }) {
  const state = useOfflinePreparation();
  if (
    state.phase === 'disabled' ||
    state.phase === 'signed-out' ||
    state.phase === 'ready'
  ) {
    return <>{children}</>;
  }

  const phase: OfflinePreparationScreenPhase =
    state.phase === 'incomplete'
      ? 'incomplete'
      : state.phase === 'error'
        ? 'error'
        : state.phase === 'checking'
          ? 'checking'
          : 'preparing';
  return (
    <OfflinePreparationScreen
      phase={phase}
      progress={state.progress}
      manifest={state.manifest}
      error={state.error}
    />
  );
}
