import {
  addToOfflineQueue,
  getOfflineQueue,
  getOfflineQueueForSpace,
  removeFromOfflineQueue,
  type OfflineQueueItem,
} from './idb-storage';
import { getServiceWorkerToken } from './token-storage';
import { shareText, shareFile, SpaceApiError } from '../features/space-view/space-api';
import { requestBackgroundSync } from './sw-registration';

export interface SyncResult {
  synced: number;
  failed: number;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || !('onLine' in navigator) || navigator.onLine;
}

function isPermanentSyncFailure(error: unknown): boolean {
  return error instanceof SpaceApiError
    && typeof error.status === 'number'
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 425
    && error.status !== 429;
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
 * Process every queued space that has a mirrored token available for the
 * service worker, skipping spaces that still need a foreground migration.
 */
export async function processAllOfflineQueues(): Promise<SyncResult> {
  if (!isOnline()) return { synced: 0, failed: 0 };

  const queue = await getOfflineQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const processedSpaces = new Set<string>();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    const key = `${item.serverUrl}:${item.spaceId}`;
    if (processedSpaces.has(key)) continue;
    processedSpaces.add(key);

    const token = await getServiceWorkerToken(item.serverUrl, item.spaceId);
    if (!token) continue;

    const result = await processOfflineQueue(item.serverUrl, item.spaceId, token);
    synced += result.synced;
    failed += result.failed;
  }

  return { synced, failed };
}

/**
 * Process all queued items for a space by uploading each via the space API.
 *
 * - Successfully uploaded items are removed from the queue.
 * - Permanent 4xx auth/validation failures are removed (won't succeed on retry).
 * - Transient and network failures stay queued for a future attempt.
 */
export async function processOfflineQueue(
  serverUrl: string,
  spaceId: string,
  token: string,
): Promise<SyncResult> {
  if (!isOnline()) return { synced: 0, failed: 0 };

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
      if (isPermanentSyncFailure(error)) {
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
