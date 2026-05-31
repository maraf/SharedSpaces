// IndexedDB schema — shared with src/sw.ts (which has its own openDB for SW context).
// If you change DB_NAME, DB_VERSION, or store names, update both files.
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'shared-spaces-db';
const DB_VERSION = 6;
const PENDING_SHARES_STORE = 'pending-shares';
// Unified compose queue: everything the user selected/typed but hasn't
// successfully uploaded yet. Each row carries a `status` ('draft' | 'pending').
// Replaces the old split between `compose-drafts` (picked, not yet shared) and
// `offline-queue` (shared but upload failed). A NEW store name is used so the
// previously shipped v5 service worker — which background-uploads everything in
// `offline-queue` even with the tab closed — can never auto-upload a `draft`.
const COMPOSE_ITEMS_STORE = 'compose-items';
// Legacy store, shipped at DB v5. Still created/read so the service worker and
// the lazy migration can drain any rows queued before this version.
const OFFLINE_QUEUE_STORE = 'offline-queue';
const AUTH_TOKENS_STORE = 'auth-tokens';
const JOURNAL_SYNC_SETTINGS_STORE = 'journal-sync-settings';
const JOURNAL_CACHE_STORE = 'journal-cache';
// `viewed-files` holds only `{ key, blob }` rows so reads/writes never touch
// metadata. `viewed-files-meta` carries everything needed for LRU/eviction
// (size, accessedAt index, etc.) so we can sort, prune, and bump access times
// without ever loading or rewriting blobs.
const VIEWED_FILES_STORE = 'viewed-files';
const VIEWED_FILES_META_STORE = 'viewed-files-meta';

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

// A single compose-queue row. `status` is the only thing distinguishing the two
// former concepts:
//  - 'draft'   = picked/typed, awaits an explicit Share, never background-synced.
//  - 'pending' = Share was pressed but the upload hasn't succeeded yet; retried
//                in the foreground and by the service worker background sync.
// `serverUrl`/`spaceId`/`itemId` are assigned at creation (the space is always
// known in the compose box) so promoting draft -> pending is just a status flip
// and the upload is self-contained the instant the status changes. `itemId` is
// the stable upsert key, so duplicate uploads (e.g. deploy-skew between an old
// SW and new code) are idempotent.
export interface ComposeItem {
  id: string;
  status: 'draft' | 'pending';
  type: 'text' | 'file';
  serverUrl: string;
  spaceId: string;
  itemId: string;
  content?: string;
  fileName?: string;
  fileType?: string;
  fileData?: ArrayBuffer;
  fileSize?: number;
  // When a draft was promoted from a Web Share Target ("Shared from other apps")
  // file share, this links back to the originating pending share so the share can
  // be cleared on successful upload and filtered out of the pending-shares list.
  pendingShareId?: string;
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
    upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains(PENDING_SHARES_STORE)) {
        db.createObjectStore(PENDING_SHARES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(COMPOSE_ITEMS_STORE)) {
        db.createObjectStore(COMPOSE_ITEMS_STORE, { keyPath: 'id' });
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

      // v4 → v5: the `accessedAt` index on the blob store no longer applies
      // because rows now only carry `{ key, blob }`. Drop it here (schema
      // change must happen inside the versionchange tx); data migration
      // runs lazily below in `migrateViewedFilesIfNeeded`.
      if (oldVersion < 5) {
        const blobStore = tx.objectStore(VIEWED_FILES_STORE);
        if (blobStore.indexNames.contains('accessedAt')) {
          blobStore.deleteIndex('accessedAt');
        }
      }
    },
  })
    .then(async (db) => {
      db.onversionchange = () => db.close();
      await migrateViewedFilesIfNeeded(db);
      await migrateOfflineQueueIfNeeded(db);
      return db;
    })
    .catch((err) => {
      dbInstance = null;
      throw err;
    });

  return dbInstance;
}

// Pre-v5 rows in `viewed-files` carried the metadata inline alongside the
// blob. After upgrade those rows still exist but the meta store starts
// empty — split them on first open so the new read/write paths can find
// both halves. Idempotent: meta rows that are already present win.
async function migrateViewedFilesIfNeeded(db: IDBPDatabase): Promise<void> {
  const tx = db.transaction([VIEWED_FILES_STORE, VIEWED_FILES_META_STORE], 'readwrite');
  const blobStore = tx.objectStore(VIEWED_FILES_STORE);
  const metaStore = tx.objectStore(VIEWED_FILES_META_STORE);

  let cursor = await blobStore.openCursor();
  while (cursor) {
    const value = cursor.value as {
      key?: string;
      serverUrl?: string;
      spaceId?: string;
      itemId?: string;
      blob?: Blob;
      mimeType?: string;
      size?: number;
      accessedAt?: number;
    };
    const key = value.key ?? (cursor.key as string);
    const blob = value.blob;
    // A migrated row only has `{ key, blob }`. A legacy row also carries
    // `serverUrl`/`spaceId`/etc — that's our migration trigger.
    const isLegacy = blob !== undefined && (
      typeof value.serverUrl === 'string'
      || typeof value.spaceId === 'string'
      || typeof value.itemId === 'string'
      || typeof value.size === 'number'
      || typeof value.accessedAt === 'number'
    );
    if (isLegacy && key) {
      const existing = (await metaStore.get(key)) as CachedFileMeta | undefined;
      if (!existing) {
        const accessedAt = typeof value.accessedAt === 'number' ? value.accessedAt : Date.now();
        await metaStore.put({
          key,
          serverUrl: value.serverUrl ?? '',
          spaceId: value.spaceId ?? '',
          itemId: value.itemId ?? '',
          mimeType: value.mimeType ?? blob.type ?? 'application/octet-stream',
          size: value.size ?? blob.size,
          accessedAt,
          createdAt: accessedAt,
        });
      }
      await cursor.update({ key, blob });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

// Drains the legacy `offline-queue` store into the unified `compose-items`
// store as `pending` rows. Runs lazily on first open after the v5 -> v6 upgrade
// (when production users still have queued items). Done in ONE readwrite
// transaction over both stores so there's no getAll+clear race: each legacy row
// is copied (preserving `itemId` so any concurrent SW upload stays idempotent)
// then deleted in the same transaction. Idempotent — re-running finds an empty
// queue. The migrated row keeps the legacy `id` so a second run that races the
// first just overwrites the same compose-items row rather than duplicating it.
// Exported for unit testing. Production callers reach this only through getDB().
export async function migrateOfflineQueueIfNeeded(db: IDBPDatabase): Promise<void> {
  if (
    !db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)
    || !db.objectStoreNames.contains(COMPOSE_ITEMS_STORE)
  ) {
    return;
  }

  const tx = db.transaction([OFFLINE_QUEUE_STORE, COMPOSE_ITEMS_STORE], 'readwrite');
  const queueStore = tx.objectStore(OFFLINE_QUEUE_STORE);
  const composeStore = tx.objectStore(COMPOSE_ITEMS_STORE);

  let cursor = await queueStore.openCursor();
  while (cursor) {
    const legacy = cursor.value as OfflineQueueItem;
    const existing = (await composeStore.get(legacy.id)) as ComposeItem | undefined;
    if (!existing) {
      const migrated: ComposeItem = {
        id: legacy.id,
        status: 'pending',
        type: legacy.type,
        serverUrl: legacy.serverUrl,
        spaceId: legacy.spaceId,
        itemId: legacy.itemId,
        content: legacy.content,
        fileName: legacy.fileName,
        fileType: legacy.fileType,
        fileData: legacy.fileData,
        timestamp: legacy.timestamp,
      };
      await composeStore.put(migrated);
    }
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

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

// Transactionally update a pending share (e.g. persist a rename) so the edit
// survives a refresh. Returns 'missing' if the row was dismissed/claimed in the
// meantime so a stale in-flight write never resurrects it.
export async function updatePendingShare(
  id: string,
  updater: (item: PendingShareItem) => PendingShareItem,
): Promise<'updated' | 'missing'> {
  const db = await getDB();
  const tx = db.transaction(PENDING_SHARES_STORE, 'readwrite');
  const existing = (await tx.store.get(id)) as PendingShareItem | undefined;
  if (!existing) {
    await tx.done;
    return 'missing';
  }
  await tx.store.put(updater(existing));
  await tx.done;
  return 'updated';
}

export async function clearPendingShares(): Promise<void> {
  const db = await getDB();
  await db.clear(PENDING_SHARES_STORE);
}

// --- Compose Items (unified compose queue: drafts + pending uploads) ---

// Defensive guard: a dev who already opened this branch at v6 (before the store
// was added to the v6 upgrade handler) will be at v6 without `compose-items`, so
// `onupgradeneeded` never fires to create it. Rather than hard-crash, treat a
// missing store as an empty queue. Production users upgrading v5 -> v6 always get
// the store created in the upgrade handler.
function hasComposeItemsStore(db: IDBPDatabase): boolean {
  return db.objectStoreNames.contains(COMPOSE_ITEMS_STORE);
}

export async function getComposeItems(): Promise<ComposeItem[]> {
  const db = await getDB();
  if (!hasComposeItemsStore(db)) return [];
  return (await db.getAll(COMPOSE_ITEMS_STORE)).sort((a, b) =>
    (a.timestamp - b.timestamp)
    || a.id.localeCompare(b.id),
  );
}

export async function getComposeItemsForSpace(
  serverUrl: string,
  spaceId: string,
): Promise<ComposeItem[]> {
  const all = await getComposeItems();
  return all.filter(
    (item) => item.serverUrl === serverUrl && item.spaceId === spaceId,
  );
}

export async function getPendingComposeItems(): Promise<ComposeItem[]> {
  const all = await getComposeItems();
  return all.filter((item) => item.status === 'pending');
}

export async function saveComposeItem(item: ComposeItem): Promise<void> {
  const db = await getDB();
  if (!hasComposeItemsStore(db)) return;
  await db.put(COMPOSE_ITEMS_STORE, item);
}

// Conditionally update an existing compose item inside a single transaction.
// Returns 'missing' (without writing) when the row no longer exists, so a stale
// rename or status flip can never resurrect a row that foreground/background
// sync — or the user — already removed.
export async function updateComposeItem(
  id: string,
  updater: (item: ComposeItem) => ComposeItem,
): Promise<'updated' | 'missing'> {
  const db = await getDB();
  if (!hasComposeItemsStore(db)) return 'missing';
  const tx = db.transaction(COMPOSE_ITEMS_STORE, 'readwrite');
  const existing = (await tx.store.get(id)) as ComposeItem | undefined;
  if (!existing) {
    await tx.done;
    return 'missing';
  }
  await tx.store.put(updater(existing));
  await tx.done;
  return 'updated';
}

export async function removeComposeItem(id: string): Promise<void> {
  const db = await getDB();
  if (!hasComposeItemsStore(db)) return;
  await db.delete(COMPOSE_ITEMS_STORE, id);
}

export async function clearComposeItems(): Promise<void> {
  const db = await getDB();
  if (!hasComposeItemsStore(db)) return;
  await db.clear(COMPOSE_ITEMS_STORE);
}

export async function clearComposeItemsForSpace(
  serverUrl: string,
  spaceId: string,
): Promise<void> {
  const db = await getDB();
  if (!hasComposeItemsStore(db)) return;
  const all: ComposeItem[] = await db.getAll(COMPOSE_ITEMS_STORE);
  const tx = db.transaction(COMPOSE_ITEMS_STORE, 'readwrite');
  for (const item of all) {
    if (item.serverUrl === serverUrl && item.spaceId === spaceId) {
      tx.store.delete(item.id);
    }
  }
  await tx.done;
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
//
// The blob payload lives in `viewed-files` (rows are `{ key, blob }`) and
// metadata lives in `viewed-files-meta`. Splitting the two keeps LRU bumps
// and prune scans cheap: reading a file rewrites only the small meta row,
// and pruning iterates the `accessedAt` index without ever loading blobs.

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

interface CachedFileMeta {
  key: string;
  serverUrl: string;
  spaceId: string;
  itemId: string;
  mimeType: string;
  size: number;
  accessedAt: number;
  createdAt: number;
}

interface CachedFileBlobRow {
  key: string;
  blob: Blob;
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

  const tx = db.transaction([VIEWED_FILES_STORE, VIEWED_FILES_META_STORE], 'readwrite');
  const blobStore = tx.objectStore(VIEWED_FILES_STORE);
  const metaStore = tx.objectStore(VIEWED_FILES_META_STORE);

  const [meta, blobRow] = await Promise.all([
    metaStore.get(key) as Promise<CachedFileMeta | undefined>,
    blobStore.get(key) as Promise<CachedFileBlobRow | undefined>,
  ]);

  if (!meta || !blobRow) {
    // If only one half exists (e.g. a half-completed write), drop both so we
    // don't return a partial entry and don't leak storage.
    if (meta) await metaStore.delete(key);
    if (blobRow) await blobStore.delete(key);
    await tx.done;
    return undefined;
  }

  const accessedAt = Date.now();
  // Bump LRU by writing only the small meta row — the blob is untouched.
  await metaStore.put({ ...meta, accessedAt });
  await tx.done;

  return {
    key: meta.key,
    serverUrl: meta.serverUrl,
    spaceId: meta.spaceId,
    itemId: meta.itemId,
    blob: blobRow.blob,
    mimeType: meta.mimeType,
    size: meta.size,
    accessedAt,
  };
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
  const key = getCachedFileKey(serverUrl, spaceId, itemId);
  const now = Date.now();

  const tx = db.transaction([VIEWED_FILES_STORE, VIEWED_FILES_META_STORE], 'readwrite');
  const blobStore = tx.objectStore(VIEWED_FILES_STORE);
  const metaStore = tx.objectStore(VIEWED_FILES_META_STORE);

  const existing = (await metaStore.get(key)) as CachedFileMeta | undefined;
  const meta: CachedFileMeta = {
    key,
    serverUrl,
    spaceId,
    itemId,
    mimeType: mimeType ?? blob.type ?? 'application/octet-stream',
    size: blob.size,
    accessedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  await Promise.all([
    blobStore.put({ key, blob }),
    metaStore.put(meta),
  ]);
  await tx.done;

  const budget = budgetBytes ?? (await getViewedFilesBudget());
  await pruneCachedFiles(budget);
}

export async function removeCachedFile(
  serverUrl: string,
  spaceId: string,
  itemId: string,
): Promise<void> {
  const db = await getDB();
  const key = getCachedFileKey(serverUrl, spaceId, itemId);
  const tx = db.transaction([VIEWED_FILES_STORE, VIEWED_FILES_META_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(VIEWED_FILES_STORE).delete(key),
    tx.objectStore(VIEWED_FILES_META_STORE).delete(key),
  ]);
  await tx.done;
}

export async function clearCachedFilesForSpace(
  serverUrl: string,
  spaceId: string,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([VIEWED_FILES_STORE, VIEWED_FILES_META_STORE], 'readwrite');
  const metaStore = tx.objectStore(VIEWED_FILES_META_STORE);
  const blobStore = tx.objectStore(VIEWED_FILES_STORE);

  // Cursor over meta only — we never load blobs into memory.
  let cursor = await metaStore.openCursor();
  while (cursor) {
    const meta = cursor.value as CachedFileMeta;
    if (meta.serverUrl === serverUrl && meta.spaceId === spaceId) {
      await cursor.delete();
      await blobStore.delete(meta.key);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getCachedFilesTotalSize(): Promise<number> {
  const db = await getDB();
  // Sum sizes from the meta store; the blob store is never iterated.
  const metas = (await db.getAll(VIEWED_FILES_META_STORE)) as CachedFileMeta[];
  return metas.reduce((total, meta) => total + meta.size, 0);
}

export async function pruneCachedFiles(
  budgetBytes?: number,
): Promise<void> {
  const budget = budgetBytes ?? (await getViewedFilesBudget());
  if (budget < 0) return;

  const db = await getDB();
  const tx = db.transaction([VIEWED_FILES_STORE, VIEWED_FILES_META_STORE], 'readwrite');
  const metaStore = tx.objectStore(VIEWED_FILES_META_STORE);
  const blobStore = tx.objectStore(VIEWED_FILES_STORE);

  // Cheap O(n) total: meta rows are small and we only sum a number field.
  const metas = (await metaStore.getAll()) as CachedFileMeta[];
  let total = metas.reduce((sum, m) => sum + m.size, 0);

  if (total <= budget) {
    await tx.done;
    return;
  }

  // Walk the accessedAt index ascending (oldest first) via a cursor — no
  // blobs are loaded since we only read meta rows.
  const index = metaStore.index('accessedAt');
  let cursor = await index.openCursor();
  while (cursor && total > budget) {
    const meta = cursor.value as CachedFileMeta;
    await cursor.delete();
    await blobStore.delete(meta.key);
    total -= meta.size;
    cursor = await cursor.continue();
  }

  await tx.done;
}

export async function clearAllCachedFiles(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([VIEWED_FILES_STORE, VIEWED_FILES_META_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(VIEWED_FILES_STORE).clear(),
    tx.objectStore(VIEWED_FILES_META_STORE).clear(),
  ]);
  await tx.done;
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
