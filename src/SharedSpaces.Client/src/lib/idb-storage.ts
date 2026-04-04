// IndexedDB schema — shared with src/sw.ts (which has its own openDB for SW context).
// If you change DB_NAME, DB_VERSION, or store names, update both files.
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 2;
const PENDING_SHARES_STORE = 'pending-shares';
const OFFLINE_QUEUE_STORE = 'offline-queue';
const AUTH_TOKENS_STORE = 'auth-tokens';

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
  return db.getAll(PENDING_SHARES_STORE);
}

export async function removePendingShare(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(PENDING_SHARES_STORE, id);
}

export async function clearPendingShares(): Promise<void> {
  const db = await getDB();
  await db.clear(PENDING_SHARES_STORE);
}

// --- Auth Tokens (mirrored from localStorage for service worker sync) ---

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
