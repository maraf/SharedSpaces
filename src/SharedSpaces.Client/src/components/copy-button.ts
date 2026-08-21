import { html, type TemplateResult } from 'lit';

/** Default duration the "copied" confirmation stays visible. */
export const COPY_FEEDBACK_MS = 1500;

/**
 * Copies `text` to the clipboard and drives the transient "copied" feedback
 * state via `setCopied`. Clipboard failures (for example in insecure contexts)
 * are swallowed and no feedback is shown.
 *
 * Returns the reset timer handle so callers that need to cancel it (for example
 * when a dialog closes) can clear it.
 */
export async function copyWithFeedback(
  text: string,
  setCopied: (copied: boolean) => void,
  resetMs: number = COPY_FEEDBACK_MS,
): Promise<number | null> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API may fail in insecure contexts; silently ignore.
    return null;
  }

  setCopied(true);
  return globalThis.setTimeout(() => setCopied(false), resetMs);
}

export interface CopyButtonOptions {
  /** Whether the button is in the "just copied" state. */
  copied: boolean;
  onClick: () => void;
  /** Tooltip shown in the idle state. Replaced by "Copied!" when copied. */
  title: string;
  /** Accessible label shown in the idle state. */
  ariaLabel: string;
  /** Icon size in pixels. Defaults to 20. */
  size?: number;
  /** Tailwind classes applied to the button element. */
  buttonClass?: string;
}

const DEFAULT_BUTTON_CLASS =
  'cursor-pointer rounded p-2 text-slate-500 transition hover:text-slate-300';

function renderCheckIcon(size: number) {
  return html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-400"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
}

function renderCopyIcon(size: number) {
  return html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
}

/**
 * Renders the shared "copy to clipboard" icon button that swaps to a green
 * check mark while `copied` is true.
 */
export function renderCopyButton(options: CopyButtonOptions): TemplateResult {
  const {
    copied,
    onClick,
    title,
    ariaLabel,
    size = 20,
    buttonClass = DEFAULT_BUTTON_CLASS,
  } = options;

  return html`
    <button
      @click=${onClick}
      class=${buttonClass}
      title=${copied ? 'Copied!' : title}
      aria-label=${copied ? 'Copied to clipboard' : ariaLabel}
    >
      ${copied ? renderCheckIcon(size) : renderCopyIcon(size)}
    </button>
  `;
}
