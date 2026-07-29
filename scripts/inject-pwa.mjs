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
        height: 100dvh !important;
        min-height: 100vh !important;
        min-height: 100dvh !important;
        background-color: #131715;
        touch-action: pan-x pan-y;
      }
      #root {
        /* 100vh first for anything without dvh; the var line then wins where
           it parses. With no keyboard the var is unset, so this is plain
           100dvh — the full screen, flush to the bottom edge. */
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
       * harder than the last and is masked to begin lower, so the blur
       * deepens toward the bottom edge instead of switching on at one line.
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
      if (window.visualViewport) {
        var vv = window.visualViewport;
        var root = document.documentElement;
        // Shrink only while a field is actually being typed into. Deciding
        // from the measurement alone meant a keyboard that closed without the
        // viewport reporting all the way back left the app permanently short,
        // showing bare background under the nav until reload.
        var isEditing = function () {
          var el = document.activeElement;
          if (!el) return false;
          return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
        };
        // Always an explicit pixel height — never handed back to 100dvh. iOS
        // can leave viewport units stale after a keyboard is dismissed, which
        // is exactly when this runs, so the shell stayed short even once the
        // override was cleared. innerHeight is the layout viewport, which the
        // keyboard overlays rather than resizes, so it holds the full height.
        // Runs only while the shell is actually shrunk. A keyboard can be
        // dismissed without blurring the field — swipe-down and Done both
        // leave the message composer focused — so there is no focusout, and
        // iOS does not reliably emit a viewport event either. Without this
        // the shell would stay short indefinitely. Self-limiting: starts on
        // shrink, stops the moment there isn't one.
        var watchdog = null;
        var syncViewport = function () {
          var covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
          var shrink = isEditing() && covered >= 120;
          if (shrink && watchdog === null) {
            watchdog = setInterval(syncViewport, 250);
          } else if (!shrink && watchdog !== null) {
            clearInterval(watchdog);
            watchdog = null;
          }
          root.style.setProperty('--app-height', (shrink ? vv.height : window.innerHeight) + 'px');
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
