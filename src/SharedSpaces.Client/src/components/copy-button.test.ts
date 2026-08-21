import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CopyButton } from './copy-button';
import './copy-button';

describe('CopyButton', () => {
  let element: CopyButton;
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    element = document.createElement('copy-button');
    element.text = 'hello';
    document.body.appendChild(element);
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
    vi.useRealTimers();
  });

  const button = () => element.querySelector('button') as HTMLButtonElement;

  it('copies its text and shows confirmation for 1500ms', async () => {
    expect(button().getAttribute('aria-label')).toBe('Copy to clipboard');

    button().click();
    await Promise.resolve();
    await element.updateComplete;

    expect(writeTextMock).toHaveBeenCalledWith('hello');
    expect(button().getAttribute('aria-label')).toBe('Copied to clipboard');
    expect(button().getAttribute('title')).toBe('Copied!');

    await vi.advanceTimersByTimeAsync(1500);
    await element.updateComplete;

    expect(button().getAttribute('aria-label')).toBe('Copy to clipboard');
  });

  it('uses the configured labels in the idle state', async () => {
    element.label = 'Copy space Id';
    element.idleAriaLabel = 'Copy space Id to clipboard';
    await element.updateComplete;

    expect(button().getAttribute('title')).toBe('Copy space Id');
    expect(button().getAttribute('aria-label')).toBe('Copy space Id to clipboard');
  });

  it('shows no confirmation when the clipboard write fails', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('insecure context'));

    button().click();
    await Promise.resolve();
    await Promise.resolve();
    await element.updateComplete;

    expect(button().getAttribute('aria-label')).toBe('Copy to clipboard');
  });

  it('restarts the reset window on a repeated click', async () => {
    button().click();
    await Promise.resolve();
    await element.updateComplete;

    await vi.advanceTimersByTimeAsync(1000);
    button().click();
    await Promise.resolve();
    await element.updateComplete;

    await vi.advanceTimersByTimeAsync(600);
    await element.updateComplete;
    expect(button().getAttribute('aria-label')).toBe('Copied to clipboard');

    await vi.advanceTimersByTimeAsync(900);
    await element.updateComplete;
    expect(button().getAttribute('aria-label')).toBe('Copy to clipboard');
  });

  it('copies programmatically via copy()', async () => {
    await element.copy();
    await element.updateComplete;

    expect(writeTextMock).toHaveBeenCalledWith('hello');
    expect(button().getAttribute('aria-label')).toBe('Copied to clipboard');
  });

  it('clears the pending reset timer when disconnected', async () => {
    button().click();
    await Promise.resolve();
    await element.updateComplete;

    element.remove();
    await vi.advanceTimersByTimeAsync(1500);

    document.body.appendChild(element);
    await element.updateComplete;
    expect(button().getAttribute('aria-label')).toBe('Copy to clipboard');
  });
});
