import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { jwtDecode } from 'jwt-decode';

import { BaseElement } from '../../lib/base-element';
import type { AppViewChangeDetail } from '../../lib/navigation';
import { exchangeToken, TokenExchangeError } from '../../lib/api-client';
import {
  parseInvitationString,
  parseInvitationFromUrl,
} from '../../lib/invitation';
import {
  getPrimaryDisplayName,
  setPrimaryDisplayName,
  setToken,
} from '../../lib/token-storage';

interface JwtClaims {
  sub: string;
  display_name: string;
  server_url: string;
  space_id: string;
  space_name: string;
}

@customElement('join-view')
export class JoinView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  @state() private invitationString = '';
  @state() private serverUrl = '';
  @state() private spaceId = '';
  @state() private pin = '';
  @state() private displayName = '';
  @state() private isLoading = false;
  @state() private errorMessage = '';
  @state() private entryMode: 'paste' | 'manual' = 'paste';

  override connectedCallback() {
    super.connectedCallback();
    
    // Check URL for join query parameter
    const urlInvitation = parseInvitationFromUrl();
    if (urlInvitation) {
      this.serverUrl = urlInvitation.serverUrl;
      this.spaceId = urlInvitation.spaceId;
      this.pin = urlInvitation.pin;
      this.invitationString = `${urlInvitation.serverUrl}|${urlInvitation.spaceId}|${urlInvitation.pin}`;

      // Strip only the join query parameter from URL
      const url = new URL(window.location.href);
      url.searchParams.delete('join');
      window.history.replaceState({}, '', url.pathname + url.search);
    }

    // Pre-fill display name from localStorage
    this.displayName = getPrimaryDisplayName();
  }

  private handleInvitationPaste = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.invitationString = input.value;
    this.errorMessage = '';

    // Auto-parse invitation string
    const parsed = parseInvitationString(this.invitationString);
    if (parsed) {
      this.serverUrl = parsed.serverUrl;
      this.spaceId = parsed.spaceId;
      this.pin = parsed.pin;
    } else {
      this.serverUrl = '';
      this.spaceId = '';
      this.pin = '';
    }
  };

  private handleServerUrlInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.serverUrl = input.value;
    this.errorMessage = '';
  };

  private handleSpaceIdInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.spaceId = input.value;
    this.errorMessage = '';
  };

  private handlePinInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.pin = input.value;
    this.errorMessage = '';
  };

  private handleDisplayNameInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.displayName = input.value;
    this.errorMessage = '';
  };

  private toggleEntryMode = () => {
    this.entryMode = this.entryMode === 'paste' ? 'manual' : 'paste';
    this.errorMessage = '';
  };

  private handleJoin = async () => {
    this.errorMessage = '';

    // Validate inputs
    if (!this.serverUrl || !this.spaceId || !this.pin) {
      this.errorMessage = 'Please provide server URL, space ID, and PIN.';
      return;
    }

    if (!this.displayName.trim()) {
      this.errorMessage = 'Please enter a display name.';
      return;
    }

    this.isLoading = true;

    try {
      // Exchange PIN for JWT
      const response = await exchangeToken(
        this.serverUrl,
        this.spaceId,
        this.pin,
        this.displayName.trim()
      );

      // Decode JWT to extract claims
      const claims = jwtDecode<JwtClaims>(response.token);

      // Store token
      setToken(claims.server_url, claims.space_id, response.token);

      // Save display name as primary for future use
      setPrimaryDisplayName(this.displayName.trim());

      // Navigate to space view
      this.dispatchEvent(
        new CustomEvent<AppViewChangeDetail>('view-change', {
          bubbles: true,
          composed: true,
          detail: {
            view: 'space',
            spaceId: claims.space_id,
            serverUrl: claims.server_url,
            token: response.token,
            displayName: claims.display_name,
            spaceName: claims.space_name,
          },
        })
      );
    } catch (error) {
      if (error instanceof TokenExchangeError) {
        this.errorMessage = error.message;
      } else {
        this.errorMessage = 'An unexpected error occurred. Please try again.';
      }
    } finally {
      this.isLoading = false;
    }
  };

  override render() {
    return html`
      <div class="mx-auto max-w-lg space-y-8">
        <div>
          <h2 class="text-2xl font-semibold tracking-tight text-white">
            Join a Space
          </h2>
          <p class="mt-1 text-sm text-slate-400">
            Enter your invitation details and display name.
          </p>
        </div>

        <!-- Invitation -->
        <section class="space-y-4">
          <div class="flex items-center justify-between">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Invitation
            </p>
            <button
              @click=${this.toggleEntryMode}
              class="text-xs text-sky-400 hover:text-sky-300 transition"
              ?disabled=${this.isLoading}
            >
              ${this.entryMode === 'paste' ? 'Enter manually' : 'Paste invitation'}
            </button>
          </div>

          ${this.entryMode === 'paste'
            ? html`
                <div>
                  <input
                    id="invitation"
                    type="text"
                    placeholder="https://server.com|space-id|123456"
                    .value=${this.invitationString}
                    @input=${this.handleInvitationPaste}
                    ?disabled=${this.isLoading}
                    class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                  />
                  <p class="mt-2 text-xs text-slate-500">
                    Paste the invitation string from your QR code or link
                  </p>
                </div>
              `
            : html`
                <div class="space-y-3">
                  <input
                    id="serverUrl"
                    type="text"
                    placeholder="Server URL"
                    .value=${this.serverUrl}
                    @input=${this.handleServerUrlInput}
                    ?disabled=${this.isLoading}
                    class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                  />
                  <input
                    id="spaceId"
                    type="text"
                    placeholder="Space ID"
                    .value=${this.spaceId}
                    @input=${this.handleSpaceIdInput}
                    ?disabled=${this.isLoading}
                    class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-mono text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                  />
                  <input
                    id="pin"
                    type="text"
                    placeholder="PIN"
                    .value=${this.pin}
                    @input=${this.handlePinInput}
                    ?disabled=${this.isLoading}
                    class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-mono text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                  />
                </div>
              `}
        </section>

        <hr class="border-slate-800/60" />

        <!-- Display Name -->
        <section class="space-y-4">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Identity
          </p>
          <div>
            <input
              id="displayName"
              type="text"
              placeholder="Your display name"
              .value=${this.displayName}
              @input=${this.handleDisplayNameInput}
              ?disabled=${this.isLoading}
              class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
            />
            <p class="mt-2 text-xs text-slate-500">
              Visible to other members in the space
            </p>
          </div>
        </section>

        <!-- Error -->
        ${this.errorMessage
          ? html`<p class="text-sm text-red-400">${this.errorMessage}</p>`
          : ''}

        <!-- Join Button -->
        <button
          @click=${this.handleJoin}
          ?disabled=${this.isLoading}
          class="w-full rounded-full bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ${this.isLoading ? 'Joining...' : 'Join Space'}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'join-view': JoinView;
  }
}
