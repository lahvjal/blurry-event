/**
 * Web Push subscription management.
 *
 * The service worker (public/sw.js) handles the incoming `push` event; this
 * module handles everything that has to happen in the page: asking permission,
 * subscribing with the VAPID public key, and keeping the resulting endpoint
 * stored against the signed-in account so the edge function can find it.
 *
 * The iOS constraint drives the shape of this file. Safari only exposes the
 * Push API to a PWA that has been added to the home screen — in a normal tab
 * `window.PushManager` simply isn't there. That's a fixable situation rather
 * than a dead end, so it gets its own state ('needs-install') instead of being
 * lumped in with genuinely unsupported browsers.
 */

import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export type PushState =
  /** No Push API, or no VAPID key configured for this deploy. Nothing to offer. */
  | 'unsupported'
  /** iOS Safari in a tab — works, but only once added to the home screen. */
  | 'needs-install'
  /** Permission refused. Only recoverable through browser/OS settings. */
  | 'denied'
  /** Subscribed, endpoint stored. */
  | 'granted'
  /** Supported and available, not yet asked. */
  | 'default';

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Running from the home screen rather than inside browser chrome. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * VAPID keys travel as base64url; subscribe() wants the raw bytes. Typed as
 * BufferSource because TS models `Uint8Array` as possibly backed by a
 * SharedArrayBuffer, which the DOM signature won't take.
 */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function hasPushApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof window.Notification !== 'undefined'
  );
}

/** Where this device currently stands, without prompting for anything. */
export function pushState(): PushState {
  if (typeof window === 'undefined' || !VAPID_PUBLIC_KEY) return 'unsupported';

  if (!hasPushApi()) {
    // On iOS the API appears only after the app is installed, so absence in a
    // tab is a "not yet" rather than a "never".
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }

  const permission = window.Notification.permission;
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'default';
}

/**
 * Whether this device is actually subscribed — which is not the same question
 * as whether permission was granted. Turning notifications off unsubscribes but
 * leaves the browser permission in place (only the user can revoke that), so a
 * toggle driven by permission alone would spring back on by itself.
 */
export async function isPushEnabled(): Promise<boolean> {
  if (!hasPushApi() || window.Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Upserts on `endpoint`: re-subscribing on a device that already has a row
 * returns the same endpoint and should refresh it in place, while a reinstalled
 * PWA gets a brand new one. Keyed that way, a device can also change hands
 * between accounts without stranding a row pointed at the wrong user.
 */
async function storeSubscription(subscription: PushSubscription): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;

  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) return;

  await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 400),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
}

/**
 * Asks permission and subscribes. Must be called from a user gesture — Safari
 * rejects `requestPermission()` outright otherwise.
 */
export async function enablePush(): Promise<PushState> {
  const state = pushState();
  if (state === 'unsupported' || state === 'needs-install' || state === 'denied') {
    return state;
  }

  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') {
    return permission === 'denied' ? 'denied' : 'default';
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    // An existing subscription is reused rather than replaced: its endpoint is
    // already stored, and re-subscribing would orphan the previous row.
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));

    await storeSubscription(subscription);
    return 'granted';
  } catch {
    // Permission is granted but the subscribe failed — a missing service worker,
    // a bad VAPID key. Report it as not-on rather than claiming success.
    return 'default';
  }
}

/** Unsubscribes this device and forgets its endpoint server-side. */
export async function disablePush(): Promise<void> {
  if (!hasPushApi()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', subscription.endpoint);
    await subscription.unsubscribe();
  } catch {
    // Nothing actionable — the row is either gone or will be pruned on the
    // first 410 from the push service.
  }
}

/**
 * Re-registers an already-granted device on launch. Push endpoints rotate
 * without warning, and a stale one is silently undeliverable, so the cheapest
 * fix is to re-assert the current one every time the app opens.
 */
export async function syncPush(): Promise<void> {
  if (pushState() !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await storeSubscription(subscription);
  } catch {
    // Best effort.
  }
}

/**
 * Called on sign-out. The device stays subscribed at the browser level, but the
 * row goes away so the next person to sign in on this phone doesn't inherit
 * someone else's notifications.
 */
export async function clearPushForSignOut(): Promise<void> {
  await disablePush();
}
