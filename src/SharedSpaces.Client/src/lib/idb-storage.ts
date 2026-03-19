const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 1;
const PENDING_SHARES_STORE = 'pending-shares';
const OFFLINE_QUEUE_STORE = 'offline-queue';

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

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PENDING_SHARES_STORE)) {
        db.createObjectStore(PENDING_SHARES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

function getAllFromStore<T>(storeName: string): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      }),
  );
}

function putInStore<T extends { id: string }>(
  storeName: string,
  item: T,
): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function deleteFromStore(storeName: string, id: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function clearStore(storeName: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// --- Pending Shares (from Web Share Target API) ---

export function getPendingShares(): Promise<PendingShareItem[]> {
  return getAllFromStore<PendingShareItem>(PENDING_SHARES_STORE);
}

export function removePendingShare(id: string): Promise<void> {
  return deleteFromStore(PENDING_SHARES_STORE, id);
}

export function clearPendingShares(): Promise<void> {
  return clearStore(PENDING_SHARES_STORE);
}

// --- Offline Queue ---

export function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  return getAllFromStore<OfflineQueueItem>(OFFLINE_QUEUE_STORE);
}

export function addToOfflineQueue(item: OfflineQueueItem): Promise<void> {
  return putInStore(OFFLINE_QUEUE_STORE, item);
}

export function removeFromOfflineQueue(id: string): Promise<void> {
  return deleteFromStore(OFFLINE_QUEUE_STORE, id);
}

export function clearOfflineQueue(): Promise<void> {
  return clearStore(OFFLINE_QUEUE_STORE);
}
