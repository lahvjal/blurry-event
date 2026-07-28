/**
 * Home screen icon badge.
 *
 * The service worker sets this on incoming push (that's the case that matters —
 * app closed, count going up). This side handles the other direction: the count
 * coming down as threads are actually read, which only the running app knows
 * about.
 *
 * Same platform gate as push: an installed PWA with notification permission.
 * Everywhere else the methods simply aren't there, so this is a no-op rather
 * than something to feature-detect around at each call site.
 */

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export async function setBadge(count: number): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as BadgeNavigator;

  try {
    // A zero badge still draws a dot on some platforms, so nothing unread has
    // to mean cleared, not set to 0.
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    // Permission revoked mid-session, or an unsupported install. A wrong badge
    // is not worth surfacing to anyone.
  }
}

export async function clearBadge(): Promise<void> {
  await setBadge(0);
}
