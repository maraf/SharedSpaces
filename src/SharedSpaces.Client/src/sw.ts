/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// --- IndexedDB for Share Target ---
// Schema shared with src/lib/idb-storage.ts (app-side typed wrapper).
// If you change DB_NAME, DB_VERSION, or store names, update both files.
const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 2;
const PENDING_SHARES_STORE = 'pending-shares';
const OFFLINE_QUEUE_STORE = 'offline-queue';
const AUTH_TOKENS_STORE = 'auth-tokens';

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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PENDING_SHARES_STORE)) {
        db.createObjectStore(PENDING_SHARES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(AUTH_TOKENS_STORE)) {
        db.createObjectStore(AUTH_TOKENS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storePendingShare(item: Record<string, unknown>) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PENDING_SHARES_STORE, 'readwrite');
    tx.objectStore(PENDING_SHARES_STORE).put(item);
    tx.oncomplete = () => {
      resolve();
      void notifyClients({ type: 'pending-share-added' });
    };
    tx.onerror = () => reject(tx.error);
  });
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
      retryable++;
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
    const file = formData.get('file');
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    if (file && file instanceof File && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      await storePendingShare({
        id,
        type: 'file',
        fileName: file.name,
        fileType: file.type,
        fileData: arrayBuffer,
        fileSize: file.size,
        timestamp,
      });
    } else {
      const content = [title, text, url].filter(Boolean).join('\n');
      if (content) {
        await storePendingShare({
          id,
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
