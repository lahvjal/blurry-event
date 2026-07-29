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
 * Shrinks `#root` to the visible area **only while a field is being typed
 * into**, and restores it the moment that field is done.
 *
 * Two conditions, and the focus one is what makes this safe. Deciding from the
 * measurement alone meant a keyboard that closed without the viewport
 * reporting all the way back left the app permanently short, showing a strip
 * of bare `body` under the nav until reload. Focus is unambiguous: nothing
 * focused, nothing covering the app, full height. The measurement then only
 * decides *how much* to shrink, never whether to stay shrunk.
 *
 * The covered gap is measured rather than heights compared, because Safari
 * both shortens the visual viewport and pans it — `offsetTop` is the panned
 * part and counts toward what the keyboard hides.
 */
const KEYBOARD_MIN_INSET = 120;

function isEditing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
  );
}

function ensureViewportPinned() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const root = document.documentElement;

  const sync = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const shrink = isEditing() && covered >= KEYBOARD_MIN_INSET;

    // Always an explicit pixel height — never handed back to `100dvh`.
    // Falling back to the unit was the bug: iOS can leave viewport units stale
    // after a keyboard is dismissed, which is exactly when this runs, so the
    // shell stayed short even once the override was correctly cleared.
    // `innerHeight` is the layout viewport, which the keyboard overlays rather
    // than resizes, so it holds the true full height throughout.
    root.style.setProperty(
      '--app-height',
      `${shrink ? vv.height : window.innerHeight}px`,
    );
    root.style.setProperty(
      '--app-offset-top',
      `${shrink ? vv.offsetTop : 0}px`,
    );

    window.scrollTo(0, 0);
  };

  sync();

  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  // Returning from the app switcher or bfcache can land with stale metrics.
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('focusin', sync);

  // Blur restores full height straight away rather than waiting on a viewport
  // event that may never arrive, then settles again after the keyboard has
  // finished animating out.
  document.addEventListener('focusout', () => {
    sync();
    setTimeout(sync, 300);
  });
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
      /* 100vh first for anything without dvh; the var line then wins where it
         parses. With no keyboard the var is unset, so this is plain 100dvh —
         the full screen, flush to the bottom edge. */
      height: 100vh !important;
      height: var(--app-height, 100dvh) !important;
      min-height: 100vh !important;
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
    /*
     * The score dial reads the drag itself, so the browser must not also
     * scroll the page, select the numerals, or raise the iOS long-press
     * callout — all three fire on exactly the gesture used to enter a score.
     */
    [data-dial] {
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }

    /*
     * Progressive blur behind the nav. Each layer blurs the same backdrop
     * harder than the last and is masked to begin lower, so the blur deepens
     * toward the bottom edge instead of switching on at one line. A single
     * masked layer only fades one radius in, which reads as a band.
     */
    [data-nav-scrim] {
      pointer-events: none;
    }
    [data-nav-scrim="1"] {
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      mask-image: linear-gradient(to bottom, transparent 0%, #000 38%);
      -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 38%);
    }
    [data-nav-scrim="2"] {
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
      mask-image: linear-gradient(to bottom, transparent 32%, #000 68%);
      -webkit-mask-image: linear-gradient(to bottom, transparent 32%, #000 68%);
    }
    [data-nav-scrim="3"] {
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      mask-image: linear-gradient(to bottom, transparent 60%, #000 92%);
      -webkit-mask-image: linear-gradient(to bottom, transparent 60%, #000 92%);
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
