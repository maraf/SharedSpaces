import { provide } from '@lit/context';
import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { jwtDecode } from 'jwt-decode';

import databaseGearSvg from 'bootstrap-icons/icons/database-gear.svg?raw';
import gearSvg from 'bootstrap-icons/icons/gear.svg?raw';
import inboxFillSvg from 'bootstrap-icons/icons/inbox-fill.svg?raw';
import plusSvg from 'bootstrap-icons/icons/plus.svg?raw';

// Smaller variants used in compact buttons / list rows.
const gearSvg14 = gearSvg.replace(/width="16"/, 'width="14"').replace(/height="16"/, 'height="14"');

// Precomputed SVG variant to avoid per-render string replacements
const inboxFillSvg14 = inboxFillSvg.replace(/width="16"/, 'width="14"').replace(/height="16"/, 'height="14"');

import './features/admin/admin-view';
import './features/join/join-view';
import './features/space-view/space-view';
import './features/shared-item/shared-item-view';
import {
  appContext,
  getRuntimeAppConfig,
  type AppConfig,
} from './lib/app-context';
import { authContext, type AuthState } from './lib/auth-context';
import { BaseElement } from './lib/base-element';
import type { AppView, AppViewChangeDetail } from './lib/navigation';
import { parseInvitationFromUrl } from './lib/invitation';
import {
  getTokens,
  getLastSelectedSpace,
  setLastSelectedSpace,
  clearLastSelectedSpace,
} from './lib/token-storage';
import { formatRelativeTime } from './lib/format-time';
import type { ConnectionState } from './lib/signalr-client';
import {
  clearPendingShares,
  getPendingShares,
  removePendingShare,
  type PendingShareItem,
} from './lib/idb-storage';
import { decodeShareLinkSegment } from './lib/share-link';
import { initSwUpdate, checkForUpdates, activateUpdate } from './lib/sw-update';

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
  @state() private pendingShareCount = 0;
  @state() private pendingShares: PendingShareItem[] = [];
  @state() private swUpdateAvailable = false;
  @state() private sheetOpen = false;
  @state() private spaceSettingsOpen = false;
  @state() private sharedToken?: string;
  @state() private sharedApiUrl?: string;
  @state() private sharedError?: string;

  private headerElement?: HTMLElement;
  private headerResizeObserver?: ResizeObserver;
  private mobileMediaQuery?: MediaQueryList;
  private initialSpaceLoad: Promise<void> = Promise.resolve();
  private initialPendingShareLoad: Promise<void> = Promise.resolve();



  private handleBreakpointChange = (e: MediaQueryListEvent) => {
    if (!e.matches && this.sheetOpen) {
      this.sheetOpen = false;
      document.body.classList.remove('overflow-hidden');
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.sheetOpen) {
      this.sheetOpen = false;
    }
  };

  override connectedCallback() {
    super.connectedCallback();

    // Check for /shared/{segment} route first — standalone view, no app chrome
    const sharedMatch = window.location.pathname.match(/^\/shared\/([^/]+)$/);
    if (sharedMatch) {
      const result = decodeShareLinkSegment(sharedMatch[1]);
      if (!result) {
        this.sharedError = 'Invalid share link.';
        this.view = 'shared-item';
        return;
      }
      this.sharedToken = result.token;
      this.sharedApiUrl = result.api;
      this.view = 'shared-item';
      return;
    }

    const invitation = parseInvitationFromUrl();
    if (invitation) {
      this.view = 'join';
    }

    this.initialSpaceLoad = this.loadSpacesFromStorage().then(() => {
      if (!invitation) {
        // Auto-select last space if no invitation and no explicit navigation
        this.autoSelectLastSpace();
      }
    });

    // Listen for SW messages (registration handled by sw-update service)
    navigator.serviceWorker?.addEventListener('message', this.handleSwMessage);

    // Initialise SW update detection
    void initSwUpdate({
      onUpdateAvailable: () => { this.swUpdateAvailable = true; },
    });


    // Check pending shares from IndexedDB
    this.initialPendingShareLoad = this.refreshPendingShareCount();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.addEventListener('pending-shares-changed', this.handlePendingSharesChanged);

    this.mobileMediaQuery = window.matchMedia?.('(max-width: 639px)');
    this.mobileMediaQuery?.addEventListener?.('change', this.handleBreakpointChange);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  override firstUpdated() {
    this.headerElement = this.renderRoot.querySelector('header') as HTMLElement;
    if (this.headerElement) {
      this.headerResizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const borderBoxSize = Array.isArray(entry.borderBoxSize)
            ? entry.borderBoxSize[0]
            : entry.borderBoxSize;
          const height = borderBoxSize?.blockSize ?? entry.contentRect.height;
          document.documentElement.style.setProperty('--header-height', `${height}px`);
        }
      });
      this.headerResizeObserver.observe(this.headerElement);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    navigator.serviceWorker?.removeEventListener('message', this.handleSwMessage);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.removeEventListener('pending-shares-changed', this.handlePendingSharesChanged);
    this.headerResizeObserver?.disconnect();
    document.documentElement.style.removeProperty('--header-height');
    this.mobileMediaQuery?.removeEventListener?.('change', this.handleBreakpointChange);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.body.classList.remove('overflow-hidden');
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    await super.getUpdateComplete();
    await this.initialSpaceLoad;
    await this.initialPendingShareLoad;
    return super.getUpdateComplete();
  }

  override willUpdate(changed: Map<string, unknown>) {
    // Clear connection state when leaving a space (switching to different view or different space)
    if (changed.has('view')) {
      const oldView = changed.get('view') as string | undefined;
      if (oldView === 'space' && this.view !== 'space' && this.currentSpaceId) {
        // Leaving space view entirely
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [this.currentSpaceId]: _, ...rest } = this.spaceConnectionStates;
        this.spaceConnectionStates = rest;
      }
    }

    // Lock body scroll when mobile sheet is open
    if (changed.has('sheetOpen')) {
      if (this.sheetOpen && window.matchMedia('(max-width: 639px)').matches) {
        document.body.classList.add('overflow-hidden');
      } else {
        document.body.classList.remove('overflow-hidden');
      }
    }

    // Clear connection state when switching between spaces
    if (changed.has('currentSpaceId')) {
      const oldSpaceId = changed.get('currentSpaceId') as string | undefined;
      if (oldSpaceId && oldSpaceId !== this.currentSpaceId) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [oldSpaceId]: _, ...rest } = this.spaceConnectionStates;
        this.spaceConnectionStates = rest;
        // Reset the space settings panel when switching to a different space.
        this.spaceSettingsOpen = false;
      }
    }
  }

  private handleSwMessage = (event: MessageEvent) => {
    if (event.data?.type === 'pending-share-added') {
      this.refreshPendingShareCount();
    }
  };

  private handleVersionClick = () => {
    if (this.swUpdateAvailable) {
      activateUpdate();
    } else {
      void checkForUpdates();
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

  private async loadSpacesFromStorage() {
    try {
      const tokens = await getTokens();
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
      this.spaces = entries.sort((a, b) =>
        a.spaceName.localeCompare(b.spaceName, undefined, { sensitivity: 'base' }),
      );
    } catch {
      this.spaces = [];
    }
  }


  private autoSelectLastSpace() {
    const lastSpaceKey = getLastSelectedSpace();
    if (!lastSpaceKey) return;

    // Try to find the space in the loaded spaces
    const space = this.spaces.find((s) => {
      const key = `${s.serverUrl}:${s.spaceId}`;
      return key === lastSpaceKey;
    });

    if (space) {
      // Space still exists and token is valid, auto-select it
      this.selectSpace(space);
    } else {
      // Space no longer exists or token was removed, clear the saved value
      clearLastSelectedSpace();
    }
  }
  private handleViewChange = async (event: CustomEvent<AppViewChangeDetail>) => {
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
      await this.loadSpacesFromStorage();
      // Persist last selected space for auto-reconnect on next start
      setLastSelectedSpace(serverUrl, spaceId);
    } else if (reloadSpaces) {
      // Reload spaces when explicitly requested (e.g., after removing a space)
      await this.loadSpacesFromStorage();
    }
  };

  private selectSpace(entry: SpaceEntry) {
    this.currentSpaceId = entry.spaceId;
    this.currentServerUrl = entry.serverUrl;
    this.authState = { token: entry.token };
    this.view = 'space';
    // Persist last selected space for auto-reconnect on next start
    setLastSelectedSpace(entry.serverUrl, entry.spaceId);
  }

  private toggleSpaceSettings(entry: SpaceEntry) {
    const isCurrent =
      this.view === 'space' && this.currentSpaceId === entry.spaceId;
    if (!isCurrent) {
      // Switch to that space and open the settings panel.
      this.selectSpace(entry);
      this.spaceSettingsOpen = true;
    } else {
      this.spaceSettingsOpen = !this.spaceSettingsOpen;
    }
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
    // Shared-item view is standalone — no app chrome (header, nav, bottom bar)
    if (this.view === 'shared-item') {
      if (this.sharedError) {
        return html`
          <div class="flex min-h-svh flex-col bg-slate-950 text-slate-50">
            <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8 sm:px-6">
              <div class="mb-8 text-center">
                <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-300">SharedSpaces</p>
              </div>
              <div class="flex flex-1 flex-col items-center justify-start">
                <div class="w-full max-w-md space-y-4 py-16 text-center">
                  <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-800/60">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-400"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                  </div>
                  <p class="text-sm text-slate-400">${this.sharedError}</p>
                </div>
              </div>
            </div>
          </div>`;
      }
      if (this.sharedToken) {
        return html`<shared-item-view
          .token=${this.sharedToken}
          .apiBaseUrl=${this.sharedApiUrl ?? this.appConfig.apiBaseUrl}
        ></shared-item-view>`;
      }
    }

    return html`
      <div
        class="min-h-svh bg-slate-950 px-4 pb-20 sm:pb-6 text-slate-50 sm:px-6 lg:px-8"
      >
        <div
          class="mx-auto flex min-h-[calc(100svh-1.5rem)] w-full max-w-5xl flex-col gap-6"
        >
          <header class="sticky top-0 z-20 bg-slate-950 pt-6 pb-2 flex flex-col gap-4">
            <div class="flex items-center justify-between">
              <button
                type="button"
                class="w-fit text-sm font-semibold uppercase tracking-[0.3em] text-sky-300 cursor-pointer bg-transparent border-none p-0"
                @click=${() => { 
                  // Intentional de-select — clear last space to prevent auto-reconnect
                  if (this.view === 'space' && this.currentSpaceId) {
                    clearLastSelectedSpace();
                  }
                  this.view = 'home'; 
                }}
              >
                SharedSpaces
              </button>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="text-xs bg-transparent border-none p-0 cursor-pointer ${this.swUpdateAvailable ? 'version-rainbow font-semibold' : 'text-slate-500'}"
                  title="${this.swUpdateAvailable ? 'Update available — click to activate' : 'Check for updates'}"
                  @click=${this.handleVersionClick}
                >v${__APP_VERSION__}</button>
                <button
                  @click=${() => { this.view = 'admin'; }}
                  class="sm:hidden ${this.pillBase} ${this.view === 'admin' ? this.pillActive : this.pillDefault}"
                  title="Admin panel"
                  aria-label="Admin panel"
                >
                  ${unsafeHTML(databaseGearSvg)}
                </button>
              </div>
            </div>

            <!-- Desktop pill nav — hidden on mobile -->
            <nav class="hidden sm:flex items-center gap-2 flex-wrap" data-testid="desktop-pills">
              ${this.pendingShareCount > 0
                ? html`
                  <button
                    @click=${() => { this.view = 'pending-shares'; }}
                    class="rounded-full border px-3 py-1 text-xs font-medium transition inline-flex items-center gap-1.5 ${this.view === 'pending-shares'
                      ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                      : 'border-amber-500/50 bg-amber-950/40 text-amber-300 hover:border-amber-400 hover:bg-amber-950/60'}"
                    title="Items shared from other apps"
                    data-testid="pending-shares-pill"
                  >
                    <span class="inline-flex w-3.5 h-3.5 shrink-0">${unsafeHTML(inboxFillSvg14)}</span> ${this.pendingShareCount}
                  </button>
                `
                : nothing}
              ${this.spaces.map((entry) => {
                const isActive =
                  this.view === 'space' &&
                  this.currentSpaceId === entry.spaceId;
                return html`
                  <div
                    class="inline-flex items-stretch rounded-full border ${isActive
                      ? 'border-sky-500 bg-sky-950/60 text-sky-300'
                      : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:bg-slate-900'} text-xs font-medium transition"
                  >
                    <button
                      @click=${() => this.selectSpace(entry)}
                      class="inline-flex items-center gap-1.5 rounded-l-full px-3 py-1.5"
                    >
                      <span class="inline-block h-2 w-2 shrink-0 rounded-full ${this.dotColor(entry.spaceId)}"></span>
                      ${entry.spaceName}
                    </button>
                    <button
                      @click=${() => this.toggleSpaceSettings(entry)}
                      class="inline-flex items-center justify-center rounded-r-full border-l ${isActive
                        ? 'border-sky-500/60 hover:bg-sky-900/40'
                        : 'border-slate-700/80 hover:bg-slate-800'} px-2 py-1.5"
                      title="Large space settings"
                      aria-label="Large space settings for ${entry.spaceName}"
                      aria-pressed=${isActive && this.spaceSettingsOpen}
                      data-testid="space-settings-toggle"
                    >
                      <span class="inline-flex w-3.5 h-3.5">${unsafeHTML(gearSvg14)}</span>
                    </button>
                  </div>
                `;
              })}
              <button
                @click=${() => { this.view = 'join'; }}
                class="rounded-full border px-1.5 py-1.5 text-xs font-medium transition aspect-square inline-flex items-center justify-center ${this.view === 'join' ? this.pillActive : this.pillDefault}"
                aria-label="Join a space"
              >
                ${unsafeHTML(plusSvg)}
              </button>

              <span class="flex-1"></span>

              <button
                @click=${() => { this.view = 'admin'; }}
                class="${this.pillBase} ${this.view === 'admin' ? this.pillActive : this.pillDefault}"
                title="Admin panel"
                aria-label="Admin panel"
              >
                ${unsafeHTML(databaseGearSvg)}
              </button>
            </nav>
          </header>

          <main class="flex flex-1" @view-change=${this.handleViewChange} @connection-state-change=${this.handleConnectionStateChange}>
            ${this.renderContent()}
          </main>
        </div>

        ${this.renderMobileBottomBar()}
        ${this.renderMobileBackdrop()}
        ${this.renderMobileSheet()}
      </div>
    `;
  }


  // --- Mobile Bottom Bar + Sheet ---

  private renderMobileBottomBar() {
    const activeSpace = this.spaces.find(
      (s) => s.spaceId === this.currentSpaceId,
    );
    return html`
      <div
        class="fixed bottom-0 left-0 right-0 z-30 sm:hidden border-t border-slate-800 bg-slate-900 select-none cursor-pointer"
        style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))"
        data-testid="bottom-bar"
        role="button"
        tabindex="0"
        @click=${() => { this.sheetOpen = !this.sheetOpen; }}
        @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.sheetOpen = !this.sheetOpen; } }}
        aria-label=${this.sheetOpen ? 'Close spaces sheet' : 'Open spaces sheet'}
      >
        <div
          class="mx-auto max-w-5xl flex items-center justify-between px-4 pt-3"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            ${activeSpace
              ? html`
                  <span
                    class="inline-block h-2.5 w-2.5 shrink-0 rounded-full ${this.dotColor(activeSpace.spaceId)}"
                  ></span>
                  <span class="text-sm font-medium text-slate-200 truncate">
                    ${activeSpace.spaceName}
                  </span>
                `
              : html`
                  <span class="text-sm text-slate-400">
                    ${this.spaces.length > 0
                      ? 'Select a space'
                      : 'Join a space'}
                  </span>
                `}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${this.pendingShareCount > 0
              ? html`
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300"
                  title="Pending shares"
                  data-testid="pending-shares-bar"
                  @click=${(e: Event) => { e.stopPropagation(); this.view = 'pending-shares'; }}
                >
                  <span class="inline-flex w-3.5 h-3.5 shrink-0">${unsafeHTML(inboxFillSvg14)}</span> ${this.pendingShareCount}
                </button>
              `
              : nothing}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
              class="shrink-0 text-slate-500 transition-transform ${this.sheetOpen ? 'rotate-180' : ''}"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"
              />
            </svg>
          </div>
        </div>
      </div>
    `;
  }

  private renderMobileBackdrop() {
    return html`
      <div
        class="fixed inset-0 z-40 sm:hidden bg-black/50 transition-opacity duration-300 ${this.sheetOpen
          ? 'opacity-100'
          : 'opacity-0 pointer-events-none'}"
        data-testid="backdrop"
        @click=${() => {
          this.sheetOpen = false;
        }}
      ></div>
    `;
  }

  private renderMobileSheet() {
    return html`
      <div
        class="fixed bottom-0 left-0 right-0 z-50 sm:hidden bottom-sheet ${this.sheetOpen
          ? 'bottom-sheet-open'
          : ''}"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        aria-hidden=${!this.sheetOpen}
        data-testid="bottom-sheet"
      >
        <div
          class="bg-slate-900 rounded-t-2xl border-t border-slate-700 flex flex-col"
          style="max-height: 70svh; padding-bottom: max(1rem, env(safe-area-inset-bottom))"
        >
          <!-- Drag handle -->
          <div class="flex justify-center pt-3 pb-1">
            <div class="h-1 w-10 rounded-full bg-slate-600"></div>
          </div>

          <!-- Title -->
          <div class="px-4 py-2">
            <h2
              id="sheet-title"
              class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
            >
              Spaces
            </h2>
          </div>

          <!-- Scrollable space list -->
          <div class="overflow-y-auto px-2">
            <!-- Join new space -->
            <button
              class="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-slate-800/60 active:bg-slate-800 transition text-left"
              @click=${() => {
                this.view = 'join';
                this.sheetOpen = false;
              }}
            >
              <span class="inline-flex w-5 shrink-0 items-center justify-center text-sky-400 text-sm">+</span>
              <span class="text-sm text-sky-400 font-medium"
                >Join new space</span
              >
            </button>

            <!-- Pending shares entry -->
            ${this.pendingShareCount > 0
              ? html`
                  <button
                    class="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-slate-800/60 active:bg-slate-800 transition text-left"
                    data-testid="pending-shares-sheet"
                    @click=${() => {
                      this.view = 'pending-shares';
                      this.sheetOpen = false;
                    }}
                  >
                    <span class="inline-flex w-5 shrink-0 items-center justify-center">${unsafeHTML(inboxFillSvg)}</span>
                    <span class="text-sm text-amber-300 font-medium"
                      >Pending shares</span
                    >
                    <span
                      class="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300"
                      >${this.pendingShareCount}</span
                    >
                  </button>
                `
              : nothing}

            <!-- Separator -->
            ${this.spaces.length > 0
              ? html`<div class="mx-3 my-1 border-t border-slate-800"></div>`
              : nothing}

            ${this.spaces.map((entry) => {
              const isActive =
                this.view === 'space' &&
                this.currentSpaceId === entry.spaceId;
              return html`
                <div
                  class="flex w-full items-stretch rounded-lg transition ${isActive
                    ? 'bg-sky-950/40'
                    : 'hover:bg-slate-800/60 active:bg-slate-800'}"
                >
                  <button
                    class="flex flex-1 items-center gap-3 px-3 py-3 text-left"
                    data-testid="sheet-space-item"
                    @click=${() => {
                      this.selectSpace(entry);
                      this.sheetOpen = false;
                    }}
                  >
                    <span class="inline-flex w-5 shrink-0 items-center justify-center">
                      <span
                        class="inline-block h-2.5 w-2.5 rounded-full ${this.dotColor(entry.spaceId)}"
                      ></span>
                    </span>
                    <span
                      class="text-sm ${isActive
                        ? 'text-sky-300 font-medium'
                        : 'text-slate-200'}"
                      >${entry.spaceName}</span
                    >
                    ${isActive
                      ? html`<span class="ml-auto text-xs text-sky-400/70"
                          >Active</span
                        >`
                      : nothing}
                  </button>
                  <button
                    class="flex shrink-0 items-center justify-center px-4 text-slate-400 hover:text-slate-200"
                    data-testid="sheet-space-settings"
                    title="Large space settings"
                    aria-label="Large space settings for ${entry.spaceName}"
                    aria-pressed=${isActive && this.spaceSettingsOpen}
                    @click=${() => {
                      this.toggleSpaceSettings(entry);
                      this.sheetOpen = false;
                    }}
                  >
                    <span class="inline-flex w-4 h-4">${unsafeHTML(gearSvg)}</span>
                  </button>
                </div>
              `;
            })}
          </div>
        </div>
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
          .spaces=${this.spaces}
          .showSettings=${this.spaceSettingsOpen}
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
          Select a space to get started.
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
      const date = new Date(ts);
      return formatRelativeTime(date);
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
