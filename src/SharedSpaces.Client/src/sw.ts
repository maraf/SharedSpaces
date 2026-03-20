/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// --- IndexedDB for Share Target ---
// Schema shared with src/lib/idb-storage.ts (app-side typed wrapper).
// If you change DB_NAME, DB_VERSION, or store names, update both files.
const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 1;
const PENDING_SHARES_STORE = 'pending-shares';
const OFFLINE_QUEUE_STORE = 'offline-queue';

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
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'pending-share-added' });
        }
      });
    };
    tx.onerror = () => reject(tx.error);
  });
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
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA fallback: serve precached index.html for all navigation requests
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/v1\//, /^\/_share/],
  }),
);

// --- Background Sync ---
// The 'sync' event is from the Background Sync API, not in standard TS lib types.

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener('sync' as keyof ServiceWorkerGlobalScopeEventMap, ((event: SyncEvent) => {
  if (event.tag === 'offline-queue-sync') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'offline-queue-sync-requested' });
        }
      }),
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
