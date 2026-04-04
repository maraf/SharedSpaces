import {
  clearStoredAuthTokens,
  getStoredAuthToken,
  getStoredAuthTokens,
  setStoredAuthTokens,
} from './idb-storage';

// Token storage utilities for managing JWTs in IndexedDB.
// `localStorage` is only used as a one-time migration source for legacy installs.

const STORAGE_KEY_TOKENS = 'sharedspaces:tokens';
const STORAGE_KEY_PRIMARY_DISPLAY_NAME = 'sharedspaces:primaryDisplayName';
const STORAGE_KEY_LAST_SELECTED_SPACE = 'sharedspaces:lastSelectedSpace';

export interface TokenStore {
  [serverSpaceKey: string]: string;
}

let tokenCache: TokenStore | null = null;
let tokenInitPromise: Promise<TokenStore> | null = null;
let tokenWritePromise: Promise<void> = Promise.resolve();

function getTokenKey(serverUrl: string, spaceId: string): string {
  return `${serverUrl}:${spaceId}`;
}

function readLegacyTokensFromLocalStorage(): TokenStore {
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

function cloneTokens(tokens: TokenStore): TokenStore {
  return { ...tokens };
}

function areTokenStoresEqual(left: TokenStore, right: TokenStore): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
}

function clearLegacyTokensFromLocalStorage(): void {
  localStorage.removeItem(STORAGE_KEY_TOKENS);
}

function queueTokenPersist(tokens: TokenStore): void {
  const snapshot = cloneTokens(tokens);
  tokenWritePromise = tokenWritePromise
    .catch(() => undefined)
    .then(async () => {
      try {
        await setStoredAuthTokens(snapshot);
        clearLegacyTokensFromLocalStorage();
      } catch {
        localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(snapshot));
      }
    })
    .catch(() => undefined);
}

async function ensureTokenCache(): Promise<TokenStore> {
  if (tokenCache) {
    return tokenCache;
  }

  if (!tokenInitPromise) {
    tokenInitPromise = (async () => {
      const storedTokens = await getStoredAuthTokens().catch(() => null);
      const legacyTokens = readLegacyTokensFromLocalStorage();

      if (storedTokens === null) {
        tokenCache = cloneTokens(legacyTokens);
        return tokenCache;
      }

      if (Object.keys(storedTokens).length > 0) {
        const mergedTokens = Object.keys(legacyTokens).length > 0
          ? { ...legacyTokens, ...storedTokens }
          : storedTokens;

        if (!areTokenStoresEqual(storedTokens, mergedTokens)) {
          await setStoredAuthTokens(mergedTokens);
        }

        if (Object.keys(legacyTokens).length > 0) {
          clearLegacyTokensFromLocalStorage();
        }

        tokenCache = cloneTokens(mergedTokens);
        return tokenCache;
      }

      if (Object.keys(legacyTokens).length > 0) {
        await setStoredAuthTokens(legacyTokens);
        clearLegacyTokensFromLocalStorage();
        tokenCache = cloneTokens(legacyTokens);
        return tokenCache;
      }

      tokenCache = {};
      return tokenCache;
    })().finally(() => {
      tokenInitPromise = null;
    });
  }

  return tokenInitPromise;
}

function getCacheSnapshot(): TokenStore {
  if (tokenCache) {
    return cloneTokens(tokenCache);
  }

  return readLegacyTokensFromLocalStorage();
}

/**
 * One-time token migration/bootstrap for app startup.
 */
export async function initializeTokenStorage(): Promise<void> {
  await ensureTokenCache();
}

/**
 * Test helper that waits for any pending token-store initialization/writes.
 */
export async function waitForTokenMirrorWritesForTests(): Promise<void> {
  await (tokenInitPromise ?? Promise.resolve());
  await tokenWritePromise;
}

export async function resetTokenStorageForTests(): Promise<void> {
  await waitForTokenMirrorWritesForTests();
  await clearStoredAuthTokens().catch(() => undefined);
  clearLegacyTokensFromLocalStorage();
  tokenCache = null;
  tokenInitPromise = null;
  tokenWritePromise = Promise.resolve();
}

/**
 * Get all stored tokens from the canonical IndexedDB-backed store.
 */
export async function getTokens(): Promise<Record<string, string>> {
  await initializeTokenStorage();
  return getCacheSnapshot();
}

/**
 * Legacy helper kept for callers that want to force the canonical store to be
 * ready for service-worker sync.
 */
export async function syncTokensToServiceWorkerStore(): Promise<Record<string, string>> {
  const tokens = await getTokens();
  queueTokenPersist(tokens);
  await tokenWritePromise;
  return tokens;
}

export async function getServiceWorkerTokens(): Promise<Record<string, string>> {
  return getTokens();
}

export async function getServiceWorkerToken(
  serverUrl: string,
  spaceId: string,
): Promise<string | undefined> {
  await initializeTokenStorage();

  const cached = tokenCache?.[getTokenKey(serverUrl, spaceId)];
  if (cached !== undefined) {
    return cached;
  }

  return getStoredAuthToken(serverUrl, spaceId);
}

/**
 * Store a JWT token for a specific server+space combination.
 */
export async function setToken(serverUrl: string, spaceId: string, token: string): Promise<void> {
  await initializeTokenStorage();
  const tokens = getCacheSnapshot();
  tokens[getTokenKey(serverUrl, spaceId)] = token;
  tokenCache = tokens;
  localStorage.removeItem(STORAGE_KEY_TOKENS);
  queueTokenPersist(tokens);
  await tokenWritePromise;
}

/**
 * Get a JWT token for a specific server+space combination.
 */
export async function getToken(serverUrl: string, spaceId: string): Promise<string | undefined> {
  const tokens = await getTokens();
  return tokens[getTokenKey(serverUrl, spaceId)];
}

/**
 * Remove a JWT token for a specific server+space combination.
 */
export async function removeToken(serverUrl: string, spaceId: string): Promise<void> {
  await initializeTokenStorage();
  const tokens = getCacheSnapshot();
  delete tokens[getTokenKey(serverUrl, spaceId)];
  tokenCache = tokens;
  localStorage.removeItem(STORAGE_KEY_TOKENS);
  queueTokenPersist(tokens);
  await tokenWritePromise;
}

/**
 * Get the primary/default display name for pre-filling forms.
 */
export function getPrimaryDisplayName(): string {
  return localStorage.getItem(STORAGE_KEY_PRIMARY_DISPLAY_NAME) || '';
}

/**
 * Save the primary/default display name.
 */
export function setPrimaryDisplayName(name: string): void {
  localStorage.setItem(STORAGE_KEY_PRIMARY_DISPLAY_NAME, name);
}

/**
 * Get the last selected space (auto-reconnect on next start).
 */
export function getLastSelectedSpace(): string | undefined {
  const value = localStorage.getItem(STORAGE_KEY_LAST_SELECTED_SPACE);
  return value || undefined;
}

/**
 * Save the last selected space for auto-reconnect.
 */
export function setLastSelectedSpace(serverUrl: string, spaceId: string): void {
  const key = `${serverUrl}:${spaceId}`;
  localStorage.setItem(STORAGE_KEY_LAST_SELECTED_SPACE, key);
}

/**
 * Clear the last selected space (user intentionally de-selected).
 */
export function clearLastSelectedSpace(): void {
  localStorage.removeItem(STORAGE_KEY_LAST_SELECTED_SPACE);
}
