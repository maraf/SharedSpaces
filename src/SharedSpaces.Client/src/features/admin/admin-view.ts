import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '../../components/view-card';
import { BaseElement } from '../../lib/base-element';
import {
  AdminApiError,
  createInvitation,
  createSpace,
  type InvitationResponse,
  type SpaceResponse,
} from './admin-api';

const ADMIN_SECRET_KEY = 'sharedspaces.admin-secret';
const ADMIN_SERVER_URL_KEY = 'sharedspaces.admin-server-url';
const SPACES_CACHE_KEY = 'sharedspaces.admin-spaces';

type InvitationFormState = {
  isGenerating: boolean;
  clientAppUrl: string;
  invitation: InvitationResponse | null;
  error: string;
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
  @state() private errorMessage = '';

  @state() private invitationFormState: Record<string, InvitationFormState> = {};

  override connectedCallback() {
    super.connectedCallback();
    this.loadAdminSession();
    this.loadSpaces();
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

  private createInvitationState(): InvitationFormState {
    return {
      isGenerating: false,
      clientAppUrl: window.location.origin,
      invitation: null,
      error: '',
    };
  }

  private setSpaces(spaces: SpaceResponse[]) {
    this.spaces = spaces;
    this.invitationFormState = Object.fromEntries(
      spaces.map((space) => [
        space.id,
        this.invitationFormState[space.id] ?? this.createInvitationState(),
      ]),
    ) as Record<string, InvitationFormState>;
  }

  private ensureInvitationState(spaceId: string) {
    if (this.invitationFormState[spaceId]) {
      return this.invitationFormState[spaceId];
    }

    const nextState = {
      ...this.invitationFormState,
      [spaceId]: this.createInvitationState(),
    };

    this.invitationFormState = nextState;
    return nextState[spaceId];
  }

  private updateInvitationState(
    spaceId: string,
    updates: Partial<InvitationFormState>,
  ) {
    const current = this.invitationFormState[spaceId] ?? this.createInvitationState();
    const nextState = {
      ...this.invitationFormState,
      [spaceId]: {
        ...current,
        ...updates,
      },
    };

    this.invitationFormState = nextState;
    return nextState[spaceId];
  }

  private loadAdminSession() {
    const storedSecret = localStorage.getItem(ADMIN_SECRET_KEY);
    const storedServerUrl = this.normalizeServerUrl(
      localStorage.getItem(ADMIN_SERVER_URL_KEY) ?? '',
    );
    const activeServerUrl = storedServerUrl || this.getDefaultServerUrl();

    this.secretInput = storedSecret ?? '';
    this.serverUrlInput = activeServerUrl;
    this.adminSecret = storedSecret;
    this.adminServerUrl = storedSecret ? activeServerUrl : null;

    if (storedSecret && !storedServerUrl) {
      localStorage.setItem(ADMIN_SERVER_URL_KEY, activeServerUrl);
    }
  }

  private loadSpaces(serverUrl = this.adminServerUrl ?? this.serverUrlInput) {
    const normalizedServerUrl = this.normalizeServerUrl(serverUrl);
    if (!normalizedServerUrl) {
      this.setSpaces([]);
      return;
    }

    try {
      const cached = localStorage.getItem(SPACES_CACHE_KEY);
      if (!cached) {
        this.setSpaces([]);
        return;
      }

      const parsed: unknown = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        this.setSpaces(parsed);
        localStorage.setItem(
          SPACES_CACHE_KEY,
          JSON.stringify({ [normalizedServerUrl]: parsed }),
        );
        return;
      }

      if (parsed && typeof parsed === 'object') {
        this.setSpaces(
          (parsed as Record<string, SpaceResponse[]>)[normalizedServerUrl] ?? [],
        );
        return;
      }
    } catch {
      // Ignore malformed cache and reset below.
    }

    this.setSpaces([]);
  }

  private saveSpaces() {
    if (!this.adminServerUrl) return;

    try {
      const cached = localStorage.getItem(SPACES_CACHE_KEY);
      const parsed: unknown = cached ? JSON.parse(cached) : {};
      const spacesByServer =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, SpaceResponse[]>)
          : {};

      spacesByServer[this.adminServerUrl] = this.spaces;
      localStorage.setItem(SPACES_CACHE_KEY, JSON.stringify(spacesByServer));
    } catch {
      localStorage.setItem(
        SPACES_CACHE_KEY,
        JSON.stringify({ [this.adminServerUrl]: this.spaces }),
      );
    }
  }

  private handleSecretSubmit = (e: Event) => {
    e.preventDefault();
    const serverUrl = this.normalizeServerUrl(this.serverUrlInput);
    if (!this.secretInput.trim() || !serverUrl) return;

    localStorage.setItem(ADMIN_SECRET_KEY, this.secretInput);
    localStorage.setItem(ADMIN_SERVER_URL_KEY, serverUrl);
    this.adminSecret = this.secretInput;
    this.adminServerUrl = serverUrl;
    this.serverUrlInput = serverUrl;
    this.invitationFormState = {};
    this.loadSpaces(serverUrl);
    this.errorMessage = '';
  };

  private handleLogout = () => {
    localStorage.removeItem(ADMIN_SECRET_KEY);
    localStorage.removeItem(ADMIN_SERVER_URL_KEY);
    this.adminSecret = null;
    this.adminServerUrl = null;
    this.secretInput = '';
    this.serverUrlInput = this.getDefaultServerUrl();
    this.invitationFormState = {};
    this.errorMessage = '';
  };

  private handleCreateSpace = async (e: Event) => {
    e.preventDefault();
    if (!this.newSpaceName.trim() || !this.adminSecret || !this.adminServerUrl) {
      return;
    }

    this.isCreatingSpace = true;
    this.errorMessage = '';

    try {
      const space = await createSpace(
        this.adminServerUrl,
        this.adminSecret,
        this.newSpaceName,
      );
      this.setSpaces([space, ...this.spaces]);
      this.saveSpaces();
      this.newSpaceName = '';
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        this.handleLogout();
        this.errorMessage = 'Invalid admin secret. Please re-enter.';
        return;
      }
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to create space';
    } finally {
      this.isCreatingSpace = false;
    }
  };

  private getInvitationState(spaceId: string) {
    return this.invitationFormState[spaceId] ?? this.createInvitationState();
  }

  private handleGenerateInvitation = async (spaceId: string) => {
    if (!this.adminSecret || !this.adminServerUrl) return;

    const state = this.ensureInvitationState(spaceId);
    this.updateInvitationState(spaceId, { isGenerating: true, error: '' });

    try {
      const invitation = await createInvitation(
        this.adminServerUrl,
        this.adminSecret,
        spaceId,
        state.clientAppUrl.trim() || undefined,
      );
      this.updateInvitationState(spaceId, {
        invitation,
        error: '',
        isGenerating: false,
      });
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        this.handleLogout();
        this.errorMessage = 'Invalid admin secret. Please re-enter.';
        return;
      }
      this.updateInvitationState(spaceId, {
        error:
          error instanceof Error ? error.message : 'Failed to generate invitation',
        isGenerating: false,
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

    const body = html`
      ${this.renderAuthenticatedHeader()} ${this.renderSpacesSection()}
    `;

    return html`
      <view-card
        headline="Admin Panel"
        supporting-text="Manage spaces and generate invitation links"
        .body=${body}
      ></view-card>
    `;
  }

  private renderSecretPrompt() {
    const body = html`
      <form
        @submit=${this.handleSecretSubmit}
        class="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6"
      >
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <label
              for="admin-server-url"
              class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
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
              class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
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
          ?disabled=${!this.secretInput.trim() || !this.serverUrlInput.trim()}
          class="w-full rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </form>
    `;

    return html`
      <view-card
        headline="Admin Access"
        supporting-text="Enter a server URL and admin secret to continue"
        .body=${body}
      ></view-card>
    `;
  }

  private renderAuthenticatedHeader() {
    return html`
      <div
        class="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:flex-row md:items-center md:justify-between"
      >
        <div class="space-y-2">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
          >
            Connected Server
          </p>
          <p class="break-all text-sm text-slate-50">${this.adminServerUrl}</p>
        </div>
        <button
          @click=${this.handleLogout}
          class="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-900"
        >
          Log out
        </button>
      </div>
    `;
  }

  private renderSpacesSection() {
    return html`
      <section class="space-y-6 rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
        <div class="space-y-1">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
          >
            Spaces (${this.spaces.length})
          </p>
          <p class="text-sm text-slate-400">
            Create and manage spaces from one place.
          </p>
        </div>

        <form @submit=${this.handleCreateSpace} class="space-y-4">
          <div class="space-y-2">
            <label
              for="space-name"
              class="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
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
                  class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
                >
                  ${this.errorMessage}
                </div>
              `
            : null}
        </form>

        ${this.spaces.length === 0
          ? html`
              <div
                class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-8 text-center"
              >
                <p class="text-sm text-slate-400">
                  No spaces yet. Create one to get started.
                </p>
              </div>
            `
          : html`
              <div class="space-y-3">
                ${this.spaces.map((space) => this.renderSpaceCard(space))}
              </div>
            `}
      </section>
    `;
  }

  private renderSpaceCard(space: SpaceResponse) {
    const state = this.getInvitationState(space.id);

    return html`
      <div
        class="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <h3 class="text-lg font-semibold text-white">${space.name}</h3>
            <p class="mt-1 text-xs text-slate-400 font-mono">${space.id}</p>
            <p class="mt-1 text-xs text-slate-500">
              Created ${new Date(space.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div class="space-y-3 border-t border-slate-800 pt-4">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
          >
            Generate Invitation
          </p>

          <div class="flex gap-3">
            <input
              type="url"
              .value=${state.clientAppUrl}
              @input=${(e: InputEvent) =>
                this.updateInvitationState(space.id, {
                  clientAppUrl: (e.target as HTMLInputElement).value,
                })}
              placeholder="Client app URL (optional)"
              class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-50 placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              ?disabled=${state.isGenerating}
            />
            <button
              @click=${() => this.handleGenerateInvitation(space.id)}
              ?disabled=${state.isGenerating}
              class="rounded-full bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ${state.isGenerating ? 'Generating...' : 'Generate'}
            </button>
          </div>

          ${state.error
            ? html`
                <div
                  class="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300"
                >
                  ${state.error}
                </div>
              `
            : null}
          ${state.invitation ? this.renderInvitation(state.invitation) : null}
        </div>
      </div>
    `;
  }

  private renderInvitation(invitation: InvitationResponse) {
    return html`
      <div
        class="rounded-xl border border-emerald-900 bg-emerald-950/30 p-4 space-y-4"
      >
        <div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Invitation String
          </p>
          <div class="flex gap-2">
            <input
              type="text"
              readonly
              .value=${invitation.invitationString}
              class="flex-1 rounded border border-emerald-800 bg-emerald-950/50 px-3 py-2 font-mono text-xs text-emerald-300"
            />
            <button
              @click=${() => this.handleCopyInvitation(invitation.invitationString)}
              class="rounded-full border border-emerald-700 bg-emerald-900/50 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900"
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

