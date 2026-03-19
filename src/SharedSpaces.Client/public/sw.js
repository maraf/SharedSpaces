/// <reference lib="webworker" />
// @ts-nocheck — plain JS service worker served from public/

const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 1;
const PENDING_SHARES_STORE = 'pending-shares';
const OFFLINE_QUEUE_STORE = 'offline-queue';

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

async function processOfflineQueue() {
  const db = await openDB();

  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const request = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const results = { synced: 0, failed: 0 };

  for (const item of items) {
    try {
      const form = new FormData();
      form.append('id', item.itemId);
      form.append('contentType', item.type);

      if (item.type === 'text') {
        form.append('content', item.content);
      } else {
        const blob = new Blob([item.fileData], { type: item.fileType });
        form.append('file', blob, item.fileName);
      }

      const response = await fetch(
        `${item.serverUrl}/v1/spaces/${item.spaceId}/items/${item.itemId}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${item.token}` },
          body: form,
        },
      );

      if (response.ok) {
        const deleteTx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
        deleteTx.objectStore(OFFLINE_QUEUE_STORE).delete(item.id);
        await new Promise((resolve) => {
          deleteTx.oncomplete = resolve;
        });
        results.synced++;
      } else {
        results.failed++;
      }
    } catch {
      results.failed++;
    }
  }

  // Notify clients about sync results
  if (results.synced > 0) {
    const allClients = await self.clients.matchAll();
    for (const client of allClients) {
      client.postMessage({
        type: 'offline-queue-synced',
        synced: results.synced,
        failed: results.failed,
      });
    }
  }
}

// --- Event Listeners ---

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/_share' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Pass through all other requests — no caching strategy
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-queue-sync') {
    event.waitUntil(processOfflineQueue());
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
