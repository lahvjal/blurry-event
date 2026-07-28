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
    </style>
    <script>
      document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
      if (window.visualViewport) {
        var vv = window.visualViewport;
        // Only shrink the app while the keyboard is genuinely covering it.
        // Tracking visualViewport unconditionally turned a few pixels of
        // browser rounding into a strip of bare background under the nav.
        var syncViewport = function () {
          var covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
          var root = document.documentElement;
          if (covered >= 120) {
            root.style.setProperty('--app-height', vv.height + 'px');
            root.style.setProperty('--app-offset-top', vv.offsetTop + 'px');
          } else {
            root.style.removeProperty('--app-height');
            root.style.removeProperty('--app-offset-top');
          }
          window.scrollTo(0, 0);
        };
        syncViewport();
        vv.addEventListener('resize', syncViewport);
        vv.addEventListener('scroll', syncViewport);
        window.addEventListener('scroll', syncViewport);
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
