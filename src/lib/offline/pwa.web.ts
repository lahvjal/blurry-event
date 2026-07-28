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
  'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=overlays-content';

/**
 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to
 * real values on iOS Safari — without it, react-native-safe-area-context
 * reports zero insets everywhere. `user-scalable=no` plus a pinned
 * min/max-scale is what stops pinch-zoom and the auto-zoom Safari does when
 * focusing a text input. Expo's stock dev template ships a viewport meta
 * without any of this, so it's rewritten here rather than appended (a second
 * viewport meta would be ignored).
 *
 * `interactive-widget=overlays-content` (rather than `resizes-content`) is
 * deliberate: `resizes-content` shrinks the layout viewport for the keyboard,
 * but on real iOS Safari that shrink doesn't reserve space for Safari's own
 * accessory toolbar (the prev/next/done bar above the keyboard) — so a
 * bottom-anchored field like the message composer ends up sized right up
 * against the toolbar and gets rendered behind it. `overlays-content` keeps
 * the layout viewport full-size and leaves keyboard handling to us, via
 * `ensureViewportPinned` below, which sizes `#root` off `visualViewport`
 * instead — that api's `height` reliably excludes the toolbar because it's
 * measuring genuinely visible pixels, not deriving them from the keyboard's
 * reported height the way the declarative resize does.
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
 * Keeps `#root` sized and positioned to exactly the real visible area,
 * tracked live off `window.visualViewport`. `html`/`body` stay at the full,
 * unshrunk layout-viewport size as an inert backdrop; `#root` is what
 * actually holds the app, so it's the one that needs to both shrink for the
 * keyboard (`--app-height`) and slide to wherever Safari panned the visible
 * window to (`--app-offset-top`) — without the second part, a `#root` sized
 * correctly but left at `top: 0` would render mostly scrolled out of view
 * the moment Safari pans. `window.scrollTo(0, 0)` on the same events cancels
 * any residual document-level scroll so nothing fights this positioning.
 */
function ensureViewportPinned() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const sync = () => {
    document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
    document.documentElement.style.setProperty('--app-offset-top', `${vv.offsetTop}px`);
    window.scrollTo(0, 0);
  };
  sync();
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('scroll', sync);
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
 * chrome is showing. `html`/`body` get `100dvh` as an inert, full-size
 * backdrop; `#root` is the one that needs to track the *real* visible area
 * (see `ensureViewportPinned`), so it's sized and positioned off the
 * `--app-height`/`--app-offset-top` custom properties that function keeps
 * live, falling back to `100dvh`/`0` before that JS has run a first time.
 * `!important` guarantees these win regardless of where they land relative
 * to expo-reset in the cascade.
 *
 * The focus-ring rules replace the browser's default `outline`, which draws
 * tight around the raw `<input>`/`<textarea>` box. For a field where that
 * element *is* the whole visual field (most of them — background and
 * padding applied directly to the TextInput) that's already correct, so
 * `input:focus`/`textarea:focus` gets a themed ring straight away. For a
 * field where the input sits inside a decorative pill with icons as
 * siblings (the message composer, the search field), the input's own box is
 * narrower than the field — those opt out with `data-skip-ring` and the
 * pill wrapper opts in with `data-focus-ring`, so the ring wraps the whole
 * pill via `:focus-within` instead.
 */
function ensureBaseStyle() {
  if (document.getElementById('blurry-shell')) return;
  const style = document.createElement('style');
  style.id = 'blurry-shell';
  style.textContent = `
    html, body {
      height: 100vh !important;
      height: 100dvh !important;
      min-height: 100vh !important;
      min-height: 100dvh !important;
      background-color: #131715;
      touch-action: pan-x pan-y;
    }
    #root {
      height: var(--app-height, 100dvh) !important;
      min-height: var(--app-height, 100dvh) !important;
      transform: translateY(var(--app-offset-top, 0px));
      background-color: #131715;
      touch-action: pan-x pan-y;
    }
    body {
      overflow: hidden;
      overscroll-behavior-y: none;
      -webkit-tap-highlight-color: transparent;
    }
    input, textarea { outline: none; }
    input:focus:not([data-skip-ring]), textarea:focus:not([data-skip-ring]) {
      box-shadow: 0 0 0 2px #7bffb2;
    }
    [data-focus-ring]:focus-within {
      box-shadow: 0 0 0 2px #7bffb2;
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
