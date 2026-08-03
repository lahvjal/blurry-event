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
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');

if (!existsSync(indexPath)) {
  console.error('inject-pwa: dist/index.html not found — run the web export first.');
  process.exit(1);
}

const HEAD = `
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=overlays-content" />
    <meta name="blurry-build-id" content="0000000000000000" />
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
       * Progressive blur behind floating controls. Each layer blurs the same
       * backdrop harder than the last and is masked to begin nearer its edge,
       * so the blur deepens gradually instead of switching on at one line.
       * Top-floating headers use the exact masks mirrored vertically.
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
      [data-nav-scrim="1"][data-scrim-edge="top"] {
        mask-image: linear-gradient(to bottom, #000 62%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, #000 62%, transparent 100%);
      }
      [data-nav-scrim="2"][data-scrim-edge="top"] {
        mask-image: linear-gradient(to bottom, #000 32%, transparent 68%);
        -webkit-mask-image: linear-gradient(to bottom, #000 32%, transparent 68%);
      }
      [data-nav-scrim="3"][data-scrim-edge="top"] {
        mask-image: linear-gradient(to bottom, #000 8%, transparent 40%);
        -webkit-mask-image: linear-gradient(to bottom, #000 8%, transparent 40%);
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

if (!html.includes('manifest.webmanifest')) {
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
}

const swPath = join(dist, 'sw.js');
if (!existsSync(swPath)) {
  console.error('inject-pwa: dist/sw.js not found — public/sw.js was not exported.');
  process.exit(1);
}

function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

const exportedFiles = allFiles(dist)
  .filter((path) => path !== swPath && !path.endsWith('.map'))
  .sort((left, right) => left.localeCompare(right));
const hash = createHash('sha256');
const swTemplate = readFileSync(swPath, 'utf8');
hash.update(swTemplate);

const entries = exportedFiles.map((path) => {
  const relativePath = relative(dist, path).split(sep).join('/');
  const contents = readFileSync(path);
  hash.update(relativePath);
  hash.update(contents);
  return {
    url: `/${relativePath}`,
    size: statSync(path).size,
  };
});

// Cache the SPA shell under both addresses. The root alias contributes no
// duplicate byte count because it resolves to the exact index response.
if (!entries.some((entry) => entry.url === '/index.html')) {
  console.error('inject-pwa: generated cache manifest has no /index.html.');
  process.exit(1);
}
entries.unshift({ url: '/', size: 0 });

const fingerprint = hash.digest('hex').slice(0, 16);
const manifest = { fingerprint, entries };

// The page and worker use the same build fingerprint so preparation cannot
// accept a completion broadcast from a previous service-worker version. The
// placeholder and digest are both 16 bytes, keeping the precache size exact.
const builtHtml = readFileSync(indexPath, 'utf8');
if (!builtHtml.includes('content="0000000000000000"')) {
  console.error('inject-pwa: build fingerprint placeholder is missing.');
  process.exit(1);
}
writeFileSync(
  indexPath,
  builtHtml.replace('content="0000000000000000"', `content="${fingerprint}"`),
);

const marker = '/*__BLURRY_PRECACHE_MANIFEST__*/ null';
if (!swTemplate.includes(marker)) {
  if (/const INJECTED_PRECACHE = \{"fingerprint":"[a-f0-9]+"/.test(swTemplate)) {
    console.log('inject-pwa: offline shell manifest is already embedded.');
    process.exit(0);
  }
  console.error('inject-pwa: service worker precache marker is missing.');
  process.exit(1);
}

writeFileSync(swPath, swTemplate.replace(marker, JSON.stringify(manifest)));
console.log(
  `inject-pwa: ${entries.length} offline shell URLs embedded (${fingerprint}).`,
);
