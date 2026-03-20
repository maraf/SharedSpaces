import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  queueForOffline,
  getOfflineQueueCount,
  processOfflineQueue,
} from './offline-sync';
import {
  clearOfflineQueue,
  getOfflineQueue,
} from './idb-storage';

// Mock space-api
vi.mock('../features/space-view/space-api', () => ({
  shareText: vi.fn(),
  shareFile: vi.fn(),
  SpaceApiError: class SpaceApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = 'SpaceApiError';
      this.status = status;
    }
  },
}));

// Mock sw-registration
vi.mock('./sw-registration', () => ({
  requestBackgroundSync: vi.fn().mockResolvedValue(false),
}));

import { shareText, shareFile, SpaceApiError } from '../features/space-view/space-api';

const SERVER = 'http://server';
const SPACE = 'space-1';
const TOKEN = 'test-token';

beforeEach(async () => {
  vi.clearAllMocks();
  await clearOfflineQueue();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('offline-sync', () => {
  describe('queueForOffline', () => {
    it('queues a text item', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'hello' });

      const queue = await getOfflineQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe('text');
      expect(queue[0].content).toBe('hello');
      expect(queue[0].serverUrl).toBe(SERVER);
      expect(queue[0].spaceId).toBe(SPACE);
    });

    it('queues a file item', async () => {
      const data = new Uint8Array([1, 2, 3]).buffer;
      await queueForOffline(SERVER, SPACE, 'file', {
        fileName: 'test.bin',
        fileType: 'application/octet-stream',
        fileData: data,
      });

      const queue = await getOfflineQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe('file');
      expect(queue[0].fileName).toBe('test.bin');
    });

    it('generates unique ids for each queued item', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'a' });
      await queueForOffline(SERVER, SPACE, 'text', { content: 'b' });

      const queue = await getOfflineQueue();
      expect(queue).toHaveLength(2);
      expect(queue[0].id).not.toBe(queue[1].id);
      expect(queue[0].itemId).not.toBe(queue[1].itemId);
    });
  });

  describe('getOfflineQueueCount', () => {
    it('returns 0 for empty queue', async () => {
      expect(await getOfflineQueueCount(SERVER, SPACE)).toBe(0);
    });

    it('returns count for matching space only', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'a' });
      await queueForOffline(SERVER, SPACE, 'text', { content: 'b' });
      await queueForOffline(SERVER, 'other-space', 'text', { content: 'c' });

      expect(await getOfflineQueueCount(SERVER, SPACE)).toBe(2);
      expect(await getOfflineQueueCount(SERVER, 'other-space')).toBe(1);
    });
  });

  describe('processOfflineQueue', () => {
    it('returns zero when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      await queueForOffline(SERVER, SPACE, 'text', { content: 'test' });

      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);
      expect(result).toEqual({ synced: 0, failed: 0 });
    });

    it('returns zero for empty queue', async () => {
      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);
      expect(result).toEqual({ synced: 0, failed: 0 });
    });

    it('uploads text items via shareText', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'hello' });
      vi.mocked(shareText).mockResolvedValue({
        id: '1', spaceId: SPACE, memberId: 'm', contentType: 'text',
        content: 'hello', fileSize: 0, sharedAt: '',
      });

      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);

      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(shareText).toHaveBeenCalledWith(
        SERVER, SPACE, expect.any(String), 'hello', TOKEN,
      );
      expect(await getOfflineQueueCount(SERVER, SPACE)).toBe(0);
    });

    it('uploads file items via shareFile', async () => {
      await queueForOffline(SERVER, SPACE, 'file', {
        fileName: 'pic.png',
        fileType: 'image/png',
        fileData: new Uint8Array([1]).buffer,
      });
      vi.mocked(shareFile).mockResolvedValue({
        id: '1', spaceId: SPACE, memberId: 'm', contentType: 'file',
        content: 'pic.png', fileSize: 1, sharedAt: '',
      });

      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);

      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(shareFile).toHaveBeenCalledWith(
        SERVER, SPACE, expect.any(String), expect.any(File), TOKEN,
      );
    });

    it('removes server-rejected items (4xx) from queue', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'bad' });
      vi.mocked(shareText).mockRejectedValue(new SpaceApiError('Forbidden', 403));

      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);

      expect(result).toEqual({ synced: 0, failed: 1 });
      expect(await getOfflineQueueCount(SERVER, SPACE)).toBe(0);
    });

    it('keeps network-error items in queue for retry', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'retry me' });
      vi.mocked(shareText).mockRejectedValue(new SpaceApiError('Network error'));

      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);

      expect(result).toEqual({ synced: 0, failed: 1 });
      expect(await getOfflineQueueCount(SERVER, SPACE)).toBe(1);
    });

    it('processes multiple items — partial success', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'ok' });
      await queueForOffline(SERVER, SPACE, 'text', { content: 'fail' });

      vi.mocked(shareText)
        .mockResolvedValueOnce({
          id: '1', spaceId: SPACE, memberId: 'm', contentType: 'text',
          content: 'ok', fileSize: 0, sharedAt: '',
        })
        .mockRejectedValueOnce(new SpaceApiError('Network error'));

      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);

      expect(result).toEqual({ synced: 1, failed: 1 });
      expect(await getOfflineQueueCount(SERVER, SPACE)).toBe(1);
    });

    it('only processes items for the specified space', async () => {
      await queueForOffline(SERVER, SPACE, 'text', { content: 'mine' });
      await queueForOffline(SERVER, 'other', 'text', { content: 'not mine' });

      vi.mocked(shareText).mockResolvedValue({
        id: '1', spaceId: SPACE, memberId: 'm', contentType: 'text',
        content: 'mine', fileSize: 0, sharedAt: '',
      });

      const result = await processOfflineQueue(SERVER, SPACE, TOKEN);

      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(shareText).toHaveBeenCalledTimes(1);
      // Other space's item still in queue
      expect(await getOfflineQueueCount(SERVER, 'other')).toBe(1);
    });
  });
});
