import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Capture the `controllerchange` handler registered by initSwUpdate so the test
 * can simulate the service worker taking control of the page.
 */
function setupServiceWorkerMock() {
  let controllerChangeHandler: (() => void) | undefined;

  const serviceWorkerMock = {
    register: vi.fn().mockResolvedValue({
      waiting: { postMessage: vi.fn() },
      addEventListener: vi.fn(),
    }),
    addEventListener: vi.fn((type: string, handler: () => void) => {
      if (type === 'controllerchange') {
        controllerChangeHandler = handler;
      }
    }),
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    value: serviceWorkerMock,
    configurable: true,
  });

  return {
    fireControllerChange: () => controllerChangeHandler?.(),
    waitingPostMessage: async () => {
      const reg = await serviceWorkerMock.register.mock.results[0]?.value;
      return reg.waiting.postMessage as ReturnType<typeof vi.fn>;
    },
  };
}

describe('sw-update', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Fresh module state per test (module uses module-level flags).
    vi.resetModules();
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not reload on the initial controllerchange (first clients.claim())', async () => {
    const sw = setupServiceWorkerMock();
    const { initSwUpdate } = await import('./sw-update');

    await initSwUpdate({ onUpdateAvailable: () => {} });
    sw.fireControllerChange();

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('reloads on controllerchange after the user activates an update', async () => {
    const sw = setupServiceWorkerMock();
    const { initSwUpdate, activateUpdate } = await import('./sw-update');

    await initSwUpdate({ onUpdateAvailable: () => {} });
    activateUpdate();
    sw.fireControllerChange();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads only once even if controllerchange fires multiple times', async () => {
    const sw = setupServiceWorkerMock();
    const { initSwUpdate, activateUpdate } = await import('./sw-update');

    await initSwUpdate({ onUpdateAvailable: () => {} });
    activateUpdate();
    sw.fireControllerChange();
    sw.fireControllerChange();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('activateUpdate posts SKIP_WAITING to the waiting worker', async () => {
    const sw = setupServiceWorkerMock();
    const { initSwUpdate, activateUpdate } = await import('./sw-update');

    await initSwUpdate({ onUpdateAvailable: () => {} });
    activateUpdate();

    const postMessage = await sw.waitingPostMessage();
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
