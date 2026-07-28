/**
 * Browser-side PWA wiring.
 *
 * The exported build gets its head tags from scripts/inject-pwa.mjs, but the
 * dev server serves Expo's stock template — so the manifest link and service
 * worker are also established at runtime. That keeps `expo start --web`
 * installable and offline-capable, which is what makes the behaviour testable
 * during development rather than only after a production export.
 */

const VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content';

/**
 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to
 * real values on iOS Safari — without it, react-native-safe-area-context
 * reports zero insets everywhere. `user-scalable=no` plus a pinned
 * min/max-scale is what stops pinch-zoom and the auto-zoom Safari does when
 * focusing a text input. Expo's stock dev template ships a viewport meta
 * without any of this, so it's rewritten here rather than appended (a second
 * viewport meta would be ignored).
 *
 * `interactive-widget=resizes-content` (Safari 16.4+) is what actually fixes
 * keyboard handling at the root: without it, iOS keeps the layout viewport
 * full-size and pans the *visual* viewport to tuck a focused input above the
 * keyboard — and a `position: fixed` body doesn't track that pan reliably,
 * which is what produced both the vertical offset after closing the
 * keyboard and a horizontal one while it's open. With this flag the layout
 * viewport (and `dvh`) actually shrinks for the keyboard, so there's no pan
 * to compensate for in the first place.
 */
function ensureViewportFitCover() {
  const existing = document.querySelector('meta[name="viewport"]');
  if (existing) {
    if (existing.getAttribute('content') !== VIEWPORT_CONTENT) {
      existing.setAttribute('content', VIEWPORT_CONTENT);
    }
    return;
  }
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = VIEWPORT_CONTENT;
  document.head.appendChild(meta);
}

/**
 * `user-scalable=no` is enough on most browsers, but iOS Safari has long
 * ignored it for pinch gestures specifically (an accessibility carve-out).
 * Blocking the native `gesturestart` event is the standard workaround.
 */
function ensurePinchZoomBlocked() {
  document.addEventListener('gesturestart', (event) => event.preventDefault());
}

/**
 * Belt-and-suspenders for iOS < 16.4, which ignores
 * `interactive-widget=resizes-content`: pin the document scroll position to
 * the origin whenever the visual viewport moves, so a keyboard-driven pan
 * can't leave the shell visibly offset.
 */
function ensureViewportPinned() {
  if (!window.visualViewport) return;
  const reset = () => window.scrollTo(0, 0);
  window.visualViewport.addEventListener('resize', reset);
  window.visualViewport.addEventListener('scroll', reset);
  window.addEventListener('scroll', reset);
}

function ensureManifestLink() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/manifest.webmanifest';
  document.head.appendChild(link);
}

function ensureThemeColor() {
  if (document.querySelector('meta[name="theme-color"]')) return;
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#131715';
  document.head.appendChild(meta);
}

/**
 * Expo's own `#expo-reset` style tag sets a static `height: 100%`, which on
 * mobile Safari can exceed the visually available viewport once browser
 * chrome is showing. This overrides it with `100dvh` so the app shell always
 * reaches the true bottom of the screen. `!important` guarantees it wins
 * regardless of where it lands relative to expo-reset in the cascade.
 *
 * `body` only gets `overflow: hidden` here — an earlier version also pinned
 * it to `position: fixed`, which was meant to stop Safari's keyboard-focus
 * pan but instead fought with `interactive-widget=resizes-content` and left
 * a gap under the floating nav (the fixed body's `inset: 0` box didn't track
 * `dvh` the same way `#root` did). `resizes-content` now handles the
 * keyboard at the root, so body just needs to stay non-scrollable.
 */
function ensureBaseStyle() {
  if (document.getElementById('blurry-shell')) return;
  const style = document.createElement('style');
  style.id = 'blurry-shell';
  style.textContent = `
    html, body, #root {
      height: 100vh !important;
      height: 100dvh !important;
      min-height: 100vh !important;
      min-height: 100dvh !important;
      background-color: #131715;
      touch-action: pan-x pan-y;
    }
    body {
      overflow: hidden;
      overscroll-behavior-y: none;
      -webkit-tap-highlight-color: transparent;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Registers the app-shell worker. Silent on failure — no worker means no
 * offline shell, but scores still save to IndexedDB, so it must never be fatal.
 */
export function setupPwa(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  ensureViewportFitCover();
  ensurePinchZoomBlocked();
  ensureViewportPinned();
  ensureManifestLink();
  ensureThemeColor();
  ensureBaseStyle();

  if (!('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
