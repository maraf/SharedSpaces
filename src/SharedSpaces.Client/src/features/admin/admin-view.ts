import { html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { BaseElement } from '../../lib/base-element';

@customElement('admin-view')
export class AdminView extends BaseElement {
  override render() {
    return html`
      <section
        class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300"
      >
        Admin space management will land in issue #27.
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'admin-view': AdminView;
  }
}
