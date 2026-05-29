import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Capture the `controllerchange` handler registered by initSwUpdate so the test
 * can simulate the service worker taking control of the page.
 */
function setupServiceWorkerMock(opts: { waiting?: boolean } = {}) {
  let controllerChangeHandler: (() => void) | undefined;
  const postMessage = vi.fn();
  const registration = {
    waiting: opts.waiting ? { postMessage } : null,
    addEventListener: vi.fn(),
  };

  const serviceWorkerMock = {
    register: vi.fn().mockResolvedValue(registration),
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
    postMessage,
  };
}

function setDev(value: boolean) {
  (import.meta.env as unknown as Record<string, unknown>).DEV = value;
}

describe('sw-update', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  const originalDev = import.meta.env.DEV;

  beforeEach(() => {
    // Fresh module state per test (module uses module-level flags).
    vi.resetModules();
    // Default to production so the core gating logic is tested deterministically.
    setDev(false);
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    setDev(originalDev);
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
    const sw = setupServiceWorkerMock({ waiting: true });
    const { initSwUpdate, activateUpdate } = await import('./sw-update');

    await initSwUpdate({ onUpdateAvailable: () => {} });
    activateUpdate();
    sw.fireControllerChange();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads only once even if controllerchange fires multiple times', async () => {
    const sw = setupServiceWorkerMock({ waiting: true });
    const { initSwUpdate, activateUpdate } = await import('./sw-update');

    await initSwUpdate({ onUpdateAvailable: () => {} });
    activateUpdate();
    sw.fireControllerChange();
    sw.fireControllerChange();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('activateUpdate posts SKIP_WAITING to the waiting worker', async () => {
    const sw = setupServiceWorkerMock({ waiting: true });
    const { initSwUpdate, activateUpdate } = await import('./sw-update');

    await initSwUpdate({ onUpdateAvailable: () => {} });
    activateUpdate();

    expect(sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('in production, a waiting update does not auto-activate or reload', async () => {
    setDev(false);
    const sw = setupServiceWorkerMock({ waiting: true });
    const { initSwUpdate } = await import('./sw-update');

    const onUpdateAvailable = vi.fn();
    await initSwUpdate({ onUpdateAvailable });
    sw.fireControllerChange();

    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(sw.postMessage).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('in dev, a waiting update auto-activates and reloads without a manual click', async () => {
    setDev(true);
    const sw = setupServiceWorkerMock({ waiting: true });
    const { initSwUpdate } = await import('./sw-update');

    const onUpdateAvailable = vi.fn();
    await initSwUpdate({ onUpdateAvailable });
    // No explicit activateUpdate() call — dev should apply it automatically.
    sw.fireControllerChange();

    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
