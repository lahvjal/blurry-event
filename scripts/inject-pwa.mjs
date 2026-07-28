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
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
    <meta name="description" content="Scorecard, leaderboard and messaging for the Blurry Invitational. Works without a signal." />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#131715" />
    <meta name="color-scheme" content="dark" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Blurry" />
    <link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/pwa/icon-192.png" />
    <style id="blurry-shell">
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
    </style>
    <script>
      document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
      if (window.visualViewport) {
        var resetScroll = function () { window.scrollTo(0, 0); };
        window.visualViewport.addEventListener('resize', resetScroll);
        window.visualViewport.addEventListener('scroll', resetScroll);
        window.addEventListener('scroll', resetScroll);
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
