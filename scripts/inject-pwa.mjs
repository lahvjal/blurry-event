/**
 * Injects PWA metadata into the exported web build.
 *
 * Expo Router only honours `+html.tsx` when `web.output` is `static`. This app
 * ships as a single-page shell (prerendering fights offline caching and breaks
 * on browser-only APIs at build time), so the head tags are written here after
 * export instead.
 *
 * Run automatically by `npm run build:web`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');

if (!existsSync(indexPath)) {
  console.error('inject-pwa: dist/index.html not found — run the web export first.');
  process.exit(1);
}

const HEAD = `
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=overlays-content" />
    <meta name="description" content="Scorecard, leaderboard and messaging for the Blurry Invitational. Works without a signal." />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#131715" />
    <meta name="color-scheme" content="dark" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Blurry" />
    <link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/pwa/icon-192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/pwa/icon-512.png" />
    <style id="blurry-shell">
      html, body {
        height: 100vh !important;
        height: var(--app-full-height, 100dvh) !important;
        min-height: 100vh !important;
        min-height: var(--app-full-height, 100dvh) !important;
        background-color: #131715;
        touch-action: pan-x pan-y;
      }
      #root {
        /* 100vh first for anything without dvh; the var line then wins where
           it parses. 100dvh covers the moment before the viewport handler
           writes its first explicit pixel height. */
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
       * composer). Each layer blurs the same backdrop harder than the last
       * and is masked to begin lower, so the blur deepens toward the bottom
       * edge instead of switching on at one line.
       */
      [data-nav-scrim] { pointer-events: none; }
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
    </style>
    <script>
      document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
      if (window.visualViewport && !document.documentElement.hasAttribute('data-blurry-viewport-handler')) {
        var vv = window.visualViewport;
        var root = document.documentElement;
        root.setAttribute('data-blurry-viewport-handler', '');
        // Capture the unobstructed layout before a field can summon the
        // keyboard. iOS may resize innerHeight even though overlays-content
        // was requested, so it is not a safe restoration height after focus.
        var fullHeight = Math.max(window.innerHeight, vv.height + vv.offsetTop);
        // Shrink only while a field is actually being typed into. Deciding
        // from the measurement alone meant a keyboard that closed without the
        // viewport reporting all the way back left the app permanently short,
        // showing bare background under the nav until reload.
        var isEditing = function () {
          var el = document.activeElement;
          if (!el) return false;
          return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
        };
        // Always use explicit pixel heights. iOS can leave both viewport units
        // and innerHeight short after the keyboard is dismissed, so the cached
        // pre-focus height is the only safe restoration target.
        // Runs only while the keyboard is covering the app or finishing its
        // closing animation. Swipe-down and Done can leave the composer
        // focused, and iOS does not reliably emit a viewport event for the
        // dismissal. Self-limiting: starts on shrink, stops when the full
        // measurements return.
        var watchdog = null;
        var keyboardActive = false;
        var syncViewport = function () {
          var editing = isEditing();
          var measuredHeight = Math.max(window.innerHeight, vv.height + vv.offsetTop);
          // A focused keyboard is allowed to make the measurements shorter,
          // but it must never redefine the cached full device height. Keep the
          // baseline through focusout too, while the keyboard is animating.
          fullHeight = editing || keyboardActive
            ? Math.max(fullHeight, measuredHeight)
            : measuredHeight;
          var covered = Math.max(0, fullHeight - vv.height - vv.offsetTop);
          var shrink = editing && covered >= 120;
          if (shrink) {
            keyboardActive = true;
          } else if (keyboardActive && measuredHeight >= fullHeight - 1 && covered < 120) {
            keyboardActive = false;
          }
          if ((shrink || keyboardActive) && watchdog === null) {
            watchdog = setInterval(syncViewport, 250);
          } else if (!shrink && !keyboardActive && watchdog !== null) {
            clearInterval(watchdog);
            watchdog = null;
          }
          root.style.setProperty('--app-full-height', fullHeight + 'px');
          root.style.setProperty('--app-height', (shrink ? vv.height : fullHeight) + 'px');
          root.style.setProperty('--app-offset-top', (shrink ? vv.offsetTop : 0) + 'px');
          window.scrollTo(0, 0);
        };
        syncViewport();
        vv.addEventListener('resize', syncViewport);
        vv.addEventListener('scroll', syncViewport);
        window.addEventListener('scroll', syncViewport);
        window.addEventListener('resize', syncViewport);
        window.addEventListener('orientationchange', syncViewport);
        window.addEventListener('pageshow', syncViewport);
        document.addEventListener('visibilitychange', syncViewport);
        document.addEventListener('focusin', syncViewport);
        // Blur restores full height straight away rather than waiting on a
        // viewport event that may never arrive, then settles again once the
        // keyboard has animated out.
        document.addEventListener('focusout', function () {
          syncViewport();
          setTimeout(syncViewport, 300);
        });
      }
    </script>
`;

let html = readFileSync(indexPath, 'utf8');

if (html.includes('manifest.webmanifest')) {
  console.log('inject-pwa: already injected, skipping.');
  process.exit(0);
}

// Expo's template ships a default viewport; ours adds viewport-fit=cover for
// the notch, so the original is dropped rather than duplicated.
html = html.replace(
  /\n\s*<meta name="viewport"[^>]*\/>/,
  '',
);

html = html.replace('<title>', `${HEAD}    <title>`);
html = html.replace(
  /<title>[^<]*<\/title>/,
  '<title>Blurry Invitational</title>',
);

writeFileSync(indexPath, html);
console.log('inject-pwa: PWA metadata written to dist/index.html');
