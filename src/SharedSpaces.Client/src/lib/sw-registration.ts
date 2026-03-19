export async function registerServiceWorker(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (!('serviceWorker' in navigator)) {
    return undefined;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return undefined;
  }
}

export async function requestBackgroundSync(
  tag = 'offline-queue-sync',
): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;

    if ('sync' in registration) {
      await (
        registration as ServiceWorkerRegistration & {
          sync: { register(tag: string): Promise<void> };
        }
      ).sync.register(tag);
      return true;
    }
  } catch {
    // Background Sync API not supported or failed
  }

  return false;
}
