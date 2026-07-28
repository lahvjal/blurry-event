/**
 * App-shell service worker for the Blurry Invitational PWA.
 *
 * Scope is deliberately narrow: cache the shell (HTML, JS, CSS, fonts, icons)
 * so the installed app opens with no signal, and stay out of the way of
 * everything else.
 *
 * Supabase requests are never cached. A cached score read would be worse than
 * no read at all — it could show a golfer a stale card and let them overwrite
 * a teammate's entry. Application data belongs in IndexedDB, which the app
 * manages itself and can reason about staleness for.
 */

const VERSION = 'v1';
const SHELL_CACHE = `blurry-shell-${VERSION}`;
const ASSET_CACHE = `blurry-assets-${VERSION}`;

/** Enough to boot the SPA; hashed bundles are added as they're requested. */
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Don't let one 404 abort the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('blurry-') && !key.endsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Anything that isn't ours, or is an API call, is left entirely alone. */
function isBypassed(url) {
  if (url.origin !== self.location.origin) return true;
  // Never intercept Supabase or any other API traffic.
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return true;
  return false;
}

function isShellAsset(url) {
  return (
    url.pathname.startsWith('/_expo/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/pwa/') ||
    /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|ico|webp)$/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isBypassed(url)) return;

  // Navigations: serve the cached shell when the network is gone. This is what
  // lets the installed app open on the first tee with no bars.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cached =
            (await caches.match('/index.html')) || (await caches.match('/'));
          if (cached) return cached;
          return new Response(
            '<h1>Offline</h1><p>Open the app once while connected, then it will work without a signal.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html' } },
          );
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first. Bundles are content-hashed, so a cache hit is
  // always the right bytes for that URL.
  if (isShellAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(ASSET_CACHE);
            cache.put(request, fresh.clone());
          }
          return fresh;
        } catch (error) {
          const fallback = await caches.match(request);
          if (fallback) return fallback;
          throw error;
        }
      })(),
    );
  }
});

/** Lets the page trigger an immediate activation after an update. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});
