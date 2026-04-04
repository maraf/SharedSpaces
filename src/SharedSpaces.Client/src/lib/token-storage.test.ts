import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  getTokens,
  setToken,
  getToken,
  removeToken,
  getPrimaryDisplayName,
  setPrimaryDisplayName,
  getLastSelectedSpace,
  setLastSelectedSpace,
  clearLastSelectedSpace,
  getServiceWorkerToken,
  getServiceWorkerTokens,
  syncTokensToServiceWorkerStore,
  resetTokenStorageForTests,
  waitForTokenMirrorWritesForTests,
} from './token-storage';
import { clearStoredAuthTokens, getStoredToken } from './idb-storage';

async function resetTokenStorageState(): Promise<void> {
  await waitForTokenMirrorWritesForTests();
  localStorage.clear();
  await clearStoredAuthTokens();
  await resetTokenStorageForTests();
}

describe('token-storage', () => {
  beforeEach(resetTokenStorageState);
  afterEach(resetTokenStorageState);

  describe('getTokens', () => {
    it('returns empty object when storage is empty', async () => {
      const tokens = await getTokens();
      expect(tokens).toEqual({});
    });

    it('returns all stored tokens', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001', 'token2');

      const tokens = await getTokens();
      expect(tokens).toEqual({
        'http://localhost:5000:550e8400-e29b-41d4-a716-446655440000': 'token1',
        'http://localhost:5000:550e8400-e29b-41d4-a716-446655440001': 'token2',
      });
    });

    it('handles corrupted localStorage data gracefully', async () => {
      localStorage.setItem('sharedspaces:tokens', 'not-valid-json');
      const tokens = await getTokens();
      expect(tokens).toEqual({});
    });
  });

  describe('setToken', () => {
    it('stores a token for a specific server+space key', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'my-jwt-token');

      const tokens = await getTokens();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBe('my-jwt-token');
    });

    it('stores multiple tokens for different server+space combinations', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      await setToken('http://localhost:5001', '550e8400-e29b-41d4-a716-446655440000', 'token2');
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001', 'token3');

      const tokens = await getTokens();
      expect(Object.keys(tokens)).toHaveLength(3);
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBe('token1');
      expect(tokens['http://localhost:5001:550e8400-e29b-41d4-a716-446655440000']).toBe('token2');
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440001']).toBe('token3');
    });

    it('overwrites existing token for the same key', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'old-token');
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'new-token');

      const tokens = await getTokens();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBe('new-token');
      expect(Object.keys(tokens)).toHaveLength(1);
    });
  });

  describe('getToken', () => {
    it('retrieves a stored token by server+space key', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'my-token');

      const token = await getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      expect(token).toBe('my-token');
    });

    it('returns undefined for non-existent key', async () => {
      const token = await getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      expect(token).toBeUndefined();
    });

    it('returns undefined for different server URL', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');

      const token = await getToken('http://localhost:5001', '550e8400-e29b-41d4-a716-446655440000');
      expect(token).toBeUndefined();
    });

    it('returns undefined for different space ID', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');

      const token = await getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001');
      expect(token).toBeUndefined();
    });
  });

  describe('removeToken', () => {
    it('removes a specific token by server+space key', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001', 'token2');

      await removeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');

      const tokens = await getTokens();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBeUndefined();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440001']).toBe('token2');
    });

    it('does not throw when removing non-existent token', async () => {
      await expect(
        removeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000'),
      ).resolves.toBeUndefined();
    });

    it('leaves empty object after removing last token', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      await removeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');

      const tokens = await getTokens();
      expect(tokens).toEqual({});
    });
  });

  describe('service worker token mirror', () => {
    it('mirrors newly stored tokens to the service-worker-readable store', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'mirror-me');

      await expect(
        getServiceWorkerToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000'),
      ).resolves.toBe('mirror-me');
    });

    it('migrates legacy localStorage-only tokens into the service-worker-readable store on first access', async () => {
      const legacyTokens = {
        'http://localhost:5000:550e8400-e29b-41d4-a716-446655440000': 'legacy-token',
        'http://localhost:5001:550e8400-e29b-41d4-a716-446655440001': 'other-token',
      };
      localStorage.setItem('sharedspaces:tokens', JSON.stringify(legacyTokens));

      await expect(getServiceWorkerTokens()).resolves.toEqual(legacyTokens);
      await expect(
        getServiceWorkerToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000'),
      ).resolves.toBe('legacy-token');
      expect(localStorage.getItem('sharedspaces:tokens')).toBeNull();
    });

    it('migrates plain reads from legacy localStorage into IndexedDB on first access', async () => {
      const serverUrl = 'http://localhost:5000';
      const spaceId = '550e8400-e29b-41d4-a716-446655440000';
      const key = `${serverUrl}:${spaceId}`;
      localStorage.setItem('sharedspaces:tokens', JSON.stringify({ [key]: 'legacy-token' }));

      await expect(getTokens()).resolves.toEqual({ [key]: 'legacy-token' });
      await expect(getToken(serverUrl, spaceId)).resolves.toBe('legacy-token');
      await expect(getStoredToken(serverUrl, spaceId)).resolves.toBe('legacy-token');

      expect(localStorage.getItem('sharedspaces:tokens')).toBeNull();
    });

    it('can eagerly mirror every legacy token into IndexedDB in one pass', async () => {
      const legacyTokens = {
        'http://localhost:5000:550e8400-e29b-41d4-a716-446655440000': 'legacy-token',
        'http://localhost:5001:550e8400-e29b-41d4-a716-446655440001': 'other-token',
      };
      localStorage.setItem('sharedspaces:tokens', JSON.stringify(legacyTokens));

      await expect(syncTokensToServiceWorkerStore()).resolves.toEqual(legacyTokens);
      await expect(
        getServiceWorkerToken('http://localhost:5001', '550e8400-e29b-41d4-a716-446655440001'),
      ).resolves.toBe('other-token');
      expect(localStorage.getItem('sharedspaces:tokens')).toBeNull();
    });

    it('prefers the IndexedDB mirror after the one-time migration even if localStorage changes later', async () => {
      const serverUrl = 'http://localhost:5000';
      const spaceId = '550e8400-e29b-41d4-a716-446655440000';
      const key = `${serverUrl}:${spaceId}`;
      localStorage.setItem('sharedspaces:tokens', JSON.stringify({ [key]: 'legacy-token' }));

      await expect(syncTokensToServiceWorkerStore()).resolves.toEqual({ [key]: 'legacy-token' });

      localStorage.setItem('sharedspaces:tokens', JSON.stringify({ [key]: 'stale-local-token' }));

      await expect(getTokens()).resolves.toEqual({ [key]: 'legacy-token' });
      await expect(getServiceWorkerToken(serverUrl, spaceId)).resolves.toBe('legacy-token');
    });

    it('removes mirrored tokens when a token is deleted', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'temp-token');
      await expect(
        getServiceWorkerToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000'),
      ).resolves.toBe('temp-token');

      await removeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');

      await expect(
        getServiceWorkerToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getPrimaryDisplayName', () => {
    it('returns empty string when not set', () => {
      const name = getPrimaryDisplayName();
      expect(name).toBe('');
    });

    it('returns stored display name', () => {
      setPrimaryDisplayName('Alice');
      const name = getPrimaryDisplayName();
      expect(name).toBe('Alice');
    });
  });

  describe('setPrimaryDisplayName', () => {
    it('stores the display name', () => {
      setPrimaryDisplayName('Bob');
      const name = getPrimaryDisplayName();
      expect(name).toBe('Bob');
    });

    it('overwrites existing display name', () => {
      setPrimaryDisplayName('Alice');
      setPrimaryDisplayName('Bob');
      const name = getPrimaryDisplayName();
      expect(name).toBe('Bob');
    });
  });

  describe('getLastSelectedSpace', () => {
    it('returns undefined when not set', () => {
      const lastSpace = getLastSelectedSpace();
      expect(lastSpace).toBeUndefined();
    });

    it('returns stored last selected space key', () => {
      setLastSelectedSpace('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      const lastSpace = getLastSelectedSpace();
      expect(lastSpace).toBe('http://localhost:5000:550e8400-e29b-41d4-a716-446655440000');
    });

    it('returns undefined when localStorage item is empty string', () => {
      localStorage.setItem('sharedspaces:lastSelectedSpace', '');
      const lastSpace = getLastSelectedSpace();
      expect(lastSpace).toBeUndefined();
    });
  });

  describe('setLastSelectedSpace', () => {
    it('stores the last selected space in serverUrl:spaceId format', () => {
      setLastSelectedSpace('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      const stored = localStorage.getItem('sharedspaces:lastSelectedSpace');
      expect(stored).toBe('http://localhost:5000:550e8400-e29b-41d4-a716-446655440000');
    });

    it('overwrites existing last selected space', () => {
      setLastSelectedSpace('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      setLastSelectedSpace('http://localhost:5001', '550e8400-e29b-41d4-a716-446655440001');
      const lastSpace = getLastSelectedSpace();
      expect(lastSpace).toBe('http://localhost:5001:550e8400-e29b-41d4-a716-446655440001');
    });

    it('handles server URLs with port numbers correctly', () => {
      setLastSelectedSpace('http://localhost:8080', '550e8400-e29b-41d4-a716-446655440000');
      const lastSpace = getLastSelectedSpace();
      expect(lastSpace).toBe('http://localhost:8080:550e8400-e29b-41d4-a716-446655440000');
    });

    it('handles server URLs with colons in path correctly', () => {
      setLastSelectedSpace('http://example.com:3000/api', '550e8400-e29b-41d4-a716-446655440000');
      const lastSpace = getLastSelectedSpace();
      expect(lastSpace).toBe('http://example.com:3000/api:550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('clearLastSelectedSpace', () => {
    it('removes the last selected space from storage', () => {
      setLastSelectedSpace('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      clearLastSelectedSpace();
      const lastSpace = getLastSelectedSpace();
      expect(lastSpace).toBeUndefined();
    });

    it('does not throw when clearing non-existent value', () => {
      expect(() => {
        clearLastSelectedSpace();
      }).not.toThrow();
    });

    it('leaves other localStorage keys intact', async () => {
      await setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      setPrimaryDisplayName('Alice');
      setLastSelectedSpace('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');

      clearLastSelectedSpace();

      await expect(
        getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000'),
      ).resolves.toBe('token1');
      expect(getPrimaryDisplayName()).toBe('Alice');
    });
  });
});
