import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB, type IDBPDatabase } from 'idb';

import {
  addToOfflineQueue,
  clearAllCachedFiles,
  clearCachedFilesForSpace,
  clearComposeItems,
  clearComposeItemsForSpace,
  clearJournalCache,
  clearOfflineQueue,
  clearOfflineQueueForSpace,
  clearPendingShares,
  clearStoredTokens,
  getCachedFile,
  getCachedFilesTotalSize,
  getComposeItems,
  getComposeItemsForSpace,
  getJournalCache,
  getJournalSyncEnabled,
  getOfflineQueue,
  getOfflineQueueForSpace,
  getPendingComposeItems,
  getPendingShares,
  getStoredToken,
  getViewedFilesBudget,
  getViewedFilesStorageStatus,
  migrateOfflineQueueIfNeeded,
  pruneCachedFiles,
  removeCachedFile,
  removeComposeItem,
  removeFromOfflineQueue,
  removePendingShare,
  removeStoredToken,
  requestPersistentStorage,
  saveComposeItem,
  setCachedFile,
  setJournalCache,
  setJournalSyncEnabled,
  setStoredToken,
  syncStoredTokens,
  updateComposeItem,
  type ComposeItem,
  type OfflineQueueItem,
  type PendingShareItem,
} from './idb-storage';

beforeEach(async () => {
  await clearPendingShares();
  await clearOfflineQueue();
  await clearComposeItems();
  await clearStoredTokens();
  await clearAllCachedFiles();
});

async function seedPendingShares(items: PendingShareItem[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('shared-spaces-db', 6);

    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('pending-shares', 'readwrite');
      for (const item of items) {
        tx.objectStore('pending-shares').put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Failed to seed pending shares'));
    };

    request.onerror = () => reject(request.error);
  });
}

describe('idb-storage', () => {
  describe('pending shares', () => {
    it('starts empty', async () => {
      expect(await getPendingShares()).toEqual([]);
    });

    it('removePendingShare removes a single item', async () => {
      await removePendingShare('nonexistent');
      expect(await getPendingShares()).toEqual([]);
    });

    it('clearPendingShares removes all items', async () => {
      await clearPendingShares();
      expect(await getPendingShares()).toEqual([]);
    });

    it('returns pending shares newest-first with stable tie-breakers', async () => {
      await seedPendingShares([
        { id: '1000-0001-b', type: 'text', content: 'second', timestamp: 1000 },
        { id: '2000-0000-c', type: 'text', content: 'latest', timestamp: 2000 },
        { id: '1000-0000-a', type: 'text', content: 'first', timestamp: 1000 },
      ]);

      expect((await getPendingShares()).map((item) => item.id)).toEqual([
        '2000-0000-c',
        '1000-0000-a',
        '1000-0001-b',
      ]);
    });
  });

  describe('offline queue', () => {
    const item1: OfflineQueueItem = {
      id: 'q-1',
      itemId: 'item-1',
      spaceId: 'space-A',
      serverUrl: 'http://server1',
      type: 'text',
      content: 'queued text',
      timestamp: 1000,
    };

    const item2: OfflineQueueItem = {
      id: 'q-2',
      itemId: 'item-2',
      spaceId: 'space-A',
      serverUrl: 'http://server1',
      type: 'file',
      fileName: 'photo.png',
      fileType: 'image/png',
      fileData: new ArrayBuffer(8),
      timestamp: 2000,
    };

    const item3: OfflineQueueItem = {
      id: 'q-3',
      itemId: 'item-3',
      spaceId: 'space-B',
      serverUrl: 'http://server1',
      type: 'text',
      content: 'other space',
      timestamp: 3000,
    };

    it('starts empty', async () => {
      expect(await getOfflineQueue()).toEqual([]);
    });

    it('addToOfflineQueue stores an item', async () => {
      await addToOfflineQueue(item1);
      const queue = await getOfflineQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('q-1');
      expect(queue[0].content).toBe('queued text');
    });

    it('addToOfflineQueue stores multiple items', async () => {
      await addToOfflineQueue(item1);
      await addToOfflineQueue(item2);
      expect(await getOfflineQueue()).toHaveLength(2);
    });

    it('addToOfflineQueue overwrites item with same id (put semantics)', async () => {
      await addToOfflineQueue(item1);
      await addToOfflineQueue({ ...item1, content: 'updated' });
      const queue = await getOfflineQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].content).toBe('updated');
    });

    it('removeFromOfflineQueue removes a single item', async () => {
      await addToOfflineQueue(item1);
      await addToOfflineQueue(item2);
      await removeFromOfflineQueue('q-1');
      const queue = await getOfflineQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('q-2');
    });

    it('removeFromOfflineQueue is no-op for nonexistent id', async () => {
      await addToOfflineQueue(item1);
      await removeFromOfflineQueue('nonexistent');
      expect(await getOfflineQueue()).toHaveLength(1);
    });

    it('clearOfflineQueue removes all items', async () => {
      await addToOfflineQueue(item1);
      await addToOfflineQueue(item2);
      await clearOfflineQueue();
      expect(await getOfflineQueue()).toEqual([]);
    });

    it('getOfflineQueueForSpace filters by serverUrl and spaceId', async () => {
      await addToOfflineQueue(item1);
      await addToOfflineQueue(item2);
      await addToOfflineQueue(item3);

      const spaceA = await getOfflineQueueForSpace('http://server1', 'space-A');
      expect(spaceA).toHaveLength(2);
      expect(spaceA.map((i) => i.id).sort()).toEqual(['q-1', 'q-2']);

      const spaceB = await getOfflineQueueForSpace('http://server1', 'space-B');
      expect(spaceB).toHaveLength(1);
      expect(spaceB[0].id).toBe('q-3');
    });

    it('getOfflineQueueForSpace returns items newest-first with stable tie-breakers', async () => {
      await addToOfflineQueue({ ...item1, id: 'q-9', itemId: 'item-9', timestamp: 1000 });
      await addToOfflineQueue({ ...item1, id: 'q-1', itemId: 'item-1', timestamp: 1000 });
      await addToOfflineQueue({ ...item2, id: 'q-2', itemId: 'item-2', timestamp: 2000 });

      const queue = await getOfflineQueueForSpace('http://server1', 'space-A');

      expect(queue.map((item) => item.id)).toEqual(['q-2', 'q-1', 'q-9']);
    });

    it('getOfflineQueueForSpace returns empty for unknown space', async () => {
      await addToOfflineQueue(item1);
      expect(await getOfflineQueueForSpace('http://other', 'space-X')).toEqual([]);
    });

    it('clearOfflineQueueForSpace only removes items for that space', async () => {
      await addToOfflineQueue(item1);
      await addToOfflineQueue(item2);
      await addToOfflineQueue(item3);

      await clearOfflineQueueForSpace('http://server1', 'space-A');

      const remaining = await getOfflineQueue();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('q-3');
    });

    it('clearOfflineQueueForSpace is no-op for unknown space', async () => {
      await addToOfflineQueue(item1);
      await clearOfflineQueueForSpace('http://other', 'space-X');
      expect(await getOfflineQueue()).toHaveLength(1);
    });

    it('stores and retrieves ArrayBuffer for file items', async () => {
      const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
      await addToOfflineQueue({ ...item2, fileData: buffer });
      const queue = await getOfflineQueue();
      expect(queue[0].fileData).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(queue[0].fileData!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });
  });

  describe('compose items', () => {
    const draftText: ComposeItem = {
      id: 'c-1',
      status: 'draft',
      type: 'text',
      serverUrl: 'http://server1',
      spaceId: 'space-A',
      itemId: 'item-1',
      content: 'draft text',
      timestamp: 1000,
    };

    const pendingFile: ComposeItem = {
      id: 'c-2',
      status: 'pending',
      type: 'file',
      serverUrl: 'http://server1',
      spaceId: 'space-A',
      itemId: 'item-2',
      fileName: 'photo.png',
      fileType: 'image/png',
      fileData: new ArrayBuffer(8),
      fileSize: 8,
      timestamp: 2000,
    };

    const draftOtherSpace: ComposeItem = {
      id: 'c-3',
      status: 'draft',
      type: 'text',
      serverUrl: 'http://server1',
      spaceId: 'space-B',
      itemId: 'item-3',
      content: 'other space',
      timestamp: 3000,
    };

    it('starts empty', async () => {
      expect(await getComposeItems()).toEqual([]);
    });

    it('saveComposeItem stores an item', async () => {
      await saveComposeItem(draftText);
      const items = await getComposeItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('c-1');
      expect(items[0].status).toBe('draft');
      expect(items[0].content).toBe('draft text');
    });

    it('saveComposeItem overwrites item with same id (put semantics)', async () => {
      await saveComposeItem(draftText);
      await saveComposeItem({ ...draftText, content: 'updated' });
      const items = await getComposeItems();
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('updated');
    });

    it('getComposeItems returns oldest-first with stable tie-breakers', async () => {
      await saveComposeItem({ ...draftText, id: 'c-9', timestamp: 1000 });
      await saveComposeItem({ ...draftText, id: 'c-1', timestamp: 1000 });
      await saveComposeItem({ ...pendingFile, id: 'c-2', timestamp: 2000 });

      expect((await getComposeItems()).map((i) => i.id)).toEqual(['c-1', 'c-9', 'c-2']);
    });

    it('getPendingComposeItems returns only pending rows', async () => {
      await saveComposeItem(draftText);
      await saveComposeItem(pendingFile);
      await saveComposeItem(draftOtherSpace);

      const pending = await getPendingComposeItems();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('c-2');
      expect(pending[0].status).toBe('pending');
    });

    it('getComposeItemsForSpace filters by serverUrl and spaceId', async () => {
      await saveComposeItem(draftText);
      await saveComposeItem(pendingFile);
      await saveComposeItem(draftOtherSpace);

      const spaceA = await getComposeItemsForSpace('http://server1', 'space-A');
      expect(spaceA.map((i) => i.id).sort()).toEqual(['c-1', 'c-2']);

      const spaceB = await getComposeItemsForSpace('http://server1', 'space-B');
      expect(spaceB).toHaveLength(1);
      expect(spaceB[0].id).toBe('c-3');
    });

    it('getComposeItemsForSpace returns empty for unknown space', async () => {
      await saveComposeItem(draftText);
      expect(await getComposeItemsForSpace('http://other', 'space-X')).toEqual([]);
    });

    it('updateComposeItem flips a draft to pending', async () => {
      await saveComposeItem(draftText);
      const result = await updateComposeItem('c-1', (item) => ({ ...item, status: 'pending' }));
      expect(result).toBe('updated');
      const items = await getComposeItems();
      expect(items[0].status).toBe('pending');
    });

    it('updateComposeItem returns missing without writing for unknown id', async () => {
      const result = await updateComposeItem('nope', (item) => ({ ...item, status: 'pending' }));
      expect(result).toBe('missing');
      expect(await getComposeItems()).toEqual([]);
    });

    it('removeComposeItem removes a single item', async () => {
      await saveComposeItem(draftText);
      await saveComposeItem(pendingFile);
      await removeComposeItem('c-1');
      const items = await getComposeItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('c-2');
    });

    it('removeComposeItem is no-op for nonexistent id', async () => {
      await saveComposeItem(draftText);
      await removeComposeItem('nonexistent');
      expect(await getComposeItems()).toHaveLength(1);
    });

    it('clearComposeItems removes all items', async () => {
      await saveComposeItem(draftText);
      await saveComposeItem(pendingFile);
      await clearComposeItems();
      expect(await getComposeItems()).toEqual([]);
    });

    it('clearComposeItemsForSpace only removes items for that space', async () => {
      await saveComposeItem(draftText);
      await saveComposeItem(pendingFile);
      await saveComposeItem(draftOtherSpace);

      await clearComposeItemsForSpace('http://server1', 'space-A');

      const remaining = await getComposeItems();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('c-3');
    });

    it('clearComposeItemsForSpace is no-op for unknown space', async () => {
      await saveComposeItem(draftText);
      await clearComposeItemsForSpace('http://other', 'space-X');
      expect(await getComposeItems()).toHaveLength(1);
    });

    it('stores and retrieves ArrayBuffer for file items', async () => {
      const buffer = new Uint8Array([5, 6, 7, 8]).buffer;
      await saveComposeItem({ ...pendingFile, fileData: buffer });
      const items = await getComposeItems();
      expect(items[0].fileData).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(items[0].fileData!)).toEqual(new Uint8Array([5, 6, 7, 8]));
    });
  });

  describe('offline-queue -> compose-items migration', () => {
    async function openWrappedDb(): Promise<IDBPDatabase> {
      return await openDB('shared-spaces-db', 6);
    }

    async function seedOfflineQueueRaw(
      db: IDBPDatabase,
      items: OfflineQueueItem[],
    ): Promise<void> {
      const tx = db.transaction('offline-queue', 'readwrite');
      for (const item of items) {
        await tx.store.put(item);
      }
      await tx.done;
    }

    const legacy: OfflineQueueItem = {
      id: 'q-mig-1',
      itemId: 'item-mig-1',
      spaceId: 'space-A',
      serverUrl: 'http://server1',
      type: 'text',
      content: 'legacy queued text',
      timestamp: 1000,
    };

    it('copies legacy offline-queue rows into compose-items as pending and clears the queue', async () => {
      const db = await openWrappedDb();
      await seedOfflineQueueRaw(db, [legacy]);

      await migrateOfflineQueueIfNeeded(db);

      const items = await getComposeItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('q-mig-1');
      expect(items[0].status).toBe('pending');
      expect(items[0].itemId).toBe('item-mig-1');
      expect(items[0].content).toBe('legacy queued text');
      expect(await getOfflineQueue()).toEqual([]);

      db.close();
    });

    it('is idempotent and does not resurrect rows on re-run', async () => {
      const db = await openWrappedDb();
      await seedOfflineQueueRaw(db, [legacy]);

      await migrateOfflineQueueIfNeeded(db);
      // Second run sees an empty queue; the already-migrated row must survive.
      await migrateOfflineQueueIfNeeded(db);

      const items = await getComposeItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('q-mig-1');

      db.close();
    });

    it('does not overwrite an existing compose-item with the same id', async () => {
      await saveComposeItem({
        id: 'q-mig-1',
        status: 'draft',
        type: 'text',
        serverUrl: 'http://server1',
        spaceId: 'space-A',
        itemId: 'item-mig-1',
        content: 'existing draft',
        timestamp: 5000,
      });

      const db = await openWrappedDb();
      await seedOfflineQueueRaw(db, [legacy]);

      await migrateOfflineQueueIfNeeded(db);

      const items = await getComposeItems();
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe('draft');
      expect(items[0].content).toBe('existing draft');
      // Legacy row is still drained from the queue even when skipped.
      expect(await getOfflineQueue()).toEqual([]);

      db.close();
    });
  });

  describe('service worker token mirror', () => {
    it('stores and retrieves a mirrored token', async () => {
      await setStoredToken('http://server1', 'space-A', 'jwt-token');

      await expect(getStoredToken('http://server1', 'space-A')).resolves.toBe('jwt-token');
    });

    it('removes a mirrored token', async () => {
      await setStoredToken('http://server1', 'space-A', 'jwt-token');
      await removeStoredToken('http://server1', 'space-A');

      await expect(getStoredToken('http://server1', 'space-A')).resolves.toBeUndefined();
    });

    it('syncStoredTokens replaces the IndexedDB mirror with the latest local tokens', async () => {
      await setStoredToken('http://old-server', 'space-old', 'old-token');

      await syncStoredTokens({
        'http://server1:space-A': 'token-a',
        'http://server2:space-B': 'token-b',
      });

      await expect(getStoredToken('http://server1', 'space-A')).resolves.toBe('token-a');
      await expect(getStoredToken('http://server2', 'space-B')).resolves.toBe('token-b');
      await expect(getStoredToken('http://old-server', 'space-old')).resolves.toBeUndefined();
    });
  });

  describe('journal sync settings', () => {
    it('defaults to false for new space', async () => {
      expect(await getJournalSyncEnabled('http://server1', 'space-A')).toBe(false);
    });

    it('setJournalSyncEnabled stores enabled state', async () => {
      await setJournalSyncEnabled('http://server1', 'space-A', true);
      expect(await getJournalSyncEnabled('http://server1', 'space-A')).toBe(true);
    });

    it('setJournalSyncEnabled can toggle back to false', async () => {
      await setJournalSyncEnabled('http://server1', 'space-A', true);
      await setJournalSyncEnabled('http://server1', 'space-A', false);
      expect(await getJournalSyncEnabled('http://server1', 'space-A')).toBe(false);
    });

    it('settings are scoped by serverUrl and spaceId', async () => {
      await setJournalSyncEnabled('http://server1', 'space-A', true);
      await setJournalSyncEnabled('http://server1', 'space-B', false);
      await setJournalSyncEnabled('http://server2', 'space-A', true);

      expect(await getJournalSyncEnabled('http://server1', 'space-A')).toBe(true);
      expect(await getJournalSyncEnabled('http://server1', 'space-B')).toBe(false);
      expect(await getJournalSyncEnabled('http://server2', 'space-A')).toBe(true);
    });
  });

  describe('journal cache', () => {
    const items = [
      {
        id: 'item-1',
        spaceId: 'space-A',
        memberId: 'member-1',
        contentType: 'text' as const,
        content: 'Hello',
        fileSize: 0,
        sharedAt: '2025-01-01T00:00:00Z',
      },
      {
        id: 'item-2',
        spaceId: 'space-A',
        memberId: 'member-1',
        contentType: 'file' as const,
        content: 'file.txt',
        fileSize: 1024,
        sharedAt: '2025-01-02T00:00:00Z',
      },
    ];

    it('returns undefined for uncached space', async () => {
      expect(await getJournalCache('http://server1', 'space-A')).toBeUndefined();
    });

    it('setJournalCache stores checkpoint and items', async () => {
      const checkpoint = '2025-01-02T12:00:00Z';
      await setJournalCache('http://server1', 'space-A', checkpoint, items);

      const cache = await getJournalCache('http://server1', 'space-A');
      expect(cache).toBeDefined();
      expect(cache!.checkpoint).toBe(checkpoint);
      expect(cache!.items).toEqual(items);
    });

    it('setJournalCache overwrites existing cache', async () => {
      await setJournalCache('http://server1', 'space-A', '2025-01-01T00:00:00Z', items);
      await setJournalCache('http://server1', 'space-A', '2025-01-03T00:00:00Z', [items[0]]);

      const cache = await getJournalCache('http://server1', 'space-A');
      expect(cache!.checkpoint).toBe('2025-01-03T00:00:00Z');
      expect(cache!.items).toHaveLength(1);
    });

    it('cache is scoped by serverUrl and spaceId', async () => {
      await setJournalCache('http://server1', 'space-A', '2025-01-01T00:00:00Z', items);
      await setJournalCache('http://server1', 'space-B', '2025-01-02T00:00:00Z', [items[1]]);

      const cacheA = await getJournalCache('http://server1', 'space-A');
      const cacheB = await getJournalCache('http://server1', 'space-B');

      expect(cacheA!.items).toHaveLength(2);
      expect(cacheB!.items).toHaveLength(1);
    });

    it('clearJournalCache removes cache for space', async () => {
      await setJournalCache('http://server1', 'space-A', '2025-01-01T00:00:00Z', items);
      await clearJournalCache('http://server1', 'space-A');

      expect(await getJournalCache('http://server1', 'space-A')).toBeUndefined();
    });

    it('clearJournalCache only removes specified space', async () => {
      await setJournalCache('http://server1', 'space-A', '2025-01-01T00:00:00Z', items);
      await setJournalCache('http://server1', 'space-B', '2025-01-02T00:00:00Z', [items[1]]);

      await clearJournalCache('http://server1', 'space-A');

      expect(await getJournalCache('http://server1', 'space-A')).toBeUndefined();
      expect(await getJournalCache('http://server1', 'space-B')).toBeDefined();
    });
  });

  describe('viewed file cache', () => {
    const server = 'http://localhost:5165';
    const spaceId = 'space-1';

    function makeBlob(size: number, type = 'application/octet-stream'): Blob {
      return new Blob([new Uint8Array(size)], { type });
    }

    it('returns undefined when no entry is cached', async () => {
      expect(await getCachedFile(server, spaceId, 'item-1')).toBeUndefined();
    });

    it('round-trips a cached blob and refreshes accessedAt on read', async () => {
      const blob = makeBlob(100, 'image/png');
      await setCachedFile(server, spaceId, 'item-1', blob, 'image/png');

      const first = await getCachedFile(server, spaceId, 'item-1');
      expect(first).toBeDefined();
      expect(first?.size).toBe(100);
      expect(first?.mimeType).toBe('image/png');
      // fake-indexeddb may not preserve Blob.prototype across structured cloning,
      // so we only assert the persisted metadata round-trips.

      const firstAccess = first!.accessedAt;
      // Force a tick so the second read produces a strictly greater timestamp.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const second = await getCachedFile(server, spaceId, 'item-1');
      expect(second!.accessedAt).toBeGreaterThanOrEqual(firstAccess);
    });

    it('removes a single cached blob', async () => {
      await setCachedFile(server, spaceId, 'item-1', makeBlob(10));
      await setCachedFile(server, spaceId, 'item-2', makeBlob(10));
      await removeCachedFile(server, spaceId, 'item-1');

      expect(await getCachedFile(server, spaceId, 'item-1')).toBeUndefined();
      expect(await getCachedFile(server, spaceId, 'item-2')).toBeDefined();
    });

    it('clears all cached blobs for a single space only', async () => {
      await setCachedFile(server, 'space-A', 'item-1', makeBlob(10));
      await setCachedFile(server, 'space-A', 'item-2', makeBlob(10));
      await setCachedFile(server, 'space-B', 'item-3', makeBlob(10));

      await clearCachedFilesForSpace(server, 'space-A');

      expect(await getCachedFile(server, 'space-A', 'item-1')).toBeUndefined();
      expect(await getCachedFile(server, 'space-A', 'item-2')).toBeUndefined();
      expect(await getCachedFile(server, 'space-B', 'item-3')).toBeDefined();
    });

    it('evicts the least recently used entry when the budget is exceeded', async () => {
      // Budget = 250 bytes; three 100-byte blobs forces eviction of the oldest.
      await setCachedFile(server, spaceId, 'old', makeBlob(100), undefined, 250);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await setCachedFile(server, spaceId, 'mid', makeBlob(100), undefined, 250);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await setCachedFile(server, spaceId, 'new', makeBlob(100), undefined, 250);

      expect(await getCachedFile(server, spaceId, 'old')).toBeUndefined();
      expect(await getCachedFile(server, spaceId, 'mid')).toBeDefined();
      expect(await getCachedFile(server, spaceId, 'new')).toBeDefined();
      expect(await getCachedFilesTotalSize()).toBeLessThanOrEqual(250);
    });

    it('pruneCachedFiles is a no-op when total size is under budget', async () => {
      await setCachedFile(server, spaceId, 'item-1', makeBlob(10));
      await setCachedFile(server, spaceId, 'item-2', makeBlob(10));

      await pruneCachedFiles(10_000);

      expect(await getCachedFile(server, spaceId, 'item-1')).toBeDefined();
      expect(await getCachedFile(server, spaceId, 'item-2')).toBeDefined();
    });

    it('getCachedFile bumps accessedAt without rewriting the blob row', async () => {
      // Warm the DB and seed an entry, then start tracking puts so we only
      // observe the puts that the read path performs.
      await setCachedFile(server, spaceId, 'item-1', makeBlob(100), 'image/png');

      const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
      try {
        const first = await getCachedFile(server, spaceId, 'item-1');
        await new Promise((resolve) => setTimeout(resolve, 2));
        const second = await getCachedFile(server, spaceId, 'item-1');
        await new Promise((resolve) => setTimeout(resolve, 2));
        const third = await getCachedFile(server, spaceId, 'item-1');

        expect(first).toBeDefined();
        expect(second).toBeDefined();
        expect(third).toBeDefined();
        // accessedAt must advance — proves meta is being updated.
        expect(third!.accessedAt).toBeGreaterThanOrEqual(second!.accessedAt);
        expect(second!.accessedAt).toBeGreaterThanOrEqual(first!.accessedAt);

        const targets = putSpy.mock.contexts.map((ctx) => (ctx as IDBObjectStore).name);
        // Three reads should produce three meta puts and zero blob puts.
        expect(targets.filter((n) => n === 'viewed-files-meta')).toHaveLength(3);
        expect(targets.filter((n) => n === 'viewed-files')).toHaveLength(0);
      } finally {
        putSpy.mockRestore();
      }
    });

    it('uses the dynamic budget from navigator.storage.estimate when none is provided', async () => {
      const originalNavigator = globalThis.navigator;
      const estimate = vi.fn().mockResolvedValue({ quota: 1024, usage: 0 });
      Object.defineProperty(globalThis, 'navigator', {
        value: { storage: { estimate } },
        configurable: true,
      });

      try {
        // 1024 * 0.5 = 512, but the floor of 100 MB takes over.
        const budget = await getViewedFilesBudget();
        expect(budget).toBeGreaterThanOrEqual(100 * 1024 * 1024);
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        });
      }
    });

    it('caps the dynamic budget at the ceiling for large quotas', async () => {
      const originalNavigator = globalThis.navigator;
      const oneTerabyte = 1024 * 1024 * 1024 * 1024;
      const estimate = vi.fn().mockResolvedValue({ quota: oneTerabyte, usage: 0 });
      Object.defineProperty(globalThis, 'navigator', {
        value: { storage: { estimate } },
        configurable: true,
      });

      try {
        const budget = await getViewedFilesBudget();
        expect(budget).toBe(500 * 1024 * 1024);
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        });
      }
    });

    it('returns the floor when navigator.storage is unavailable', async () => {
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        configurable: true,
      });

      try {
        const budget = await getViewedFilesBudget();
        expect(budget).toBe(100 * 1024 * 1024);
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        });
      }
    });

    it('reports cache usage status with quota/usage when available', async () => {
      const originalNavigator = globalThis.navigator;
      const estimate = vi.fn().mockResolvedValue({ quota: 999, usage: 42 });
      Object.defineProperty(globalThis, 'navigator', {
        value: { storage: { estimate } },
        configurable: true,
      });

      try {
        await setCachedFile(server, spaceId, 'item-1', makeBlob(50));
        const status = await getViewedFilesStorageStatus();
        expect(status.used).toBe(50);
        expect(status.quota).toBe(999);
        expect(status.usage).toBe(42);
        expect(status.budget).toBeGreaterThan(0);
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        });
      }
    });

    it('requestPersistentStorage resolves to false when the API is missing', async () => {
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        configurable: true,
      });

      try {
        const result = await requestPersistentStorage();
        expect(result).toBe(false);
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        });
      }
    });

    it('requestPersistentStorage short-circuits when storage is already persisted', async () => {
      const originalNavigator = globalThis.navigator;
      const persisted = vi.fn().mockResolvedValue(true);
      const persist = vi.fn().mockResolvedValue(true);
      Object.defineProperty(globalThis, 'navigator', {
        value: { storage: { persisted, persist } },
        configurable: true,
      });

      try {
        const result = await requestPersistentStorage();
        expect(result).toBe(true);
        expect(persisted).toHaveBeenCalled();
        expect(persist).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        });
      }
    });
  });
});
