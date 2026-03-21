import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAdminServerUrls,
  addAdminServerUrl,
  removeAdminServerUrl,
} from './admin-url-storage';

const STORAGE_KEY = 'sharedspaces:adminServerUrls';

describe('admin-url-storage', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getAdminServerUrls', () => {
    it('returns empty array when nothing stored', () => {
      expect(getAdminServerUrls()).toEqual([]);
    });

    it('returns empty array when localStorage has invalid JSON', () => {
      store.set(STORAGE_KEY, 'not valid JSON{');
      expect(getAdminServerUrls()).toEqual([]);
    });

    it('returns empty array when stored value is not an array', () => {
      store.set(STORAGE_KEY, JSON.stringify({ urls: ['http://example.com'] }));
      expect(getAdminServerUrls()).toEqual([]);
    });

    it('filters out non-string elements', () => {
      store.set(STORAGE_KEY, JSON.stringify(['http://example.com', 123, null]));
      expect(getAdminServerUrls()).toEqual(['http://example.com']);
    });

    it('returns stored URLs array', () => {
      const urls = ['https://server1.com', 'https://server2.com'];
      store.set(STORAGE_KEY, JSON.stringify(urls));
      expect(getAdminServerUrls()).toEqual(urls);
    });
  });

  describe('addAdminServerUrl', () => {
    it('adds a URL and it appears in the list', () => {
      addAdminServerUrl('https://example.com');
      const result = getAdminServerUrls();
      expect(result).toEqual(['https://example.com']);
    });

    it('adds URL as first element (most recent first)', () => {
      addAdminServerUrl('https://server1.com');
      addAdminServerUrl('https://server2.com');
      const result = getAdminServerUrls();
      expect(result[0]).toBe('https://server2.com');
      expect(result[1]).toBe('https://server1.com');
    });

    it('deduplicates — adding existing URL moves it to front', () => {
      addAdminServerUrl('https://server1.com');
      addAdminServerUrl('https://server2.com');
      addAdminServerUrl('https://server3.com');
      addAdminServerUrl('https://server1.com');
      const result = getAdminServerUrls();
      expect(result).toEqual([
        'https://server1.com',
        'https://server3.com',
        'https://server2.com',
      ]);
    });

    it('caps at 20 entries — oldest dropped', () => {
      for (let i = 1; i <= 25; i++) {
        addAdminServerUrl(`https://server${i}.com`);
      }
      const result = getAdminServerUrls();
      expect(result.length).toBe(20);
      expect(result[0]).toBe('https://server25.com');
      expect(result).not.toContain('https://server1.com');
      expect(result).not.toContain('https://server5.com');
    });

    it('trims whitespace from URL', () => {
      addAdminServerUrl('  https://example.com  ');
      expect(getAdminServerUrls()).toEqual(['https://example.com']);
    });

    it('ignores empty string', () => {
      addAdminServerUrl('');
      expect(getAdminServerUrls()).toEqual([]);
    });

    it('ignores whitespace-only string', () => {
      addAdminServerUrl('   ');
      expect(getAdminServerUrls()).toEqual([]);
    });

    it('stores URLs as plain strings (no secret data)', () => {
      addAdminServerUrl('https://api.example.com');
      const stored = store.get(STORAGE_KEY)!;
      const parsed = JSON.parse(stored);
      expect(Array.isArray(parsed)).toBe(true);
      expect(typeof parsed[0]).toBe('string');
    });
  });

  describe('removeAdminServerUrl', () => {
    it('removes a URL from storage', () => {
      addAdminServerUrl('https://server1.com');
      addAdminServerUrl('https://server2.com');
      addAdminServerUrl('https://server3.com');

      removeAdminServerUrl('https://server2.com');

      const result = getAdminServerUrls();
      expect(result).toEqual(['https://server3.com', 'https://server1.com']);
    });

    it('is a no-op for URLs not in the list', () => {
      addAdminServerUrl('https://server1.com');
      removeAdminServerUrl('https://not-in-list.com');
      expect(getAdminServerUrls()).toEqual(['https://server1.com']);
    });

    it('is a no-op when storage is empty', () => {
      removeAdminServerUrl('https://example.com');
      expect(getAdminServerUrls()).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('handles typical user workflow', () => {
      addAdminServerUrl('https://prod.example.com');
      addAdminServerUrl('https://staging.example.com');
      addAdminServerUrl('https://dev.example.com');

      expect(getAdminServerUrls()).toEqual([
        'https://dev.example.com',
        'https://staging.example.com',
        'https://prod.example.com',
      ]);

      // Revisit prod — moves to top
      addAdminServerUrl('https://prod.example.com');
      expect(getAdminServerUrls()[0]).toBe('https://prod.example.com');
      expect(getAdminServerUrls().length).toBe(3);

      // Remove staging
      removeAdminServerUrl('https://staging.example.com');
      expect(getAdminServerUrls()).toEqual([
        'https://prod.example.com',
        'https://dev.example.com',
      ]);
    });

    it('survives malformed localStorage data', () => {
      store.set(STORAGE_KEY, 'corrupted data');

      expect(getAdminServerUrls()).toEqual([]);

      // Can still add new URLs
      addAdminServerUrl('https://example.com');
      expect(getAdminServerUrls()).toEqual(['https://example.com']);
    });
  });
});
