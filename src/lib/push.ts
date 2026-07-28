/**
 * Native stand-in. Metro resolves push.web.ts on web; this keeps the same
 * surface so screens never branch on platform.
 *
 * Push on a native build would go through APNs/FCM via expo-notifications,
 * which is a different mechanism entirely — not a gap to be filled in here.
 */

export type PushState =
  | 'unsupported'
  | 'needs-install'
  | 'denied'
  | 'granted'
  | 'default';

export function pushState(): PushState {
  return 'unsupported';
}

export async function isPushEnabled(): Promise<boolean> {
  return false;
}

export async function enablePush(): Promise<PushState> {
  return 'unsupported';
}

export async function disablePush(): Promise<void> {}

export async function syncPush(): Promise<void> {}

export async function clearPushForSignOut(): Promise<void> {}
