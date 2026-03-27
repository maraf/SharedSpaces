import { html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { BaseElement } from '../../lib/base-element';
import type { AppViewChangeDetail } from '../../lib/navigation';
import { getToken, removeToken } from '../../lib/token-storage';
import { formatRelativeTime } from '../../lib/format-time';
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
  SpaceApiError,
  type SpaceItemResponse,
} from './space-api';
import {
  getPendingShares,
  removePendingShare,
  clearOfflineQueueForSpace,
  getOfflineQueueForSpace,
  removeFromOfflineQueue,
  type PendingShareItem,
  type OfflineQueueItem,
} from '../../lib/idb-storage';
import { requestBackgroundSync } from '../../lib/sw-registration';
import { getFileTypeIcon, getTextItemIcon } from '../../lib/file-icons';
import {
  queueForOffline,
  processOfflineQueue,
} from '../../lib/offline-sync';

export interface JoinedSpace {
  serverUrl: string;
  spaceId: string;
  spaceName: string;
  token: string;
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
  @state() private offlineQueueCount = 0;
  @state() private offlineQueueItems: OfflineQueueItem[] = [];
  @state() private syncMessage = '';
  @state() private deleteConfirmItemId: string | null = null;
  @state() private transferModalItem: SpaceItemResponse | null = null;
  @state() private transferInProgress = false;
  @state() private transferError = '';

  private token?: string;
  private lastLoadedKey = '';
  private signalRClient?: SignalRClient;
  private pendingItemIds = new Set<string>();
  private dragCounter = 0;

  private handleOnline = async () => {
    this.isOnline = true;
    const synced = await requestBackgroundSync();
    if (!synced) {
      this.syncOfflineQueue();
    }
  };
  private handleOffline = () => { this.isOnline = false; };
  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.connectionState === 'disconnected') {
      this.startSignalR().catch((error) => {
        console.error('Failed to start SignalR after visibility change', error);
      });
    }
  };
  private handleSwMessage = (event: MessageEvent) => {
    if (event.data?.type === 'pending-share-added') {
      this.loadPendingShares();
    }
    if (event.data?.type === 'offline-queue-sync-requested') {
      this.syncOfflineQueue();
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
    this.loadPendingShares();
    this.refreshOfflineQueue();
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
  }

  private resolveToken(): string | undefined {
    if (this.serverUrl && this.spaceId) {
      return getToken(this.serverUrl, this.spaceId);
    }
    return undefined;
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
    removeToken(this.serverUrl, this.spaceId);

    // Clear any queued offline items for this space
    await clearOfflineQueueForSpace(this.serverUrl, this.spaceId).catch(() => {});
    
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

    this.token = this.resolveToken();
    if (!this.token) {
      this.redirectToJoin();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.connectionErrorType = 'none';

    // Refresh offline queue and pending shares for the current space
    await Promise.all([
      this.refreshOfflineQueue(),
      this.loadPendingShares(),
    ]);

    try {
      const itemList = await getItems(this.serverUrl, this.spaceId, this.token);
      this.items = itemList;
      
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
        
        // On reconnect, refresh items to catch any missed events
        if (state === 'connected') {
          this.refreshItemsAfterReconnect();
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
  }

  private handleItemDeleted(payload: ItemDeletedPayload) {
    // Remove item from list (silently ignore if not found)
    this.items = this.items.filter((item) => item.id !== payload.id);
  }

  private async refreshItemsAfterReconnect() {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    try {
      const itemList = await getItems(this.serverUrl, this.spaceId, this.token);
      this.items = itemList;
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

  private async dismissOfflineQueueItem(item: OfflineQueueItem) {
    try {
      await removeFromOfflineQueue(item.id);
      this.offlineQueueItems = this.offlineQueueItems.filter((i) => i.id !== item.id);
      this.offlineQueueCount = this.offlineQueueItems.length;
    } catch {
      // IndexedDB may not be available
    }
  }

  // --- Offline Queue ---

  private async refreshOfflineQueue() {
    if (!this.serverUrl || !this.spaceId) return;
    try {
      const items = await getOfflineQueueForSpace(this.serverUrl, this.spaceId);
      // Strip fileData to avoid keeping large ArrayBuffers in reactive state
      const lightweight = items.map(({ fileData: _fileData, ...rest }) => rest);
      this.offlineQueueItems = lightweight;
      this.offlineQueueCount = lightweight.length;
    } catch {
      // IndexedDB may not be available
    }
  }

  private async enqueueForOffline(
    type: 'text' | 'file',
    options: { content?: string; fileName?: string; fileType?: string; fileData?: ArrayBuffer },
  ) {
    if (!this.serverUrl || !this.spaceId) return;
    await queueForOffline(this.serverUrl, this.spaceId, type, options);
    await this.refreshOfflineQueue();
  }

  private async syncOfflineQueue() {
    if (!navigator.onLine || !this.token || !this.serverUrl || !this.spaceId) return;

    try {
      const result = await processOfflineQueue(this.serverUrl, this.spaceId, this.token);
      await this.refreshOfflineQueue();

      if (result.synced > 0 || result.failed > 0) {
        if (result.synced > 0 && result.failed > 0) {
          this.syncMessage = `Synced ${result.synced} item${result.synced !== 1 ? 's' : ''}, ${result.failed} failed`;
        } else if (result.synced > 0) {
          this.syncMessage = `${result.synced} queued item${result.synced !== 1 ? 's' : ''} uploaded`;
        } else {
          this.syncMessage = `${result.failed} queued item${result.failed !== 1 ? 's' : ''} failed to upload`;
        }

        if (result.synced > 0) {
          this.refreshItemsAfterReconnect();
        }
        setTimeout(() => { this.syncMessage = ''; }, 5000);
      }
    } catch {
      // Queue processing failed
    }
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
      this.handleTextSubmit();
    }
  };

  private handleFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    await this.uploadFiles(Array.from(files));
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
    await this.uploadFiles(Array.from(files));
  };

  private triggerFileSelect = () => {
    const input = this.querySelector<HTMLInputElement>('#file-input-hidden');
    if (input) {
      input.click();
    }
  };

  private async uploadFiles(files: File[]) {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    this.isUploading = true;
    this.uploadError = '';

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
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof SpaceApiError && (error.status === 401 || error.status === 404)) {
        this.connectionErrorType = 'auth';
        this.errorMessage = 'Authentication failed. Your token may have been revoked or the space no longer exists.';
        return;
      }
      this.uploadError =
        error instanceof SpaceApiError
          ? error.message
          : 'Failed to upload file.';
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

  private handleDownload = async (item: SpaceItemResponse) => {
    if (!this.serverUrl || !this.spaceId || !this.token) return;

    try {
      const blob = await downloadFile(
        this.serverUrl,
        this.spaceId,
        item.id,
        this.token,
      );
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
        ${this.renderUploadArea()}
        ${this.renderPendingSharesSection()}
        ${this.renderPendingUploadsSection()}
        ${this.renderItemsList()}
        ${this.modalItem ? this.renderModal() : nothing}
        ${this.transferModalItem ? this.renderTransferModal() : nothing}
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

  private renderPendingSharesSection() {
    if (this.pendingShares.length === 0) return nothing;

    return html`
      <section
        class="space-y-3"
      >
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium text-amber-300">
            📥 ${this.pendingShares.length}
            item${this.pendingShares.length !== 1 ? 's' : ''} shared from other
            apps
          </p>
          <div class="flex gap-2">
            <button
              @click=${() => this.uploadAllPendingShares()}
              ?disabled=${this.isUploading}
              class="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              Upload All
            </button>
          </div>
        </div>

        <ul class="space-y-2">
          ${this.pendingShares.map((share) => {
            const icon = share.type === 'file' 
              ? getFileTypeIcon(share.fileName ?? 'file')
              : getTextItemIcon();
            
            const content = html`
              <!-- Left: Icon -->
              <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
                ${icon.svg}
              </div>
              <!-- Center: Content -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-slate-200">
                  ${share.type === 'file'
                    ? share.fileName ?? 'File'
                    : (share.content ?? '').substring(0, 100)}
                </p>
                <p class="text-xs text-slate-500">
                  Pending upload
                </p>
              </div>
              <!-- Right: Actions -->
              <div class="-mr-2 flex shrink-0 items-center gap-1">
                <button
                  @click=${() => this.uploadPendingShare(share)}
                  ?disabled=${this.isUploading}
                  class="rounded px-3 py-1.5 text-xs font-medium text-sky-400 transition hover:text-sky-300 disabled:opacity-50"
                  title="Upload this item"
                >
                  Upload
                </button>
                <button
                  @click=${() => this.dismissPendingShare(share)}
                  class="rounded p-2 text-slate-500 transition hover:text-red-400"
                  title="Dismiss"
                  aria-label="Dismiss shared item"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            `;

            return this.renderUnifiedItemCard(content, undefined, 'border-amber-500/40', 'bg-amber-950/20');
          })}
        </ul>
      </section>
    `;
  }

  private renderPendingUploadsSection() {
    if (this.offlineQueueItems.length === 0) return nothing;

    const canSync = this.isOnline && this.connectionErrorType !== 'network';

    return html`
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium text-slate-400">
            📤 ${this.offlineQueueItems.length}
            item${this.offlineQueueItems.length !== 1 ? 's' : ''} pending upload
          </p>
          ${canSync
            ? html`
              <button
                @click=${() => this.syncOfflineQueue()}
                ?disabled=${this.isUploading}
                class="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
              >
                Sync Now
              </button>
            `
            : nothing}
        </div>

        <ul class="space-y-2">
          ${this.offlineQueueItems.map((item) => {
            const icon = item.type === 'file' 
              ? getFileTypeIcon(item.fileName ?? 'file')
              : getTextItemIcon();
            
            const content = html`
              <!-- Left: Icon -->
              <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
                ${icon.svg}
              </div>
              <!-- Center: Content -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-slate-200">
                  ${item.type === 'file'
                    ? item.fileName ?? 'File'
                    : (item.content ?? '').substring(0, 100)}
                </p>
                <p class="text-xs text-slate-500">
                  Queued for upload
                </p>
              </div>
              <!-- Right: Dismiss Button -->
              <div class="-mr-2 shrink-0">
                <button
                  @click=${() => this.dismissOfflineQueueItem(item)}
                  class="rounded p-2 text-slate-500 transition hover:text-red-400"
                  title="Dismiss"
                  aria-label="Dismiss pending upload"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            `;

            return this.renderUnifiedItemCard(content, undefined, 'border-sky-500/40', 'bg-sky-950/20');
          })}
        </ul>
      </section>
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
            ?disabled=${this.isUploading}
            class="w-full resize-none rounded-t-lg border-0 bg-transparent px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
          ></textarea>

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
              <span class="hidden text-xs text-slate-500 sm:inline">Ctrl/⌘+Enter</span>
              <button
                @click=${this.handleTextSubmit}
                ?disabled=${this.isUploading || !this.textInput.trim()}
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

        ${this.offlineQueueCount > 0 && !this.isOnline
          ? html`<p class="text-xs text-amber-400">
              📤 ${this.offlineQueueCount} item${this.offlineQueueCount !== 1 ? 's' : ''} queued — will upload when back online
            </p>`
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
        class="relative overflow-hidden rounded-lg border ${borderClass} ${bgClass} px-4 py-3"
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
    const showOverlay = this.deleteConfirmItemId === item.id;
    const content = isFile ? this.renderFileContent(item) : this.renderTextContent(item);
    const overlay = showOverlay ? this.renderDeleteConfirmOverlay(item) : undefined;

    return this.renderUnifiedItemCard(content, overlay);
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

  private renderTextContent(item: SpaceItemResponse) {
    const icon = getTextItemIcon();
    return html`
      <!-- Left: Icon -->
      <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
        ${icon.svg}
      </div>
      <!-- Center: Content -->
      <div class="min-w-0 flex-1">
        <p
          class="cursor-pointer truncate text-sm font-medium text-slate-200 hover:text-slate-100"
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
        ${this.renderCopyButton(item)}
        ${this.renderSendToButton(item)}
        ${this.renderDeleteButton(item)}
      </div>
    `;
  }

  private renderFileContent(item: SpaceItemResponse) {
    const icon = getFileTypeIcon(item.content);
    return html`
      <!-- Left: Icon -->
      <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
        ${icon.svg}
      </div>
      <!-- Center: Content -->
      <div class="min-w-0 flex-1">
        <p
          class="truncate text-sm font-medium text-slate-200"
          title=${item.content}
        >
          ${item.content}
        </p>
        <p class="text-xs text-slate-500">
          ${this.formatFileSize(item.fileSize)} · <time datetime=${item.sharedAt}>${this.formatTime(item.sharedAt)}</time>
        </p>
      </div>
      <!-- Right: Actions -->
      <div class="-mr-2 flex shrink-0 items-center gap-1">
        ${this.renderDownloadButton(item)}
        ${this.renderSendToButton(item)}
        ${this.renderDeleteButton(item)}
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

  private renderDeleteConfirmOverlay(item: SpaceItemResponse) {
    const label = this.getItemPreviewLabel(item);
    return html`
      <div
        class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-slate-900/95 px-4 py-3 backdrop-blur-sm"
      >
        <p class="max-w-full text-center text-sm text-slate-200">
          Delete
          <span class="inline-block max-w-[200px] truncate align-bottom font-medium text-white"
            >${label}</span
          >?
        </p>
        <div class="flex gap-2">
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
        </div>
      </div>
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
