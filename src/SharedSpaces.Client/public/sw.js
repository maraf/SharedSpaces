/// <reference lib="webworker" />
// @ts-nocheck — plain JS service worker served from public/

const CACHE_NAME = 'sharedspaces-v1';
const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 1;
const PENDING_SHARES_STORE = 'pending-shares';
const OFFLINE_QUEUE_STORE = 'offline-queue';

// --- Asset Caching ---

// Hashed assets (/assets/*) are immutable — cache-first, never revalidate.
// Navigation and app shell — network-first with cache fallback.
// API calls (/v1/*) and SignalR (/v1/*/hub) — never cache.

function isApiRequest(url) {
  return url.pathname.startsWith('/v1/');
}

function isHashedAsset(url) {
  return url.pathname.startsWith('/assets/');
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // For navigation requests, try serving the cached root page (SPA fallback)
    if (isNavigationRequest(request)) {
      const fallback = await caches.match('/');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
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

async function storePendingShare(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_SHARES_STORE, 'readwrite');
    tx.objectStore(PENDING_SHARES_STORE).put(item);
    tx.oncomplete = () => {
      resolve();
      // Notify all clients that a new share arrived
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'pending-share-added' });
        }
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const file = formData.get('file');
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    if (file && file.size > 0) {
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

// --- Event Listeners ---

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Share target interception
  if (url.pathname === '/_share' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Never cache API calls or non-GET requests
  if (isApiRequest(url) || event.request.method !== 'GET') {
    return;
  }

  // Hashed assets (JS/CSS bundles) — cache-first (immutable filenames)
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Everything else (HTML, icons, manifest) — network-first
  event.respondWith(networkFirst(event.request));
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-queue-sync') {
    // Notify the client to process the queue (client has auth context)
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'offline-queue-sync-requested' });
        }
      }),
    );
  }
});

self.addEventListener('activate', (event) => {
  // Clean up old caches when the SW version changes
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ).then(() => self.clients.claim()),
  );
});
