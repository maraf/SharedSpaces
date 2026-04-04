import {
  getStoredAuthToken,
  getStoredAuthTokens,
  setStoredToken,
  setStoredAuthTokens,
} from './idb-storage';

// Token storage utilities for managing JWTs in localStorage

const STORAGE_KEY_TOKENS = 'sharedspaces:tokens';
const STORAGE_KEY_PRIMARY_DISPLAY_NAME = 'sharedspaces:primaryDisplayName';
const STORAGE_KEY_LAST_SELECTED_SPACE = 'sharedspaces:lastSelectedSpace';

export interface TokenStore {
  [serverSpaceKey: string]: string;
}

let tokenMirrorSync: Promise<void> = Promise.resolve();

/** Test helper to await queued IndexedDB mirror writes before cleanup. */
export async function waitForTokenMirrorWritesForTests(): Promise<void> {
  await tokenMirrorSync;
}

function getTokenKey(serverUrl: string, spaceId: string): string {
  return `${serverUrl}:${spaceId}`;
}

function readTokensFromLocalStorage(): TokenStore {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TOKENS);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const result: TokenStore = {};
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

function queueTokenMirror(tokens: TokenStore): void {
  const snapshot = { ...tokens };
  tokenMirrorSync = tokenMirrorSync
    .catch(() => undefined)
    .then(async () => {
      await setStoredAuthTokens(snapshot);
    })
    .catch(() => undefined);
}

function queueSingleTokenMirror(serverUrl: string, spaceId: string, token: string): void {
  tokenMirrorSync = tokenMirrorSync
    .catch(() => undefined)
    .then(async () => {
      await setStoredToken(serverUrl, spaceId, token);
    })
    .catch(() => undefined);
}

/**
 * Get all stored tokens
 * @returns Record of 'serverUrl:spaceId' -> JWT token
 */
export function getTokens(): Record<string, string> {
  return readTokensFromLocalStorage();
}

/**
 * Ensure the service-worker-readable token store is populated from localStorage.
 */
export async function syncTokensToServiceWorkerStore(): Promise<Record<string, string>> {
  const tokens = readTokensFromLocalStorage();
  await setStoredAuthTokens(tokens);
  return tokens;
}

/**
 * Get all tokens from the service-worker-readable store, migrating legacy
 * localStorage-only users on demand.
 */
export async function getServiceWorkerTokens(): Promise<Record<string, string>> {
  const storedTokens = await getStoredAuthTokens();
  if (Object.keys(storedTokens).length > 0) {
    return storedTokens;
  }

  const legacyTokens = readTokensFromLocalStorage();
  if (Object.keys(legacyTokens).length > 0) {
    await setStoredAuthTokens(legacyTokens);
  }

  return legacyTokens;
}

/**
 * Get a token from the service-worker-readable store, falling back to legacy
 * localStorage and repairing the mirror when needed.
 */
export async function getServiceWorkerToken(
  serverUrl: string,
  spaceId: string,
): Promise<string | undefined> {
  const storedToken = await getStoredAuthToken(serverUrl, spaceId);
  if (storedToken !== undefined) {
    return storedToken;
  }

  const legacyTokens = readTokensFromLocalStorage();
  const token = legacyTokens[getTokenKey(serverUrl, spaceId)];
  if (token !== undefined) {
    queueSingleTokenMirror(serverUrl, spaceId, token);
  }

  return token;
}

/**
 * Store a JWT token for a specific server+space combination
 * @param serverUrl - Server URL (e.g., 'http://localhost:5000')
 * @param spaceId - Space GUID
 * @param token - JWT token string
 */
export function setToken(serverUrl: string, spaceId: string, token: string): void {
  const tokens = readTokensFromLocalStorage();
  tokens[getTokenKey(serverUrl, spaceId)] = token;
  localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(tokens));
  queueTokenMirror(tokens);
}

/**
 * Get a JWT token for a specific server+space combination
 * @param serverUrl - Server URL
 * @param spaceId - Space GUID
 * @returns JWT token string or undefined if not found
 */
export function getToken(serverUrl: string, spaceId: string): string | undefined {
  const tokens = getTokens();
  return tokens[getTokenKey(serverUrl, spaceId)];
}

/**
 * Remove a JWT token for a specific server+space combination
 * @param serverUrl - Server URL
 * @param spaceId - Space GUID
 */
export function removeToken(serverUrl: string, spaceId: string): void {
  const tokens = readTokensFromLocalStorage();
  delete tokens[getTokenKey(serverUrl, spaceId)];
  localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(tokens));
  queueTokenMirror(tokens);
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

/**
 * Get the last selected space (auto-reconnect on next start)
 * @returns Token key string (serverUrl:spaceId) or undefined if not set
 */
export function getLastSelectedSpace(): string | undefined {
  const value = localStorage.getItem(STORAGE_KEY_LAST_SELECTED_SPACE);
  return value || undefined;
}

/**
 * Save the last selected space for auto-reconnect
 * @param serverUrl - Server URL
 * @param spaceId - Space GUID
 */
export function setLastSelectedSpace(serverUrl: string, spaceId: string): void {
  const key = `${serverUrl}:${spaceId}`;
  localStorage.setItem(STORAGE_KEY_LAST_SELECTED_SPACE, key);
}

/**
 * Clear the last selected space (user intentionally de-selected)
 */
export function clearLastSelectedSpace(): void {
  localStorage.removeItem(STORAGE_KEY_LAST_SELECTED_SPACE);
}
