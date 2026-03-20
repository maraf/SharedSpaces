import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestBackgroundSync } from './sw-registration';

describe('sw-registration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('requestBackgroundSync', () => {
    it('returns false when serviceWorker is not available', async () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: undefined,
        configurable: true,
      });

      const result = await requestBackgroundSync();
      expect(result).toBe(false);
    });

    it('returns true when Background Sync is supported', async () => {
      const mockSyncRegister = vi.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve({
            sync: { register: mockSyncRegister },
          }),
        },
        configurable: true,
      });

      const result = await requestBackgroundSync('test-tag');
      expect(result).toBe(true);
      expect(mockSyncRegister).toHaveBeenCalledWith('test-tag');
    });

    it('uses default tag when none provided', async () => {
      const mockSyncRegister = vi.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve({
            sync: { register: mockSyncRegister },
          }),
        },
        configurable: true,
      });

      await requestBackgroundSync();
      expect(mockSyncRegister).toHaveBeenCalledWith('offline-queue-sync');
    });

    it('returns false when Background Sync is not supported', async () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve({}),
        },
        configurable: true,
      });

      const result = await requestBackgroundSync();
      expect(result).toBe(false);
    });

    it('returns false when sync.register throws', async () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve({
            sync: { register: vi.fn().mockRejectedValue(new Error('denied')) },
          }),
        },
        configurable: true,
      });

      const result = await requestBackgroundSync();
      expect(result).toBe(false);
    });
  });
});
