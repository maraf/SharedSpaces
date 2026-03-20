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
