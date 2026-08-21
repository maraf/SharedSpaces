import { html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { BaseElement } from '../lib/base-element';

/** How long the "copied" confirmation stays visible. */
export const COPY_FEEDBACK_MS = 1500;

function renderIcon(size: number, copied: boolean) {
  return copied
    ? html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-400"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
}

/**
 * Self-contained "copy to clipboard" icon button. Give it the text to copy and
 * it handles the clipboard write plus the transient green check mark itself, so
 * callers need no click handler or copied-state bookkeeping.
 *
 * Clipboard failures (for example in insecure contexts) are swallowed and no
 * confirmation is shown.
 */
@customElement('copy-button')
export class CopyButton extends BaseElement {
  /** Text placed on the clipboard when the button is clicked. */
  @property({ type: String }) text = '';

  /** Tooltip shown in the idle state. Replaced by "Copied!" once copied. */
  @property({ type: String }) label = 'Copy to clipboard';

  /** Accessible label shown in the idle state. */
  @property({ type: String, attribute: 'idle-aria-label' })
  idleAriaLabel = 'Copy to clipboard';

  /** Icon size in pixels. */
  @property({ type: Number }) size = 20;

  /** Tailwind classes applied to the inner button element. */
  @property({ type: String, attribute: 'button-class' })
  buttonClass = 'cursor-pointer rounded p-2 text-slate-500 transition hover:text-slate-300';

  @state() private copied = false;

  private resetTimer: number | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearResetTimer();
    this.copied = false;
  }

  /**
   * Copies the current `text` and shows the confirmation. Exposed so flows that
   * reach the clipboard by another route (for example a share button falling
   * back to a copy) can surface the same feedback on this button.
   */
  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text);
    } catch {
      // Clipboard API may fail in insecure contexts; silently ignore.
      return;
    }

    this.clearResetTimer();
    this.copied = true;
    this.resetTimer = globalThis.setTimeout(() => {
      this.copied = false;
      this.resetTimer = null;
    }, COPY_FEEDBACK_MS);
  }

  private clearResetTimer() {
    if (this.resetTimer !== null) {
      globalThis.clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  private handleClick = () => {
    void this.copy();
  };

  override render(): TemplateResult {
    return html`
      <button
        @click=${this.handleClick}
        class=${this.buttonClass}
        title=${this.copied ? 'Copied!' : this.label}
        aria-label=${this.copied ? 'Copied to clipboard' : this.idleAriaLabel}
      >
        ${renderIcon(this.size, this.copied)}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'copy-button': CopyButton;
  }
}
