import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '../../components/view-card';
import { BaseElement } from '../../lib/base-element';
import type { AppViewChangeDetail } from '../../lib/navigation';

@customElement('join-view')
export class JoinView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  private handleContinue = () => {
    this.dispatchEvent(
      new CustomEvent<AppViewChangeDetail>('view-change', {
        bubbles: true,
        composed: true,
        detail: { view: 'space' },
      }),
    );
  };

  override render() {
    return html`
      <view-card
        headline="Join a Space"
        supporting-text="PIN entry, display name capture, loading states, and validation will land here next."
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <div
            class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-4"
          >
            <p
              class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
            >
              Invitation
            </p>
            <p class="mt-3 text-lg font-medium text-white">
              Paste a join link or PIN
            </p>
            <p class="mt-2 text-sm text-slate-300">
              This placeholder reserves space for QR parsing, manual PIN entry,
              and form validation.
            </p>
          </div>
          <div
            class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-4"
          >
            <p
              class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
            >
              Identity
            </p>
            <p class="mt-3 text-lg font-medium text-white">
              Choose a display name
            </p>
            <p class="mt-2 text-sm text-slate-300">
              Saved identities and future auth context will plug into this
              panel.
            </p>
          </div>
        </div>

        <div
          class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300"
        >
          <p class="font-medium text-slate-100">Runtime API base URL</p>
          <p class="mt-2 break-all font-mono text-xs text-sky-300">
            ${this.apiBaseUrl}
          </p>
        </div>

        <div
          class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <button
            class="inline-flex items-center justify-center rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
            @click=${this.handleContinue}
          >
            Open placeholder space
          </button>
          <p class="text-sm text-slate-400">
            Tailwind utilities render in light DOM through BaseElement.
          </p>
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
