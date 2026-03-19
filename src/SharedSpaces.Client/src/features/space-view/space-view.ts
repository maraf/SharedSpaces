import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '../../components/view-card';
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
    const body = html`
      <div class="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
        <section
          class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p
                class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
              >
                Item feed
              </p>
              <h2 class="mt-2 text-xl font-semibold text-white">No items yet</h2>
            </div>
            <span
              class="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300"
            >
              Empty state ready
            </span>
          </div>
          <div
            class="mt-4 rounded-2xl border border-dashed border-slate-700 p-6 text-sm text-slate-300"
          >
            Uploaded files and shared text will appear here with SignalR-driven
            updates.
          </div>
        </section>

        <aside
          class="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
        >
          <div>
            <p
              class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400"
            >
              Connection
            </p>
            ${this.spaceId
              ? html`<p class="mt-2 text-sm text-slate-300">
                  Space ID:
                  <span class="block break-all font-mono text-xs text-sky-300">${this.spaceId}</span>
                </p>`
              : ''}
            ${this.serverUrl
              ? html`<p class="mt-2 text-sm text-slate-300">
                  Server:
                  <span class="block break-all font-mono text-xs text-sky-300">${this.serverUrl}</span>
                </p>`
              : ''}
          </div>
        </aside>
      </div>
    `;

    return html`
      <view-card
        headline="Space View"
        supporting-text="Real-time items, uploads, empty states, and member presence will grow from this shell."
        .body=${body}
      ></view-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'space-view': SpaceView;
  }
}
