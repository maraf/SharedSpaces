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
const SPACES_CACHE_KEY = 'sharedspaces.admin-spaces';

@customElement('admin-view')
export class AdminView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  @state() private adminSecret: string | null = null;
  @state() private secretInput = '';
  @state() private isAuthenticating = false;

  @state() private spaces: SpaceResponse[] = [];
  @state() private newSpaceName = '';
  @state() private isCreatingSpace = false;
  @state() private errorMessage = '';

  @state() private invitationFormState: Record<
    string,
    {
      isGenerating: boolean;
      clientAppUrl: string;
      invitation: InvitationResponse | null;
      error: string;
    }
  > = {};

  override connectedCallback() {
    super.connectedCallback();
    this.loadAdminSecret();
    this.loadSpaces();
  }

  private loadAdminSecret() {
    this.adminSecret = localStorage.getItem(ADMIN_SECRET_KEY);
  }

  private loadSpaces() {
    try {
      const cached = localStorage.getItem(SPACES_CACHE_KEY);
      if (cached) {
        this.spaces = JSON.parse(cached);
      }
    } catch {
      this.spaces = [];
    }
  }

  private saveSpaces() {
    localStorage.setItem(SPACES_CACHE_KEY, JSON.stringify(this.spaces));
  }

  private handleSecretSubmit = async (e: Event) => {
    e.preventDefault();
    if (!this.secretInput.trim()) return;

    this.isAuthenticating = true;
    this.errorMessage = '';

    try {
      await createSpace(this.apiBaseUrl, this.secretInput, '__test_auth__');
      localStorage.setItem(ADMIN_SECRET_KEY, this.secretInput);
      this.adminSecret = this.secretInput;
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        this.errorMessage = 'Invalid admin secret. Please try again.';
      } else {
        this.errorMessage =
          error instanceof Error ? error.message : 'Failed to authenticate';
      }
    } finally {
      this.isAuthenticating = false;
    }
  };

  private handleLogout = () => {
    localStorage.removeItem(ADMIN_SECRET_KEY);
    this.adminSecret = null;
    this.secretInput = '';
    this.errorMessage = '';
  };

  private handleCreateSpace = async (e: Event) => {
    e.preventDefault();
    if (!this.newSpaceName.trim() || !this.adminSecret) return;

    this.isCreatingSpace = true;
    this.errorMessage = '';

    try {
      const space = await createSpace(
        this.apiBaseUrl,
        this.adminSecret,
        this.newSpaceName,
      );
      this.spaces = [space, ...this.spaces];
      this.saveSpaces();
      this.newSpaceName = '';
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to create space';
    } finally {
      this.isCreatingSpace = false;
    }
  };

  private getInvitationState(spaceId: string) {
    if (!this.invitationFormState[spaceId]) {
      this.invitationFormState[spaceId] = {
        isGenerating: false,
        clientAppUrl: window.location.origin,
        invitation: null,
        error: '',
      };
    }
    return this.invitationFormState[spaceId];
  }

  private handleGenerateInvitation = async (spaceId: string) => {
    if (!this.adminSecret) return;

    const state = this.getInvitationState(spaceId);
    state.isGenerating = true;
    state.error = '';
    this.requestUpdate();

    try {
      const invitation = await createInvitation(
        this.apiBaseUrl,
        this.adminSecret,
        spaceId,
        state.clientAppUrl.trim() || undefined,
      );
      state.invitation = invitation;
    } catch (error) {
      state.error =
        error instanceof Error ? error.message : 'Failed to generate invitation';
    } finally {
      state.isGenerating = false;
      this.requestUpdate();
    }
  };

  private handleCopyInvitation = (invitationString: string) => {
    navigator.clipboard.writeText(invitationString).catch(() => {
      this.errorMessage = 'Failed to copy to clipboard';
    });
  };

  override render() {
    if (!this.adminSecret) {
      return this.renderSecretPrompt();
    }

    return html`
      <view-card
        headline="Admin Panel"
        supporting-text="Manage spaces and generate invitation links"
      >
        ${this.renderCreateSpaceForm()} ${this.renderSpacesList()}
        <div class="flex justify-end">
          <button
            @click=${this.handleLogout}
            class="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-900"
          >
            Log out
          </button>
        </div>
      </view-card>
    `;
  }

  private renderSecretPrompt() {
    return html`
      <view-card
        headline="Admin Access"
        supporting-text="Enter your admin secret to continue"
      >
        <form
          @submit=${this.handleSecretSubmit}
          class="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 space-y-4"
        >
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
              ?disabled=${this.isAuthenticating}
            />
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
            ?disabled=${this.isAuthenticating || !this.secretInput.trim()}
            class="w-full rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ${this.isAuthenticating ? 'Authenticating...' : 'Continue'}
          </button>
        </form>
      </view-card>
    `;
  }

  private renderCreateSpaceForm() {
    return html`
      <form
        @submit=${this.handleCreateSpace}
        class="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 space-y-4"
      >
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
    `;
  }

  private renderSpacesList() {
    if (this.spaces.length === 0) {
      return html`
        <div
          class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-8 text-center"
        >
          <p class="text-sm text-slate-400">
            No spaces yet. Create one to get started.
          </p>
        </div>
      `;
    }

    return html`
      <div class="space-y-4">
        <p
          class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
        >
          Spaces (${this.spaces.length})
        </p>
        <div class="space-y-3">
          ${this.spaces.map((space) => this.renderSpaceCard(space))}
        </div>
      </div>
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
              @input=${(e: InputEvent) => {
                state.clientAppUrl = (e.target as HTMLInputElement).value;
                this.requestUpdate();
              }}
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

