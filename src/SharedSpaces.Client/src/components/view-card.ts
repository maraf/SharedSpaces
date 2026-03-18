import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { BaseElement } from '../lib/base-element';

@customElement('view-card')
export class ViewCard extends BaseElement {
  @property({ type: String }) headline = '';

  @property({ type: String, attribute: 'supporting-text' })
  supportingText = '';

  override render() {
    return html`
      <section
        class="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur sm:p-8"
      >
        <header class="space-y-3 border-b border-slate-800 pb-6">
          <p
            class="text-sm font-medium uppercase tracking-[0.3em] text-sky-300"
          >
            SharedSpaces client bootstrap
          </p>
          <div class="space-y-2">
            <h1
              class="text-3xl font-semibold tracking-tight text-white sm:text-4xl"
            >
              ${this.headline}
            </h1>
            ${this.supportingText
              ? html`<p class="max-w-2xl text-sm text-slate-300 sm:text-base">
                  ${this.supportingText}
                </p>`
              : null}
          </div>
        </header>
        <div class="mt-6 space-y-6">
          <slot></slot>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'view-card': ViewCard;
  }
}
