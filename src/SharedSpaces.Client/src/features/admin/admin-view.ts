import { html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { BaseElement } from '../../lib/base-element';
import {
  addAdminServerUrl,
  getAdminServerUrls,
  removeAdminServerUrl,
} from '../../lib/admin-url-storage';
import {
  AdminApiError,
  createInvitation,
  createSpace,
  deleteInvitation,
  listInvitations,
  listMembers,
  listSpaces,
  removeMember,
  revokeMember,
  type InvitationListResponse,
  type InvitationResponse,
  type MemberResponse,
  type SpaceResponse,
} from './admin-api';

type SpaceCardState = {
  clientAppUrl: string;
  generatedInvitation: InvitationResponse | null;
  invitationGenerationError: string;
  invitations: InvitationListResponse[];
  invitationsError: string;
  isGeneratingInvitation: boolean;
  isLoadingInvitations: boolean;
  isLoadingMembers: boolean;
  members: MemberResponse[];
  membersError: string;
  pendingInvitationDeletions: Record<string, boolean>;
  pendingMemberRevocations: Record<string, boolean>;
  pendingMemberRemovals: Record<string, boolean>;
};

type ModalState = {
  type: 'members' | 'invitations' | 'invite';
  spaceId: string;
} | null;

@customElement('admin-view')
export class AdminView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  @state() private adminSecret: string | null = null;
  @state() private adminServerUrl: string | null = null;
  @state() private serverUrlInput = 'https://';
  @state() private secretInput = '';
  @state() private spaces: SpaceResponse[] = [];
  @state() private newSpaceName = '';
  @state() private newSpaceQuotaMb = '';
  @state() private isCreatingSpace = false;
  @state() private isConnecting = false;
  @state() private errorMessage = '';

  @state() private savedServerUrls: string[] = [];
  @state() private showUrlDropdown = false;

  @state() private spaceCardState: Record<string, SpaceCardState> = {};
  @state() private activeModal: ModalState = null;

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (
      changedProperties.has('apiBaseUrl') &&
      !this.adminServerUrl &&
      (this.serverUrlInput === 'https://' || !this.serverUrlInput.trim())
    ) {
      this.serverUrlInput = this.getDefaultServerUrl();
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    this.savedServerUrls = getAdminServerUrls();
  }

  private normalizeServerUrl(serverUrl: string) {
    const trimmed = serverUrl.trim();
    if (!trimmed || trimmed === 'https://') return '';
    if (trimmed === '/') return '/';
    return trimmed.replace(/\/+$/, '');
  }

  private getDefaultServerUrl() {
    const normalized = this.normalizeServerUrl(this.apiBaseUrl);
    return normalized || 'https://';
  }

  private formatDate(value: string) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
  }

  private formatBytesAsMb(bytes: number) {
    const mb = bytes / (1024 * 1024);
    return mb % 1 === 0 ? `${mb} MB` : `${mb.toFixed(1)} MB`;
  }

  private createSpaceCardState(): SpaceCardState {
    return {
      clientAppUrl: window.location.origin,
      generatedInvitation: null,
      invitationGenerationError: '',
      invitations: [],
      invitationsError: '',
      isGeneratingInvitation: false,
      isLoadingInvitations: false,
      isLoadingMembers: false,
      members: [],
      membersError: '',
      pendingInvitationDeletions: {},
      pendingMemberRevocations: {},
      pendingMemberRemovals: {},
    };
  }

  private setSpaces(spaces: SpaceResponse[]) {
    this.spaces = spaces;
    this.spaceCardState = Object.fromEntries(
      spaces.map((space) => [
        space.id,
        this.spaceCardState[space.id] ?? this.createSpaceCardState(),
      ]),
    ) as Record<string, SpaceCardState>;
  }

  private getSpaceCardState(spaceId: string) {
    return this.spaceCardState[spaceId] ?? this.createSpaceCardState();
  }

  private updateSpaceCardState(
    spaceId: string,
    updates: Partial<SpaceCardState>,
  ) {
    const current = this.getSpaceCardState(spaceId);
    const nextState = {
      ...this.spaceCardState,
      [spaceId]: {
        ...current,
        ...updates,
      },
    };

    this.spaceCardState = nextState;
    return nextState[spaceId];
  }

  private getPendingState(record: Record<string, boolean>, key: string, isPending: boolean) {
    if (isPending) {
      return { ...record, [key]: true };
    }

    const nextState = { ...record };
    delete nextState[key];
    return nextState;
  }

  private isCurrentSession(serverUrl: string, adminSecret: string) {
    return this.adminServerUrl === serverUrl && this.adminSecret === adminSecret;
  }

  private isUnauthorizedError(error: unknown) {
    return error instanceof AdminApiError && error.status === 401;
  }

  private handleUnauthorized() {
    this.handleLogout();
    this.errorMessage = 'Invalid admin secret. Please re-enter.';
  }

  private async loadSpaceCollectionsForAll(
    spaces: SpaceResponse[],
    serverUrl: string,
    adminSecret: string,
  ) {
    await Promise.all(
      spaces.map((space) =>
        this.loadSpaceCollections(space.id, serverUrl, adminSecret),
      ),
    );
  }

  private async loadSpaceCollections(
    spaceId: string,
    serverUrl: string,
    adminSecret: string,
    options: { invitations?: boolean; members?: boolean } = {},
  ) {
    if (!this.isCurrentSession(serverUrl, adminSecret)) {
      return;
    }

    const shouldLoadMembers = options.members ?? true;
    const shouldLoadInvitations = options.invitations ?? true;
    const currentState = this.getSpaceCardState(spaceId);

    this.updateSpaceCardState(spaceId, {
      ...(shouldLoadMembers
        ? {
            isLoadingMembers: true,
            membersError: '',
          }
        : {}),
      ...(shouldLoadInvitations
        ? {
            invitationsError: '',
            isLoadingInvitations: true,
          }
        : {}),
    });

    const [membersResult, invitationsResult] = await Promise.allSettled([
      shouldLoadMembers
        ? listMembers(serverUrl, adminSecret, spaceId)
        : Promise.resolve(currentState.members),
      shouldLoadInvitations
        ? listInvitations(serverUrl, adminSecret, spaceId)
        : Promise.resolve(currentState.invitations),
    ]);

    if (!this.isCurrentSession(serverUrl, adminSecret)) {
      return;
    }

    const errors = [membersResult, invitationsResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);

    if (errors.some((error) => this.isUnauthorizedError(error))) {
      this.handleUnauthorized();
      return;
    }

    const nextState: Partial<SpaceCardState> = {};

    if (shouldLoadMembers) {
      nextState.isLoadingMembers = false;
      if (membersResult.status === 'fulfilled') {
        nextState.members = membersResult.value;
        nextState.membersError = '';
      } else {
        nextState.membersError =
          membersResult.reason instanceof Error
            ? membersResult.reason.message
            : 'Failed to load members';
      }
    }

    if (shouldLoadInvitations) {
      nextState.isLoadingInvitations = false;
      if (invitationsResult.status === 'fulfilled') {
        nextState.invitations = invitationsResult.value;
        nextState.invitationsError = '';
      } else {
        nextState.invitationsError =
          invitationsResult.reason instanceof Error
            ? invitationsResult.reason.message
            : 'Failed to load invitations';
      }
    }

    this.updateSpaceCardState(spaceId, nextState);
  }

  private handleSecretSubmit = async (e: Event) => {
    e.preventDefault();
    const serverUrl = this.normalizeServerUrl(this.serverUrlInput);
    const secret = this.secretInput.trim();
    if (!secret || !serverUrl) return;

    this.isConnecting = true;
    this.errorMessage = '';

    try {
      const spaces = await listSpaces(serverUrl, secret);
      this.adminSecret = secret;
      this.adminServerUrl = serverUrl;
      this.serverUrlInput = serverUrl;
      this.setSpaces(spaces);
      this.errorMessage = '';
      // Save successful URL to history
      addAdminServerUrl(serverUrl);
      this.savedServerUrls = getAdminServerUrls();
      void this.loadSpaceCollectionsForAll(spaces, serverUrl, secret);
    } catch (error) {
      this.adminSecret = null;
      this.adminServerUrl = null;
      this.setSpaces([]);
      this.spaceCardState = {};
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to connect to server';
    } finally {
      this.isConnecting = false;
    }
  };

  private handleLogout = () => {
    const nextServerUrl = this.adminServerUrl ?? this.getDefaultServerUrl();

    this.adminSecret = null;
    this.adminServerUrl = null;
    this.secretInput = '';
    this.serverUrlInput = nextServerUrl;
    this.spaces = [];
    this.newSpaceName = '';
    this.newSpaceQuotaMb = '';
    this.spaceCardState = {};
    this.errorMessage = '';
  };

  private handleUrlSelect = (url: string) => {
    this.serverUrlInput = url;
    this.showUrlDropdown = false;
  };

  private handleUrlRemove = (e: Event, url: string) => {
    e.stopPropagation();
    removeAdminServerUrl(url);
    this.savedServerUrls = getAdminServerUrls();
  };

  private handleUrlInputFocus = () => {
    if (this.savedServerUrls.length > 0) {
      this.showUrlDropdown = true;
    }
  };

  private handleUrlInputBlur = () => {
    // Small delay to allow click events on dropdown items to register
    setTimeout(() => {
      this.showUrlDropdown = false;
    }, 200);
  };

  private handleCreateSpace = async (e: Event) => {
    e.preventDefault();
    if (!this.newSpaceName.trim() || !this.adminSecret || !this.adminServerUrl) {
      return;
    }

    const serverUrl = this.adminServerUrl;
    const adminSecret = this.adminSecret;

    const quotaMb = this.newSpaceQuotaMb.trim();
    const maxUploadSize =
      quotaMb !== '' ? Math.round(parseFloat(quotaMb) * 1024 * 1024) : null;

    if (maxUploadSize !== null && (!Number.isFinite(maxUploadSize) || maxUploadSize <= 0)) {
      this.errorMessage = 'Upload quota must be a positive number';
      return;
    }

    this.isCreatingSpace = true;
    this.errorMessage = '';

    try {
      const space = await createSpace(serverUrl, adminSecret, this.newSpaceName, maxUploadSize);

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      this.setSpaces([space, ...this.spaces]);
      this.newSpaceName = '';
      this.newSpaceQuotaMb = '';
      void this.loadSpaceCollections(space.id, serverUrl, adminSecret);
    } catch (error) {
      if (this.isUnauthorizedError(error)) {
        this.handleUnauthorized();
        return;
      }
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to create space';
    } finally {
      this.isCreatingSpace = false;
    }
  };

  private handleGenerateInvitation = async (spaceId: string) => {
    if (!this.adminSecret || !this.adminServerUrl) return;

    const serverUrl = this.adminServerUrl;
    const adminSecret = this.adminSecret;
    const state = this.getSpaceCardState(spaceId);

    this.updateSpaceCardState(spaceId, {
      invitationGenerationError: '',
      isGeneratingInvitation: true,
    });

    try {
      const invitation = await createInvitation(
        serverUrl,
        adminSecret,
        spaceId,
        state.clientAppUrl.trim() || undefined,
      );

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      this.updateSpaceCardState(spaceId, {
        generatedInvitation: invitation,
        invitationGenerationError: '',
        isGeneratingInvitation: false,
      });
      void this.loadSpaceCollections(spaceId, serverUrl, adminSecret, {
        invitations: true,
        members: false,
      });
    } catch (error) {
      if (this.isUnauthorizedError(error)) {
        this.handleUnauthorized();
        return;
      }

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      this.updateSpaceCardState(spaceId, {
        invitationGenerationError:
          error instanceof Error ? error.message : 'Failed to generate invitation',
        isGeneratingInvitation: false,
      });
    }
  };

  private handleRevokeMember = async (spaceId: string, memberId: string) => {
    if (!this.adminSecret || !this.adminServerUrl) return;

    const serverUrl = this.adminServerUrl;
    const adminSecret = this.adminSecret;
    const currentState = this.getSpaceCardState(spaceId);

    this.updateSpaceCardState(spaceId, {
      membersError: '',
      pendingMemberRevocations: this.getPendingState(
        currentState.pendingMemberRevocations,
        memberId,
        true,
      ),
    });

    try {
      await revokeMember(serverUrl, adminSecret, spaceId, memberId);

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      const latestState = this.getSpaceCardState(spaceId);
      this.updateSpaceCardState(spaceId, {
        members: latestState.members.map((member) =>
          member.id === memberId ? { ...member, isRevoked: true } : member,
        ),
        pendingMemberRevocations: this.getPendingState(
          latestState.pendingMemberRevocations,
          memberId,
          false,
        ),
      });
    } catch (error) {
      if (this.isUnauthorizedError(error)) {
        this.handleUnauthorized();
        return;
      }

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      const latestState = this.getSpaceCardState(spaceId);
      this.updateSpaceCardState(spaceId, {
        membersError:
          error instanceof Error ? error.message : 'Failed to revoke member',
        pendingMemberRevocations: this.getPendingState(
          latestState.pendingMemberRevocations,
          memberId,
          false,
        ),
      });
    }
  };

  private handleRemoveMember = async (spaceId: string, memberId: string) => {
    if (!this.adminSecret || !this.adminServerUrl) return;

    if (
      !confirm(
        'Permanently remove this member and all their items? This cannot be undone.',
      )
    ) {
      return;
    }

    const serverUrl = this.adminServerUrl;
    const adminSecret = this.adminSecret;
    const currentState = this.getSpaceCardState(spaceId);

    this.updateSpaceCardState(spaceId, {
      membersError: '',
      pendingMemberRemovals: this.getPendingState(
        currentState.pendingMemberRemovals,
        memberId,
        true,
      ),
    });

    try {
      await removeMember(serverUrl, adminSecret, spaceId, memberId);

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      const latestState = this.getSpaceCardState(spaceId);
      this.updateSpaceCardState(spaceId, {
        members: latestState.members.filter((member) => member.id !== memberId),
        pendingMemberRemovals: this.getPendingState(
          latestState.pendingMemberRemovals,
          memberId,
          false,
        ),
      });
    } catch (error) {
      if (this.isUnauthorizedError(error)) {
        this.handleUnauthorized();
        return;
      }

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      const latestState = this.getSpaceCardState(spaceId);
      this.updateSpaceCardState(spaceId, {
        membersError:
          error instanceof Error ? error.message : 'Failed to remove member',
        pendingMemberRemovals: this.getPendingState(
          latestState.pendingMemberRemovals,
          memberId,
          false,
        ),
      });
    }
  };

  private handleDeleteInvitation = async (
    spaceId: string,
    invitationId: string,
  ) => {
    if (!this.adminSecret || !this.adminServerUrl) return;

    const serverUrl = this.adminServerUrl;
    const adminSecret = this.adminSecret;
    const currentState = this.getSpaceCardState(spaceId);

    this.updateSpaceCardState(spaceId, {
      invitationsError: '',
      pendingInvitationDeletions: this.getPendingState(
        currentState.pendingInvitationDeletions,
        invitationId,
        true,
      ),
    });

    try {
      await deleteInvitation(serverUrl, adminSecret, spaceId, invitationId);

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      const latestState = this.getSpaceCardState(spaceId);
      this.updateSpaceCardState(spaceId, {
        invitations: latestState.invitations.filter(
          (invitation) => invitation.id !== invitationId,
        ),
        pendingInvitationDeletions: this.getPendingState(
          latestState.pendingInvitationDeletions,
          invitationId,
          false,
        ),
      });
    } catch (error) {
      if (this.isUnauthorizedError(error)) {
        this.handleUnauthorized();
        return;
      }

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      const latestState = this.getSpaceCardState(spaceId);
      this.updateSpaceCardState(spaceId, {
        invitationsError:
          error instanceof Error ? error.message : 'Failed to delete invitation',
        pendingInvitationDeletions: this.getPendingState(
          latestState.pendingInvitationDeletions,
          invitationId,
          false,
        ),
      });
    }
  };

  private handleCopyInvitation = (invitationString: string) => {
    navigator.clipboard.writeText(invitationString).catch(() => {
      this.errorMessage = 'Failed to copy to clipboard';
    });
  };

  private openModal(type: 'members' | 'invitations' | 'invite', spaceId: string) {
    this.activeModal = { type, spaceId };
    this.handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.closeModal();
    };
    document.addEventListener('keydown', this.handleEscapeKey);
  }

  private closeModal = () => {
    if (this.handleEscapeKey) {
      document.removeEventListener('keydown', this.handleEscapeKey);
      this.handleEscapeKey = null;
    }
    this.activeModal = null;
  };

  private handleEscapeKey: ((e: KeyboardEvent) => void) | null = null;

  private handleModalBackdropClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this.closeModal();
    }
  };

  override render() {
    if (!this.adminSecret || !this.adminServerUrl) {
      return this.renderSecretPrompt();
    }

    return html`
      <div class="space-y-4">
        ${this.renderConnectionCard()}
        ${this.renderCreateSpaceForm()}
        ${this.spaces.map((space) => this.renderSpaceCard(space))}
      </div>
      ${this.activeModal ? this.renderModal() : null}
    `;
  }

  private renderSecretPrompt() {
    return html`
      <div class="space-y-6">
        <div>
          <h2 class="text-xl font-semibold text-white">Admin Access</h2>
          <p class="mt-1 text-sm text-slate-400">
            Enter a server URL and admin secret to continue
          </p>
        </div>

        <form @submit=${this.handleSecretSubmit} class="space-y-4">
          <div class="grid gap-4">
            <div class="space-y-2">
              <label
                for="admin-server-url"
                class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
              >
                Server URL
              </label>
              <div class="relative">
                <input
                  id="admin-server-url"
                  type="text"
                  .value=${this.serverUrlInput}
                  @input=${(e: InputEvent) =>
                    (this.serverUrlInput = (e.target as HTMLInputElement).value)}
                  @focus=${this.handleUrlInputFocus}
                  @blur=${this.handleUrlInputBlur}
                  placeholder="https://api.example.com"
                  class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                />
                ${this.showUrlDropdown && this.savedServerUrls.length > 0
                  ? html`
                      <div
                        class="absolute z-10 mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 shadow-lg"
                      >
                        ${this.savedServerUrls.map(
                          (url) => html`
                            <div
                              class="flex items-center justify-between border-b border-slate-700 last:border-b-0"
                            >
                              <button
                                type="button"
                                @click=${() => this.handleUrlSelect(url)}
                                class="flex-1 px-4 py-3 text-left text-sm text-slate-50 hover:bg-slate-700/50"
                              >
                                ${url}
                              </button>
                              <button
                                type="button"
                                @click=${(e: Event) => this.handleUrlRemove(e, url)}
                                class="px-3 py-3 text-slate-400 hover:text-red-400"
                                title="Remove from history"
                                aria-label=${`Remove ${url} from history`}
                              >
                                ✕
                              </button>
                            </div>
                          `,
                        )}
                      </div>
                    `
                  : null}
              </div>
            </div>

            <div class="space-y-2">
              <label
                for="admin-secret"
                class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
              >
                Admin Secret
              </label>
              <input
                id="admin-secret"
                type="password"
                .value=${this.secretInput}
                @input=${(e: InputEvent) =>
                  (this.secretInput = (e.target as HTMLInputElement).value)}
                placeholder="Enter admin secret"
                class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              />
            </div>
          </div>

          ${this.errorMessage
            ? html`
                <div
                  class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
                >
                  ${this.errorMessage}
                </div>
              `
            : null}

          <button
            type="submit"
            ?disabled=${this.isConnecting || !this.secretInput.trim() || !this.serverUrlInput.trim()}
            class="w-full rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ${this.isConnecting ? 'Connecting...' : 'Continue'}
          </button>
        </form>
      </div>
    `;
  }

  private renderConnectionCard() {
    return html`
      <div
        class="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3"
      >
        <p class="min-w-0 truncate text-sm text-slate-400">
          Connected to
          <span class="font-mono text-xs text-slate-300">${this.adminServerUrl}</span>
        </p>
        <button
          type="button"
          @click=${this.handleLogout}
          class="shrink-0 rounded-full border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
        >
          Log out
        </button>
      </div>
    `;
  }

  private renderCreateSpaceForm() {
    return html`
      <form
        @submit=${this.handleCreateSpace}
        class="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3"
      >
        <div class="flex gap-3">
          <input
            id="space-name"
            type="text"
            .value=${this.newSpaceName}
            @input=${(e: InputEvent) =>
              (this.newSpaceName = (e.target as HTMLInputElement).value)}
            placeholder="New space name…"
            class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
            ?disabled=${this.isCreatingSpace}
          />
          <button
            type="submit"
            ?disabled=${this.isCreatingSpace || !this.newSpaceName.trim()}
            class="shrink-0 rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ${this.isCreatingSpace ? 'Creating…' : 'Create'}
          </button>
        </div>
        <div class="flex items-center gap-3">
          <input
            id="space-quota"
            type="number"
            min="0"
            step="any"
            .value=${this.newSpaceQuotaMb}
            @input=${(e: InputEvent) =>
              (this.newSpaceQuotaMb = (e.target as HTMLInputElement).value)}
            placeholder="Upload quota (MB)"
            class="w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
            ?disabled=${this.isCreatingSpace}
          />
          <span class="text-xs text-slate-500">Default: server configured</span>
        </div>
      </form>

      ${this.errorMessage
        ? html`
            <div
              class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
            >
              ${this.errorMessage}
            </div>
          `
        : null}
    `;
  }

  private renderSpaceCard(space: SpaceResponse) {
    const state = this.getSpaceCardState(space.id);

    return html`
      <div class="rounded-xl border border-slate-800 bg-slate-900/50">
        <div class="px-4 py-4">
          <h3 class="text-base font-semibold text-white">${space.name}</h3>
          <p class="mt-0.5 font-mono text-xs text-slate-500">${space.id}</p>
          <p class="text-xs text-slate-500">
            Created ${this.formatDate(space.createdAt)}
          </p>
          <p class="text-xs text-slate-500">
            Upload quota: ${this.formatBytesAsMb(space.effectiveMaxUploadSize)}${space.maxUploadSize == null ? ' (default)' : ''}
          </p>
        </div>

        <div class="divide-y divide-slate-800">
          <button
            type="button"
            @click=${() => this.openModal('members', space.id)}
            class="flex w-full items-center justify-between px-4 py-3 text-sm text-slate-300 transition hover:bg-slate-800/50"
          >
            <span>Members (${state.members.length})</span>
            <span class="text-slate-500">›</span>
          </button>

          <button
            type="button"
            @click=${() => this.openModal('invitations', space.id)}
            class="flex w-full items-center justify-between px-4 py-3 text-sm text-slate-300 transition hover:bg-slate-800/50"
          >
            <span>Invitations (${state.invitations.length})</span>
            <span class="text-slate-500">›</span>
          </button>

          <button
            type="button"
            @click=${() => this.openModal('invite', space.id)}
            class="flex w-full items-center justify-between rounded-b-xl px-4 py-3 text-sm text-sky-300 transition hover:bg-slate-800/50"
          >
            <span>Invite</span>
            <span class="text-slate-500">›</span>
          </button>
        </div>
      </div>
    `;
  }

  private renderModal() {
    if (!this.activeModal) return null;

    const space = this.spaces.find((s) => s.id === this.activeModal!.spaceId);
    if (!space) return null;

    const state = this.getSpaceCardState(space.id);

    let title = '';
    let content = html``;

    switch (this.activeModal.type) {
      case 'members':
        title = `Members — ${space.name}`;
        content = this.renderMembersModalContent(space.id, state);
        break;
      case 'invitations':
        title = `Invitations — ${space.name}`;
        content = this.renderInvitationsModalContent(space.id, state);
        break;
      case 'invite':
        title = `Invite — ${space.name}`;
        content = this.renderInviteModalContent(space.id, state);
        break;
    }

    return html`
      <div
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
        @click=${this.handleModalBackdropClick}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          class="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        >
          <div class="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <h3 id="modal-title" class="text-sm font-semibold text-white">${title}</h3>
            <button
              type="button"
              @click=${this.closeModal}
              aria-label="Close dialog"
              class="rounded-full p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            >
              ✕
            </button>
          </div>

          <div class="max-h-[60vh] overflow-y-auto px-5 py-4">
            ${content}
          </div>
        </div>
      </div>
    `;
  }

  private renderMembersModalContent(spaceId: string, state: SpaceCardState) {
    if (state.isLoadingMembers) {
      return html`<p class="text-sm text-slate-500">Loading members…</p>`;
    }

    if (state.membersError) {
      return html`
        <div class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          ${state.membersError}
        </div>
      `;
    }

    if (state.members.length === 0) {
      return html`<p class="text-sm text-slate-500">No members yet.</p>`;
    }

    return html`
      <div class="divide-y divide-slate-800">
        ${state.members.map((member) => {
          const isRevokePending = !!state.pendingMemberRevocations[member.id];
          const isRemovePending = !!state.pendingMemberRemovals[member.id];
          return html`
            <div class="flex items-center justify-between gap-3 py-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p
                    class=${member.isRevoked
                      ? 'text-sm font-medium text-slate-500 line-through'
                      : 'text-sm font-medium text-slate-100'}
                  >
                    ${member.displayName}
                  </p>
                  ${member.isRevoked
                    ? html`
                        <span
                          class="rounded-full border border-rose-800 bg-rose-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-200"
                        >
                          Revoked
                        </span>
                      `
                    : null}
                </div>
                <p class="text-xs text-slate-500">
                  Joined ${this.formatDate(member.joinedAt)}
                </p>
              </div>

              ${member.isRevoked
                ? html`
                    <button
                      type="button"
                      @click=${() => this.handleRemoveMember(spaceId, member.id)}
                      ?disabled=${isRemovePending}
                      class="shrink-0 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400 transition hover:border-red-700 hover:bg-red-950/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ${isRemovePending ? 'Removing…' : 'Remove'}
                    </button>
                  `
                : html`
                    <button
                      type="button"
                      @click=${() => this.handleRevokeMember(spaceId, member.id)}
                      ?disabled=${isRevokePending}
                      class="shrink-0 rounded-full border border-rose-800 bg-rose-950/40 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/70 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ${isRevokePending ? 'Revoking…' : 'Revoke'}
                    </button>
                  `}
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderInvitationsModalContent(spaceId: string, state: SpaceCardState) {
    if (state.isLoadingInvitations) {
      return html`<p class="text-sm text-slate-500">Loading invitations…</p>`;
    }

    if (state.invitationsError) {
      return html`
        <div class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          ${state.invitationsError}
        </div>
      `;
    }

    if (state.invitations.length === 0) {
      return html`<p class="text-sm text-slate-500">No pending invitations.</p>`;
    }

    return html`
      <div class="divide-y divide-slate-800">
        ${state.invitations.map((invitation) => {
          const isPending = !!state.pendingInvitationDeletions[invitation.id];
          return html`
            <div class="flex items-center justify-between gap-3 py-3">
              <p class="min-w-0 break-all font-mono text-xs text-slate-300">
                ${invitation.id}
              </p>
              <button
                type="button"
                @click=${() => this.handleDeleteInvitation(spaceId, invitation.id)}
                ?disabled=${isPending}
                class="shrink-0 rounded-full border border-rose-800 bg-rose-950/40 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ${isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderInviteModalContent(spaceId: string, state: SpaceCardState) {
    return html`
      <div class="space-y-4">
        <div class="space-y-2">
          <label class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Client App URL
          </label>
          <div class="flex gap-3">
            <input
              type="url"
              .value=${state.clientAppUrl}
              @input=${(e: InputEvent) =>
                this.updateSpaceCardState(spaceId, {
                  clientAppUrl: (e.target as HTMLInputElement).value,
                })}
              placeholder="https://app.example.com"
              class="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              ?disabled=${state.isGeneratingInvitation}
            />
            <button
              type="button"
              @click=${() => this.handleGenerateInvitation(spaceId)}
              ?disabled=${state.isGeneratingInvitation}
              class="shrink-0 rounded-full bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ${state.isGeneratingInvitation ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>

        ${state.invitationGenerationError
          ? html`
              <div class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                ${state.invitationGenerationError}
              </div>
            `
          : null}

        ${state.generatedInvitation
          ? this.renderGeneratedInvitation(state.generatedInvitation)
          : null}
      </div>
    `;
  }

  private renderGeneratedInvitation(invitation: InvitationResponse) {
    return html`
      <div class="space-y-3">
        <div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Invitation String
          </p>
          <div class="flex gap-2">
            <input
              type="text"
              readonly
              .value=${invitation.invitationString}
              class="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-emerald-300"
            />
            <button
              type="button"
              @click=${() => this.handleCopyInvitation(invitation.invitationString)}
              class="rounded-full border border-emerald-700 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/30"
              title="Copy to clipboard"
            >
              📋 Copy
            </button>
          </div>
        </div>

        ${invitation.qrCodeBase64
          ? html`
              <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
                  QR Code
                </p>
                <img
                  src="data:image/png;base64,${invitation.qrCodeBase64}"
                  alt="QR Code"
                  class="rounded border border-emerald-800 bg-white p-2"
                  style="width: 200px; height: 200px;"
                />
              </div>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'admin-view': AdminView;
  }
}

