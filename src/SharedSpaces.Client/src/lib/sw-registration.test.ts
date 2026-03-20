import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerServiceWorker, requestBackgroundSync } from './sw-registration';

describe('sw-registration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerServiceWorker', () => {
    it('returns undefined when serviceWorker is not in navigator', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
      Object.defineProperty(navigator, 'serviceWorker', {
        value: undefined,
        configurable: true,
      });

      const result = await registerServiceWorker();
      expect(result).toBeUndefined();

      if (original) {
        Object.defineProperty(navigator, 'serviceWorker', original);
      }
    });

    it('registers service worker and returns registration', async () => {
      const mockRegistration = { scope: '/' } as ServiceWorkerRegistration;
      const mockRegister = vi.fn().mockResolvedValue(mockRegistration);

      Object.defineProperty(navigator, 'serviceWorker', {
        value: { register: mockRegister },
        configurable: true,
      });

      const result = await registerServiceWorker();
      expect(result).toBe(mockRegistration);
      expect(mockRegister).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    it('returns undefined on registration failure', async () => {
      const mockRegister = vi.fn().mockRejectedValue(new Error('SW failed'));

      Object.defineProperty(navigator, 'serviceWorker', {
        value: { register: mockRegister },
        configurable: true,
      });

      const result = await registerServiceWorker();
      expect(result).toBeUndefined();
    });
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
