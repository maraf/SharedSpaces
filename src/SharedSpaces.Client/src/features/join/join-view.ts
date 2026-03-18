import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { jwtDecode } from 'jwt-decode';

import '../../components/view-card';
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
    
    // Check URL for invitation parameter
    const urlInvitation = parseInvitationFromUrl();
    if (urlInvitation) {
      this.serverUrl = urlInvitation.serverUrl;
      this.spaceId = urlInvitation.spaceId;
      this.pin = urlInvitation.pin;
      this.invitationString = `${urlInvitation.serverUrl}|${urlInvitation.spaceId}|${urlInvitation.pin}`;
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
      <view-card
        headline="Join a Space"
        supporting-text="Enter your invitation details and display name to join a shared space."
      >
        <div class="grid gap-6">
          <!-- Invitation Entry -->
          <div
            class="rounded-2xl border border-slate-800 bg-slate-950/60 p-6"
          >
            <div class="flex items-center justify-between mb-4">
              <p
                class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
              >
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
                    <label
                      for="invitation"
                      class="block text-sm font-medium text-slate-300 mb-2"
                    >
                      Invitation String
                    </label>
                    <input
                      id="invitation"
                      type="text"
                      placeholder="https://server.com|space-id|123456"
                      .value=${this.invitationString}
                      @input=${this.handleInvitationPaste}
                      ?disabled=${this.isLoading}
                      class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                    />
                    <p class="mt-2 text-xs text-slate-400">
                      Paste the invitation string from your QR code or invitation link
                    </p>
                  </div>
                `
              : html`
                  <div class="grid gap-4">
                    <div>
                      <label
                        for="serverUrl"
                        class="block text-sm font-medium text-slate-300 mb-2"
                      >
                        Server URL
                      </label>
                      <input
                        id="serverUrl"
                        type="text"
                        placeholder="https://server.com"
                        .value=${this.serverUrl}
                        @input=${this.handleServerUrlInput}
                        ?disabled=${this.isLoading}
                        class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                      />
                    </div>
                    <div>
                      <label
                        for="spaceId"
                        class="block text-sm font-medium text-slate-300 mb-2"
                      >
                        Space ID
                      </label>
                      <input
                        id="spaceId"
                        type="text"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        .value=${this.spaceId}
                        @input=${this.handleSpaceIdInput}
                        ?disabled=${this.isLoading}
                        class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-mono text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                      />
                    </div>
                    <div>
                      <label
                        for="pin"
                        class="block text-sm font-medium text-slate-300 mb-2"
                      >
                        PIN
                      </label>
                      <input
                        id="pin"
                        type="text"
                        placeholder="123456"
                        .value=${this.pin}
                        @input=${this.handlePinInput}
                        ?disabled=${this.isLoading}
                        class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-mono text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                      />
                    </div>
                  </div>
                `}
          </div>

          <!-- Display Name -->
          <div
            class="rounded-2xl border border-slate-800 bg-slate-950/60 p-6"
          >
            <p
              class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 mb-4"
            >
              Identity
            </p>
            <div>
              <label
                for="displayName"
                class="block text-sm font-medium text-slate-300 mb-2"
              >
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                placeholder="Your name"
                .value=${this.displayName}
                @input=${this.handleDisplayNameInput}
                ?disabled=${this.isLoading}
                class="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              />
              <p class="mt-2 text-xs text-slate-400">
                This name will be visible to other members in the space
              </p>
            </div>
          </div>

          <!-- Error Message -->
          ${this.errorMessage
            ? html`
                <div
                  class="rounded-lg border border-red-800 bg-red-950/60 p-4 text-sm text-red-200"
                >
                  ${this.errorMessage}
                </div>
              `
            : ''}

          <!-- Join Button -->
          <button
            @click=${this.handleJoin}
            ?disabled=${this.isLoading}
            class="inline-flex items-center justify-center rounded-full bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ${this.isLoading ? 'Joining...' : 'Join Space'}
          </button>
        </div>
      </view-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'join-view': JoinView;
  }
}
