import { provide } from '@lit/context';
import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './features/admin/admin-view';
import './features/join/join-view';
import './features/space-view/space-view';
import {
  appContext,
  getRuntimeAppConfig,
  type AppConfig,
} from './lib/app-context';
import { BaseElement } from './lib/base-element';
import type { AppView, AppViewChangeDetail } from './lib/navigation';

@customElement('app-shell')
export class AppShell extends BaseElement {
  @property({ type: String }) view: AppView = 'join';

  @provide({ context: appContext })
  private appConfig: AppConfig = getRuntimeAppConfig();

  private handleViewChange = (event: CustomEvent<AppViewChangeDetail>) => {
    this.view = event.detail.view;
  };

  override render() {
    return html`
      <div
        class="min-h-svh bg-slate-950 px-4 py-6 text-slate-50 sm:px-6 lg:px-8"
      >
        <div
          class="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-5xl flex-col gap-6"
        >
          <header
            class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <p
                class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-300"
              >
                SharedSpaces
              </p>
              <h1
                class="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl"
              >
                Lit HTML + WebComponents shell
              </h1>
            </div>
            <div class="flex items-center gap-3">
              <button
                @click=${() => (this.view = 'admin')}
                class="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-900"
                title="Admin panel"
              >
                ⚙️ Admin
              </button>
              <div
                class="rounded-full border border-slate-800 bg-slate-900/80 px-4 py-2 text-sm text-slate-300"
              >
                Current view:
                <span class="ml-2 font-semibold text-white">${this.view}</span>
              </div>
            </div>
          </header>

          <main
            class="flex flex-1 items-center"
            @view-change=${this.handleViewChange}
          >
            ${this.view === 'join'
              ? html`<join-view
                  class="w-full"
                  .apiBaseUrl=${this.appConfig.apiBaseUrl}
                ></join-view>`
              : this.view === 'space'
                ? html`<space-view
                    class="w-full"
                    .apiBaseUrl=${this.appConfig.apiBaseUrl}
                  ></space-view>`
                : html`<admin-view
                    class="w-full"
                    .apiBaseUrl=${this.appConfig.apiBaseUrl}
                  ></admin-view>`}
          </main>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
