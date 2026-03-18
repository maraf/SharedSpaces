import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '../../components/view-card';
import { BaseElement } from '../../lib/base-element';
import type { AppViewChangeDetail } from '../../lib/navigation';

@customElement('space-view')
export class SpaceView extends BaseElement {
  @property({ type: String, attribute: 'api-base-url' })
  apiBaseUrl = '/';

  private handleBack = () => {
    this.dispatchEvent(
      new CustomEvent<AppViewChangeDetail>('view-change', {
        bubbles: true,
        composed: true,
        detail: { view: 'join' },
      }),
    );
  };

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
            <p class="mt-2 text-sm text-slate-300">
              Runtime API base URL:
              <span class="break-all font-mono text-xs text-sky-300"
                >${this.apiBaseUrl}</span
              >
            </p>
          </div>
          <div
            class="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-300"
          >
            SignalR client wrapper and auth state placeholders live under
            <code class="rounded bg-slate-900 px-1.5 py-0.5 text-sky-300"
              >src/lib</code
            >.
          </div>
        </aside>
      </div>

      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <button
          class="inline-flex items-center justify-center rounded-full border border-slate-700 px-5 py-3 text-sm font-semibold text-white transition hover:border-slate-500 hover:bg-slate-800"
          @click=${this.handleBack}
        >
          Back to join
        </button>
        <p class="text-sm text-slate-400">
          Use this view switcher until real routing arrives.
        </p>
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
