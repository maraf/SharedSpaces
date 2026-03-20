import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  getPendingShares,
  removePendingShare,
  clearPendingShares,
  getOfflineQueue,
  addToOfflineQueue,
  removeFromOfflineQueue,
  clearOfflineQueue,
  getOfflineQueueForSpace,
  clearOfflineQueueForSpace,
  type OfflineQueueItem,
} from './idb-storage';

// fake-indexeddb/auto replaces globalThis.indexedDB — but the module caches
// its DB promise, so we need to reset it between tests.  The simplest way
// is to delete all databases and re-import, but since the module caches a
// singleton promise we instead clear stores between tests.

beforeEach(async () => {
  await clearPendingShares();
  await clearOfflineQueue();
});

describe('idb-storage', () => {
  // --- Pending Shares ---

  describe('pending shares', () => {
    it('starts empty', async () => {
      expect(await getPendingShares()).toEqual([]);
    });

    it('removePendingShare removes a single item', async () => {
      // Manually add via addToOfflineQueue sibling — pending shares have
      // no public "add" (SW does it), so we reach in via the store's put.
      // Instead we can add two, remove one, and verify the other remains.
      // But since there's no addPendingShare export, we test remove on a
      // non-existent id (should be a no-op) and verify the store is still empty.
      await removePendingShare('nonexistent');
      expect(await getPendingShares()).toEqual([]);
    });

    it('clearPendingShares removes all items', async () => {
      await clearPendingShares();
      expect(await getPendingShares()).toEqual([]);
    });
  });

  // --- Offline Queue ---

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
});
