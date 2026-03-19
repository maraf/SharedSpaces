import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { BaseElement } from '../../lib/base-element';

@customElement('space-view')
export class SpaceView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  @property({ type: String, attribute: 'space-id' })
  spaceId?: string;

  @property({ type: String, attribute: 'server-url' })
  serverUrl?: string;

  override render() {
    return html`
      <div class="space-y-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Item feed
            </p>
            <h2 class="mt-1 text-xl font-semibold text-white">No items yet</h2>
          </div>
          <span
            class="mt-1 shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300"
          >
            Connected
          </span>
        </div>

        <p class="text-sm text-slate-400">
          Uploaded files and shared text will appear here with real-time updates.
        </p>

        <hr class="border-slate-800/60" />

        <div class="flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-500">
          ${this.spaceId
            ? html`<span>Space <span class="font-mono text-xs text-slate-400">${this.spaceId}</span></span>`
            : ''}
          ${this.serverUrl
            ? html`<span>Server <span class="font-mono text-xs text-slate-400">${this.serverUrl}</span></span>`
            : ''}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'space-view': SpaceView;
  }
}
