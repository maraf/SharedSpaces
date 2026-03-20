import {
  addToOfflineQueue,
  getOfflineQueueForSpace,
  removeFromOfflineQueue,
  type OfflineQueueItem,
} from './idb-storage';
import { shareText, shareFile, SpaceApiError } from '../features/space-view/space-api';
import { requestBackgroundSync } from './sw-registration';

export interface SyncResult {
  synced: number;
  failed: number;
}

/**
 * Queue a text or file item for later upload when connectivity is restored.
 */
export async function queueForOffline(
  serverUrl: string,
  spaceId: string,
  type: 'text' | 'file',
  options: {
    content?: string;
    fileName?: string;
    fileType?: string;
    fileData?: ArrayBuffer;
  },
): Promise<void> {
  await addToOfflineQueue({
    id: crypto.randomUUID(),
    itemId: crypto.randomUUID(),
    spaceId,
    serverUrl,
    type,
    ...options,
    timestamp: Date.now(),
  });

  await requestBackgroundSync();
}

/**
 * Get the number of queued items for a given space.
 */
export async function getOfflineQueueCount(
  serverUrl: string,
  spaceId: string,
): Promise<number> {
  const queue = await getOfflineQueueForSpace(serverUrl, spaceId);
  return queue.length;
}

/**
 * Process all queued items for a space — upload each via the space API.
 *
 * - Successfully uploaded items are removed from the queue.
 * - Items rejected by the server (4xx) are removed (won't succeed on retry).
 * - Network errors leave the item in the queue for a future attempt.
 */
export async function processOfflineQueue(
  serverUrl: string,
  spaceId: string,
  token: string,
): Promise<SyncResult> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  const queue = await getOfflineQueueForSpace(serverUrl, spaceId);
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      await uploadQueueItem(item, token);
      await removeFromOfflineQueue(item.id);
      synced++;
    } catch (error) {
      if (error instanceof SpaceApiError && error.status) {
        await removeFromOfflineQueue(item.id);
      }
      failed++;
    }
  }

  return { synced, failed };
}

async function uploadQueueItem(
  item: OfflineQueueItem,
  token: string,
): Promise<void> {
  if (item.type === 'text' && item.content) {
    await shareText(item.serverUrl, item.spaceId, item.itemId, item.content, token);
  } else if (item.fileData) {
    const blob = new Blob([item.fileData], {
      type: item.fileType ?? 'application/octet-stream',
    });
    const file = new File([blob], item.fileName ?? 'file', { type: blob.type });
    await shareFile(item.serverUrl, item.spaceId, item.itemId, file, token);
  }
}
