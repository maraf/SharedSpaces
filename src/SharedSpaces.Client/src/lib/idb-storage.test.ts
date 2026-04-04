import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';

import {
  addToOfflineQueue,
  clearJournalCache,
  clearOfflineQueue,
  clearOfflineQueueForSpace,
  clearPendingShares,
  clearStoredTokens,
  getJournalCache,
  getJournalSyncEnabled,
  getOfflineQueue,
  getOfflineQueueForSpace,
  getPendingShares,
  getStoredToken,
  removeFromOfflineQueue,
  removePendingShare,
  removeStoredToken,
  setJournalCache,
  setJournalSyncEnabled,
  setStoredToken,
  syncStoredTokens,
  type OfflineQueueItem,
} from './idb-storage';

beforeEach(async () => {
  await clearPendingShares();
  await clearOfflineQueue();
  await clearStoredTokens();
});

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
});
