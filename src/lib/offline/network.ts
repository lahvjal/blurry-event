import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * `navigator.onLine === false` is the one browser signal that is safe to act
 * on immediately: the device cannot complete a request. A `true` value remains
 * only a hint, so reachable-looking captive portals still get a real request
 * and the normal cache fallback.
 */
export function isBrowserDefinitelyOffline(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    navigator.onLine === false
  );
}

function subscribe(listener: () => void): () => void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return () => {};
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** Re-renders read paths as soon as the browser enters or leaves offline mode. */
export function useBrowserDefinitelyOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    isBrowserDefinitelyOffline,
    () => false,
  );
}
