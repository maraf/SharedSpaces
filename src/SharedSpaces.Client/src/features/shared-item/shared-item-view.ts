import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { BaseElement } from '../../lib/base-element';
import { getFileTypeIcon, getTextItemIcon } from '../../lib/file-icons';
import { getFilePreviewType, isPreviewable } from '../space-view/file-preview';
import {
  getSharedItem,
  downloadSharedItem,
  SharedItemApiError,
  type SharedItemResponse,
} from './shared-item-api';

@customElement('shared-item-view')
export class SharedItemView extends BaseElement {
  @property({ type: String }) token = '';
  @property({ type: String }) apiBaseUrl = '/';

  @state() private item: SharedItemResponse | null = null;
  @state() private isLoading = true;
  @state() private errorMessage = '';
  @state() private previewUrl: string | null = null;
  @state() private previewText: string | null = null;
  @state() private previewLoading = false;

  override connectedCallback() {
    super.connectedCallback();
    if (this.token) {
      this.loadItem();
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('token') && this.token) {
      this.loadItem();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
    }
  }

  private async loadItem() {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
    }
    this.previewUrl = null;
    this.previewText = null;
    this.previewLoading = false;
    this.isLoading = true;
    this.errorMessage = '';
    this.item = null;

    try {
      this.item = await getSharedItem(this.apiBaseUrl, this.token);

      // Auto-load preview for previewable files within size limits
      if (this.item.contentType === 'file' && isPreviewable(this.item.content)) {
        this.loadPreview();
      }
    } catch (error) {
      if (error instanceof SharedItemApiError) {
        this.errorMessage = error.message;
      } else {
        this.errorMessage = 'Failed to load shared item.';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async loadPreview() {
    if (!this.item) return;

    this.previewLoading = true;
    try {
      const blob = await downloadSharedItem(this.apiBaseUrl, this.token);
      const previewType = getFilePreviewType(this.item.content);

      if (previewType === 'text') {
        this.previewText = await blob.text();
      } else {
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = URL.createObjectURL(blob);
      }
    } catch {
      // Preview is optional; fail silently
    } finally {
      this.previewLoading = false;
    }
  }

  private handleDownload = async () => {
    try {
      const blob = await downloadSharedItem(this.apiBaseUrl, this.token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.item?.content ?? 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Download failures are non-critical
    }
  };

  private handleCopyText = async () => {
    if (!this.item) return;
    try {
      await navigator.clipboard.writeText(this.item.content);
    } catch {
      // Clipboard may fail in insecure contexts
    }
  };

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    const size = bytes / Math.pow(1024, i);
    return `${i === 0 ? size : size.toFixed(1)} ${units[i]}`;
  }

  override render() {
    return html`
      <div class="flex min-h-svh flex-col bg-slate-950 text-slate-50">
        <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8 sm:px-6">
          <!-- Header -->
          <div class="mb-8 text-center">
            <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-300">
              SharedSpaces
            </p>
          </div>

          <!-- Content -->
          <div class="flex flex-1 flex-col items-center justify-start">
            ${this.isLoading
              ? this.renderLoading()
              : this.errorMessage
                ? this.renderError()
                : this.item
                  ? this.renderItem()
                  : nothing}
          </div>
        </div>
      </div>
    `;
  }

  private renderLoading() {
    return html`
      <div class="flex items-center gap-3 py-16">
        <svg class="h-5 w-5 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm text-slate-400">Loading shared item…</p>
      </div>
    `;
  }

  private renderError() {
    return html`
      <div class="w-full max-w-md space-y-4 py-16 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-800/60">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-400"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
        </div>
        <p class="text-sm text-slate-400">${this.errorMessage}</p>
      </div>
    `;
  }

  private renderItem() {
    if (!this.item) return nothing;

    return this.item.contentType === 'text'
      ? this.renderTextItem()
      : this.renderFileItem();
  }

  private renderTextItem() {
    if (!this.item) return nothing;
    const icon = getTextItemIcon();

    return html`
      <div class="w-full max-w-lg space-y-4">
        <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
              ${icon.svg}
            </div>
            <p class="text-xs text-slate-500">Shared text</p>
          </div>
          <p class="whitespace-pre-wrap break-words text-sm text-slate-200">
            ${this.item.content}
          </p>
        </div>
        <div class="flex justify-center">
          <button
            @click=${this.handleCopyText}
            class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy text
          </button>
        </div>
      </div>
    `;
  }

  private renderFileItem() {
    if (!this.item) return nothing;
    const icon = getFileTypeIcon(this.item.content);
    const previewType = getFilePreviewType(this.item.content);

    return html`
      <div class="w-full max-w-lg space-y-4">
        <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="shrink-0 ${icon.colorClass}" aria-hidden="true">
              ${icon.svg}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-200" title=${this.item.content}>
                ${this.item.content}
              </p>
              <p class="text-xs text-slate-500">${this.formatFileSize(this.item.fileSize)}</p>
            </div>
          </div>

          ${this.renderFilePreview(previewType)}
        </div>

        <div class="flex justify-center">
          <button
            @click=${this.handleDownload}
            class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download
          </button>
        </div>
      </div>
    `;
  }

  private renderFilePreview(previewType: string) {
    if (this.previewLoading) {
      return html`
        <div class="flex items-center justify-center py-8">
          <svg class="h-6 w-6 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="ml-3 text-sm text-slate-400">Loading preview…</span>
        </div>
      `;
    }

    switch (previewType) {
      case 'image':
        return this.previewUrl
          ? html`<img
              src=${this.previewUrl}
              alt=${this.item?.content ?? 'Image preview'}
              class="max-h-[50vh] max-w-full rounded object-contain"
            />`
          : nothing;

      case 'video':
        return this.previewUrl
          ? html`<video
              src=${this.previewUrl}
              controls
              class="max-h-[50vh] max-w-full rounded"
            >Your browser does not support video playback.</video>`
          : nothing;

      case 'audio':
        return this.previewUrl
          ? html`<audio src=${this.previewUrl} controls class="w-full">
              Your browser does not support audio playback.
            </audio>`
          : nothing;

      case 'pdf':
        return this.previewUrl
          ? html`<iframe
              src=${this.previewUrl}
              class="h-[50vh] w-full rounded border border-slate-700"
              title=${this.item?.content ?? 'PDF preview'}
            ></iframe>`
          : nothing;

      case 'text':
        return this.previewText
          ? html`<p class="whitespace-pre-wrap break-words font-mono text-sm text-slate-200">${this.previewText}</p>`
          : nothing;

      default:
        return nothing;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'shared-item-view': SharedItemView;
  }
}
