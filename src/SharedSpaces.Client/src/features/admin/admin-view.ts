import { html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { BaseElement } from '../../lib/base-element';
import {
  AdminApiError,
  createInvitation,
  createSpace,
  deleteInvitation,
  listInvitations,
  listMembers,
  listSpaces,
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
};

@customElement('admin-view')
export class AdminView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  @state() private adminSecret: string | null = null;
  @state() private adminServerUrl: string | null = null;
  @state() private serverUrlInput = '/';
  @state() private secretInput = '';
  @state() private spaces: SpaceResponse[] = [];
  @state() private newSpaceName = '';
  @state() private isCreatingSpace = false;
  @state() private isConnecting = false;
  @state() private errorMessage = '';

  @state() private spaceCardState: Record<string, SpaceCardState> = {};

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (
      changedProperties.has('apiBaseUrl') &&
      !this.adminServerUrl &&
      (this.serverUrlInput === '/' || !this.serverUrlInput.trim())
    ) {
      this.serverUrlInput = this.getDefaultServerUrl();
    }
  }

  private normalizeServerUrl(serverUrl: string) {
    const trimmed = serverUrl.trim();
    if (!trimmed) return '';
    if (trimmed === '/') return '/';
    return trimmed.replace(/\/+$/, '');
  }

  private getDefaultServerUrl() {
    return this.normalizeServerUrl(this.apiBaseUrl) || '/';
  }

  private formatDate(value: string) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
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
    this.spaceCardState = {};
    this.errorMessage = '';
  };

  private handleCreateSpace = async (e: Event) => {
    e.preventDefault();
    if (!this.newSpaceName.trim() || !this.adminSecret || !this.adminServerUrl) {
      return;
    }

    const serverUrl = this.adminServerUrl;
    const adminSecret = this.adminSecret;

    this.isCreatingSpace = true;
    this.errorMessage = '';

    try {
      const space = await createSpace(serverUrl, adminSecret, this.newSpaceName);

      if (!this.isCurrentSession(serverUrl, adminSecret)) {
        return;
      }

      this.setSpaces([space, ...this.spaces]);
      this.newSpaceName = '';
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

  override render() {
    if (!this.adminSecret || !this.adminServerUrl) {
      return this.renderSecretPrompt();
    }

    return html`
      <div class="space-y-8">
        <div>
          <h2 class="text-xl font-semibold text-white">Admin Panel</h2>
          <p class="mt-1 text-sm text-slate-400">
            Manage spaces, members, and pending invitations
          </p>
        </div>
        ${this.renderAuthenticatedHeader()} ${this.renderSpacesSection()}
      </div>
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
          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label
                for="admin-server-url"
                class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
              >
                Server URL
              </label>
              <input
                id="admin-server-url"
                type="text"
                .value=${this.serverUrlInput}
                @input=${(e: InputEvent) =>
                  (this.serverUrlInput = (e.target as HTMLInputElement).value)}
                placeholder="https://api.example.com"
                class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              />
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

  private renderAuthenticatedHeader() {
    return html`
      <div
        class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
      >
        <p class="text-sm text-slate-400">
          Connected to
          <span class="font-mono text-xs text-slate-300">${this.adminServerUrl}</span>
        </p>
        <button
          type="button"
          @click=${this.handleLogout}
          class="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-900"
        >
          Log out
        </button>
      </div>

      <hr class="border-slate-800/60" />
    `;
  }

  private renderSpacesSection() {
    return html`
      <section class="space-y-6">
        <div class="flex items-baseline justify-between">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
          >
            Spaces (${this.spaces.length})
          </p>
        </div>

        <form @submit=${this.handleCreateSpace}>
          <div class="space-y-2">
            <label
              for="space-name"
              class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
            >
              Create New Space
            </label>
            <div class="flex gap-3">
              <input
                id="space-name"
                type="text"
                .value=${this.newSpaceName}
                @input=${(e: InputEvent) =>
                  (this.newSpaceName = (e.target as HTMLInputElement).value)}
                placeholder="Space name"
                class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                ?disabled=${this.isCreatingSpace}
              />
              <button
                type="submit"
                ?disabled=${this.isCreatingSpace || !this.newSpaceName.trim()}
                class="rounded-full bg-emerald-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ${this.isCreatingSpace ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>

          ${this.errorMessage
            ? html`
                <div
                  class="mt-4 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
                >
                  ${this.errorMessage}
                </div>
              `
            : null}
        </form>

        ${this.spaces.length === 0
          ? html`<p class="py-4 text-sm text-slate-500">
              No spaces yet. Create one to get started.
            </p>`
          : html`
              <div class="space-y-2">
                ${this.spaces.map((space, index) =>
                  this.renderSpaceCard(space, index < this.spaces.length - 1),
                )}
              </div>
            `}
      </section>
    `;
  }

  private renderSpaceCard(space: SpaceResponse, showDivider: boolean) {
    const state = this.getSpaceCardState(space.id);

    return html`
      <div class="space-y-5 pt-4">
        <div>
          <h3 class="text-lg font-semibold text-white">${space.name}</h3>
          <p class="mt-0.5 font-mono text-xs text-slate-500">${space.id}</p>
          <p class="text-xs text-slate-500">
            Created ${this.formatDate(space.createdAt)}
          </p>
        </div>

        <div class="space-y-3">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
          >
            Generate Invitation
          </p>

          <div class="flex gap-3">
            <input
              type="url"
              .value=${state.clientAppUrl}
              @input=${(e: InputEvent) =>
                this.updateSpaceCardState(space.id, {
                  clientAppUrl: (e.target as HTMLInputElement).value,
                })}
              placeholder="Client app URL (optional)"
              class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              ?disabled=${state.isGeneratingInvitation}
            />
            <button
              type="button"
              @click=${() => this.handleGenerateInvitation(space.id)}
              ?disabled=${state.isGeneratingInvitation}
              class="rounded-full bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ${state.isGeneratingInvitation ? 'Generating...' : 'Generate'}
            </button>
          </div>

          ${state.invitationGenerationError
            ? html`
                <div
                  class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
                >
                  ${state.invitationGenerationError}
                </div>
              `
            : null}
          ${state.generatedInvitation
            ? this.renderGeneratedInvitation(state.generatedInvitation)
            : null}
        </div>

        ${this.renderMembersSection(space.id, state)}
        ${this.renderInvitationsSection(space.id, state)}

        ${showDivider ? html`<hr class="border-slate-800/60" />` : null}
      </div>
    `;
  }

  private renderMembersSection(spaceId: string, state: SpaceCardState) {
    return html`
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
          >
            Members (${state.members.length})
          </p>
          ${state.isLoadingMembers
            ? html`<span class="text-xs text-slate-500">Loading...</span>`
            : null}
        </div>

        ${state.membersError
          ? html`
              <div
                class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
              >
                ${state.membersError}
              </div>
            `
          : null}

        ${state.members.length === 0 && !state.isLoadingMembers && !state.membersError
          ? html`<p class="text-sm text-slate-500">No members yet.</p>`
          : html`
              <div class="divide-y divide-slate-800/60">
                ${state.members.map((member) => {
                  const isPending = !!state.pendingMemberRevocations[member.id];
                  return html`
                    <div
                      class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div class="space-y-0.5">
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
                        <p
                          class=${member.isRevoked
                            ? 'text-xs text-slate-600'
                            : 'text-xs text-slate-500'}
                        >
                          Joined ${this.formatDate(member.joinedAt)}
                        </p>
                      </div>

                      ${member.isRevoked
                        ? null
                        : html`
                            <button
                              type="button"
                              @click=${() => this.handleRevokeMember(spaceId, member.id)}
                              ?disabled=${isPending}
                              class="rounded-full border border-rose-800 bg-rose-950/40 px-4 py-1.5 text-xs font-semibold text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/70 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              ${isPending ? 'Revoking...' : 'Revoke'}
                            </button>
                          `}
                    </div>
                  `;
                })}
              </div>
            `}
      </div>
    `;
  }

  private renderInvitationsSection(spaceId: string, state: SpaceCardState) {
    return html`
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
          >
            Pending Invitations (${state.invitations.length})
          </p>
          ${state.isLoadingInvitations
            ? html`<span class="text-xs text-slate-500">Loading...</span>`
            : null}
        </div>

        ${state.invitationsError
          ? html`
              <div
                class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
              >
                ${state.invitationsError}
              </div>
            `
          : null}

        ${state.invitations.length === 0 &&
        !state.isLoadingInvitations &&
        !state.invitationsError
          ? html`<p class="text-sm text-slate-500">No pending invitations</p>`
          : html`
              <div class="divide-y divide-slate-800/60">
                ${state.invitations.map((invitation) => {
                  const isPending =
                    !!state.pendingInvitationDeletions[invitation.id];
                  return html`
                    <div
                      class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div class="space-y-0.5">
                        <p class="text-xs text-slate-500">Invitation ID</p>
                        <p class="break-all font-mono text-sm text-slate-300">
                          ${invitation.id}
                        </p>
                      </div>
                      <button
                        type="button"
                        @click=${() =>
                          this.handleDeleteInvitation(spaceId, invitation.id)}
                        ?disabled=${isPending}
                        class="rounded-full border border-rose-800 bg-rose-950/40 px-4 py-1.5 text-xs font-semibold text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/70 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ${isPending ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  `;
                })}
              </div>
            `}
      </div>
    `;
  }

  private renderGeneratedInvitation(invitation: InvitationResponse) {
    return html`
      <div class="space-y-3 border-l-2 border-emerald-800 pl-4">
        <div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Invitation String
          </p>
          <div class="flex gap-2">
            <input
              type="text"
              readonly
              .value=${invitation.invitationString}
              class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300"
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
                <p
                  class="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400"
                >
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

