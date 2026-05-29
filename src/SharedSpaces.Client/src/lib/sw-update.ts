/**
 * Lightweight service worker update manager.
 *
 * - Registers the SW (in both dev and production modes)
 * - Detects when a new SW is waiting to activate
 * - Exposes `checkForUpdates()` and `activateUpdate()`
 */

export interface SwUpdateCallbacks {
  onUpdateAvailable: () => void;
}

let registration: ServiceWorkerRegistration | undefined;
let callbacks: SwUpdateCallbacks | undefined;
let refreshing = false;

function trackInstalling(worker: ServiceWorker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      // New SW installed while an existing one controls the page → update available
      callbacks?.onUpdateAvailable();
    }
  });
}

/**
 * Initialise the update manager. Call once from the app shell.
 * Returns immediately in environments without service worker support.
 */
export async function initSwUpdate(cb: SwUpdateCallbacks): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  callbacks = cb;

  try {
    registration = await navigator.serviceWorker.register(
      import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js',
      { type: import.meta.env.DEV ? 'module' : 'classic' },
    );
  } catch {
    // Registration may fail in unsupported contexts (e.g. non-HTTPS without localhost)
    return;
  }

  // A worker may already be waiting (e.g. page was left open during a deploy)
  if (registration.waiting) {
    callbacks.onUpdateAvailable();
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration!.installing;
    if (installing) {
      trackInstalling(installing);
    }
  });

  // Reload when the new SW takes over (one-shot guard to prevent loops)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

/**
 * Ask the browser to re-fetch the SW script and check for a new version.
 */
export async function checkForUpdates(): Promise<void> {
  if (registration) {
    await registration.update();
  }
}

/**
 * Tell the waiting SW to activate, which triggers `controllerchange` → reload.
 */
export function activateUpdate(): void {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}
