import {
  INITIAL_PWA_PREPARE_PROGRESS,
  PwaPrepareListener,
  PwaPrepareProgress,
} from '@/lib/offline/pwa-contract';

export type {
  PwaPrepareListener,
  PwaPreparePhase,
  PwaPrepareProgress,
} from '@/lib/offline/pwa-contract';

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

type StandaloneNavigator = Navigator & { standalone?: boolean };

/**
 * Chromium and modern Safari expose display-mode; iOS Home Screen apps have
 * historically exposed navigator.standalone instead. Both are required so an
 * authenticated browser tab can be held at installation guidance while the
 * installed app is allowed into event operations.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as StandaloneNavigator).standalone === true
  );
}

export function subscribePwaDisplayMode(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia('(display-mode: standalone)');
  const notify = () => listener();
  media.addEventListener?.('change', notify);
  window.addEventListener('pageshow', notify);
  return () => {
    media.removeEventListener?.('change', notify);
    window.removeEventListener('pageshow', notify);
  };
}

let latestPrepareProgress: PwaPrepareProgress = {
  ...INITIAL_PWA_PREPARE_PROGRESS,
};
const prepareListeners = new Set<PwaPrepareListener>();
let workerMessageBridgeInstalled = false;
let preparePromise: Promise<PwaPrepareProgress> | null = null;

type WorkerPrepareMessage = {
  type?: string;
  completed?: number;
  total?: number;
  completedBytes?: number;
  totalBytes?: number;
  fingerprint?: string;
  url?: string | null;
  error?: string;
  expectedFingerprint?: string;
};

function emitPrepareProgress(progress: PwaPrepareProgress) {
  latestPrepareProgress = progress;
  prepareListeners.forEach((listener) => listener(progress));
}

function progressFromWorker(message: WorkerPrepareMessage): PwaPrepareProgress | null {
  const common = {
    completed: message.completed ?? latestPrepareProgress.completed,
    total: message.total ?? latestPrepareProgress.total,
    completedBytes:
      message.completedBytes ?? latestPrepareProgress.completedBytes,
    totalBytes: message.totalBytes ?? latestPrepareProgress.totalBytes,
    fingerprint: message.fingerprint ?? latestPrepareProgress.fingerprint,
    url: message.url ?? null,
  };

  if (message.type === 'BLURRY_PREPARE_PROGRESS') {
    return { ...common, phase: 'downloading', error: null };
  }
  if (message.type === 'BLURRY_PREPARE_COMPLETE') {
    return { ...common, phase: 'ready', error: null };
  }
  if (message.type === 'BLURRY_PREPARE_ERROR') {
    return {
      ...common,
      phase: 'error',
      error: message.error ?? 'The offline app download did not finish.',
    };
  }
  if (message.type === 'BLURRY_PREPARE_VERSION_MISMATCH') {
    return {
      ...common,
      phase: 'error',
      error:
        message.error ??
        'The installed app is still activating its latest offline files.',
    };
  }
  return null;
}

function expectedBuildFingerprint(): string | null {
  if (typeof document === 'undefined') return null;
  return (
    document
      .querySelector('meta[name="blurry-build-id"]')
      ?.getAttribute('content') ?? null
  );
}

function ensureWorkerMessageBridge() {
  if (
    workerMessageBridgeInstalled ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return;
  }
  workerMessageBridgeInstalled = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const progress = progressFromWorker(event.data as WorkerPrepareMessage);
    if (progress) emitPrepareProgress(progress);
  });
}

/** Receive exact file and byte counts from the service worker cache pass. */
export function subscribePwaPrepareProgress(
  listener: PwaPrepareListener,
): () => void {
  ensureWorkerMessageBridge();
  prepareListeners.add(listener);
  listener(latestPrepareProgress);
  return () => prepareListeners.delete(listener);
}

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
 * Two conditions make this safe: an editable field must be focused and the
 * visible viewport must be materially shorter than the cached full height.
 * Focus alone is not enough because iOS leaves the composer focused after the
 * keyboard is dismissed.
 *
 * The covered gap is measured rather than heights compared, because Safari
 * both shortens the visual viewport and pans it — `offsetTop` is the panned
 * part and counts toward what the keyboard hides.
 */
const KEYBOARD_MIN_INSET = 120;
const VIEWPORT_HANDLER_ATTRIBUTE = 'data-blurry-viewport-handler';

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
  // The production HTML installs this before React starts. This guard also
  // prevents duplicate listeners when development Strict Mode re-runs effects.
  if (root.hasAttribute(VIEWPORT_HANDLER_ATTRIBUTE)) return;
  root.setAttribute(VIEWPORT_HANDLER_ATTRIBUTE, '');

  // Capture the unobstructed layout before a field can summon the keyboard.
  // On iOS, `innerHeight` can shrink with the keyboard even when
  // `interactive-widget=overlays-content` is requested, so it cannot be used
  // as the restoration height after editing has begun.
  let fullHeight = Math.max(window.innerHeight, vv.height + vv.offsetTop);

  /**
   * Runs only while the keyboard is covering the app or finishing its closing
   * animation.
   *
   * A keyboard can be dismissed without blurring the field — swipe-down, or
   * the Done key, both leave the message composer focused. There is then no
   * `focusout`, and iOS does not reliably emit a viewport event either, so
   * nothing tells us to grow back and the shell stays short indefinitely.
   * Every other field in the app gets blurred by tapping away, which is why
   * the composer was the one that kept doing this.
   *
   * Self-limiting: it starts when a shrink is applied and stops once the full
   * viewport measurements return, so it never ticks while the app is idle.
   */
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let keyboardActive = false;

  const sync = () => {
    const editing = isEditing();
    const measuredHeight = Math.max(
      window.innerHeight,
      vv.height + vv.offsetTop,
    );

    // Browser chrome can disappear and reveal more space while a field is
    // focused, so the baseline may grow. Do not let it shrink until a previous
    // keyboard has visibly finished closing: focusout fires at the start of
    // that animation, while all of Safari's height readings are still short.
    fullHeight =
      editing || keyboardActive
        ? Math.max(fullHeight, measuredHeight)
        : measuredHeight;

    const covered = Math.max(0, fullHeight - vv.height - vv.offsetTop);
    const shrink = editing && covered >= KEYBOARD_MIN_INSET;
    if (shrink) {
      keyboardActive = true;
    } else if (
      keyboardActive &&
      measuredHeight >= fullHeight - 1 &&
      covered < KEYBOARD_MIN_INSET
    ) {
      keyboardActive = false;
    }

    if ((shrink || keyboardActive) && watchdog === null) {
      watchdog = setInterval(sync, 250);
    } else if (!shrink && !keyboardActive && watchdog !== null) {
      clearInterval(watchdog);
      watchdog = null;
    }

    // Keep the page backdrop at the cached full height. Otherwise a stale
    // `100dvh` on `body` clips the restored root because body overflow is
    // intentionally hidden.
    root.style.setProperty('--app-full-height', `${fullHeight}px`);
    root.style.setProperty(
      '--app-height',
      `${shrink ? vv.height : fullHeight}px`,
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
      height: var(--app-full-height, 100dvh) !important;
      min-height: 100vh !important;
      min-height: var(--app-full-height, 100dvh) !important;
      background-color: #131715;
      touch-action: pan-x pan-y;
    }
    #root {
      /* 100vh first for anything without dvh; the var line then wins where it
         parses. 100dvh covers the moment before the viewport handler writes
         its first explicit pixel height. */
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
     * Progressive blur behind bottom-floating controls (the nav and message
     * composer). Each layer blurs the same backdrop harder than the last and
     * is masked to begin lower, so the blur deepens toward the bottom edge
     * instead of switching on at one line. A single masked layer only fades
     * one radius in, which reads as a band.
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
  ensureWorkerMessageBridge();

  if (!('serviceWorker' in navigator)) {
    emitPrepareProgress({
      ...INITIAL_PWA_PREPARE_PROGRESS,
      phase: 'error',
      error: 'This browser does not support offline app storage.',
    });
    return;
  }

  // When a production update replaces an existing worker, reload exactly
  // once so an already-open iOS Safari tab cannot keep running a stale bundle
  // after the new worker has taken control. Do not reload on first install.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  const register = () => {
    if (latestPrepareProgress.phase === 'idle') {
      emitPrepareProgress({
        ...latestPrepareProgress,
        phase: 'registering',
        error: null,
      });
    }
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((caught: unknown) => {
        emitPrepareProgress({
          ...latestPrepareProgress,
          phase: 'error',
          error:
            caught instanceof Error
              ? caught.message
              : 'The offline worker could not be started.',
        });
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/**
 * Ask the active worker to verify/download its exact generated asset manifest.
 * A single in-flight promise is shared by callers so root setup and a visible
 * progress screen cannot start competing cache passes.
 */
export function preparePwaShell(): Promise<PwaPrepareProgress> {
  if (preparePromise) return preparePromise;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    const error = new Error('This browser does not support offline app storage.');
    emitPrepareProgress({
      ...INITIAL_PWA_PREPARE_PROGRESS,
      phase: 'error',
      error: error.message,
    });
    return Promise.reject(error);
  }

  const expectedFingerprint = expectedBuildFingerprint();
  if (
    latestPrepareProgress.phase === 'ready' &&
    (!expectedFingerprint ||
      latestPrepareProgress.fingerprint === expectedFingerprint)
  ) {
    return Promise.resolve(latestPrepareProgress);
  }
  if (latestPrepareProgress.phase === 'error') {
    emitPrepareProgress({
      ...latestPrepareProgress,
      phase: 'registering',
      error: null,
    });
  }

  setupPwa();
  preparePromise = new Promise<PwaPrepareProgress>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe = () => {};
    let settled = false;
    const handleProgress = (progress: PwaPrepareProgress) => {
      if (settled) return;
      if (
        expectedFingerprint &&
        progress.fingerprint &&
        progress.fingerprint !== expectedFingerprint
      ) {
        return;
      }
      if (
        progress.phase === 'ready' &&
        (!expectedFingerprint || progress.fingerprint === expectedFingerprint)
      ) {
        settled = true;
        if (timeout) clearTimeout(timeout);
        unsubscribe();
        resolve(progress);
      } else if (progress.phase === 'error') {
        settled = true;
        if (timeout) clearTimeout(timeout);
        unsubscribe();
        reject(new Error(progress.error ?? 'The offline app download failed.'));
      }
    };

    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      const progress: PwaPrepareProgress = {
        ...latestPrepareProgress,
        phase: 'error',
        error: 'The offline app download timed out. Keep the app open and try again.',
      };
      emitPrepareProgress(progress);
      reject(new Error(progress.error ?? 'The offline app download timed out.'));
    }, 120_000);

    unsubscribe = subscribePwaPrepareProgress(handleProgress);
    if (settled) unsubscribe();

    navigator.serviceWorker.ready
      .then((registration) => {
        if (settled) return;
        const worker = navigator.serviceWorker.controller ?? registration.active;
        if (!worker) {
          throw new Error('The offline worker is not active yet.');
        }
        worker.postMessage({
          type: 'BLURRY_PREPARE_CACHE',
          expectedFingerprint,
        });
      })
      .catch((caught: unknown) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        unsubscribe();
        const error =
          caught instanceof Error
            ? caught
            : new Error('The offline worker could not be reached.');
        emitPrepareProgress({
          ...latestPrepareProgress,
          phase: 'error',
          error: error.message,
        });
        reject(error);
      });
  }).finally(() => {
    preparePromise = null;
  });

  return preparePromise;
}
