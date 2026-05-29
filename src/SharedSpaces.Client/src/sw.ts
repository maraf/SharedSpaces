/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// --- IndexedDB for Share Target ---
// Schema shared with src/lib/idb-storage.ts (app-side typed wrapper).
// If you change DB_NAME, DB_VERSION, or store names, update both files.
const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 6;
const PENDING_SHARES_STORE = 'pending-shares';
const COMPOSE_DRAFTS_STORE = 'compose-drafts';
const OFFLINE_QUEUE_STORE = 'offline-queue';
const AUTH_TOKENS_STORE = 'auth-tokens';
const JOURNAL_SYNC_SETTINGS_STORE = 'journal-sync-settings';
const JOURNAL_CACHE_STORE = 'journal-cache';
const VIEWED_FILES_STORE = 'viewed-files';
const VIEWED_FILES_META_STORE = 'viewed-files-meta';

interface OfflineQueueItem {
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

interface SyncSummary {
  synced: number;
  failed: number;
  retryable: number;
  spaces: Array<{ serverUrl: string; spaceId: string }>;
}

class SyncUploadError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SyncUploadError';
    this.status = status;
  }
}

let dbInstance: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PENDING_SHARES_STORE)) {
        db.createObjectStore(PENDING_SHARES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(COMPOSE_DRAFTS_STORE)) {
        db.createObjectStore(COMPOSE_DRAFTS_STORE, { keyPath: 'id' });
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
        db.createObjectStore(VIEWED_FILES_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(VIEWED_FILES_META_STORE)) {
        const metaStore = db.createObjectStore(VIEWED_FILES_META_STORE, { keyPath: 'key' });
        metaStore.createIndex('accessedAt', 'accessedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbInstance = null;
      reject(request.error);
    };
  });

  return dbInstance;
}

function createPendingShareId(timestamp: number, index = 0): string {
  return `${timestamp}-${index.toString().padStart(4, '0')}-${crypto.randomUUID()}`;
}

async function storePendingShares(items: Record<string, unknown>[]) {
  if (items.length === 0) return;

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PENDING_SHARES_STORE, 'readwrite');
    const store = tx.objectStore(PENDING_SHARES_STORE);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Failed to store pending shares'));
  });

  void notifyClients({ type: 'pending-share-added' });
}

async function storePendingShare(item: Record<string, unknown>) {
  await storePendingShares([item]);
}

async function notifyClients(message: unknown) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, '');
}

function isPermanentSyncFailure(status?: number): boolean {
  return status !== undefined
    && status >= 400
    && status < 500
    && status !== 408
    && status !== 425
    && status !== 429;
}

async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const request = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
    request.onsuccess = () => {
      const items = (request.result as OfflineQueueItem[]).sort((a, b) =>
        (b.timestamp - a.timestamp)
        || a.id.localeCompare(b.id)
        || a.itemId.localeCompare(b.itemId),
      );
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getStoredToken(serverUrl: string, spaceId: string): Promise<string | undefined> {
  const db = await openDB();
  const key = `${serverUrl}:${spaceId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTH_TOKENS_STORE, 'readonly');
    const request = tx.objectStore(AUTH_TOKENS_STORE).get(key);
    request.onsuccess = () => {
      const stored = request.result as string | { token?: string } | undefined;
      if (typeof stored === 'string') {
        resolve(stored);
        return;
      }

      resolve(typeof stored?.token === 'string' ? stored.token : undefined);
    };
    request.onerror = () => reject(request.error);
  });
}

async function removeOfflineQueueItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function uploadOfflineQueueItem(item: OfflineQueueItem, token: string): Promise<void> {
  const form = new FormData();
  form.append('id', item.itemId);
  form.append('contentType', item.type);

  if (item.type === 'text') {
    if (!item.content) {
      throw new SyncUploadError('Queued text item is missing content.', 400);
    }
    form.append('content', item.content);
  } else {
    if (!item.fileData) {
      throw new SyncUploadError('Queued file item is missing data.', 400);
    }
    const blob = new Blob([item.fileData], {
      type: item.fileType ?? 'application/octet-stream',
    });
    form.append('file', blob, item.fileName ?? 'shared-file');
  }

  const response = await fetch(
    `${normalizeUrl(item.serverUrl)}/v1/spaces/${encodeURIComponent(item.spaceId)}/items/${encodeURIComponent(item.itemId)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    },
  );

  if (response.ok) {
    return;
  }

  let detail = response.statusText || 'Sync failed';
  try {
    const body = await response.json() as { Error?: string };
    if (body.Error) {
      detail = body.Error;
    }
  } catch {
    // Ignore parse failures and keep the HTTP status text.
  }

  throw new SyncUploadError(detail, response.status);
}

async function syncOfflineQueueInBackground(): Promise<SyncSummary> {
  const queue = await getOfflineQueue();
  if (queue.length === 0) {
    return { synced: 0, failed: 0, retryable: 0, spaces: [] };
  }

  let synced = 0;
  let failed = 0;
  let retryable = 0;
  const affectedSpaces = new Map<string, { serverUrl: string; spaceId: string }>();

  for (const item of queue) {
    affectedSpaces.set(`${item.serverUrl}|${item.spaceId}`, {
      serverUrl: item.serverUrl,
      spaceId: item.spaceId,
    });

    const token = await getStoredToken(item.serverUrl, item.spaceId);
    if (!token) {
      failed++;
      console.warn('[SW] Skipping queued item without a mirrored auth token', item.id);
      continue;
    }

    try {
      await uploadOfflineQueueItem(item, token);
      await removeOfflineQueueItem(item.id);
      synced++;
    } catch (error) {
      const status = error instanceof SyncUploadError ? error.status : undefined;
      if (isPermanentSyncFailure(status)) {
        await removeOfflineQueueItem(item.id);
      } else {
        retryable++;
      }
      failed++;
      console.warn('[SW] Failed to sync queued item', item.id, error);
    }
  }

  return {
    synced,
    failed,
    retryable,
    spaces: [...affectedSpaces.values()],
  };
}

// --- Share Target ---

async function handleShareTarget(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const files = formData
      .getAll('files')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const legacyFile = formData.get('file');
    if (files.length === 0 && legacyFile instanceof File && legacyFile.size > 0) {
      files.push(legacyFile);
    }

    if (files.length > 0) {
      const timestamp = Date.now();
      const pendingShares = await Promise.all(files.map(async (file, index) => ({
        id: createPendingShareId(timestamp, index),
        type: 'file' as const,
        fileName: file.name,
        fileType: file.type,
        fileData: await file.arrayBuffer(),
        fileSize: file.size,
        timestamp,
      })));

      await storePendingShares(pendingShares);
    } else {
      const content = [title, text, url].filter(Boolean).join('\n');
      if (content) {
        const timestamp = Date.now();
        await storePendingShare({
          id: createPendingShareId(timestamp),
          type: 'text',
          content,
          timestamp,
        });
      }
    }
  } catch (error) {
    console.error('[SW] Failed to handle share target:', error);
  }

  return Response.redirect('/', 303);
}

// --- Share target fetch handler (registered before Workbox) ---

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/_share' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
  }
});

// --- Workbox Precaching ---
// self.__WB_MANIFEST is replaced at build time by vite-plugin-pwa with the
// list of all Vite build assets (HTML, JS, CSS, icons, etc.)
// In dev mode, the manifest is empty — precaching and SPA fallback are
// production-only (the Vite dev server handles serving in development).
const manifest = self.__WB_MANIFEST;
if (manifest.length > 0) {
  precacheAndRoute(manifest);
  cleanupOutdatedCaches();

  // SPA fallback: serve precached index.html for all navigation requests
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL('index.html'), {
      denylist: [/^\/v1\//, /^\/_share/],
    }),
  );
}

// --- Background Sync ---
// The 'sync' event is from the Background Sync API, not in standard TS lib types.

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener('sync' as keyof ServiceWorkerGlobalScopeEventMap, ((event: SyncEvent) => {
  if (event.tag === 'offline-queue-sync') {
    event.waitUntil(
      (async () => {
        const result = await syncOfflineQueueInBackground();
        await notifyClients({ type: 'offline-queue-sync-complete', result });

        if (result.retryable > 0) {
          throw new Error(`Retrying ${result.retryable} queued item(s) later.`);
        }
      })(),
    );
  }
}) as EventListener);

// --- Lifecycle ---

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});
