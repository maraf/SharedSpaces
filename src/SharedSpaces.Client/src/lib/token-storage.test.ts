import { describe, it, expect, beforeEach } from 'vitest';
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
} from './token-storage';

describe('token-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getTokens', () => {
    it('returns empty object when storage is empty', () => {
      const tokens = getTokens();
      expect(tokens).toEqual({});
    });

    it('returns all stored tokens', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001', 'token2');
      
      const tokens = getTokens();
      expect(tokens).toEqual({
        'http://localhost:5000:550e8400-e29b-41d4-a716-446655440000': 'token1',
        'http://localhost:5000:550e8400-e29b-41d4-a716-446655440001': 'token2',
      });
    });

    it('handles corrupted localStorage data gracefully', () => {
      localStorage.setItem('sharedspaces:tokens', 'not-valid-json');
      const tokens = getTokens();
      expect(tokens).toEqual({});
    });
  });

  describe('setToken', () => {
    it('stores a token for a specific server+space key', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'my-jwt-token');
      
      const tokens = getTokens();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBe('my-jwt-token');
    });

    it('stores multiple tokens for different server+space combinations', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      setToken('http://localhost:5001', '550e8400-e29b-41d4-a716-446655440000', 'token2');
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001', 'token3');
      
      const tokens = getTokens();
      expect(Object.keys(tokens)).toHaveLength(3);
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBe('token1');
      expect(tokens['http://localhost:5001:550e8400-e29b-41d4-a716-446655440000']).toBe('token2');
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440001']).toBe('token3');
    });

    it('overwrites existing token for the same key', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'old-token');
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'new-token');
      
      const tokens = getTokens();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBe('new-token');
      expect(Object.keys(tokens)).toHaveLength(1);
    });
  });

  describe('getToken', () => {
    it('retrieves a stored token by server+space key', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'my-token');
      
      const token = getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      expect(token).toBe('my-token');
    });

    it('returns undefined for non-existent key', () => {
      const token = getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      expect(token).toBeUndefined();
    });

    it('returns undefined for different server URL', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      
      const token = getToken('http://localhost:5001', '550e8400-e29b-41d4-a716-446655440000');
      expect(token).toBeUndefined();
    });

    it('returns undefined for different space ID', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      
      const token = getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001');
      expect(token).toBeUndefined();
    });
  });

  describe('removeToken', () => {
    it('removes a specific token by server+space key', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440001', 'token2');
      
      removeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      
      const tokens = getTokens();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440000']).toBeUndefined();
      expect(tokens['http://localhost:5000:550e8400-e29b-41d4-a716-446655440001']).toBe('token2');
    });

    it('does not throw when removing non-existent token', () => {
      expect(() => {
        removeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      }).not.toThrow();
    });

    it('leaves empty object after removing last token', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      removeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      
      const tokens = getTokens();
      expect(tokens).toEqual({});
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

    it('leaves other localStorage keys intact', () => {
      setToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'token1');
      setPrimaryDisplayName('Alice');
      setLastSelectedSpace('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000');
      
      clearLastSelectedSpace();
      
      expect(getToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000')).toBe('token1');
      expect(getPrimaryDisplayName()).toBe('Alice');
    });
  });
});
