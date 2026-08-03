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

const INJECTED_PRECACHE = /*__BLURRY_PRECACHE_MANIFEST__*/ null;
const FALLBACK_PRECACHE = {
  fingerprint: 'dev-v7',
  entries: [
    { url: '/', size: 0 },
    { url: '/index.html', size: 0 },
    { url: '/manifest.webmanifest', size: 0 },
    { url: '/pwa/apple-touch-icon.png', size: 0 },
    { url: '/pwa/icon-192.png', size: 0 },
    { url: '/pwa/icon-512.png', size: 0 },
  ],
};
const PRECACHE = INJECTED_PRECACHE || FALLBACK_PRECACHE;
const FINGERPRINT = PRECACHE.fingerprint;
const PRECACHE_ENTRIES = PRECACHE.entries;
const TOTAL_BYTES = PRECACHE_ENTRIES.reduce(
  (sum, entry) => sum + (entry.size || 0),
  0,
);

const SHELL_CACHE_PREFIX = 'blurry-shell-';
const RUNTIME_CACHE_PREFIX = 'blurry-runtime-assets-';
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${FINGERPRINT}`;
const RUNTIME_CACHE = `${RUNTIME_CACHE_PREFIX}${FINGERPRINT}`;
// Owned by the event-data preparation track. It must survive app-shell updates.
const EVENT_MEDIA_CACHE = 'blurry-event-media-v1';

let prepareInFlight = null;

async function notifyClients(type, detail = {}) {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const message = {
    type,
    fingerprint: FINGERPRINT,
    total: PRECACHE_ENTRIES.length,
    totalBytes: TOTAL_BYTES,
    ...detail,
  };
  clients.forEach((client) => client.postMessage(message));
}

/**
 * Cache every generated shell file before this worker can activate. If any
 * required response is missing, installation fails and the browser keeps the
 * previous worker and its known-good cache in control.
 */
function preparePrecache() {
  if (prepareInFlight) return prepareInFlight;
  prepareInFlight = (async () => {
    const cache = await caches.open(SHELL_CACHE);
    let completed = 0;
    let completedBytes = 0;

    await notifyClients('BLURRY_PREPARE_PROGRESS', {
      completed,
      completedBytes,
      url: null,
    });

    try {
      // Sequential writes keep memory predictable on older iPhones. Progress
      // is per real response, rather than a timer-based approximation.
      for (const entry of PRECACHE_ENTRIES) {
        const cached = await cache.match(entry.url);
        if (!cached) {
          const response = await fetch(entry.url, { cache: 'reload' });
          if (!response.ok) {
            throw new Error(`${entry.url} returned ${response.status}`);
          }
          await cache.put(entry.url, response);
        }
        completed += 1;
        completedBytes += entry.size || 0;
        await notifyClients('BLURRY_PREPARE_PROGRESS', {
          completed,
          completedBytes,
          url: entry.url,
        });
      }

      const result = {
        completed,
        completedBytes,
        url: null,
      };
      await notifyClients('BLURRY_PREPARE_COMPLETE', result);
      return result;
    } catch (caught) {
      const error =
        caught instanceof Error
          ? caught.message
          : 'The offline app download did not finish.';
      await notifyClients('BLURRY_PREPARE_ERROR', {
        completed,
        completedBytes,
        url: null,
        error,
      });
      throw caught;
    }
  })().finally(() => {
    prepareInFlight = null;
  });
  return prepareInFlight;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await preparePrecache();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Installation cannot reach activation unless every manifest entry was
      // cached. Only now is it safe to retire older shell/runtime versions.
      await preparePrecache();
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              ((key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE) ||
                key.startsWith('blurry-assets-') ||
                (key.startsWith(RUNTIME_CACHE_PREFIX) &&
                  key !== RUNTIME_CACHE)) &&
              key !== EVENT_MEDIA_CACHE,
          )
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
  if (
    url.pathname.startsWith('/rest/v1/') ||
    url.pathname.startsWith('/auth/v1/')
  ) {
    return true;
  }
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

  // Event preparation stores only explicitly fetched CORS media here. Check
  // it before cross-origin bypass so course maps and avatars can render with
  // no signal; a miss remains a normal network request and is never cached by
  // the worker implicitly.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, {
          cacheName: EVENT_MEDIA_CACHE,
        });
        return cached || fetch(request);
      })(),
    );
    return;
  }

  if (isBypassed(url)) return;

  // Navigations: serve the verified shell immediately. Waiting for a doomed
  // network request can hold an iPhone on a blank screen for many seconds at a
  // no-signal course. Worker updates still refresh the shell atomically.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached =
          (await cache.match('/index.html')) || (await cache.match('/'));
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
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
        const shell = await caches.open(SHELL_CACHE);
        const cached = await shell.match(request);
        if (cached) return cached;
        const runtime = await caches.open(RUNTIME_CACHE);
        const runtimeCached = await runtime.match(request);
        if (runtimeCached) return runtimeCached;
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            runtime.put(request, fresh.clone());
          }
          return fresh;
        } catch (error) {
          const fallback = await runtime.match(request);
          if (fallback) return fallback;
          throw error;
        }
      })(),
    );
  }
});

/** Lets the page trigger an immediate activation after an update. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'BLURRY_PREPARE_CACHE') {
    if (
      event.data.expectedFingerprint &&
      event.data.expectedFingerprint !== FINGERPRINT
    ) {
      event.source?.postMessage({
        type: 'BLURRY_PREPARE_VERSION_MISMATCH',
        fingerprint: event.data.expectedFingerprint,
        actualFingerprint: FINGERPRINT,
        expectedFingerprint: event.data.expectedFingerprint,
        error: 'The installed app is still activating its latest offline files.',
      });
      return;
    }
    event.waitUntil(preparePrecache().catch(() => {}));
  }
});

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Payloads come from the send-push edge function as
 * `{ title, body, url, tag }`. A notification must always be shown: browsers
 * grant push under `userVisibleOnly`, and staying silent burns that trust —
 * repeated offences get the site's push permission revoked. So a malformed
 * payload still surfaces something rather than returning early.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON. Fall through to the generic notification below.
  }

  const title = payload.title || 'Blurry Invitational';

  // The count on the home screen icon. Set here rather than in the app because
  // this is the only code that runs while the app is closed, which is exactly
  // when the badge matters. Unsupported browsers simply don't have the method.
  if (typeof payload.badgeCount === 'number' && self.navigator.setAppBadge) {
    event.waitUntil(
      payload.badgeCount > 0
        ? self.navigator.setAppBadge(payload.badgeCount).catch(() => {})
        : self.navigator.clearAppBadge().catch(() => {}),
    );
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/pwa/icon-192.png',
      badge: '/pwa/icon-192.png',
      // Same tag = same slot, so a busy thread replaces its own notification
      // instead of stacking twenty of them on the lock screen.
      tag: payload.tag || 'blurry',
      renotify: true,
      data: { url: payload.url || '/' },
    }),
  );
});

/**
 * Focus an open tab and take it to the right screen; only open a new window if
 * the app isn't running at all. Opening unconditionally would leave a golfer
 * with two copies of the app and a half-typed message stranded in the other.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            // Cross-origin or a client mid-navigation will reject; the tab is
            // focused either way, which is the part that matters.
            try {
              await client.navigate(target);
            } catch {}
          }
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});
