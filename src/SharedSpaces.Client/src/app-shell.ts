import { provide } from '@lit/context';
import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { jwtDecode } from 'jwt-decode';

import './features/admin/admin-view';
import './features/join/join-view';
import './features/space-view/space-view';
import {
  appContext,
  getRuntimeAppConfig,
  type AppConfig,
} from './lib/app-context';
import { authContext, type AuthState } from './lib/auth-context';
import { BaseElement } from './lib/base-element';
import type { AppView, AppViewChangeDetail } from './lib/navigation';
import { parseInvitationFromUrl } from './lib/invitation';
import { getTokens } from './lib/token-storage';
import type { ConnectionState } from './lib/signalr-client';
import {
  clearPendingShares,
  getPendingShares,
  removePendingShare,
  type PendingShareItem,
} from './lib/idb-storage';

interface SpaceEntry {
  serverUrl: string;
  spaceId: string;
  spaceName: string;
  token: string;
}

interface StoredJwtClaims {
  server_url: string;
  space_id: string;
  space_name?: string;
  display_name?: string;
}

@customElement('app-shell')
export class AppShell extends BaseElement {
  @property({ type: String }) view: AppView = 'home';

  @provide({ context: appContext })
  private appConfig: AppConfig = getRuntimeAppConfig();

  @provide({ context: authContext })
  @state()
  private authState: AuthState = {};

  @state() private currentSpaceId?: string;
  @state() private currentServerUrl?: string;
  @state() private spaces: SpaceEntry[] = [];
  @state() private spaceConnectionStates: Record<string, ConnectionState> = {};
  @state() private isOnline = navigator.onLine;
  @state() private pendingShareCount = 0;
  @state() private pendingShares: PendingShareItem[] = [];

  private handleOnline = () => { this.isOnline = true; };
  private handleOffline = () => { this.isOnline = false; };

  override connectedCallback() {
    super.connectedCallback();
    this.loadSpacesFromStorage();

    const invitation = parseInvitationFromUrl();
    if (invitation) {
      this.view = 'join';
    }

    // Listen for SW messages (registration handled by vite-plugin-pwa)
    navigator.serviceWorker?.addEventListener('message', this.handleSwMessage);

    // Track online/offline state
    globalThis.addEventListener('online', this.handleOnline);
    globalThis.addEventListener('offline', this.handleOffline);

    // Check pending shares from IndexedDB
    this.refreshPendingShareCount();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.addEventListener('pending-shares-changed', this.handlePendingSharesChanged);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    globalThis.removeEventListener('online', this.handleOnline);
    globalThis.removeEventListener('offline', this.handleOffline);
    navigator.serviceWorker?.removeEventListener('message', this.handleSwMessage);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.removeEventListener('pending-shares-changed', this.handlePendingSharesChanged);
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('view')) {
      const oldView = changed.get('view') as string | undefined;
      if (oldView === 'space' && this.view !== 'space' && this.currentSpaceId) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [this.currentSpaceId]: _, ...rest } = this.spaceConnectionStates;
        this.spaceConnectionStates = rest;
      }
    }
  }

  private handleSwMessage = (event: MessageEvent) => {
    if (event.data?.type === 'pending-share-added') {
      this.refreshPendingShareCount();
    }
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.refreshPendingShareCount();
    }
  };

  private handlePendingSharesChanged = () => {
    this.refreshPendingShareCount();
  };

  private async refreshPendingShareCount() {
    try {
      const shares = await getPendingShares();
      this.pendingShares = shares;
      this.pendingShareCount = shares.length;
    } catch {
      // IndexedDB may not be available
    }
  }

  private async dismissPendingShare(share: PendingShareItem) {
    try {
      await removePendingShare(share.id);
      this.pendingShares = this.pendingShares.filter((s) => s.id !== share.id);
      this.pendingShareCount = this.pendingShares.length;
      if (this.pendingShareCount === 0 && this.view === 'pending-shares') {
        this.view = 'home';
      }
    } catch {
      // IndexedDB may not be available
    }
  }

  private async dismissAllPendingShares() {
    try {
      await clearPendingShares();
      this.pendingShares = [];
      this.pendingShareCount = 0;
      if (this.view === 'pending-shares') {
        this.view = 'home';
      }
    } catch {
      // IndexedDB may not be available
    }
  }

  private loadSpacesFromStorage() {
    const tokens = getTokens();
    const entries: SpaceEntry[] = [];
    for (const [key, token] of Object.entries(tokens)) {
      try {
        const claims = jwtDecode<StoredJwtClaims>(token);
        const parts = key.split(':');
        const serverUrl = parts.slice(0, -1).join(':');
        const spaceId = parts[parts.length - 1];
        entries.push({
          serverUrl: claims.server_url || serverUrl,
          spaceId: claims.space_id || spaceId,
          spaceName: claims.space_name || spaceId.substring(0, 8),
          token,
        });
      } catch {
        // Skip invalid tokens
      }
    }
    this.spaces = entries;
  }

  private handleViewChange = (event: CustomEvent<AppViewChangeDetail>) => {
    const { view, spaceId, serverUrl, token, displayName, reloadSpaces } = event.detail;

    this.view = view;

    if (token && spaceId && serverUrl) {
      this.currentSpaceId = spaceId;
      this.currentServerUrl = serverUrl;
      this.authState = {
        token,
        displayName: displayName ?? this.authState.displayName,
      };
      // Refresh space list after joining
      this.loadSpacesFromStorage();
    } else if (reloadSpaces) {
      // Reload spaces when explicitly requested (e.g., after removing a space)
      this.loadSpacesFromStorage();
    }
  };

  private selectSpace(entry: SpaceEntry) {
    this.currentSpaceId = entry.spaceId;
    this.currentServerUrl = entry.serverUrl;
    this.authState = { token: entry.token };
    this.view = 'space';
  }

  private handleConnectionStateChange = (event: Event) => {
    const { spaceId, state } = (event as CustomEvent<{ spaceId: string; state: ConnectionState }>).detail;
    this.spaceConnectionStates = {
      ...this.spaceConnectionStates,
      [spaceId]: state,
    };
  };

  private dotColor(spaceId: string): string {
    const state = this.spaceConnectionStates[spaceId];
    switch (state) {
      case 'connected':
        return 'bg-emerald-400';
      case 'connecting':
      case 'reconnecting':
        return 'bg-amber-400';
      case 'disconnected':
        // Red only for the actively-viewed space with a real problem
        return this.view === 'space' && this.currentSpaceId === spaceId
          ? 'bg-red-400'
          : 'bg-slate-500';
      default:
        return 'bg-slate-500';
    }
  }

  private readonly pillBase =
    'rounded-full border px-3 py-1.5 text-xs font-medium transition';
  private readonly pillDefault =
    'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:bg-slate-900';
  private readonly pillActive =
    'border-sky-500 bg-sky-950/60 text-sky-300';

  override render() {
    return html`
      <div
        class="min-h-svh bg-slate-950 px-4 py-6 text-slate-50 sm:px-6 lg:px-8"
      >
        <div
          class="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-5xl flex-col gap-6"
        >
          ${!this.isOnline ? this.renderOfflineBanner() : nothing}

          <header class="flex flex-col gap-4">
            <div class="flex items-center justify-between">
              <button
                type="button"
                class="w-fit text-sm font-semibold uppercase tracking-[0.3em] text-sky-300 cursor-pointer bg-transparent border-none p-0"
                @click=${() => { this.view = 'home'; }}
              >
                SharedSpaces
              </button>
              <span class="text-xs text-slate-500">v${__APP_VERSION__}</span>
            </div>

            <nav class="flex items-center gap-2 flex-wrap">
              ${this.pendingShareCount > 0
                ? html`
                  <button
                    @click=${() => { this.view = 'pending-shares'; }}
                    class="${this.pillBase} ${this.view === 'pending-shares'
                      ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                      : 'border-amber-500/50 bg-amber-950/40 text-amber-300 hover:border-amber-400 hover:bg-amber-950/60'}"
                    title="Items shared from other apps"
                  >
                    📥 ${this.pendingShareCount}
                  </button>
                `
                : nothing}
              ${this.spaces.map(
                (entry) => html`
                  <button
                    @click=${() => this.selectSpace(entry)}
                    class="${this.pillBase} ${this.view === 'space' && this.currentSpaceId === entry.spaceId ? this.pillActive : this.pillDefault} inline-flex items-center gap-1.5"
                  >
                    <span class="inline-block h-2 w-2 shrink-0 rounded-full ${this.dotColor(entry.spaceId)}"></span>
                    ${entry.spaceName}
                  </button>
                `,
              )}
              <button
                @click=${() => { this.view = 'join'; }}
                class="${this.pillBase} ${this.view === 'join' ? this.pillActive : this.pillDefault}"
                aria-label="Join a space"
              >
                +
              </button>

              <span class="flex-1"></span>

              <button
                @click=${() => { this.view = 'admin'; }}
                class="${this.pillBase} ${this.view === 'admin' ? this.pillActive : this.pillDefault}"
                title="Admin panel"
              >
                ⚙️ Admin
              </button>
            </nav>
          </header>

          <main class="flex flex-1" @view-change=${this.handleViewChange} @connection-state-change=${this.handleConnectionStateChange}>
            ${this.renderContent()}
          </main>
        </div>
      </div>
    `;
  }

  private renderOfflineBanner() {
    return html`
      <div
        class="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-center text-sm text-amber-300"
        role="alert"
      >
        📡 You're offline — uploads will be queued and sent when you reconnect
      </div>
    `;
  }

  private renderContent() {
    switch (this.view) {
      case 'join':
        return html`<join-view
          class="w-full"
          .apiBaseUrl=${this.appConfig.apiBaseUrl}
        ></join-view>`;
      case 'space':
        return html`<space-view
          class="w-full"
          .apiBaseUrl=${this.appConfig.apiBaseUrl}
          .spaceId=${this.currentSpaceId}
          .serverUrl=${this.currentServerUrl}
        ></space-view>`;
      case 'pending-shares':
        return this.renderPendingSharesView();
      case 'admin':
        return html`<admin-view
          class="w-full"
          .apiBaseUrl=${this.appConfig.apiBaseUrl}
        ></admin-view>`;
      default:
        return this.renderHome();
    }
  }

  private renderHome() {
    if (this.spaces.length === 0) {
      return html`
        <div class="flex w-full flex-col items-center justify-center gap-4 text-center">
          <p class="text-slate-400">
            No spaces yet. Click <span class="font-semibold text-sky-300">+</span> to join one.
          </p>
        </div>
      `;
    }
    return html`
      <div class="flex w-full flex-col items-center justify-center gap-4 text-center">
        <p class="text-slate-400">
          Select a space above to get started.
        </p>
      </div>
    `;
  }

  // --- Pending Shares View ---

  private copiedShareIds = new Set<string>();

  private renderPendingSharesView() {
    if (this.pendingShares.length === 0) {
      return html`
        <div class="flex w-full flex-col items-center justify-center gap-4 text-center">
          <p class="text-slate-400">No pending shares.</p>
        </div>
      `;
    }

    return html`
      <div class="w-full space-y-4">
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <p
              class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
            >
              Shared from other apps
              <span class="ml-1 text-slate-600"
                >(${this.pendingShares.length})</span
              >
            </p>
            ${this.pendingShares.length > 1
              ? html`
                  <button
                    @click=${() => this.dismissAllPendingShares()}
                    class="text-xs text-slate-500 transition hover:text-red-400"
                  >
                    Dismiss all
                  </button>
                `
              : nothing}
          </div>

          <ul class="space-y-2">
            ${this.pendingShares.map((share) =>
              this.renderPendingShareCard(share),
            )}
          </ul>
        </section>
      </div>
    `;
  }

  private renderPendingShareCard(share: PendingShareItem) {
    const isFile = share.type === 'file';

    return html`
      <li
        class="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3"
      >
        <div class="space-y-1">
          <div class="min-w-0">
            ${isFile
              ? this.renderPendingFileContent(share)
              : this.renderPendingTextContent(share)}
          </div>
          <div class="flex items-center gap-1">
            ${isFile
              ? this.renderPendingDownloadButton(share)
              : this.renderPendingCopyButton(share)}
            ${this.renderPendingDismissButton(share)}
            <time
              class="ml-auto text-xs text-slate-500"
              datetime=${new Date(share.timestamp).toISOString()}
            >
              ${this.formatTimestamp(share.timestamp)}
            </time>
          </div>
        </div>
      </li>
    `;
  }

  private renderPendingTextContent(share: PendingShareItem) {
    return html`
      <p
        class="truncate text-sm text-slate-200"
        title=${share.content ?? ''}
      >
        ${share.content}
      </p>
    `;
  }

  private renderPendingFileContent(share: PendingShareItem) {
    return html`
      <div class="flex items-center gap-2">
        <span class="text-base" aria-hidden="true">📄</span>
        <div class="min-w-0">
          <p
            class="truncate text-sm font-medium text-slate-200"
            title=${share.fileName ?? 'File'}
          >
            ${share.fileName ?? 'File'}
          </p>
          ${share.fileSize
            ? html`<p class="text-xs text-slate-500">
                ${this.formatFileSize(share.fileSize)}
              </p>`
            : nothing}
        </div>
      </div>
    `;
  }

  private renderPendingCopyButton(share: PendingShareItem) {
    const copied = this.copiedShareIds.has(share.id);
    return html`
      <button
        @click=${() => this.handleCopyShare(share)}
        class="rounded p-2 text-slate-500 transition hover:text-slate-300"
        title=${copied ? 'Copied!' : 'Copy to clipboard'}
        aria-label=${copied
          ? 'Copied to clipboard'
          : 'Copy text to clipboard'}
      >
        ${copied
          ? html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-400"><polyline points="20 6 9 17 4 12"></polyline></svg>`
          : html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`}
      </button>
    `;
  }

  private renderPendingDownloadButton(share: PendingShareItem) {
    return html`
      <button
        @click=${() => this.handleDownloadShare(share)}
        class="rounded p-2 text-slate-500 transition hover:text-slate-300"
        title="Download file"
        aria-label="Download file"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </button>
    `;
  }

  private renderPendingDismissButton(share: PendingShareItem) {
    return html`
      <button
        @click=${() => this.dismissPendingShare(share)}
        class="rounded p-2 text-slate-500 transition hover:text-red-400"
        title="Dismiss"
        aria-label="Dismiss shared item"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>
    `;
  }

  private async handleCopyShare(share: PendingShareItem) {
    if (!share.content) return;
    try {
      await navigator.clipboard.writeText(share.content);
      this.copiedShareIds.add(share.id);
      this.requestUpdate();
      setTimeout(() => {
        this.copiedShareIds.delete(share.id);
        this.requestUpdate();
      }, 2000);
    } catch {
      // Clipboard may not be available
    }
  }

  private handleDownloadShare(share: PendingShareItem) {
    if (!share.fileData) return;
    const blob = new Blob([share.fileData], {
      type: share.fileType ?? 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = share.fileName ?? 'file';
    a.click();
    URL.revokeObjectURL(url);
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

  private formatTimestamp(ts: number): string {
    try {
      const diffMs = Date.now() - ts;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);

      if (diffSec < 60) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHour < 24) return `${diffHour}h ago`;
      if (diffDay < 7) return `${diffDay}d ago`;

      const date = new Date(ts);
      const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ];
      return `${months[date.getMonth()]} ${date.getDate()}`;
    } catch {
      return '';
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
