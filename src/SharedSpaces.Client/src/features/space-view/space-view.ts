import { html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { BaseElement } from '../../lib/base-element';
import type { AppViewChangeDetail } from '../../lib/navigation';
import { getToken, removeToken } from '../../lib/token-storage';
import { formatRelativeTime } from '../../lib/format-time';
import { modifierKey } from '../../lib/platform';
import {
  SignalRClient,
  type ConnectionState,
  type ItemAddedPayload,
  type ItemDeletedPayload,
} from '../../lib/signalr-client';
import {
  getItems,
  shareText,
  shareFile,
  downloadFile,
  deleteItem,
  transferItem,
  createSharedLink,
  getSharedLinks,
  deleteSharedLink,
  getJournal,
  updateJournalCheckpoint,
  SpaceApiError,
  type JournalResponse,
  type SpaceItemResponse,
  type SharedLinkResponse,
} from './space-api';
import {
  getPendingShares,
  removePendingShare,
  getComposeItemsForSpace,
  saveComposeItem,
  updateComposeItem,
  removeComposeItem,
  clearComposeItemsForSpace,
  getJournalSyncEnabled,
  setJournalSyncEnabled,
  getJournalCache,
  setJournalCache,
  clearJournalCache,
  getCachedFile,
  setCachedFile,
  removeCachedFile,
  clearCachedFilesForSpace,
  getViewedFilesStorageStatus,
  requestPersistentStorage,
  type PendingShareItem,
  type ComposeItem,
  type StorageBudgetSnapshot,
} from '../../lib/idb-storage';
import { requestBackgroundSync } from '../../lib/sw-registration';
import { getFileTypeIcon, getTextItemIcon } from '../../lib/file-icons';
import {
  getFilePreviewType,
  isPreviewable,
  isFileTooLargeForPreview,
  type FilePreviewType,
} from './file-preview';
import {
  queueForOffline,
  processOfflineQueue,
} from '../../lib/offline-sync';
import { buildShareUrl } from '../../lib/share-link';
import { toDataURL } from 'qrcode';

export interface JoinedSpace {
  serverUrl: string;
  spaceId: string;
  spaceName: string;
  token: string;
}

function hasFileExtension(fileName: string): boolean {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 && lastDot < fileName.length - 1;
}

function getImageExtension(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/avif':
      return 'avif';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'image/tiff':
    case 'image/tif':
      return 'tiff';
    case 'image/png':
    default:
      return 'png';
  }
}

function normalizeClipboardImageFiles(files: File[]): File[] {
  const timestamp = Date.now();

  return files.map((file, index) => {
    const trimmedName = file.name.trim();
    if (trimmedName && hasFileExtension(trimmedName)) {
      return file;
    }

    const extension = getImageExtension(file.type);
    const baseName = trimmedName.replace(/^\.+|\.+$/g, '')
      || `pasted-image-${timestamp}-${index + 1}`;

    return new File([file], `${baseName}.${extension}`, {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}

// Unified in-memory compose row. Both `draft` (picked, awaiting an explicit
// Share) and `pending` (Share pressed but upload failed, auto-retried) rows live
// in one list and one IndexedDB store (`compose-items`). A draft -> pending
// transition is just a status flip; the stable `itemId` keeps retries idempotent.
interface ComposeEntry {
  id: string;
  status: 'draft' | 'pending';
  type: 'text' | 'file';
  itemId: string;
  name: string;
  content?: string;
  fileType?: string;
  fileSize?: number;
  // In-memory File kept only for freshly picked/promoted drafts so we can upload
  // without re-reading from IDB. Not part of reactive render state.
  file?: File;
  pendingShareId?: string;
  timestamp: number;
}

@customElement('space-view')
export class SpaceView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  @property({ type: String, attribute: 'space-id' })
  spaceId?: string;

  @property({ type: String, attribute: 'server-url' })
  serverUrl?: string;

  @property({ type: Array })
  spaces: JoinedSpace[] = [];

  @property({ type: Boolean, attribute: 'show-settings' })
  showSettings = false;

  @state() private items: SpaceItemResponse[] = [];
  @state() private isLoading = true;
  @state() private errorMessage = '';
  @state() private connectionErrorType: 'none' | 'auth' | 'network' = 'none';
  @state() private textInput = '';
  @state() private isUploading = false;
  @state() private uploadError = '';
  @state() private dragOver = false;
  @state() private copiedItemIds = new Set<string>();
  @state() private modalItem: SpaceItemResponse | null = null;
  @state() private connectionState: ConnectionState = 'disconnected';
  @state() private isOnline = navigator.onLine;
  @state() private pendingShares: PendingShareItem[] = [];
  @state() private syncMessage = '';
  @state() private deleteConfirmItemId: string | null = null;
  @state() private transferModalItem: SpaceItemResponse | null = null;
  @state() private transferInProgress = false;
  @state() private transferError = '';
  @state() private filePreviewItem: SpaceItemResponse | null = null;
  @state() private filePreviewType: FilePreviewType = 'none';
  @state() private filePreviewUrl: string | null = null;
  @state() private filePreviewText: string | null = null;
  @state() private filePreviewLoading = false;
  @state() private filePreviewError = '';
  @state() private shareModalItem: SpaceItemResponse | null = null;
  @state() private shareModalLinks: SharedLinkResponse[] = [];
  @state() private shareModalLoading = false;
  @state() private shareModalError = '';
  @state() private shareModalCreating = false;
  @state() private shareModalDeleteConfirmId: string | null = null;
  @state() private shareCopiedLinkId: string | null = null;
  @state() private shareModalQrOpenLinkId: string | null = null;
  @state() private shareModalQrGeneratingLinkId: string | null = null;
  @state() private shareModalQrCodeDataUrls: Record<string, string> = {};
  @state() private shareModalName = '';
  @state() private openMenuItemId: string | null = null;
  @state() private composeItems: ComposeEntry[] = [];
  @state() private uploadingComposeItemIds = new Set<string>();
  @state() private composeQueueError = '';
  @state() private leaveConfirm = false;
  @state() private journalSyncEnabled = false;
  @state() private journalSyncLoading = false;
  @state() private cacheStorageStatus: StorageBudgetSnapshot | null = null;
  @state() private storagePersisted = false;

  private _previewRequestId = 0;

  // Compose-item ids the user removed or that uploaded successfully this session.
  // Guards against an in-flight persist or a re-hydration resurrecting a row that
  // was already discarded/uploaded.
  private discardedComposeItemIds = new Set<string>();
  // Monotonic token so a slower refresh can't clobber a newer one.
  private composeRefreshVersion = 0;

  private token?: string;
  private lastLoadedKey = '';
  private signalRClient?: SignalRClient;
  private pendingItemIds = new Set<string>();
  private dragCounter = 0;
  private journalVerifyTimer: number | null = null;
  private journalVerificationInFlight: Promise<void> | null = null;
  private journalVerificationRequested = false;

  private handleOnline = async () => {
    this.isOnline = true;
    const synced = await requestBackgroundSync();
    if (!synced) {
      this.syncOfflineQueue();
    }
    this.scheduleJournalVerification();
  };
  private handleOffline = () => { this.isOnline = false; };
  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.scheduleJournalVerification();
      if (this.connectionState === 'disconnected') {
        this.startSignalR().catch((error) => {
          console.error('Failed to start SignalR after visibility change', error);
        });
      }
    }
  };
  private handleSwMessage = (event: MessageEvent) => {
    if (event.data?.type === 'pending-share-added') {
      this.loadPendingShares();
      return;
    }
    if (event.data?.type === 'offline-queue-sync-requested') {
      void this.syncOfflineQueue();
      return;
    }
    if (event.data?.type === 'offline-queue-sync-complete') {
      void this.handleBackgroundSyncComplete(event.data.result);
    }
  };
  private handleKebabClickOutside = (event: MouseEvent) => {
    if (this.openMenuItemId === null) return;
    const target = event.target as HTMLElement;
    if (!target.closest('[data-kebab-menu]')) {
      this.openMenuItemId = null;
    }
  };
  private handleKebabKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.openMenuItemId !== null) {
      this.openMenuItemId = null;
    }
  };
  private handleKebabScroll = () => {
    if (this.openMenuItemId !== null) {
      this.openMenuItemId = null;
    }
  };

  override updated(changed: Map<string, unknown>) {
    if (changed.has('spaceId') || changed.has('serverUrl')) {
      const key = `${this.serverUrl ?? ''}|${this.spaceId ?? ''}`;
      if (key !== this.lastLoadedKey) {
        this.lastLoadedKey = key;
        this.loadData();
      }
    }

    if (changed.has('connectionState') && this.spaceId) {
      this.dispatchEvent(
        new CustomEvent('connection-state-change', {
          bubbles: true,
          composed: true,
          detail: {
            spaceId: this.spaceId,
            state: this.connectionState,
          },
        }),
      );
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener('online', this.handleOnline);
    globalThis.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('dragenter', this.handleDragEnter);
    document.addEventListener('dragleave', this.handleDragLeave);
    document.addEventListener('dragover', this.handleDragOver);
    document.addEventListener('drop', this.handleDocumentDrop);
    navigator.serviceWorker?.addEventListener('message', this.handleSwMessage);
    document.addEventListener('click', this.handleKebabClickOutside);
    document.addEventListener('keydown', this.handleKebabKeydown);
    document.addEventListener('scroll', this.handleKebabScroll, { passive: true, capture: true });
    globalThis.addEventListener('resize', this.handleKebabScroll);
    this.loadPendingShares();
    this.refreshComposeItems();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.stopSignalR();
    globalThis.removeEventListener('online', this.handleOnline);
    globalThis.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('dragenter', this.handleDragEnter);
    document.removeEventListener('dragleave', this.handleDragLeave);
    document.removeEventListener('dragover', this.handleDragOver);
    document.removeEventListener('drop', this.handleDocumentDrop);
    navigator.serviceWorker?.removeEventListener('message', this.handleSwMessage);
    document.removeEventListener('click', this.handleKebabClickOutside);
    document.removeEventListener('keydown', this.handleKebabKeydown);
    document.removeEventListener('scroll', this.handleKebabScroll, { capture: true });
    globalThis.removeEventListener('resize', this.handleKebabScroll);
    if (this.journalVerifyTimer !== null) {
      globalThis.clearTimeout(this.journalVerifyTimer);
      this.journalVerifyTimer = null;
    }
  }

  private resolveToken(): Promise<string | undefined> {
    if (this.serverUrl && this.spaceId) {
      return getToken(this.serverUrl, this.spaceId);
    }
    return Promise.resolve(undefined);
  }

  private redirectToJoin() {
    this.dispatchEvent(
      new CustomEvent<AppViewChangeDetail>('view-change', {
        bubbles: true,
        composed: true,
        detail: { view: 'join' },
      }),
    );
  }

  private async removeSpace() {
    if (!this.serverUrl || !this.spaceId) return;

    // Clean up SignalR connection
    await this.stopSignalR();

    // Remove token from storage
    await removeToken(this.serverUrl, this.spaceId);

    // Clear any queued compose items for this space
    await clearComposeItemsForSpace(this.serverUrl, this.spaceId).catch(() => {});

    // Redirect to join view and tell app-shell to reload spaces
    this.dispatchEvent(
      new CustomEvent<AppViewChangeDetail>('view-change', {
        bubbles: true,
        composed: true,
        detail: { view: 'join', reloadSpaces: true },
      }),
    );
  }

  private async loadData() {
    if (!this.serverUrl || !this.spaceId) return;

    this.token = await this.resolveToken();
    if (!this.token) {
      this.redirectToJoin();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.connectionErrorType = 'none';

    // Refresh compose items and pending shares for the current space
    await Promise.all([
      this.refreshComposeItems(),
      this.loadPendingShares(),
      this.loadJournalSyncSetting(),
    ]);

    try {
      if (this.journalSyncEnabled) {
        await this.loadDataWithJournalSync();
      } else {
        await this.loadDataWithFullFetch();
      }

      // Start SignalR connection after successful data load
      await this.startSignalR();
    } catch (error) {
      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        this.connectionErrorType = 'auth';
        this.errorMessage = 'Authentication failed. Your token may have been revoked or the space no longer exists.';
        return;
      }

      // Check if it's a network error
      if (error instanceof SpaceApiError && !error.status) {
        this.connectionErrorType = 'network';
        this.errorMessage = 'Unable to connect to the server. The server may be offline or unreachable.';
        return;
      }

      this.errorMessage =
        error instanceof SpaceApiError
          ? error.message
          : 'Failed to load space data.';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadJournalSyncSetting() {
    if (!this.serverUrl || !this.spaceId) return;
    try {
      this.journalSyncEnabled = await getJournalSyncEnabled(this.serverUrl, this.spaceId);
    } catch {
      this.journalSyncEnabled = false;
    }
    if (this.journalSyncEnabled) {
      void this.refreshCacheStorageStatus();
    } else {
      this.cacheStorageStatus = null;
    }
  }

  private async refreshCacheStorageStatus(): Promise<void> {
    try {
      this.cacheStorageStatus = await getViewedFilesStorageStatus();
    } catch {
      this.cacheStorageStatus = null;
    }
    try {
      if (
        typeof navigator !== 'undefined'
        && navigator.storage
        && typeof navigator.storage.persisted === 'function'
      ) {
        this.storagePersisted = await navigator.storage.persisted();
      }
    } catch {
      // Best-effort.
    }
  }

  private async loadDataWithFullFetch() {
    if (!this.serverUrl || !this.spaceId || !this.token) return;
    const itemList = await getItems(this.serverUrl, this.spaceId, this.token);
    this.evictCachedBlobsForRemovedItems(this.items, itemList);
    this.items = itemList;
  }

  private async loadDataWithJournalSync() {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    // 1. Load cached items from IndexedDB
    const cache = await getJournalCache(this.serverUrl, this.spaceId);
    if (cache) {
      this.items = cache.items;
    }

    // 2. Fetch journal delta and apply it. If the journal endpoint or any of the
    // journal-application steps fail (e.g. a transient 500), fall back to a full
    // fetch so the space remains usable instead of leaving the user stuck without
    // SignalR. Cache load above is intentionally outside the try/catch — IDB
    // failures there should propagate as before.
    try {
      const journal = await getJournal(this.serverUrl, this.spaceId, this.token);

      // 3. If full sync required, fall back to full fetch
      if (journal.fullSyncRequired) {
        const itemList = await getItems(this.serverUrl, this.spaceId, this.token);
        this.evictCachedBlobsForRemovedItems(this.items, itemList);
        this.items = itemList;
        await setJournalCache(this.serverUrl, this.spaceId, journal.checkpoint, itemList);
        await updateJournalCheckpoint(this.serverUrl, this.spaceId, journal.checkpoint, this.token);
        return;
      }

      await this.applyJournalDelta(journal);
    } catch (error) {
      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        // Auth/not-found errors should surface to the caller so the standard
        // error UI kicks in rather than silently masking them with a full fetch
        // that will hit the same failure.
        throw error;
      }
      console.warn('Journal sync failed; falling back to full fetch:', error);
      await this.loadDataWithFullFetch();
    }
  }

  private async applyJournalDelta(journal: JournalResponse) {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    // 4. Apply delta to cached items
    const itemMap = new Map(this.items.map((item) => [item.id, item]));

    // Apply deletions (and evict any cached blobs for them)
    for (const deletedId of journal.deleted) {
      itemMap.delete(deletedId);
      if (this.serverUrl && this.spaceId) {
        removeCachedFile(this.serverUrl, this.spaceId, deletedId).catch(() => {});
      }
    }

    // Apply additions/updates
    for (const item of journal.addedOrUpdated) {
      itemMap.set(item.id, item);
    }

    // Convert back to sorted array (newest first)
    this.items = Array.from(itemMap.values()).sort(
      (a, b) => new Date(b.sharedAt).getTime() - new Date(a.sharedAt).getTime(),
    );

    // 5. Update cache and checkpoint
    await setJournalCache(this.serverUrl, this.spaceId, journal.checkpoint, this.items);
    await updateJournalCheckpoint(this.serverUrl, this.spaceId, journal.checkpoint, this.token);
  }

  private evictCachedBlobsForRemovedItems(
    previous: SpaceItemResponse[],
    next: SpaceItemResponse[],
  ): void {
    if (!this.serverUrl || !this.spaceId || previous.length === 0) return;
    const nextIds = new Set(next.map((item) => item.id));
    for (const item of previous) {
      if (item.contentType === 'file' && !nextIds.has(item.id)) {
        removeCachedFile(this.serverUrl, this.spaceId, item.id).catch(() => {});
      }
    }
  }

  private async toggleJournalSync() {
    if (!this.serverUrl || !this.spaceId) return;

    this.journalSyncLoading = true;
    try {
      const newValue = !this.journalSyncEnabled;
      await setJournalSyncEnabled(this.serverUrl, this.spaceId, newValue);
      this.journalSyncEnabled = newValue;

      if (newValue) {
        // Ask the browser to keep our storage around so the cache survives
        // eviction. Best-effort; user may decline or the API may be missing.
        try {
          this.storagePersisted = await requestPersistentStorage();
        } catch {
          this.storagePersisted = false;
        }
        void this.refreshCacheStorageStatus();
      } else {
        // When disabling, clear caches that were populated only because Large
        // Space Mode was on (item list journal cache + viewed file blobs).
        await clearJournalCache(this.serverUrl, this.spaceId);
        await clearCachedFilesForSpace(this.serverUrl, this.spaceId);
        this.cacheStorageStatus = null;
      }

      this.syncMessage = newValue
        ? 'Large space mode enabled for this browser.'
        : 'Large space mode disabled for this browser.';
      globalThis.setTimeout(() => {
        if (
          this.syncMessage === 'Large space mode enabled for this browser.'
          || this.syncMessage === 'Large space mode disabled for this browser.'
        ) {
          this.syncMessage = '';
        }
      }, 3000);

      // Reload data to apply the new mode
      await this.loadData();
    } catch (error) {
      console.error('Failed to toggle journal sync:', error);
    } finally {
      this.journalSyncLoading = false;
    }
  }

  private async startSignalR() {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    // Stop existing connection if any
    await this.stopSignalR();

    const token = this.token; // Capture for closure

    this.connectionState = 'connecting';

    this.signalRClient = new SignalRClient({
      serverUrl: this.serverUrl,
      spaceId: this.spaceId,
      accessTokenFactory: async () => token,
      onItemAdded: (payload: ItemAddedPayload) => {
        this.handleItemAdded(payload);
      },
      onItemDeleted: (payload: ItemDeletedPayload) => {
        this.handleItemDeleted(payload);
      },
      onStateChange: (state: ConnectionState) => {
        this.connectionState = state;

        // After (re)connect, verify against the journal to catch anything
        // that SignalR may have missed while the browser was away.
        if (state === 'connected') {
          this.scheduleJournalVerification();
        }
      },
    });

    try {
      await this.signalRClient.start();
    } catch (error) {
      // SignalR connection failure is non-critical; UI still works with REST only
      console.warn('SignalR connection failed:', error);
      this.connectionState = 'disconnected';
    }
  }

  private async stopSignalR() {
    if (this.signalRClient) {
      await this.signalRClient.stop();
      this.signalRClient = undefined;
      this.connectionState = 'disconnected';
    }
  }

  private handleItemAdded(payload: ItemAddedPayload) {
    // Skip if item already exists or is being uploaded by us
    if (this.items.some((item) => item.id === payload.id)) return;
    if (this.pendingItemIds.has(payload.id)) return;

    // Prepend new item to the list
    const newItem: SpaceItemResponse = {
      id: payload.id,
      spaceId: payload.spaceId,
      memberId: payload.memberId,
      contentType: payload.contentType,
      content: payload.content,
      fileSize: payload.fileSize,
      sharedAt: payload.sharedAt,
    };

    this.items = [newItem, ...this.items];

    // Update journal cache if enabled
    this.updateJournalCacheAfterChange();
    this.scheduleJournalVerification();
  }

  private handleItemDeleted(payload: ItemDeletedPayload) {
    // Remove item from list (silently ignore if not found)
    this.items = this.items.filter((item) => item.id !== payload.id);

    // Drop any cached file blob for the deleted item.
    if (this.serverUrl && this.spaceId) {
      removeCachedFile(this.serverUrl, this.spaceId, payload.id)
        .then(() => {
          if (this.journalSyncEnabled) void this.refreshCacheStorageStatus();
        })
        .catch(() => {});
    }

    // Update journal cache if enabled
    this.updateJournalCacheAfterChange();
    this.scheduleJournalVerification();
  }

  private scheduleJournalVerification() {
    if (
      !this.journalSyncEnabled
      || !this.isOnline
      || !this.serverUrl
      || !this.spaceId
      || !this.token
    ) {
      return;
    }

    this.journalVerificationRequested = true;

    if (this.journalVerificationInFlight) {
      return;
    }

    if (this.journalVerifyTimer !== null) {
      globalThis.clearTimeout(this.journalVerifyTimer);
    }

    this.journalVerifyTimer = globalThis.setTimeout(() => {
      this.journalVerifyTimer = null;
      this.runJournalVerification();
    }, 1200);
  }

  private runJournalVerification() {
    if (!this.journalVerificationRequested || this.journalVerificationInFlight) {
      return;
    }

    this.journalVerificationRequested = false;
    const verification = this.verifyJournalState();
    this.journalVerificationInFlight = verification;

    verification.catch((error) => {
      console.warn('Failed to verify journal state:', error);
    }).finally(() => {
      this.journalVerificationInFlight = null;

      if (this.journalVerificationRequested) {
        this.scheduleJournalVerification();
      }
    });
  }

  private async verifyJournalState() {
    if (!this.journalSyncEnabled || !this.serverUrl || !this.spaceId || !this.token) {
      return;
    }

    await this.loadDataWithJournalSync();
  }

  private async updateJournalCacheAfterChange() {
    if (!this.journalSyncEnabled || !this.serverUrl || !this.spaceId) return;

    try {
      const cache = await getJournalCache(this.serverUrl, this.spaceId);
      if (cache) {
        // Update cached items while keeping existing checkpoint
        await setJournalCache(this.serverUrl, this.spaceId, cache.checkpoint, this.items);
      }
    } catch (error) {
      // Non-critical; cache will be refreshed on next startup
      console.warn('Failed to update journal cache:', error);
    }
  }

  private async refreshItemsAfterReconnect() {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    try {
      if (this.journalSyncEnabled) {
        await this.loadDataWithJournalSync();
      } else {
        const itemList = await getItems(this.serverUrl, this.spaceId, this.token);
        this.evictCachedBlobsForRemovedItems(this.items, itemList);
        this.items = itemList;
      }
    } catch (error) {
      // Refresh failure is non-critical; user can manually refresh
      console.warn('Failed to refresh items after reconnect:', error);
    }
  }

  // --- Pending Shares (from Share Target) ---

  private async loadPendingShares() {
    try {
      this.pendingShares = await getPendingShares();
    } catch {
      // IndexedDB may not be available
    }
  }

  private async uploadPendingShare(share: PendingShareItem) {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    this.isUploading = true;
    this.uploadError = '';

    try {
      const itemId = crypto.randomUUID();
      this.pendingItemIds.add(itemId);
      let uploaded = false;

      try {
        if (share.type === 'text' && share.content) {
          const item = await shareText(
            this.serverUrl,
            this.spaceId,
            itemId,
            share.content,
            this.token,
          );
          this.items = [item, ...this.items];
          uploaded = true;
        } else if (share.type === 'file' && share.fileData) {
          const blob = new Blob([share.fileData], { type: share.fileType ?? 'application/octet-stream' });
          const file = new File([blob], share.fileName ?? 'shared-file', { type: blob.type });
          const item = await shareFile(
            this.serverUrl,
            this.spaceId,
            itemId,
            file,
            this.token,
          );
          this.items = [item, ...this.items];
          uploaded = true;
        }

        if (uploaded) {
          await removePendingShare(share.id);
          this.pendingShares = this.pendingShares.filter((s) => s.id !== share.id);
          this.notifyPendingSharesChanged();
        } else {
          this.uploadError = 'Shared item has no content to upload.';
        }
      } finally {
        this.pendingItemIds.delete(itemId);
      }
    } catch (error) {
      this.uploadError =
        error instanceof SpaceApiError
          ? error.message
          : 'Failed to upload shared item.';
    } finally {
      this.isUploading = false;
    }
  }

  private async uploadAllPendingShares() {
    const fileShares = this.pendingShares.filter((share) => share.type === 'file');

    if (fileShares.length > 0) {
      // Promote file shares into editable drafts so the user can rename them
      // before uploading, instead of uploading immediately.
      const now = Date.now();
      const entries: ComposeEntry[] = [];
      fileShares.forEach((share, index) => {
        const file = this.pendingShareToFile(share);
        if (file) {
          entries.push(this.createFileDraftEntry(file, now + index, share.id));
        }
      });

      if (entries.length > 0) {
        this.composeItems = [...this.composeItems, ...entries];
        this.composeQueueError = '';
        this.uploadError = '';
        for (const entry of entries) {
          void this.persistDraftEntry(entry);
        }
        return;
      }
    }

    for (const share of [...this.pendingShares]) {
      await this.uploadPendingShare(share);
      if (this.uploadError) break;
    }
  }

  private async dismissPendingShare(share: PendingShareItem) {
    try {
      await removePendingShare(share.id);
      this.pendingShares = this.pendingShares.filter((s) => s.id !== share.id);
      this.notifyPendingSharesChanged();
    } catch {
      // IndexedDB may not be available
    }
  }

  private notifyPendingSharesChanged() {
    this.dispatchEvent(
      new CustomEvent('pending-shares-changed', { bubbles: true, composed: true }),
    );
  }

  private createFileDraftEntry(
    file: File,
    timestamp: number,
    pendingShareId?: string,
  ): ComposeEntry {
    return {
      id: crypto.randomUUID(),
      status: 'draft',
      type: 'file',
      itemId: crypto.randomUUID(),
      name: file.name,
      fileType: file.type,
      fileSize: file.size,
      file,
      pendingShareId,
      timestamp,
    };
  }

  // Persists a freshly-picked/promoted draft to the unified store so it survives
  // a refresh. Guards against the user removing the row mid-read (tombstone).
  private async persistDraftEntry(entry: ComposeEntry) {
    if (!this.serverUrl || !this.spaceId || !entry.file) return;
    if (this.discardedComposeItemIds.has(entry.id)) return;

    try {
      const fileData = await entry.file.arrayBuffer();
      if (this.discardedComposeItemIds.has(entry.id)) return;
      const current = this.composeItems.find((i) => i.id === entry.id);
      if (!current) return; // removed before the read finished

      await saveComposeItem({
        id: entry.id,
        status: 'draft',
        type: 'file',
        serverUrl: this.serverUrl,
        spaceId: this.spaceId,
        itemId: entry.itemId,
        fileName: current.name,
        fileType: entry.fileType,
        fileData,
        fileSize: entry.fileSize,
        pendingShareId: entry.pendingShareId,
        timestamp: entry.timestamp,
      });

      // If the user removed the row while we were saving, undo the write.
      if (this.discardedComposeItemIds.has(entry.id)) {
        await removeComposeItem(entry.id).catch(() => {});
      }
    } catch {
      // IndexedDB may not be available; keep the in-memory entry.
    }
  }

  private storedToEntry(item: ComposeItem, file?: File): ComposeEntry {
    return {
      id: item.id,
      status: item.status === 'pending' ? 'pending' : 'draft',
      type: item.type,
      itemId: item.itemId,
      name: item.type === 'file' ? (item.fileName ?? 'file') : (item.content ?? ''),
      content: item.content,
      fileType: item.fileType,
      fileSize: item.fileSize,
      file,
      pendingShareId: item.pendingShareId,
      timestamp: item.timestamp,
    };
  }

  // Loads the unified compose items (drafts + pending uploads) for the current
  // space and rebuilds the in-memory list. Version-guarded so a slower refresh
  // can't overwrite a newer one; preserves in-memory File handles and any
  // freshly-picked drafts whose persist may still be in flight.
  private async refreshComposeItems() {
    if (!this.serverUrl || !this.spaceId) return;

    const version = ++this.composeRefreshVersion;
    let stored: ComposeItem[];
    try {
      stored = await getComposeItemsForSpace(this.serverUrl, this.spaceId);
    } catch {
      return; // IndexedDB may not be available
    }
    if (version !== this.composeRefreshVersion) return; // a newer refresh won

    const fileById = new Map<string, File>();
    for (const item of this.composeItems) {
      if (item.file) fileById.set(item.id, item.file);
    }

    const storedIds = new Set(stored.map((item) => item.id));
    // Keep just-picked drafts whose store write hasn't landed yet so a refresh
    // racing with promptFilesForUpload doesn't drop them.
    const carriedOver = this.composeItems.filter(
      (item) =>
        item.file &&
        !storedIds.has(item.id) &&
        !this.discardedComposeItemIds.has(item.id),
    );

    this.composeItems = [
      ...stored
        .filter((item) => !this.discardedComposeItemIds.has(item.id))
        .map((item) => this.storedToEntry(item, fileById.get(item.id))),
      ...carriedOver,
    ].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'draft' ? -1 : 1;
      return a.timestamp - b.timestamp;
    });
  }

  private pendingShareToFile(share: PendingShareItem): File | null {
    if (!share.fileData) return null;

    const blob = new Blob([share.fileData], {
      type: share.fileType ?? 'application/octet-stream',
    });
    return new File([blob], share.fileName ?? 'shared-file', {
      type: blob.type,
    });
  }

  private promptFilesForUpload(files: File[]) {
    if (files.length === 0) return;

    const now = Date.now();
    const newEntries = files.map((file, index) =>
      this.createFileDraftEntry(file, now + index));
    // Append to the inline compose queue instead of replacing it so users can
    // keep adding files before sharing.
    this.composeItems = [...this.composeItems, ...newEntries];
    this.composeQueueError = '';
    this.uploadError = '';
    // Persist so the queue survives a page refresh (best-effort).
    for (const entry of newEntries) {
      void this.persistDraftEntry(entry);
    }
  }

  private requestPendingShareUpload(share: PendingShareItem) {
    if (share.type !== 'file') {
      void this.uploadPendingShare(share);
      return;
    }

    const file = this.pendingShareToFile(share);
    if (!file) {
      void this.uploadPendingShare(share);
      return;
    }

    // Promote the file pending share into an editable draft.
    const entry = this.createFileDraftEntry(file, Date.now(), share.id);
    this.composeItems = [...this.composeItems, entry];
    this.composeQueueError = '';
    this.uploadError = '';
    void this.persistDraftEntry(entry);
  }

  private handleComposeNameInput = (id: string, value: string) => {
    this.composeItems = this.composeItems.map((entry) =>
      entry.id === id ? { ...entry, name: value } : entry,
    );
    this.composeQueueError = '';
  };

  // Persists an edited filename (on blur) so it survives a refresh.
  private persistComposeName = (id: string) => {
    const entry = this.composeItems.find((i) => i.id === id);
    if (!entry || entry.type !== 'file') return;
    void updateComposeItem(id, (item) => ({ ...item, fileName: entry.name })).catch(
      () => {
        // IndexedDB may not be available
      },
    );
  };

  // Removes a compose item (draft or pending) from the list and the store.
  // When `removePendingShare` is set, also clears the originating Web Share
  // Target share so it doesn't reappear; user-initiated removals leave it so
  // the "Shared from other apps" row comes back.
  private removeComposeEntry(
    id: string,
    options: { removePendingShare?: boolean } = {},
  ) {
    const entry = this.composeItems.find((i) => i.id === id);
    this.discardedComposeItemIds.add(id);
    this.composeItems = this.composeItems.filter((i) => i.id !== id);
    this.composeQueueError = '';

    void removeComposeItem(id).catch(() => {
      // IndexedDB may not be available
    });

    if (options.removePendingShare && entry?.pendingShareId) {
      void this.removePendingSharesById([entry.pendingShareId]).catch(() => {});
    }
  }

  private removeComposeEntryByUser = (id: string) => {
    if (this.isUploading || this.uploadingComposeItemIds.has(id)) return;
    this.removeComposeEntry(id);
  };

  private get draftEntries(): ComposeEntry[] {
    return this.composeItems.filter((entry) => entry.status === 'draft');
  }

  private get hasComposeQueue(): boolean {
    return this.draftEntries.length > 0;
  }

  // Pending shares from other apps that have not yet been promoted into the
  // compose queue. Promoting a file pending share keeps it in `pendingShares`
  // until the upload is confirmed, so we filter the already-promoted ones out
  // to avoid rendering duplicate rows.
  private get visiblePendingShares(): PendingShareItem[] {
    const promotedIds = new Set<string>(
      this.composeItems
        .map((entry) => entry.pendingShareId)
        .filter((id): id is string => Boolean(id)),
    );
    return this.pendingShares.filter((share) => !promotedIds.has(share.id));
  }

  // Whether the compose box should render its queue area: the user's own
  // drafts, pending uploads (failed Shares retrying), or pending shares folded
  // in from other apps. The global Share button keys off `hasComposeQueue`
  // (drafts only), so folding pending uploads/shares in here never makes Share
  // act on them.
  private get hasComposeContent(): boolean {
    return this.composeItems.length > 0 || this.visiblePendingShares.length > 0;
  }


  private handleComposeShare = async () => {
    if (this.hasComposeQueue) {
      // When text is also typed in the box, send it first, then the queued
      // files/pending shares. If the text fails (e.g. auth/network error),
      // stop before uploading files so the user can retry the whole batch.
      if (this.textInput.trim()) {
        await this.handleTextSubmit();
        if (this.textInput.trim()) return;
      }
      await this.uploadComposeQueue();
      return;
    }
    await this.handleTextSubmit();
  };

  private focusComposeDraftInput = (index: number) => {
    const input = this.querySelector<HTMLInputElement>(
      `#compose-draft-input-${index}`,
    );
    input?.focus();
    input?.select();
  };

  private async removePendingSharesById(ids: string[]) {
    if (ids.length === 0) return;

    await Promise.all(ids.map((id) => removePendingShare(id)));
    const idSet = new Set(ids);
    this.pendingShares = this.pendingShares.filter((share) => !idSet.has(share.id));
    this.notifyPendingSharesChanged();
  }

  // Uploads every staged draft in order. Each draft that fails on offline /
  // network flips to a `pending` row (kept visible and auto-retried) rather
  // than being dropped. Stops the batch on auth/unexpected errors.
  private uploadComposeQueue = async () => {
    const trimmed = this.draftEntries.map((entry) => ({
      ...entry,
      name: entry.name.trim(),
    }));
    if (trimmed.some((entry) => entry.name.length === 0)) {
      this.composeQueueError = 'File names cannot be empty.';
      return;
    }

    // Commit trimmed names back into state (and persist them).
    this.composeItems = this.composeItems.map((entry) => {
      const match = trimmed.find((t) => t.id === entry.id);
      return match ? { ...entry, name: match.name } : entry;
    });
    for (const entry of trimmed) {
      this.persistComposeName(entry.id);
    }

    this.composeQueueError = '';
    this.uploadError = '';
    this.isUploading = true;

    try {
      for (const draft of trimmed) {
        const result = await this.uploadDraftEntry(draft);
        if (result === 'auth' || result === 'error') break;
      }
    } finally {
      this.isUploading = false;
    }
  };

  private async uploadDraftEntry(
    draft: ComposeEntry,
  ): Promise<'uploaded' | 'pending' | 'auth' | 'error'> {
    if (!this.serverUrl || !this.spaceId || !this.token) return 'error';

    const file = await this.resolveDraftFile(draft);
    if (!file) {
      this.composeQueueError = 'Could not read the file to upload.';
      return 'error';
    }
    const renamedFile = new File([file], draft.name, {
      type: file.type,
      lastModified: file.lastModified,
    });

    if (!navigator.onLine) {
      await this.flipDraftToPending(draft, renamedFile);
      return 'pending';
    }

    this.pendingItemIds.add(draft.itemId);
    try {
      const item = await shareFile(
        this.serverUrl,
        this.spaceId,
        draft.itemId,
        renamedFile,
        this.token,
      );
      this.items = [item, ...this.items];
      this.removeComposeEntry(draft.id, { removePendingShare: true });
      return 'uploaded';
    } catch (error) {
      if (error instanceof SpaceApiError && !error.status) {
        // Network error: keep it visible and auto-retry.
        await this.flipDraftToPending(draft, renamedFile);
        return 'pending';
      }
      if (
        error instanceof SpaceApiError &&
        (error.status === 401 || error.status === 404)
      ) {
        this.connectionErrorType = 'auth';
        this.errorMessage =
          'Authentication failed. Your token may have been revoked or the space no longer exists.';
        return 'auth';
      }
      this.uploadError =
        error instanceof SpaceApiError ? error.message : 'Failed to upload file.';
      this.composeQueueError = this.uploadError;
      return 'error';
    } finally {
      this.pendingItemIds.delete(draft.itemId);
    }
  }

  // Resolves the File backing a draft, reconstructing it from the persisted
  // store row when the in-memory File handle is gone (e.g. after a refresh).
  private async resolveDraftFile(draft: ComposeEntry): Promise<File | null> {
    if (draft.file) return draft.file;
    if (!this.serverUrl || !this.spaceId) return null;
    try {
      const stored = await getComposeItemsForSpace(this.serverUrl, this.spaceId);
      const match = stored.find((i) => i.id === draft.id);
      if (!match?.fileData) return null;
      const blob = new Blob([match.fileData], {
        type: match.fileType || 'application/octet-stream',
      });
      return new File([blob], match.fileName ?? draft.name, {
        type: blob.type,
        lastModified: match.timestamp,
      });
    } catch {
      return null;
    }
  }

  // Flips a staged draft to a pending upload: persists status='pending' and
  // requests a background sync so it retries even with the tab closed.
  private async flipDraftToPending(draft: ComposeEntry, file: File) {
    if (!this.serverUrl || !this.spaceId) return;
    if (this.discardedComposeItemIds.has(draft.id)) return;

    try {
      const fileData = await file.arrayBuffer();
      if (this.discardedComposeItemIds.has(draft.id)) return;
      await saveComposeItem({
        id: draft.id,
        status: 'pending',
        type: 'file',
        serverUrl: this.serverUrl,
        spaceId: this.spaceId,
        itemId: draft.itemId,
        fileName: draft.name,
        fileType: file.type,
        fileData,
        fileSize: file.size,
        pendingShareId: draft.pendingShareId,
        timestamp: draft.timestamp,
      });
    } catch {
      // IndexedDB may not be available; still flip the in-memory status.
    }

    this.composeItems = this.composeItems.map((entry) =>
      entry.id === draft.id
        ? { ...entry, status: 'pending', file: undefined }
        : entry,
    );
    void requestBackgroundSync();
  }

  private async enqueueForOffline(
    type: 'text' | 'file',
    options: { content?: string; fileName?: string; fileType?: string; fileData?: ArrayBuffer },
  ) {
    if (!this.serverUrl || !this.spaceId) return;
    await queueForOffline(this.serverUrl, this.spaceId, type, options);
    await this.refreshComposeItems();
  }

  private async syncOfflineQueue() {
    if (!navigator.onLine || !this.token || !this.serverUrl || !this.spaceId) return;

    // Mark currently-pending rows as uploading so their controls disable.
    const pendingIds = this.composeItems
      .filter((entry) => entry.status === 'pending')
      .map((entry) => entry.id);
    this.uploadingComposeItemIds = new Set([
      ...this.uploadingComposeItemIds,
      ...pendingIds,
    ]);

    try {
      const result = await processOfflineQueue(this.serverUrl, this.spaceId, this.token);
      await this.refreshComposeItems();
      this.showSyncResult(result);

      if (result.synced > 0) {
        this.refreshItemsAfterReconnect();
      }
    } catch {
      // Queue processing failed
    } finally {
      const next = new Set(this.uploadingComposeItemIds);
      for (const id of pendingIds) next.delete(id);
      this.uploadingComposeItemIds = next;
    }
  }

  private async handleBackgroundSyncComplete(
    result: { synced?: number; failed?: number; spaces?: Array<{ serverUrl: string; spaceId: string }> } | undefined,
  ) {
    if (!this.serverUrl || !this.spaceId) return;

    const affectedSpaces = Array.isArray(result?.spaces) ? result.spaces : [];
    const affectsCurrentSpace = affectedSpaces.length === 0
      || affectedSpaces.some(
        (space) => space.serverUrl === this.serverUrl && space.spaceId === this.spaceId,
      );

    if (!affectsCurrentSpace) return;

    await this.refreshComposeItems();
    this.showSyncResult({
      synced: result?.synced ?? 0,
      failed: result?.failed ?? 0,
    });

    if ((result?.synced ?? 0) > 0) {
      this.refreshItemsAfterReconnect();
    }
  }


  private showSyncResult(result: { synced: number; failed: number }) {
    if (result.synced === 0 && result.failed === 0) return;

    if (result.synced > 0 && result.failed > 0) {
      this.syncMessage = `Synced ${result.synced} item${result.synced !== 1 ? 's' : ''}, ${result.failed} failed`;
    } else if (result.synced > 0) {
      this.syncMessage = `${result.synced} queued item${result.synced !== 1 ? 's' : ''} uploaded`;
    } else {
      this.syncMessage = `${result.failed} queued item${result.failed !== 1 ? 's' : ''} failed to upload`;
    }

    const message = this.syncMessage;
    setTimeout(() => {
      if (this.syncMessage === message) {
        this.syncMessage = '';
      }
    }, 5000);
  }

  private handleTextInput = (e: Event) => {
    const textarea = e.target as HTMLTextAreaElement;
    this.textInput = textarea.value;
    this.uploadError = '';
    this.autoResizeTextarea(textarea);
  };

  private autoResizeTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = 'auto';
    const maxHeight = 200;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  private resetTextareaHeight() {
    // Query the textarea and reset its height
    const textarea = this.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
    }
  }

  private handleTextSubmit = async () => {
    if (!this.textInput.trim() || !this.serverUrl || !this.spaceId || !this.token)
      return;

    this.isUploading = true;
    this.uploadError = '';

    try {
      // If offline, queue for later
      if (!navigator.onLine) {
        await this.enqueueForOffline('text', { content: this.textInput.trim() });
        this.textInput = '';
        this.resetTextareaHeight();
        return;
      }

      const itemId = crypto.randomUUID();
      this.pendingItemIds.add(itemId);
      try {
        const item = await shareText(
          this.serverUrl,
          this.spaceId,
          itemId,
          this.textInput.trim(),
          this.token,
        );
        this.items = [item, ...this.items];
        this.textInput = '';
        this.resetTextareaHeight();
      } finally {
        this.pendingItemIds.delete(itemId);
      }
    } catch (error) {
      // On network error, queue for offline
      if (error instanceof SpaceApiError && !error.status) {
        try {
          await this.enqueueForOffline('text', { content: this.textInput.trim() });
          this.textInput = '';
          this.resetTextareaHeight();
          return;
        } catch {
          // Fall through to normal error handling
        }
      }

      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        this.connectionErrorType = 'auth';
        this.errorMessage = 'Authentication failed. Your token may have been revoked or the space no longer exists.';
        return;
      }
      this.uploadError =
        error instanceof SpaceApiError
          ? error.message
          : 'Failed to share text.';
    } finally {
      this.isUploading = false;
    }
  };

  private handleTextKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.handleComposeShare();
    }
  };

  private getClipboardImageFiles(event: ClipboardEvent): File[] {
    const items = event.clipboardData?.items;
    if (!items) return [];

    return Array.from(items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }

  private handleTextareaPaste = async (event: ClipboardEvent) => {
    const imageFiles = this.getClipboardImageFiles(event);
    if (
      imageFiles.length === 0
      || !this.serverUrl
      || !this.spaceId
      || !this.token
    ) {
      return;
    }

    event.preventDefault();
    await this.uploadFiles(normalizeClipboardImageFiles(imageFiles));
  };

  private handleFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    this.promptFilesForUpload(Array.from(files));
    input.value = '';
  };

  private handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    // Only show overlay for file drags, not text/link drags
    if (!e.dataTransfer?.types.includes('Files')) {
      return;
    }
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.dragOver = true;
    }
  };

  private handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  private handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    // Only track file drags
    if (!e.dataTransfer?.types.includes('Files')) {
      return;
    }
    // Clamp counter to prevent negative values
    if (this.dragCounter > 0) {
      this.dragCounter--;
    }
    if (this.dragCounter === 0) {
      this.dragOver = false;
    }
  };

  private handleDocumentDrop = (e: DragEvent) => {
    e.preventDefault();
    this.dragCounter = 0;
    this.dragOver = false;
  };

  private handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.dragCounter = 0;
    this.dragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    this.promptFilesForUpload(Array.from(files));
  };

  private triggerFileSelect = () => {
    const input = this.querySelector<HTMLInputElement>('#file-input-hidden');
    if (input) {
      input.click();
    }
  };

  private async uploadFiles(files: File[]): Promise<number> {
    if (!this.serverUrl || !this.spaceId || !this.token) return 0;

    this.isUploading = true;
    this.uploadError = '';
    let processedCount = 0;

    try {
      for (const file of files) {
        // If offline, queue for later
        if (!navigator.onLine) {
          const arrayBuffer = await file.arrayBuffer();
          await this.enqueueForOffline('file', {
            fileName: file.name,
            fileType: file.type,
            fileData: arrayBuffer,
          });
          processedCount++;
          continue;
        }

        try {
          const itemId = crypto.randomUUID();
          this.pendingItemIds.add(itemId);
          try {
            const item = await shareFile(
              this.serverUrl,
              this.spaceId,
              itemId,
              file,
              this.token,
            );
            this.items = [item, ...this.items];
            processedCount++;
          } finally {
            this.pendingItemIds.delete(itemId);
          }
        } catch (error) {
          // On network error, queue remaining files for offline
          if (error instanceof SpaceApiError && !error.status) {
            const arrayBuffer = await file.arrayBuffer();
            await this.enqueueForOffline('file', {
              fileName: file.name,
              fileType: file.type,
              fileData: arrayBuffer,
            });
            processedCount++;
            continue;
          }
          throw error;
        }
      }
      return processedCount;
    } catch (error) {
      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        this.connectionErrorType = 'auth';
        this.errorMessage = 'Authentication failed. Your token may have been revoked or the space no longer exists.';
        return processedCount;
      }
      this.uploadError =
        error instanceof SpaceApiError
          ? error.message
          : 'Failed to upload file.';
      return processedCount;
    } finally {
      this.isUploading = false;
    }
  }

  private handleCopy = async (item: SpaceItemResponse) => {
    try {
      await navigator.clipboard.writeText(item.content);
      this.copiedItemIds = new Set([...this.copiedItemIds, item.id]);
      setTimeout(() => {
        const next = new Set(this.copiedItemIds);
        next.delete(item.id);
        this.copiedItemIds = next;
      }, 1500);
    } catch {
      // Clipboard API may fail in insecure contexts; silently ignore.
    }
  };

  private handleDeleteRequest = (item: SpaceItemResponse) => {
    this.openMenuItemId = null;
    this.deleteConfirmItemId = item.id;
  };

  private cancelDelete = () => {
    this.deleteConfirmItemId = null;
  };

  private confirmDelete = async (item: SpaceItemResponse) => {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    this.deleteConfirmItemId = null;

    // Optimistic removal
    this.items = this.items.filter((i) => i.id !== item.id);

    // Drop any cached file blob for the deleted item.
    if (item.contentType === 'file') {
      removeCachedFile(this.serverUrl, this.spaceId, item.id)
        .then(() => {
          if (this.journalSyncEnabled) void this.refreshCacheStorageStatus();
        })
        .catch(() => {});
    }

    try {
      await deleteItem(this.serverUrl, this.spaceId, item.id, this.token);
    } catch (error) {
      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        this.connectionErrorType = 'auth';
        this.errorMessage = 'Authentication failed. Your token may have been revoked or the space no longer exists.';
        return;
      }
      // Revert on failure
      this.items = [...this.items, item].sort(
        (a, b) =>
          new Date(b.sharedAt).getTime() - new Date(a.sharedAt).getTime(),
      );
    }
  };

  private getOrFetchFileBlob = async (item: SpaceItemResponse): Promise<Blob> => {
    if (!this.serverUrl || !this.spaceId || !this.token) {
      throw new Error('Cannot fetch file without an active session.');
    }

    // Blob caching is opt-in via Large Space Mode. Outside of it we always
    // hit the network so the user's local storage stays untouched.
    if (this.journalSyncEnabled) {
      try {
        const cached = await getCachedFile(this.serverUrl, this.spaceId, item.id);
        if (cached) return cached.blob;
      } catch {
        // Cache lookup failures should not block the download path.
      }
    }

    const blob = await downloadFile(
      this.serverUrl,
      this.spaceId,
      item.id,
      this.token,
    );

    if (this.journalSyncEnabled) {
      try {
        await setCachedFile(this.serverUrl, this.spaceId, item.id, blob);
        void this.refreshCacheStorageStatus();
      } catch {
        // Best-effort cache writes; surfacing storage errors would not help the user.
      }
    }

    return blob;
  };

  private handleDownload = async (item: SpaceItemResponse) => {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    try {
      const blob = await this.getOrFetchFileBlob(item);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.content;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        this.connectionErrorType = 'auth';
        this.errorMessage = 'Authentication failed. Your token may have been revoked or the space no longer exists.';
        return;
      }
      // Download failures are non-critical; could surface as a toast later.
    }
  };

  private handleTextClick = (item: SpaceItemResponse) => {
    this.modalItem = item;
  };

  private closeModal = () => {
    this.modalItem = null;
  };

  private handleFilePreviewClick = async (item: SpaceItemResponse) => {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    const previewType = getFilePreviewType(item.content);
    if (previewType === 'none') return;

    // Revoke previous blob URL to avoid memory leak
    if (this.filePreviewUrl) {
      URL.revokeObjectURL(this.filePreviewUrl);
    }

    // Race guard: capture a request ID so stale responses are discarded
    const requestId = ++this._previewRequestId;

    if (isFileTooLargeForPreview(item.content, item.fileSize)) {
      this.filePreviewItem = item;
      this.filePreviewType = previewType;
      this.filePreviewError = 'File is too large to preview.';
      this.filePreviewLoading = false;
      this.filePreviewUrl = null;
      this.filePreviewText = null;
      return;
    }

    this.filePreviewItem = item;
    this.filePreviewType = previewType;
    this.filePreviewLoading = true;
    this.filePreviewError = '';
    this.filePreviewUrl = null;
    this.filePreviewText = null;

    try {
      const blob = await this.getOrFetchFileBlob(item);

      // Stale response — user clicked a different file while we were loading
      if (this._previewRequestId !== requestId) return;

      if (previewType === 'text') {
        this.filePreviewText = await blob.text();
      } else {
        this.filePreviewUrl = URL.createObjectURL(blob);
      }
    } catch (error) {
      if (this._previewRequestId !== requestId) return;

      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        this.connectionErrorType = 'auth';
        this.errorMessage = 'Authentication failed. Your token may have been revoked or the space no longer exists.';
        this.closeFilePreview();
        return;
      }
      this.filePreviewError = 'Failed to load preview.';
    } finally {
      if (this._previewRequestId === requestId) {
        this.filePreviewLoading = false;
      }
    }
  };

  private closeFilePreview = () => {
    this._previewRequestId++;
    if (this.filePreviewUrl) {
      URL.revokeObjectURL(this.filePreviewUrl);
    }
    this.filePreviewItem = null;
    this.filePreviewType = 'none';
    this.filePreviewUrl = null;
    this.filePreviewText = null;
    this.filePreviewLoading = false;
    this.filePreviewError = '';
  };

  private openTransferModal(item: SpaceItemResponse) {
    this.transferModalItem = item;
    this.transferError = '';
  }

  private closeTransferModal = () => {
    this.transferModalItem = null;
    this.transferError = '';
    this.transferInProgress = false;
  };

  private getAvailableTransferSpaces(): JoinedSpace[] {
    // Filter out current space
    return this.spaces.filter(
      (space) => space.spaceId !== this.spaceId
    );
  }

  private async handleTransfer(
    destinationSpace: JoinedSpace,
    action: 'copy' | 'move',
  ) {
    if (!this.transferModalItem || !this.serverUrl || !this.spaceId || !this.token) {
      return;
    }

    this.transferInProgress = true;
    this.transferError = '';

    try {
      await transferItem(
        this.serverUrl,
        this.spaceId,
        this.transferModalItem.id,
        destinationSpace.token,
        action,
        this.token,
      );

      // Show success feedback
      this.syncMessage = `Item ${action === 'copy' ? 'copied' : 'moved'} to ${destinationSpace.spaceName}`;
      setTimeout(() => {
        this.syncMessage = '';
      }, 3000);

      this.closeTransferModal();
    } catch (error) {
      if (error instanceof SpaceApiError) {
        this.transferError = error.message;
      } else {
        this.transferError = 'Failed to transfer item. Please try again.';
      }
    } finally {
      this.transferInProgress = false;
    }
  }

  // --- Shared link handlers ---

  private async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may fail in insecure contexts
    }
  }

  private openShareModal = async (item: SpaceItemResponse) => {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    this.shareModalItem = item;
    this.shareModalLinks = [];
    this.shareModalLoading = true;
    this.shareModalError = '';
    this.shareModalDeleteConfirmId = null;
    this.shareCopiedLinkId = null;
    this.shareModalQrOpenLinkId = null;
    this.shareModalQrGeneratingLinkId = null;
    this.shareModalQrCodeDataUrls = {};

    try {
      this.shareModalLinks = await getSharedLinks(
        this.serverUrl,
        this.spaceId,
        item.id,
        this.token,
      );
    } catch (error) {
      if (error instanceof SpaceApiError) {
        this.shareModalError = error.message;
      } else {
        this.shareModalError = 'Failed to load shared links.';
      }
    } finally {
      this.shareModalLoading = false;
    }
  };

  private closeShareModal = () => {
    this.shareModalItem = null;
    this.shareModalLinks = [];
    this.shareModalError = '';
    this.shareModalDeleteConfirmId = null;
    this.shareCopiedLinkId = null;
    this.shareModalQrOpenLinkId = null;
    this.shareModalQrGeneratingLinkId = null;
    this.shareModalQrCodeDataUrls = {};
    this.shareModalName = '';
  };

  private handleCreateShareLink = async () => {
    if (!this.serverUrl || !this.spaceId || !this.token || !this.shareModalItem) return;

    this.shareModalCreating = true;
    this.shareModalError = '';

    try {
      const name = this.shareModalName.trim() || undefined;
      const link = await createSharedLink(
        this.serverUrl,
        this.spaceId,
        this.shareModalItem.id,
        this.token,
        name,
      );
      this.shareModalLinks = [...this.shareModalLinks, link];
      this.shareModalName = '';

      // Open system share dialog for the new link
      await this.shareOrCopyLink(link);
    } catch (error) {
      if (error instanceof SpaceApiError) {
        this.shareModalError = error.message;
      } else {
        this.shareModalError = 'Failed to create shared link.';
      }
    } finally {
      this.shareModalCreating = false;
    }
  };

  private handleCopyShareLink = async (link: SharedLinkResponse) => {
    const shareUrl = this.serverUrl
      ? buildShareUrl(link.token, this.serverUrl)
      : `${window.location.origin}/shared/${link.token}`;
    await this.copyToClipboard(shareUrl);
    this.shareCopiedLinkId = link.id;
    setTimeout(() => {
      if (this.shareCopiedLinkId === link.id) {
        this.shareCopiedLinkId = null;
      }
    }, 1500);
  };

  private handleToggleShareLinkQrCode = async (link: SharedLinkResponse) => {
    if (this.shareModalQrOpenLinkId === link.id) {
      this.shareModalQrOpenLinkId = null;
      return;
    }

    this.shareModalQrOpenLinkId = link.id;
    this.shareModalError = '';

    if (this.shareModalQrCodeDataUrls[link.id]) {
      return;
    }

    const shareUrl = this.serverUrl
      ? buildShareUrl(link.token, this.serverUrl)
      : `${window.location.origin}/shared/${link.token}`;

    try {
      this.shareModalQrGeneratingLinkId = link.id;
      const qrCodeDataUrl = await toDataURL(shareUrl, {
        width: 512,
        margin: 1,
      });
      this.shareModalQrCodeDataUrls = {
        ...this.shareModalQrCodeDataUrls,
        [link.id]: qrCodeDataUrl,
      };
    } catch {
      this.shareModalError = 'Failed to generate QR code. Please try again.';
      if (this.shareModalQrOpenLinkId === link.id) {
        this.shareModalQrOpenLinkId = null;
      }
    } finally {
      if (this.shareModalQrGeneratingLinkId === link.id) {
        this.shareModalQrGeneratingLinkId = null;
      }
    }
  };

  private shareOrCopyLink = async (link: SharedLinkResponse) => {
    const shareUrl = this.serverUrl
      ? buildShareUrl(link.token, this.serverUrl)
      : `${window.location.origin}/shared/${link.token}`;
    const title = link.name || this.getItemPreviewLabel(this.shareModalItem!) || 'Shared item';

    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
        return;
      } catch {
        // User cancelled or share failed — fall back to clipboard
      }
    }

    await this.copyToClipboard(shareUrl);
    this.shareCopiedLinkId = link.id;
    setTimeout(() => {
      if (this.shareCopiedLinkId === link.id) {
        this.shareCopiedLinkId = null;
      }
    }, 1500);
  };

  private handleDeleteShareLink = async (link: SharedLinkResponse) => {
    if (!this.serverUrl || !this.spaceId || !this.token || !this.shareModalItem) return;

    try {
      await deleteSharedLink(
        this.serverUrl,
        this.spaceId,
        this.shareModalItem.id,
        link.id,
        this.token,
      );
      this.shareModalLinks = this.shareModalLinks.filter((l) => l.id !== link.id);
      this.shareModalDeleteConfirmId = null;
      if (this.shareModalQrOpenLinkId === link.id) {
        this.shareModalQrOpenLinkId = null;
      }
      if (this.shareModalQrGeneratingLinkId === link.id) {
        this.shareModalQrGeneratingLinkId = null;
      }
      const { [link.id]: removedQrCode, ...remainingQrCodes } = this.shareModalQrCodeDataUrls;
      void removedQrCode;
      this.shareModalQrCodeDataUrls = remainingQrCodes;
    } catch (error) {
      if (error instanceof SpaceApiError) {
        this.shareModalError = error.message;
      } else {
        this.shareModalError = 'Failed to delete shared link.';
      }
    }
  };

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    const size = bytes / Math.pow(1024, i);
    return `${i === 0 ? size : size.toFixed(1)} ${units[i]}`;
  }

  private formatTime(iso: string): string {
    try {
      const date = new Date(iso);
      return formatRelativeTime(date);
    } catch {
      return iso;
    }
  }

  // --- Rendering ---

  override render() {
    if (this.isLoading) {
      return html`
        <div class="flex w-full items-center justify-center py-16">
          <p class="text-sm text-slate-400">Loading space…</p>
        </div>
      `;
    }

    // Only block the view for auth errors (token revoked/invalid)
    if (this.errorMessage && this.connectionErrorType === 'auth') {
      return html`
        <div class="mx-auto max-w-lg space-y-4 py-8">
          <div class="rounded-lg border border-red-900/60 bg-red-950/40 p-4">
            <p class="mb-1 text-sm font-semibold text-red-300">
              Access Denied
            </p>
            <p class="text-sm text-red-400">${this.errorMessage}</p>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row">
            <button
              @click=${() => this.loadData()}
              class="flex-1 rounded-full border border-sky-700 bg-sky-900/30 px-5 py-2 text-sm font-semibold text-sky-300 transition hover:border-sky-600 hover:bg-sky-900/50"
            >
              Reconnect
            </button>
            <button
              @click=${() => this.removeSpace()}
              class="flex-1 rounded-full border border-red-700 bg-red-900/30 px-5 py-2 text-sm font-semibold text-red-300 transition hover:border-red-600 hover:bg-red-900/50"
            >
              Remove Space
            </button>
          </div>
        </div>
      `;
    }

    if (this.errorMessage && this.connectionErrorType === 'none') {
      return html`
        <div class="mx-auto max-w-lg space-y-4 py-8">
          <p class="text-sm text-red-400">${this.errorMessage}</p>
          <button
            @click=${() => this.loadData()}
            class="rounded-full bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
          >
            Retry
          </button>
        </div>
      `;
    }

    // For network errors, show banners but keep the compose box available
    return html`
      <div class="space-y-8">
        ${this.renderOfflineBanner()}
        ${this.renderServerUnreachableBanner()}
        ${this.renderSyncStatus()}
        ${this.showSettings ? this.renderSettingsPanel() : nothing}
        ${this.renderUploadArea()}
        ${this.renderItemsList()}
        ${this.modalItem ? this.renderModal() : nothing}
        ${this.filePreviewItem ? this.renderFilePreviewModal() : nothing}
        ${this.transferModalItem ? this.renderTransferModal() : nothing}
        ${this.shareModalItem ? this.renderShareModal() : nothing}
      </div>
    `;
  }

  private renderSyncStatus() {
    if (!this.syncMessage) return nothing;

    return html`
      <div
        class="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-300"
        role="status"
      >
        ✓ ${this.syncMessage}
      </div>
    `;
  }

  private renderOfflineBanner() {
    if (this.isOnline) return nothing;
    return html`
      <div class="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300" role="alert">
        <p class="font-medium">📡 You're offline</p>
        <p class="text-xs text-amber-400/80 mt-1">You can still share text and files — they'll upload when you're back online.</p>
      </div>
    `;
  }

  private renderServerUnreachableBanner() {
    if (this.connectionErrorType !== 'network' || !this.isOnline) return nothing;
    return html`
      <div class="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3" role="alert">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-red-300">⚠ Unable to reach the server</p>
            <p class="text-xs text-red-400/80 mt-1">Items you share will be queued and uploaded when the connection is restored.</p>
          </div>
          <button
            @click=${() => this.loadData()}
            class="shrink-0 rounded-full border border-sky-700 bg-sky-900/30 px-4 py-1.5 text-xs font-semibold text-sky-300 transition hover:border-sky-600 hover:bg-sky-900/50"
          >
            Reconnect
          </button>
        </div>
      </div>
    `;
  }

  private renderSettingsPanel() {
    return html`
      <div class="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-4">
        ${this.renderJournalSyncToggle()}
        <hr class="border-slate-700" />
        ${this.renderLeaveSpace()}
      </div>
    `;
  }

  private renderJournalSyncToggle() {
    return html`
      <div>
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-slate-200">
              Large Space Mode
            </p>
            <p class="text-xs text-slate-500">
              Cache items in this browser and catch up with journal sync before live updates.
            </p>
          </div>
          <button
            @click=${this.toggleJournalSync}
            ?disabled=${this.journalSyncLoading}
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${this
              .journalSyncEnabled
              ? 'bg-sky-600'
              : 'bg-slate-700'}"
            role="switch"
            aria-checked=${this.journalSyncEnabled}
            aria-label="Toggle large space mode"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${this
                .journalSyncEnabled
                ? 'translate-x-6'
                : 'translate-x-1'}"
            ></span>
          </button>
        </div>
        ${this.journalSyncEnabled ? this.renderCacheUsage() : nothing}
      </div>
    `;
  }

  private renderCacheUsage() {
    const status = this.cacheStorageStatus;
    if (!status) return nothing;

    const usedLabel = this.formatFileSize(status.used);
    const budgetLabel = this.formatFileSize(status.budget);
    const percent = status.budget > 0
      ? Math.min(100, Math.round((status.used / status.budget) * 100))
      : 0;

    return html`
      <div class="mt-3 border-t border-slate-800 pt-3" data-testid="cache-usage">
        <div class="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>Cached files</span>
          <span class="text-slate-300">
            ${usedLabel} / ${budgetLabel}
          </span>
        </div>
        <div
          class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${percent}
          aria-label="Cached files usage"
        >
          <div
            class="h-full bg-sky-500 transition-all"
            style="width: ${percent}%"
          ></div>
        </div>
        <p class="mt-2 text-[11px] text-slate-500">
          ${this.storagePersisted
            ? 'Storage is persistent: cached files survive browser cleanup.'
            : 'Storage is best-effort: the browser may evict cached files when disk space runs low.'}
        </p>
      </div>
    `;
  }

  private renderLeaveSpace() {
    return html`
      <div>
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-slate-200">Leave Space</p>
            <p class="text-xs text-slate-500">
              Remove this space from your device. Your shared items will remain on the server.
            </p>
          </div>
          ${this.leaveConfirm
            ? html`
              <div class="flex shrink-0 gap-2">
                <button
                  @click=${() => this.removeSpace()}
                  class="rounded-full border border-red-700 bg-red-900/30 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:border-red-600 hover:bg-red-900/50"
                >
                  Confirm
                </button>
                <button
                  @click=${() => { this.leaveConfirm = false; }}
                  class="rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            `
            : html`
              <button
                @click=${() => { this.leaveConfirm = true; }}
                class="shrink-0 rounded-full border border-red-700 bg-red-900/30 px-4 py-1.5 text-xs font-semibold text-red-300 transition hover:border-red-600 hover:bg-red-900/50"
              >
                Leave
              </button>
            `}
        </div>
      </div>
    `;
  }

  private renderComposeQueue() {
    const pendingShares = this.visiblePendingShares;
    const hasPending = this.composeItems.some((entry) => entry.status === 'pending');
    const canSyncOffline = this.isOnline && this.connectionErrorType !== 'network';

    return html`
      <div class="border-t border-slate-800">
        ${this.composeItems.map((entry, index) =>
          this.renderComposeRow(entry, index))}
        ${hasPending
          ? html`
            <div
              class="flex items-center justify-between gap-2 border-t border-slate-800/60 px-3 py-1.5"
            >
              <span class="text-xs font-medium text-sky-300/80">
                Pending upload
              </span>
              ${canSyncOffline
                ? html`
                  <button
                    @click=${() => this.syncOfflineQueue()}
                    ?disabled=${this.isUploading}
                    class="rounded px-2 py-1 text-xs font-medium text-sky-400 transition hover:text-sky-300 disabled:opacity-50"
                  >
                    Sync Now
                  </button>
                `
                : html`
                  <span class="text-xs text-slate-500">
                    ${this.isOnline
                      ? 'Will retry when reachable'
                      : 'Will upload when back online'}
                  </span>
                `}
            </div>
          `
          : nothing}
        ${pendingShares.length > 0
          ? html`
            <div
              class="flex items-center justify-between gap-2 border-t border-slate-800/60 px-3 py-1.5"
            >
              <span class="text-xs font-medium text-amber-300/80">
                Shared from other apps
              </span>
              <button
                @click=${() => this.uploadAllPendingShares()}
                ?disabled=${this.isUploading}
                class="rounded px-2 py-1 text-xs font-medium text-sky-400 transition hover:text-sky-300 disabled:opacity-50"
              >
                Upload all
              </button>
            </div>
            ${pendingShares.map((share) =>
              this.renderComposePendingShareRow(share))}
          `
          : nothing}
        ${this.composeQueueError
          ? html`<p class="px-4 py-2 text-xs text-red-400">${this.composeQueueError}</p>`
          : nothing}
      </div>
    `;
  }

  // Renders a single unified compose row. File rows expose an editable name
  // (rename + remove); text rows are display-only with remove. Drafts and
  // pending uploads share this layout, differing only by their status sub-label.
  private renderComposeRow(entry: ComposeEntry, index: number) {
    const locked = this.isUploading || this.uploadingComposeItemIds.has(entry.id);
    const subLabel =
      entry.status === 'pending' ? 'Pending upload' : 'Queued for upload';

    if (entry.type === 'text') {
      const icon = getTextItemIcon();
      return html`
        <div class="flex items-center gap-3 border-t border-slate-800/60 px-3 py-2 first:border-t-0">
          <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
            ${icon.svg}
          </div>
          <div class="min-w-0 flex-1 px-1">
            <p class="truncate text-sm font-medium text-slate-200">
              ${(entry.content ?? entry.name ?? '').substring(0, 100)}
            </p>
            <p class="text-xs text-slate-500">${subLabel}</p>
          </div>
          <button
            @click=${() => this.removeComposeEntryByUser(entry.id)}
            ?disabled=${locked}
            class="shrink-0 rounded p-1.5 text-slate-500 transition hover:text-red-400 disabled:opacity-50"
            title="Remove"
            aria-label="Remove pending text item"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;
    }

    const icon = getFileTypeIcon(entry.name || 'file');
    const inputId = `compose-draft-input-${index}`;
    const sizeLabel =
      entry.fileSize !== undefined ? ` · ${this.formatFileSize(entry.fileSize)}` : '';

    return html`
      <div class="flex items-center gap-3 border-t border-slate-800/60 px-3 py-2 first:border-t-0">
        <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
          ${icon.svg}
        </div>
        <div class="min-w-0 flex-1">
          <input
            id=${inputId}
            type="text"
            .value=${entry.name}
            @input=${(e: Event) =>
              this.handleComposeNameInput(
                entry.id,
                (e.target as HTMLInputElement).value,
              )}
            @change=${() => this.persistComposeName(entry.id)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            ?disabled=${locked}
            aria-label=${`Filename for ${entry.name}`}
            class="w-full truncate rounded border-0 bg-transparent px-1 py-0.5 text-sm font-medium text-slate-200 transition focus:outline-none disabled:opacity-50"
          />
          <p class="truncate px-1 text-xs text-slate-500" title=${entry.name}>
            ${subLabel}${sizeLabel}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            @click=${() => this.focusComposeDraftInput(index)}
            ?disabled=${locked}
            class="rounded p-1.5 text-slate-500 transition hover:text-sky-400 disabled:opacity-50"
            title="Rename"
            aria-label=${`Rename ${entry.name}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
          </button>
          <button
            @click=${() => this.removeComposeEntryByUser(entry.id)}
            ?disabled=${locked}
            class="rounded p-1.5 text-slate-500 transition hover:text-red-400 disabled:opacity-50"
            title="Remove"
            aria-label=${`Remove ${entry.name}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
    `;
  }

  private renderComposePendingShareRow(share: PendingShareItem) {
    const icon = share.type === 'file'
      ? getFileTypeIcon(share.fileName ?? 'file')
      : getTextItemIcon();
    const label = share.type === 'file'
      ? share.fileName ?? 'File'
      : (share.content ?? '').substring(0, 100);

    return html`
      <div class="flex items-center gap-3 border-t border-slate-800/60 px-3 py-2">
        <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
          ${icon.svg}
        </div>
        <div class="min-w-0 flex-1 px-1">
          <p class="truncate text-sm font-medium text-slate-200">${label}</p>
          <p class="text-xs text-slate-500">Shared from another app</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            @click=${() => this.requestPendingShareUpload(share)}
            ?disabled=${this.isUploading}
            class="rounded px-3 py-1.5 text-xs font-medium text-sky-400 transition hover:text-sky-300 disabled:opacity-50"
            title="Upload this item"
          >
            Upload
          </button>
          <button
            @click=${() => this.dismissPendingShare(share)}
            ?disabled=${this.isUploading}
            class="rounded p-1.5 text-slate-500 transition hover:text-red-400 disabled:opacity-50"
            title="Dismiss"
            aria-label="Dismiss shared item"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
    `;
  }

  private renderUploadArea() {
    return html`
      <section class="space-y-3">
        <!-- Compact compose box -->
        <div
          @drop=${this.handleDrop}
          class="relative rounded-lg border bg-slate-900 transition ${this
            .dragOver
            ? 'border-sky-400 ring-2 ring-sky-400/20'
            : 'border-slate-700 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/20'}"
        >
          <!-- Drag-and-drop overlay -->
          ${this.dragOver
            ? html`
              <div
                class="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-sky-400 bg-sky-950/80 backdrop-blur-sm"
              >
                <p class="text-sm font-medium text-sky-300">Drop files here</p>
              </div>
            `
            : nothing}

          <!-- Textarea -->
          <textarea
            rows="3"
            placeholder="Share some text…"
            aria-label="Text to share"
            .value=${this.textInput}
            @input=${this.handleTextInput}
            @keydown=${this.handleTextKeydown}
            @paste=${this.handleTextareaPaste}
            ?disabled=${this.isUploading}
            class="w-full resize-none rounded-t-lg border-0 bg-transparent px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
          ></textarea>

          <!-- Inline compose queue (files to rename, pending text shares,
               shares folded in from other apps, and the offline upload
               queue folded in as display-only rows) -->
          ${this.hasComposeContent ? this.renderComposeQueue() : nothing}

          <!-- Action bar -->
          <div
            class="flex items-center justify-between gap-2 border-t border-slate-800 px-3 py-2"
          >
            <div class="flex items-center gap-2">
              <!-- File upload button -->
              <button
                @click=${this.triggerFileSelect}
                ?disabled=${this.isUploading}
                class="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                title="Upload files"
                aria-label="Upload files"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                </svg>
                <span class="hidden sm:inline">Files</span>
              </button>
              <input
                type="file"
                multiple
                @change=${this.handleFileSelect}
                ?disabled=${this.isUploading}
                class="hidden"
                aria-label="Upload files input"
                id="file-input-hidden"
              />
            </div>

            <div class="flex items-center gap-2">
              <span class="hidden text-xs text-slate-500 sm:inline">${modifierKey}+Enter</span>
              <button
                @click=${this.handleComposeShare}
                ?disabled=${this.isUploading ||
                (!this.textInput.trim() && !this.hasComposeQueue)}
                class="rounded-full bg-sky-400 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ${this.isUploading ? 'Sending…' : 'Share'}
              </button>
            </div>
          </div>
        </div>

        <!-- Upload error -->
        ${this.uploadError
          ? html`<p class="text-sm text-red-400">${this.uploadError}</p>`
          : nothing}
      </section>
    `;
  }

  private renderItemsList() {
    // Show inline error if network error and no items loaded
    if (this.items.length === 0 && this.connectionErrorType === 'network') {
      return html`
        <section class="space-y-3">
          <p
            class="sticky z-10 bg-slate-950 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
            style="top: var(--header-height, 0px)"
          >
            Shared items
          </p>
          <p class="py-4 text-center text-sm text-slate-500">
            Unable to load items — server unreachable
          </p>
        </section>
      `;
    }

    if (this.items.length === 0) {
      return html`
        <section class="space-y-3">
          <p
            class="sticky z-10 bg-slate-950 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
            style="top: var(--header-height, 0px)"
          >
            Shared items
          </p>
          <p class="py-4 text-center text-sm text-slate-500">
            No items shared yet. Be the first!
          </p>
        </section>
      `;
    }

    return html`
      <section class="space-y-3">
        <p
          class="sticky z-10 bg-slate-950 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
          style="top: var(--header-height, 0px)"
        >
          Shared items
          <span class="ml-1 text-slate-600">(${this.items.length})</span>
        </p>

        <ul class="space-y-2">
          ${this.items.map((item) => this.renderItemCard(item))}
        </ul>
      </section>
    `;
  }

  /**
   * Renders a unified item card layout used for both shared items and pending shares.
   * Prevents layout drift between different item display contexts.
   */
  private renderUnifiedItemCard(
    content: TemplateResult | typeof nothing,
    overlay?: TemplateResult | typeof nothing,
    borderClass = 'border-slate-800',
    bgClass = 'bg-slate-900/60',
  ) {
    return html`
      <li
        class="relative rounded-lg border ${borderClass} ${bgClass} px-4 py-3"
      >
        <div class="flex items-center gap-3">
          ${content}
        </div>
        ${overlay ?? nothing}
      </li>
    `;
  }

  private renderItemCard(item: SpaceItemResponse) {
    const isFile = item.contentType === 'file';
    const content = isFile ? this.renderFileContent(item) : this.renderTextContent(item);

    return this.renderUnifiedItemCard(content);
  }

  private renderCopyButton(item: SpaceItemResponse) {
    const copied = this.copiedItemIds.has(item.id);
    return html`
      <button
        @click=${() => this.handleCopy(item)}
        class="cursor-pointer rounded p-2 text-slate-500 transition hover:text-slate-300"
        title=${copied ? 'Copied!' : 'Copy to clipboard'}
        aria-label=${copied ? 'Copied to clipboard' : 'Copy text to clipboard'}
      >
        ${copied
          ? html`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-400"><polyline points="20 6 9 17 4 12"></polyline></svg>`
          : html`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`}
      </button>
    `;
  }

  private renderManageLinksButton(item: SpaceItemResponse) {
    return html`
      <button
        @click=${() => this.openShareModal(item)}
        class="cursor-pointer rounded p-2 text-slate-500 transition hover:text-violet-400"
        title="Shared links"
        aria-label="Shared links"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>
    `;
  }

  private renderDeleteButton(item: SpaceItemResponse) {
    return html`
      <button
        @click=${() => this.handleDeleteRequest(item)}
        class="cursor-pointer rounded p-2 text-slate-500 transition hover:text-red-400"
        title="Delete item"
        aria-label="Delete item"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>
    `;
  }

  private renderDownloadButton(item: SpaceItemResponse) {
    return html`
      <button
        @click=${() => this.handleDownload(item)}
        class="cursor-pointer rounded p-2 text-slate-500 transition hover:text-slate-300"
        title="Download file"
        aria-label="Download file"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </button>
    `;
  }

  private renderSendToButton(item: SpaceItemResponse) {
    const availableSpaces = this.getAvailableTransferSpaces();
    if (availableSpaces.length === 0) {
      return nothing;
    }

    return html`
      <button
        @click=${() => this.openTransferModal(item)}
        class="cursor-pointer rounded p-2 text-slate-500 transition hover:text-sky-400"
        title="Send to another space"
        aria-label="Send to another space"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
      </button>
    `;
  }

  private toggleKebabMenu(itemId: string) {
    this.openMenuItemId = this.openMenuItemId === itemId ? null : itemId;
  }

  private renderKebabMenu(item: SpaceItemResponse) {
    const isOpen = this.openMenuItemId === item.id;
    const availableSpaces = this.getAvailableTransferSpaces();
    const hasSendTo = availableSpaces.length > 0;

    return html`
      <div class="relative" data-kebab-menu>
        <button
          @click=${(e: Event) => { e.stopPropagation(); this.toggleKebabMenu(item.id); }}
          class="cursor-pointer rounded p-2 text-slate-500 transition hover:text-slate-300"
          title="More actions"
          aria-label="More actions"
          aria-expanded=${isOpen}
          aria-haspopup="true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
        </button>
        ${isOpen ? html`
          <div class="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg">
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-slate-100 cursor-pointer"
              @click=${() => { this.openMenuItemId = null; this.openShareModal(item); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              Manage Links
            </button>
            ${hasSendTo ? html`
              <button
                class="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-slate-100 cursor-pointer"
                @click=${() => { this.openMenuItemId = null; this.openTransferModal(item); }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                Send To
              </button>
            ` : nothing}
            <div class="my-1 border-t border-slate-700"></div>
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-slate-700 hover:text-red-300 cursor-pointer"
              @click=${() => { this.handleDeleteRequest(item); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              Delete
            </button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  private renderTextContent(item: SpaceItemResponse) {
    const icon = getTextItemIcon();
    const isDeleting = this.deleteConfirmItemId === item.id;
    return html`
      <!-- Left: Icon -->
      <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
        ${icon.svg}
      </div>
      <!-- Center: Content -->
      <div class="min-w-0 flex-1">
        <p
          class="cursor-pointer truncate text-slate-200 hover:text-slate-100"
          @click=${() => this.handleTextClick(item)}
          title="Click to view full text"
        >
          ${item.content}
        </p>
        <p class="text-xs text-slate-500">
          <time datetime=${item.sharedAt}>${this.formatTime(item.sharedAt)}</time>
        </p>
      </div>
      <!-- Right: Actions -->
      <div class="-mr-2 flex shrink-0 items-center gap-1">
        ${isDeleting
          ? this.renderDeleteConfirmActions(item)
          : html`
            <!-- Desktop: all buttons inline -->
            <div class="hidden sm:flex items-center gap-1">
              ${this.renderCopyButton(item)}
              ${this.renderManageLinksButton(item)}
              ${this.renderSendToButton(item)}
              ${this.renderDeleteButton(item)}
            </div>
            <!-- Mobile: primary + kebab -->
            <div class="flex sm:hidden items-center gap-1">
              ${this.renderCopyButton(item)}
              ${this.renderKebabMenu(item)}
            </div>
          `}
      </div>
    `;
  }

  private renderFileContent(item: SpaceItemResponse) {
    const icon = getFileTypeIcon(item.content);
    const canPreview = isPreviewable(item.content);
    const isDeleting = this.deleteConfirmItemId === item.id;
    return html`
      <!-- Left: Icon -->
      <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
        ${icon.svg}
      </div>
      <!-- Center: Content -->
      <div class="min-w-0 flex-1">
        ${canPreview
          ? html`<button
              type="button"
              class="cursor-pointer truncate text-sm font-medium text-slate-200 hover:text-slate-100 bg-transparent border-none p-0 text-left w-full"
              title=${item.content}
              aria-label=${'Click to preview ' + item.content}
              @click=${() => this.handleFilePreviewClick(item)}
            >${item.content}</button>`
          : html`<p class="truncate text-sm font-medium text-slate-200" title=${item.content}>${item.content}</p>`
        }
        <p class="text-xs text-slate-500">
          ${this.formatFileSize(item.fileSize)} · <time datetime=${item.sharedAt}>${this.formatTime(item.sharedAt)}</time>
        </p>
      </div>
      <!-- Right: Actions -->
      <div class="-mr-2 flex shrink-0 items-center gap-1">
        ${isDeleting
          ? this.renderDeleteConfirmActions(item)
          : html`
            <!-- Desktop: all buttons inline -->
            <div class="hidden sm:flex items-center gap-1">
              ${this.renderDownloadButton(item)}
              ${this.renderManageLinksButton(item)}
              ${this.renderSendToButton(item)}
              ${this.renderDeleteButton(item)}
            </div>
            <!-- Mobile: primary + kebab -->
            <div class="flex sm:hidden items-center gap-1">
              ${this.renderDownloadButton(item)}
              ${this.renderKebabMenu(item)}
            </div>
          `}
      </div>
    `;
  }

  private getItemPreviewLabel(item: SpaceItemResponse): string {
    if (item.contentType === 'file') {
      return item.content;
    }
    const maxLen = 40;
    const text = item.content.trim();
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).trimEnd() + '…';
  }

  private renderDeleteConfirmActions(item: SpaceItemResponse) {
    return html`
      <button
        @click=${() => this.confirmDelete(item)}
        class="cursor-pointer rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500"
      >
        Delete
      </button>
      <button
        @click=${this.cancelDelete}
        class="cursor-pointer rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
      >
        Cancel
      </button>
    `;
  }

  private renderModal() {
    if (!this.modalItem) return nothing;

    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        @click=${this.closeModal}
      >
        <div
          class="relative mx-4 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-6"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <h3 class="text-lg font-semibold text-white">Full Text</h3>
            <button
              @click=${this.closeModal}
              class="rounded p-1 text-slate-400 transition hover:text-white"
              aria-label="Close modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <p class="whitespace-pre-wrap break-words text-start text-sm text-slate-200">${this.modalItem.content}</p>
        </div>
      </div>
    `;
  }

  private renderFilePreviewContent() {
    if (this.filePreviewLoading) {
      return html`
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="ml-3 text-sm text-slate-400">Loading preview…</span>
        </div>
      `;
    }

    if (this.filePreviewError) {
      return html`
        <div class="flex flex-col items-center gap-4 py-8 text-center">
          <p class="text-sm text-slate-400">${this.filePreviewError}</p>
          ${this.filePreviewItem
            ? html`
                <button
                  @click=${() => this.handleDownload(this.filePreviewItem!)}
                  class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Download instead
                </button>
              `
            : nothing}
        </div>
      `;
    }

    switch (this.filePreviewType) {
      case 'image':
        return html`
          <div class="flex items-center justify-center">
            <img
              src=${this.filePreviewUrl!}
              alt=${this.filePreviewItem?.content ?? 'Image preview'}
              class="max-h-[60vh] max-w-full rounded object-contain"
            />
          </div>
        `;

      case 'video':
        return html`
          <div class="flex items-center justify-center">
            <video
              src=${this.filePreviewUrl!}
              controls
              class="max-h-[60vh] max-w-full rounded"
            >
              Your browser does not support video playback.
            </video>
          </div>
        `;

      case 'audio':
        return html`
          <div class="flex items-center justify-center py-4">
            <audio src=${this.filePreviewUrl!} controls class="w-full max-w-md">
              Your browser does not support audio playback.
            </audio>
          </div>
        `;

      case 'pdf':
        return html`
          <iframe
            src=${this.filePreviewUrl!}
            class="h-[60vh] w-full rounded border border-slate-700"
            title=${this.filePreviewItem?.content ?? 'PDF preview'}
          ></iframe>
        `;

      case 'text':
        return html`
          <p class="whitespace-pre-wrap break-words text-start font-mono text-sm text-slate-200">${this.filePreviewText}</p>
        `;

      default:
        return nothing;
    }
  }

  private renderFilePreviewModal() {
    if (!this.filePreviewItem) return nothing;

    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        @click=${this.closeFilePreview}
      >
        <div
          class="relative w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col rounded-lg border border-slate-700 bg-slate-900"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="shrink-0 flex items-start justify-between gap-4 p-6 pb-0 mb-4">
            <h3 class="min-w-0 flex-1 truncate text-lg font-semibold text-white" title=${this.filePreviewItem.content}>
              ${this.filePreviewItem.content}
            </h3>
            <div class="flex shrink-0 items-center gap-2">
              <button
                @click=${() => this.handleDownload(this.filePreviewItem!)}
                class="rounded p-1 text-slate-400 transition hover:text-white"
                title="Download file"
                aria-label="Download file"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
              <button
                @click=${this.closeFilePreview}
                class="rounded p-1 text-slate-400 transition hover:text-white"
                aria-label="Close preview"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
          <div class="overflow-y-auto flex-1 min-h-0 px-6 pb-6">
            ${this.renderFilePreviewContent()}
          </div>
        </div>
      </div>
    `;
  }

  private renderShareModal() {
    if (!this.shareModalItem) return nothing;

    const itemPreview = this.getItemPreviewLabel(this.shareModalItem);

    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        @click=${this.closeShareModal}
      >
        <div
          class="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-6"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-semibold text-white mb-1">Shared links</h3>
              <p class="text-sm text-slate-400 truncate">${itemPreview}</p>
            </div>
            <button
              @click=${this.closeShareModal}
              class="shrink-0 rounded p-1 text-slate-400 transition hover:text-white"
              aria-label="Close modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          ${this.shareModalError
            ? html`
                <div class="mb-4 rounded-lg border border-red-500/50 bg-red-950/40 p-3">
                  <p class="text-sm text-red-300">${this.shareModalError}</p>
                </div>
              `
            : nothing}

          ${this.shareModalLoading
            ? html`
                <div class="flex items-center justify-center py-8">
                  <p class="text-sm text-slate-400">Loading links…</p>
                </div>
              `
            : html`
                <div class="space-y-3">
                  ${this.shareModalLinks.length === 0
                    ? html`<p class="py-4 text-center text-sm text-slate-500">No shared links yet.</p>`
                    : this.shareModalLinks.map((link) => this.renderShareLinkItem(link))}

                  <div class="space-y-2">
                    <input
                      type="text"
                      .value=${this.shareModalName}
                      @input=${(e: Event) => {
                        this.shareModalName = (e.target as HTMLInputElement).value;
                        this.shareModalError = '';
                      }}
                      ?disabled=${this.shareModalCreating}
                      placeholder="Link name (optional)"
                      maxlength="200"
                      aria-label="Link name"
                      class="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 transition focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <button
                      @click=${this.handleCreateShareLink}
                      ?disabled=${this.shareModalCreating}
                      class="w-full cursor-pointer rounded-md bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ${this.shareModalCreating ? 'Creating…' : 'Create new link'}
                    </button>
                  </div>
                </div>
              `}
        </div>
      </div>
    `;
  }

  private renderShareLinkItem(link: SharedLinkResponse) {
    const shareUrl = this.serverUrl
      ? buildShareUrl(link.token, this.serverUrl)
      : `${window.location.origin}/shared/${link.token}`;
    const isCopied = this.shareCopiedLinkId === link.id;
    const isConfirming = this.shareModalDeleteConfirmId === link.id;
    const isQrVisible = this.shareModalQrOpenLinkId === link.id;
    const isQrGenerating = this.shareModalQrGeneratingLinkId === link.id;
    const qrCodeDataUrl = this.shareModalQrCodeDataUrls[link.id];

    return html`
      <div class="relative overflow-hidden rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2.5">
        <div class="flex items-center gap-3">
          <!-- Left: Link icon -->
          <div class="shrink-0 text-sky-400" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          </div>
          <!-- Center: Name + URL -->
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-slate-200" title=${link.name || shareUrl}>
              ${link.name || 'Unnamed link'}
            </p>
            <p class="truncate text-xs text-slate-500" title=${shareUrl}>
              ${shareUrl} · <time datetime=${link.createdAt}>${this.formatTime(link.createdAt)}</time>
            </p>
          </div>
          <!-- Right: Actions -->
          <div class="-mr-1 flex shrink-0 items-center gap-0.5">
            <button
              @click=${() => this.shareOrCopyLink(link)}
              class="cursor-pointer rounded p-1.5 text-slate-500 transition hover:text-sky-400"
              title="Share"
              aria-label="Share link"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
            </button>
            <button
              @click=${() => this.handleCopyShareLink(link)}
              class="cursor-pointer rounded p-1.5 transition ${isCopied
                ? 'text-emerald-400'
                : 'text-slate-500 hover:text-slate-300'}"
              title=${isCopied ? 'Copied!' : 'Copy link URL'}
              aria-label=${isCopied ? 'Copied to clipboard' : 'Copy link URL'}
            >
              ${isCopied
                ? html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                : html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`}
            </button>
            <button
              @click=${() => this.handleToggleShareLinkQrCode(link)}
              ?disabled=${isQrGenerating}
              class="cursor-pointer rounded p-1.5 transition disabled:cursor-not-allowed disabled:opacity-50 ${isQrVisible
                ? 'text-sky-400'
                : 'text-slate-500 hover:text-sky-400'}"
              title=${isQrVisible ? 'Hide QR code' : 'Show QR code'}
              aria-label=${isQrVisible ? 'Hide link QR code' : 'Show link QR code'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="5"></rect><rect x="16" y="3" width="5" height="5"></rect><rect x="3" y="16" width="5" height="5"></rect><path d="M21 16h-3v3h3v2h-5v-5h5v-2z"></path><path d="M11 3h2v2h-2z"></path><path d="M11 7h2v2h-2z"></path><path d="M11 11h2v2h-2z"></path><path d="M3 11h2v2H3z"></path><path d="M7 11h2v2H7z"></path></svg>
            </button>
            <button
              @click=${() => { this.shareModalDeleteConfirmId = link.id; }}
              class="cursor-pointer rounded p-1.5 text-slate-500 transition hover:text-red-400"
              title="Delete link"
              aria-label="Delete shared link"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
        ${isQrVisible
          ? html`
              <div class="mt-3 border-t border-slate-700/60 pt-3">
                ${isQrGenerating
                  ? html`<p class="text-center text-xs text-slate-400">Generating QR code…</p>`
                  : qrCodeDataUrl
                    ? html`
                        <div class="flex justify-center">
                          <img
                            src=${qrCodeDataUrl}
                            alt="Shared link QR code"
                            class="h-40 w-40 rounded-md border border-slate-700 bg-white p-2"
                          />
                        </div>
                      `
                    : nothing}
              </div>
            `
          : nothing}
        ${isConfirming
          ? html`
              <div class="absolute inset-0 z-10 flex items-center justify-center gap-3 rounded-lg bg-slate-900/95 px-3 py-2.5 backdrop-blur-sm">
                <p class="text-xs text-slate-300">Delete this link?</p>
                <div class="flex gap-2">
                  <button
                    @click=${() => this.handleDeleteShareLink(link)}
                    class="cursor-pointer rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-500"
                  >Delete</button>
                  <button
                    @click=${() => { this.shareModalDeleteConfirmId = null; }}
                    class="cursor-pointer rounded-md border border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                  >Cancel</button>
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private renderTransferModal() {
    if (!this.transferModalItem) return nothing;

    const availableSpaces = this.getAvailableTransferSpaces();
    const itemPreview = this.getItemPreviewLabel(this.transferModalItem);

    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        @click=${this.closeTransferModal}
      >
        <div
          class="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-6"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-semibold text-white mb-1">Send to…</h3>
              <p class="text-sm text-slate-400 truncate">${itemPreview}</p>
            </div>
            <button
              @click=${this.closeTransferModal}
              class="shrink-0 rounded p-1 text-slate-400 transition hover:text-white"
              aria-label="Close modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          ${this.transferError
            ? html`
                <div class="mb-4 rounded-lg border border-red-500/50 bg-red-950/40 p-3">
                  <p class="text-sm text-red-300">${this.transferError}</p>
                </div>
              `
            : nothing}

          ${availableSpaces.length === 0
            ? html`
                <p class="text-sm text-slate-400">
                  You need to join at least one more space to transfer items.
                </p>
              `
            : html`
                <div class="space-y-2">
                  ${availableSpaces.map(
                    (space) => html`
                      <div
                        class="rounded-lg bg-slate-800/40 p-4"
                      >
                        <p class="mb-3 font-medium text-slate-200">
                          ${space.spaceName}
                        </p>
                        <div class="flex gap-2">
                          <button
                            @click=${() => this.handleTransfer(space, 'copy')}
                            ?disabled=${this.transferInProgress}
                            class="flex-1 cursor-pointer rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            ${this.transferInProgress ? 'Copying…' : 'Copy here'}
                          </button>
                          <button
                            @click=${() => this.handleTransfer(space, 'move')}
                            ?disabled=${this.transferInProgress}
                            class="flex-1 cursor-pointer rounded-md border border-slate-600 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            ${this.transferInProgress ? 'Moving…' : 'Move here'}
                          </button>
                        </div>
                      </div>
                    `,
                  )}
                </div>
              `}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'space-view': SpaceView;
  }
}
