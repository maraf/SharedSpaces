// IndexedDB schema — shared with src/sw.ts (which has its own openDB for SW context).
// If you change DB_NAME, DB_VERSION, or store names, update both files.
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 4;
const PENDING_SHARES_STORE = 'pending-shares';
const OFFLINE_QUEUE_STORE = 'offline-queue';
const AUTH_TOKENS_STORE = 'auth-tokens';
const JOURNAL_SYNC_SETTINGS_STORE = 'journal-sync-settings';
const JOURNAL_CACHE_STORE = 'journal-cache';
const VIEWED_FILES_STORE = 'viewed-files';

// Floor for the dynamic cache budget. Even on devices that report a tiny
// quota (or report nothing at all), we will try to keep at least this much.
const VIEWED_FILES_BUDGET_FLOOR_BYTES = 100 * 1024 * 1024; // 100 MB
// Ceiling so we never starve other apps on a desktop with terabytes of disk.
const VIEWED_FILES_BUDGET_CEILING_BYTES = 500 * 1024 * 1024; // 500 MB
// Fraction of `navigator.storage.estimate().quota` we are willing to consume.
const VIEWED_FILES_BUDGET_QUOTA_FRACTION = 0.5;

export interface PendingShareItem {
  id: string;
  type: 'text' | 'file';
  content?: string;
  fileName?: string;
  fileType?: string;
  fileData?: ArrayBuffer;
  fileSize?: number;
  timestamp: number;
}

export interface OfflineQueueItem {
  id: string;
  itemId: string;
  spaceId: string;
  serverUrl: string;
  type: 'text' | 'file';
  content?: string;
  fileName?: string;
  fileType?: string;
  fileData?: ArrayBuffer;
  timestamp: number;
}

export interface JournalSyncSetting {
  key: string; // `${serverUrl}|${spaceId}`
  enabled: boolean;
  updatedAt: number;
}

export interface JournalCacheEntry {
  key: string; // `${serverUrl}|${spaceId}`
  checkpoint: string; // ISO 8601 timestamp
  items: Array<{
    id: string;
    spaceId: string;
    memberId: string;
    contentType: 'text' | 'file';
    content: string;
    fileSize: number;
    sharedAt: string;
  }>;
  updatedAt: number;
}

let dbInstance: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PENDING_SHARES_STORE)) {
        db.createObjectStore(PENDING_SHARES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(AUTH_TOKENS_STORE)) {
        db.createObjectStore(AUTH_TOKENS_STORE);
      }
      if (!db.objectStoreNames.contains(JOURNAL_SYNC_SETTINGS_STORE)) {
        db.createObjectStore(JOURNAL_SYNC_SETTINGS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(JOURNAL_CACHE_STORE)) {
        db.createObjectStore(JOURNAL_CACHE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(VIEWED_FILES_STORE)) {
        const store = db.createObjectStore(VIEWED_FILES_STORE, { keyPath: 'key' });
        store.createIndex('accessedAt', 'accessedAt');
      }
    },
  }).catch((err) => {
    dbInstance = null;
    throw err;
  });

  return dbInstance;
}

// --- Pending Shares (from Web Share Target API) ---

export async function getPendingShares(): Promise<PendingShareItem[]> {
  const db = await getDB();
  return (await db.getAll(PENDING_SHARES_STORE)).sort((a, b) =>
    (b.timestamp - a.timestamp)
    || a.id.localeCompare(b.id),
  );
}

export async function removePendingShare(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(PENDING_SHARES_STORE, id);
}

export async function clearPendingShares(): Promise<void> {
  const db = await getDB();
  await db.clear(PENDING_SHARES_STORE);
}

// --- Auth Tokens (canonical store shared by the app and service worker) ---

export async function getStoredAuthTokens(): Promise<Record<string, string>> {
  const db = await getDB();
  const tx = db.transaction(AUTH_TOKENS_STORE, 'readonly');
  const [keys, values] = await Promise.all([
    tx.store.getAllKeys(),
    tx.store.getAll(),
  ]);
  await tx.done;

  const tokens: Record<string, string> = {};
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    const value = values[index];
    if (typeof key === 'string' && typeof value === 'string') {
      tokens[key] = value;
    }
  }

  return tokens;
}

export async function getStoredAuthToken(
  serverUrl: string,
  spaceId: string,
): Promise<string | undefined> {
  const db = await getDB();
  const stored = await db.get(AUTH_TOKENS_STORE, `${serverUrl}:${spaceId}`);
  return typeof stored === 'string' ? stored : undefined;
}

export async function setStoredToken(
  serverUrl: string,
  spaceId: string,
  token: string,
): Promise<void> {
  const db = await getDB();
  await db.put(AUTH_TOKENS_STORE, token, `${serverUrl}:${spaceId}`);
}

export async function getStoredToken(
  serverUrl: string,
  spaceId: string,
): Promise<string | undefined> {
  return getStoredAuthToken(serverUrl, spaceId);
}

export async function removeStoredToken(
  serverUrl: string,
  spaceId: string,
): Promise<void> {
  const db = await getDB();
  await db.delete(AUTH_TOKENS_STORE, `${serverUrl}:${spaceId}`);
}

export async function setStoredAuthTokens(tokens: Record<string, string>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(AUTH_TOKENS_STORE, 'readwrite');
  await tx.store.clear();

  for (const [key, value] of Object.entries(tokens)) {
    await tx.store.put(value, key);
  }

  await tx.done;
}

export async function clearStoredAuthTokens(): Promise<void> {
  const db = await getDB();
  await db.clear(AUTH_TOKENS_STORE);
}

export const syncStoredTokens = setStoredAuthTokens;
export const clearStoredTokens = clearStoredAuthTokens;

// --- Offline Queue ---

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  const db = await getDB();
  return db.getAll(OFFLINE_QUEUE_STORE);
}

export async function getOfflineQueueForSpace(
  serverUrl: string,
  spaceId: string,
): Promise<OfflineQueueItem[]> {
  const all = await getOfflineQueue();
  return all
    .filter(
      (item) => item.serverUrl === serverUrl && item.spaceId === spaceId,
    )
    .sort((a, b) =>
      (b.timestamp - a.timestamp)
      || a.id.localeCompare(b.id)
      || a.itemId.localeCompare(b.itemId),
    );
}

export async function clearOfflineQueueForSpace(
  serverUrl: string,
  spaceId: string,
): Promise<void> {
  const db = await getDB();
  const all: OfflineQueueItem[] = await db.getAll(OFFLINE_QUEUE_STORE);
  const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
  for (const item of all) {
    if (item.serverUrl === serverUrl && item.spaceId === spaceId) {
      tx.store.delete(item.id);
    }
  }
  await tx.done;
}

export async function addToOfflineQueue(item: OfflineQueueItem): Promise<void> {
  const db = await getDB();
  await db.put(OFFLINE_QUEUE_STORE, item);
}

export async function removeFromOfflineQueue(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(OFFLINE_QUEUE_STORE, id);
}

export async function clearOfflineQueue(): Promise<void> {
  const db = await getDB();
  await db.clear(OFFLINE_QUEUE_STORE);
}

// --- Journal Sync Settings ---

export async function getJournalSyncEnabled(
  serverUrl: string,
  spaceId: string,
): Promise<boolean> {
  const db = await getDB();
  const key = `${serverUrl}|${spaceId}`;
  const setting = await db.get(JOURNAL_SYNC_SETTINGS_STORE, key);
  return setting?.enabled ?? false;
}

export async function setJournalSyncEnabled(
  serverUrl: string,
  spaceId: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDB();
  const key = `${serverUrl}|${spaceId}`;
  const setting: JournalSyncSetting = {
    key,
    enabled,
    updatedAt: Date.now(),
  };
  await db.put(JOURNAL_SYNC_SETTINGS_STORE, setting);
}

// --- Journal Cache ---

export async function getJournalCache(
  serverUrl: string,
  spaceId: string,
): Promise<JournalCacheEntry | undefined> {
  const db = await getDB();
  const key = `${serverUrl}|${spaceId}`;
  return db.get(JOURNAL_CACHE_STORE, key);
}

export async function setJournalCache(
  serverUrl: string,
  spaceId: string,
  checkpoint: string,
  items: JournalCacheEntry['items'],
): Promise<void> {
  const db = await getDB();
  const key = `${serverUrl}|${spaceId}`;
  const entry: JournalCacheEntry = {
    key,
    checkpoint,
    items,
    updatedAt: Date.now(),
  };
  await db.put(JOURNAL_CACHE_STORE, entry);
}

export async function clearJournalCache(
  serverUrl: string,
  spaceId: string,
): Promise<void> {
  const db = await getDB();
  const key = `${serverUrl}|${spaceId}`;
  await db.delete(JOURNAL_CACHE_STORE, key);
}

// --- Viewed File Blob Cache ---
//
// Caches file blobs the user has previewed/downloaded so they don't need to
// be re-fetched from the server on subsequent views. Entries are keyed per
// `${serverUrl}|${spaceId}|${itemId}` and tracked by `accessedAt` for LRU
// eviction once the cache exceeds the configured budget.

export interface CachedFileEntry {
  key: string;
  serverUrl: string;
  spaceId: string;
  itemId: string;
  blob: Blob;
  mimeType: string;
  size: number;
  accessedAt: number;
}

function getCachedFileKey(serverUrl: string, spaceId: string, itemId: string): string {
  return `${serverUrl}|${spaceId}|${itemId}`;
}

export async function getCachedFile(
  serverUrl: string,
  spaceId: string,
  itemId: string,
): Promise<CachedFileEntry | undefined> {
  const db = await getDB();
  const key = getCachedFileKey(serverUrl, spaceId, itemId);
  const entry = (await db.get(VIEWED_FILES_STORE, key)) as CachedFileEntry | undefined;
  if (!entry) return undefined;

  // Refresh accessedAt so the LRU keeps recently used entries.
  entry.accessedAt = Date.now();
  await db.put(VIEWED_FILES_STORE, entry);
  return entry;
}

export async function setCachedFile(
  serverUrl: string,
  spaceId: string,
  itemId: string,
  blob: Blob,
  mimeType?: string,
  budgetBytes?: number,
): Promise<void> {
  const db = await getDB();
  const entry: CachedFileEntry = {
    key: getCachedFileKey(serverUrl, spaceId, itemId),
    serverUrl,
    spaceId,
    itemId,
    blob,
    mimeType: mimeType ?? blob.type ?? 'application/octet-stream',
    size: blob.size,
    accessedAt: Date.now(),
  };
  await db.put(VIEWED_FILES_STORE, entry);
  const budget = budgetBytes ?? (await getViewedFilesBudget());
  await pruneCachedFiles(budget);
}

export async function removeCachedFile(
  serverUrl: string,
  spaceId: string,
  itemId: string,
): Promise<void> {
  const db = await getDB();
  await db.delete(VIEWED_FILES_STORE, getCachedFileKey(serverUrl, spaceId, itemId));
}

export async function clearCachedFilesForSpace(
  serverUrl: string,
  spaceId: string,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(VIEWED_FILES_STORE, 'readwrite');
  const all = (await tx.store.getAll()) as CachedFileEntry[];
  for (const entry of all) {
    if (entry.serverUrl === serverUrl && entry.spaceId === spaceId) {
      await tx.store.delete(entry.key);
    }
  }
  await tx.done;
}

export async function getCachedFilesTotalSize(): Promise<number> {
  const db = await getDB();
  const all = (await db.getAll(VIEWED_FILES_STORE)) as CachedFileEntry[];
  return all.reduce((total, entry) => total + entry.size, 0);
}

export async function pruneCachedFiles(
  budgetBytes?: number,
): Promise<void> {
  const budget = budgetBytes ?? (await getViewedFilesBudget());
  if (budget < 0) return;

  const db = await getDB();
  const tx = db.transaction(VIEWED_FILES_STORE, 'readwrite');
  const all = (await tx.store.getAll()) as CachedFileEntry[];
  let total = all.reduce((sum, entry) => sum + entry.size, 0);

  if (total <= budget) {
    await tx.done;
    return;
  }

  // Evict oldest first.
  const sorted = [...all].sort((a, b) => a.accessedAt - b.accessedAt);
  for (const entry of sorted) {
    if (total <= budget) break;
    await tx.store.delete(entry.key);
    total -= entry.size;
  }

  await tx.done;
}

export async function clearAllCachedFiles(): Promise<void> {
  const db = await getDB();
  await db.clear(VIEWED_FILES_STORE);
}

// --- Storage budget / persistence helpers ---

export interface StorageBudgetSnapshot {
  used: number;
  budget: number;
  quota: number | null;
  usage: number | null;
}

/**
 * Returns the byte budget the viewed-files cache should respect. The budget
 * is derived from `navigator.storage.estimate()` — capped at a fixed ceiling
 * and floored to a sensible minimum so the cache stays useful even when the
 * browser doesn't expose an estimate.
 */
export async function getViewedFilesBudget(): Promise<number> {
  try {
    if (
      typeof navigator !== 'undefined'
      && navigator.storage
      && typeof navigator.storage.estimate === 'function'
    ) {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota ?? 0;
      if (quota > 0) {
        const dynamic = Math.floor(quota * VIEWED_FILES_BUDGET_QUOTA_FRACTION);
        return Math.min(
          VIEWED_FILES_BUDGET_CEILING_BYTES,
          Math.max(VIEWED_FILES_BUDGET_FLOOR_BYTES, dynamic),
        );
      }
    }
  } catch {
    // Fall through to the static floor.
  }
  return VIEWED_FILES_BUDGET_FLOOR_BYTES;
}

/**
 * Snapshot of how much the viewed-files cache is using and how much is
 * available, suitable for surfacing to the user.
 */
export async function getViewedFilesStorageStatus(): Promise<StorageBudgetSnapshot> {
  const used = await getCachedFilesTotalSize();
  const budget = await getViewedFilesBudget();
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    if (
      typeof navigator !== 'undefined'
      && navigator.storage
      && typeof navigator.storage.estimate === 'function'
    ) {
      const estimate = await navigator.storage.estimate();
      quota = estimate.quota ?? null;
      usage = estimate.usage ?? null;
    }
  } catch {
    // Best-effort; leave quota/usage null.
  }
  return { used, budget, quota, usage };
}

/**
 * Asks the browser to mark this origin's storage as persistent so the cache
 * survives storage-pressure eviction. Returns `true` if persistence was
 * granted (or already in effect), `false` otherwise. Best-effort — silently
 * resolves to `false` when the API is unavailable.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined'
      && navigator.storage
      && typeof navigator.storage.persist === 'function'
    ) {
      if (typeof navigator.storage.persisted === 'function') {
        const already = await navigator.storage.persisted();
        if (already) return true;
      }
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore — caller will treat false as "not persistent".
  }
  return false;
}
