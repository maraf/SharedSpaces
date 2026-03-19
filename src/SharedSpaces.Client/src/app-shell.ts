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
import { registerServiceWorker } from './lib/sw-registration';
import {
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

    // Register service worker and listen for SW messages
    registerServiceWorker();
    navigator.serviceWorker?.addEventListener('message', this.handleSwMessage);

    // Track online/offline state
    globalThis.addEventListener('online', this.handleOnline);
    globalThis.addEventListener('offline', this.handleOffline);

    // Check pending shares from IndexedDB
    this.refreshPendingShareCount();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    globalThis.removeEventListener('online', this.handleOnline);
    globalThis.removeEventListener('offline', this.handleOffline);
    navigator.serviceWorker?.removeEventListener('message', this.handleSwMessage);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
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
    await removePendingShare(share.id);
    this.pendingShares = this.pendingShares.filter((s) => s.id !== share.id);
    this.pendingShareCount = this.pendingShares.length;
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
            <button
              type="button"
              class="w-fit text-sm font-semibold uppercase tracking-[0.3em] text-sky-300 cursor-pointer bg-transparent border-none p-0"
              @click=${() => { this.view = 'home'; }}
            >
              SharedSpaces
            </button>

            <nav class="flex items-center gap-2 flex-wrap">
              ${this.spaces.map(
                (entry) => html`
                  <button
                    @click=${() => this.selectSpace(entry)}
                    class="${this.pillBase} ${this.view === 'space' && this.currentSpaceId === entry.spaceId ? this.pillActive : this.pillDefault}"
                  >
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

              ${this.pendingShareCount > 0
                ? html`
                  <button
                    @click=${() => {
                      if (this.spaces.length > 0 && !this.currentSpaceId) {
                        this.selectSpace(this.spaces[0]);
                      } else if (this.currentSpaceId) {
                        this.view = 'space';
                      }
                    }}
                    class="${this.pillBase} border-amber-500/50 bg-amber-950/40 text-amber-300 hover:border-amber-400 hover:bg-amber-950/60"
                    title="Items shared from other apps"
                  >
                    📥 ${this.pendingShareCount}
                  </button>
                `
                : nothing}

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

          <main class="flex flex-1" @view-change=${this.handleViewChange}>
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
          ${this.renderHomePendingShares('Join a space to upload them.')}
          <p class="text-slate-400">
            No spaces yet. Click <span class="font-semibold text-sky-300">+</span> to join one.
          </p>
        </div>
      `;
    }
    return html`
      <div class="flex w-full flex-col items-center justify-center gap-4 text-center">
        ${this.renderHomePendingShares('Select a space to upload them.')}
        <p class="text-slate-400">
          Select a space above to get started.
        </p>
      </div>
    `;
  }

  private renderHomePendingShares(instruction: string) {
    if (this.pendingShares.length === 0) return nothing;

    return html`
      <div class="w-full max-w-md space-y-3 text-left">
        <p class="text-center text-sm text-amber-300">
          📥 ${this.pendingShares.length}
          item${this.pendingShares.length !== 1 ? 's' : ''} shared from other
          apps. ${instruction}
        </p>
        <ul class="space-y-1.5">
          ${this.pendingShares.map(
            (share) => html`
              <li
                class="flex items-center gap-3 rounded border border-slate-700/50 bg-slate-900/40 px-3 py-2"
              >
                <span class="shrink-0 text-sm" aria-hidden="true">
                  ${share.type === 'file' ? '📄' : '📝'}
                </span>
                <span class="min-w-0 flex-1 truncate text-xs text-slate-300">
                  ${share.type === 'file'
                    ? share.fileName ?? 'File'
                    : (share.content ?? '').substring(0, 100)}
                </span>
                <button
                  @click=${() => this.dismissPendingShare(share)}
                  class="shrink-0 rounded p-1 text-slate-500 hover:text-red-400"
                  title="Dismiss"
                  aria-label="Dismiss shared item"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </li>
            `,
          )}
        </ul>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
