/**
 * Browser-side PWA wiring.
 *
 * The exported build gets its head tags from scripts/inject-pwa.mjs, but the
 * dev server serves Expo's stock template — so the manifest link and service
 * worker are also established at runtime. That keeps `expo start --web`
 * installable and offline-capable, which is what makes the behaviour testable
 * during development rather than only after a production export.
 */

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
 * Registers the app-shell worker. Silent on failure — no worker means no
 * offline shell, but scores still save to IndexedDB, so it must never be fatal.
 */
export function setupPwa(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  ensureManifestLink();
  ensureThemeColor();

  if (!('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
