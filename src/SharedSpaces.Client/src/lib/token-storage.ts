// Token storage utilities for managing JWTs in localStorage

const STORAGE_KEY_TOKENS = 'sharedspaces:tokens';
const STORAGE_KEY_PRIMARY_DISPLAY_NAME = 'sharedspaces:primaryDisplayName';

export interface TokenStore {
  [serverSpaceKey: string]: string;
}

/**
 * Get all stored tokens
 * @returns Record of 'serverUrl:spaceId' -> JWT token
 */
export function getTokens(): Record<string, string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TOKENS);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    // Only keep string values
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Store a JWT token for a specific server+space combination
 * @param serverUrl - Server URL (e.g., 'http://localhost:5000')
 * @param spaceId - Space GUID
 * @param token - JWT token string
 */
export function setToken(serverUrl: string, spaceId: string, token: string): void {
  const tokens = getTokens();
  const key = `${serverUrl}:${spaceId}`;
  tokens[key] = token;
  localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(tokens));
}

/**
 * Get a JWT token for a specific server+space combination
 * @param serverUrl - Server URL
 * @param spaceId - Space GUID
 * @returns JWT token string or undefined if not found
 */
export function getToken(serverUrl: string, spaceId: string): string | undefined {
  const tokens = getTokens();
  const key = `${serverUrl}:${spaceId}`;
  return tokens[key];
}

/**
 * Remove a JWT token for a specific server+space combination
 * @param serverUrl - Server URL
 * @param spaceId - Space GUID
 */
export function removeToken(serverUrl: string, spaceId: string): void {
  const tokens = getTokens();
  const key = `${serverUrl}:${spaceId}`;
  delete tokens[key];
  localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(tokens));
}

/**
 * Get the primary/default display name for pre-filling forms
 * @returns Display name string or empty string if not set
 */
export function getPrimaryDisplayName(): string {
  return localStorage.getItem(STORAGE_KEY_PRIMARY_DISPLAY_NAME) || '';
}

/**
 * Save the primary/default display name
 * @param name - Display name to save
 */
export function setPrimaryDisplayName(name: string): void {
  localStorage.setItem(STORAGE_KEY_PRIMARY_DISPLAY_NAME, name);
}
