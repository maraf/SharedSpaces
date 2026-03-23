import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (must be before imports that trigger module resolution) ---

const mockConnection = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  onreconnecting: vi.fn(),
  onreconnected: vi.fn(),
  onclose: vi.fn(),
  state: 'Disconnected',
};

const mockBuilder = {
  withUrl: vi.fn().mockReturnThis(),
  withAutomaticReconnect: vi.fn().mockReturnThis(),
  build: vi.fn().mockReturnValue(mockConnection),
};

vi.mock('@microsoft/signalr', () => {
  class MockHubConnectionBuilder {
    withUrl = mockBuilder.withUrl;
    withAutomaticReconnect = mockBuilder.withAutomaticReconnect;
    build = mockBuilder.build;
  }

  return {
    HubConnectionBuilder: MockHubConnectionBuilder,
    HubConnectionState: {
      Connected: 'Connected',
      Connecting: 'Connecting',
      Disconnected: 'Disconnected',
      Reconnecting: 'Reconnecting',
      Disconnecting: 'Disconnecting',
    },
    HttpTransportType: {
      WebSockets: 1,
      ServerSentEvents: 2,
      LongPolling: 4,
    },
  };
});

const mockJwtDecode = vi.fn();
vi.mock('jwt-decode', () => ({
  jwtDecode: (...args: unknown[]) => mockJwtDecode(...args),
}));

const mockGetTokens = vi.fn<() => Record<string, string>>();
const mockGetToken = vi.fn();
vi.mock('./lib/token-storage', () => ({
  getTokens: () => mockGetTokens(),
  getToken: (...args: unknown[]) => mockGetToken(...args),
  setToken: vi.fn(),
  removeToken: vi.fn(),
  getPrimaryDisplayName: vi.fn().mockReturnValue(''),
  setPrimaryDisplayName: vi.fn(),
}));

vi.mock('./lib/idb-storage', () => ({
  getPendingShares: vi.fn().mockResolvedValue([]),
  removePendingShare: vi.fn().mockResolvedValue(undefined),
  clearPendingShares: vi.fn().mockResolvedValue(undefined),
}));

import './app-shell';
import { AppShell } from './app-shell';

// --- Test helpers ---

function setupSpaces(
  entries: { id: string; name: string; serverUrl?: string }[],
) {
  const tokens: Record<string, string> = {};
  for (const entry of entries) {
    const serverUrl = entry.serverUrl ?? 'http://localhost:5000';
    tokens[`${serverUrl}:${entry.id}`] = `tok-${entry.id}`;
  }

  mockGetTokens.mockReturnValue(tokens);

  mockGetToken.mockImplementation((serverUrl: string, spaceId: string) => {
    const key = `${serverUrl}:${spaceId}`;
    return tokens[key] ?? undefined;
  });

  mockJwtDecode.mockImplementation((token: string) => {
    const match = entries.find((e) => token === `tok-${e.id}`);
    return {
      server_url: match?.serverUrl ?? 'http://localhost:5000',
      space_id: match?.id ?? 'unknown',
      space_name: match?.name ?? 'Unknown',
      display_name: 'User',
    };
  });
}

function setupEmptySpaces() {
  mockGetTokens.mockReturnValue({});
  mockJwtDecode.mockReturnValue({
    server_url: 'http://localhost:5000',
    space_id: 'test',
    space_name: 'Test',
    display_name: 'User',
  });
}

describe('AppShell — Bottom Sheet Mobile Navigation (Issue #99)', () => {
  let element: AppShell;
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.classList.remove('overflow-hidden');

    // Default: simulate mobile viewport (max-width: 639px matches)
    matchMediaMock = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, 'matchMedia', {
      value: matchMediaMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (element?.parentNode) {
      element.remove();
    }
    document.body.classList.remove('overflow-hidden');
    vi.restoreAllMocks();
  });

  function createElement(): AppShell {
    element = document.createElement('app-shell') as AppShell;
    document.body.appendChild(element);
    return element;
  }

  // ── Sheet toggle ───────────────────────────────────────────────────

  describe('sheet toggle', () => {
    it('starts with sheetOpen = false', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      expect((element as any).sheetOpen).toBe(false);
    });

    it('opens sheet when bottom bar is clicked', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      // The bottom bar has a click handler that sets sheetOpen = true
      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden') as HTMLElement;
      expect(bottomBar).toBeTruthy();
      bottomBar.click();
      await element.updateComplete;

      expect((element as any).sheetOpen).toBe(true);
    });

    it('closes sheet when backdrop is clicked', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).sheetOpen = true;
      await element.updateComplete;

      // Backdrop is the fixed inset-0 z-40 element
      const backdrop = element.querySelector('.fixed.inset-0.z-40') as HTMLElement;
      expect(backdrop).toBeTruthy();
      backdrop.click();
      await element.updateComplete;

      expect((element as any).sheetOpen).toBe(false);
    });

    it('adds bottom-sheet-open class when sheet is open', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      const sheet = element.querySelector('.bottom-sheet') as HTMLElement;
      expect(sheet).toBeTruthy();
      expect(sheet.classList.contains('bottom-sheet-open')).toBe(false);

      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetAfter = element.querySelector('.bottom-sheet') as HTMLElement;
      expect(sheetAfter.classList.contains('bottom-sheet-open')).toBe(true);
    });

    it('sets aria-hidden=false when sheet is open, true when closed', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      const sheet = element.querySelector('.bottom-sheet') as HTMLElement;
      expect(sheet.getAttribute('aria-hidden')).toBe('true');

      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetOpen = element.querySelector('.bottom-sheet') as HTMLElement;
      expect(sheetOpen.getAttribute('aria-hidden')).toBe('false');
    });
  });

  // ── Sheet close on space selection ─────────────────────────────────

  describe('sheet close on space selection', () => {
    it('closes sheet when a space is clicked in the sheet', async () => {
      setupSpaces([
        { id: 'space-a', name: 'Alpha' },
        { id: 'space-b', name: 'Bravo' },
      ]);
      createElement();
      (element as any).sheetOpen = true;
      await element.updateComplete;

      // Find space buttons inside the bottom sheet
      const sheetEl = element.querySelector('.bottom-sheet') as HTMLElement;
      const buttons = sheetEl.querySelectorAll('button');
      // Find the button for space "Alpha" (space buttons contain the space name text)
      const spaceButton = Array.from(buttons).find(
        (btn) => btn.textContent?.includes('Alpha'),
      );
      expect(spaceButton).toBeTruthy();
      spaceButton!.click();
      await element.updateComplete;

      expect((element as any).sheetOpen).toBe(false);
      expect((element as any).view).toBe('space');
      expect((element as any).currentSpaceId).toBe('space-a');
    });

    it('closes sheet when "Join new space" is clicked in the sheet', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetEl = element.querySelector('.bottom-sheet') as HTMLElement;
      const joinBtn = Array.from(sheetEl.querySelectorAll('button')).find(
        (btn) => btn.textContent?.includes('Join new space'),
      );
      expect(joinBtn).toBeTruthy();
      joinBtn!.click();
      await element.updateComplete;

      expect((element as any).sheetOpen).toBe(false);
      expect((element as any).view).toBe('join');
    });
  });

  // ── Pending shares visibility ──────────────────────────────────────

  describe('pending shares visibility', () => {
    it('does not render pending shares pill in bottom bar when count is 0', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 0;
      await element.updateComplete;

      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden') as HTMLElement;
      const pendingPill = bottomBar?.querySelector('[title="Pending shares"]');
      expect(pendingPill).toBeNull();
    });

    it('renders pending shares pill in bottom bar when count > 0', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 3;
      await element.updateComplete;

      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden') as HTMLElement;
      const pendingPill = bottomBar?.querySelector('[title="Pending shares"]');
      expect(pendingPill).toBeTruthy();
      expect(pendingPill!.textContent).toContain('3');
    });

    it('does not render pending shares entry in sheet when count is 0', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 0;
      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetEl = element.querySelector('.bottom-sheet') as HTMLElement;
      const pendingEntry = Array.from(sheetEl.querySelectorAll('button')).find(
        (btn) => btn.textContent?.includes('Pending shares'),
      );
      expect(pendingEntry).toBeUndefined();
    });

    it('renders pending shares entry in sheet when count > 0', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 5;
      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetEl = element.querySelector('.bottom-sheet') as HTMLElement;
      const pendingEntry = Array.from(sheetEl.querySelectorAll('button')).find(
        (btn) => btn.textContent?.includes('Pending shares'),
      );
      expect(pendingEntry).toBeTruthy();
      expect(pendingEntry!.textContent).toContain('5');
    });

    it('does not render desktop pending shares pill when count is 0', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 0;
      await element.updateComplete;

      const desktopNav = element.querySelector('nav.hidden.sm\\:flex') as HTMLElement;
      const pendingPill = desktopNav?.querySelector('[title="Items shared from other apps"]');
      expect(pendingPill).toBeNull();
    });

    it('renders desktop pending shares pill when count > 0', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 2;
      await element.updateComplete;

      const desktopNav = element.querySelector('nav.hidden.sm\\:flex') as HTMLElement;
      const pendingPill = desktopNav?.querySelector('[title="Items shared from other apps"]');
      expect(pendingPill).toBeTruthy();
      expect(pendingPill!.textContent).toContain('2');
    });
  });

  // ── Pending shares navigation ──────────────────────────────────────

  describe('pending shares navigation', () => {
    it('sets view to pending-shares when bottom bar pill is clicked (does NOT toggle sheet)', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 3;
      await element.updateComplete;

      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden') as HTMLElement;
      const pendingPill = bottomBar?.querySelector('[title="Pending shares"]') as HTMLElement;
      expect(pendingPill).toBeTruthy();

      // The pill calls e.stopPropagation() so it shouldn't open the sheet
      pendingPill.click();
      await element.updateComplete;

      expect((element as any).view).toBe('pending-shares');
      // Sheet should NOT open — the pill has stopPropagation
      expect((element as any).sheetOpen).toBe(false);
    });

    it('sets view to pending-shares and closes sheet when sheet entry is clicked', async () => {
      setupEmptySpaces();
      createElement();
      (element as any).pendingShareCount = 2;
      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetEl = element.querySelector('.bottom-sheet') as HTMLElement;
      const pendingBtn = Array.from(sheetEl.querySelectorAll('button')).find(
        (btn) => btn.textContent?.includes('Pending shares'),
      );
      expect(pendingBtn).toBeTruthy();
      pendingBtn!.click();
      await element.updateComplete;

      expect((element as any).view).toBe('pending-shares');
      expect((element as any).sheetOpen).toBe(false);
    });
  });

  // ── Body scroll lock ───────────────────────────────────────────────

  describe('body scroll lock', () => {
    it('adds overflow-hidden to body when sheet opens on mobile', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      // Simulate mobile: matchMedia returns true
      matchMediaMock.mockReturnValue({ matches: true });

      (element as any).sheetOpen = true;
      await element.updateComplete;

      expect(document.body.classList.contains('overflow-hidden')).toBe(true);
    });

    it('removes overflow-hidden from body when sheet closes', async () => {
      setupEmptySpaces();
      createElement();
      matchMediaMock.mockReturnValue({ matches: true });

      (element as any).sheetOpen = true;
      await element.updateComplete;
      expect(document.body.classList.contains('overflow-hidden')).toBe(true);

      (element as any).sheetOpen = false;
      await element.updateComplete;
      expect(document.body.classList.contains('overflow-hidden')).toBe(false);
    });

    it('does not add overflow-hidden on desktop even when sheet opens', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      // Simulate desktop: matchMedia returns false
      matchMediaMock.mockReturnValue({ matches: false });

      (element as any).sheetOpen = true;
      await element.updateComplete;

      expect(document.body.classList.contains('overflow-hidden')).toBe(false);
    });

    it('removes overflow-hidden when sheet closes even if viewport changed', async () => {
      setupEmptySpaces();
      createElement();
      matchMediaMock.mockReturnValue({ matches: true });

      (element as any).sheetOpen = true;
      await element.updateComplete;
      expect(document.body.classList.contains('overflow-hidden')).toBe(true);

      // Simulate user rotated to desktop size
      matchMediaMock.mockReturnValue({ matches: false });

      (element as any).sheetOpen = false;
      await element.updateComplete;
      expect(document.body.classList.contains('overflow-hidden')).toBe(false);
    });
  });

  // ── Desktop vs mobile rendering ────────────────────────────────────

  describe('desktop vs mobile rendering', () => {
    it('renders desktop pill nav with hidden sm:flex classes', async () => {
      setupSpaces([{ id: 'space-a', name: 'Alpha' }]);
      createElement();
      await element.updateComplete;

      const desktopNav = element.querySelector('nav.hidden.sm\\:flex');
      expect(desktopNav).toBeTruthy();
    });

    it('renders mobile bottom bar with sm:hidden class', async () => {
      setupSpaces([{ id: 'space-a', name: 'Alpha' }]);
      createElement();
      await element.updateComplete;

      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden');
      expect(bottomBar).toBeTruthy();
    });

    it('renders mobile bottom sheet with sm:hidden class', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      const sheet = element.querySelector('.bottom-sheet.sm\\:hidden');
      // The sheet container has sm:hidden in its class list
      expect(sheet).toBeTruthy();
    });

    it('renders mobile backdrop with sm:hidden class', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      const backdrop = element.querySelector('.fixed.inset-0.z-40.sm\\:hidden');
      expect(backdrop).toBeTruthy();
    });

    it('shows active space name in bottom bar', async () => {
      setupSpaces([{ id: 'space-a', name: 'Alpha' }]);
      createElement();
      // Select the space
      (element as any).currentSpaceId = 'space-a';
      (element as any).view = 'space';
      await element.updateComplete;

      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden') as HTMLElement;
      expect(bottomBar.textContent).toContain('Alpha');
    });

    it('shows "Select a space" when spaces exist but none selected', async () => {
      setupSpaces([{ id: 'space-a', name: 'Alpha' }]);
      createElement();
      (element as any).currentSpaceId = undefined;
      await element.updateComplete;

      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden') as HTMLElement;
      expect(bottomBar.textContent).toContain('Select a space');
    });

    it('shows "Join a space" when no spaces exist', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      const bottomBar = element.querySelector('.fixed.bottom-0.z-30.sm\\:hidden') as HTMLElement;
      expect(bottomBar.textContent).toContain('Join a space');
    });

    it('lists all spaces in the bottom sheet', async () => {
      setupSpaces([
        { id: 'space-a', name: 'Alpha' },
        { id: 'space-b', name: 'Bravo' },
        { id: 'space-c', name: 'Charlie' },
      ]);
      createElement();
      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetEl = element.querySelector('.bottom-sheet') as HTMLElement;
      const buttons = Array.from(sheetEl.querySelectorAll('button'));
      const spaceNames = buttons
        .map((btn) => btn.textContent?.trim())
        .filter((text) => text && !text.includes('Join') && !text.includes('Pending') && !text.includes('Admin'));

      expect(spaceNames.some((n) => n?.includes('Alpha'))).toBe(true);
      expect(spaceNames.some((n) => n?.includes('Bravo'))).toBe(true);
      expect(spaceNames.some((n) => n?.includes('Charlie'))).toBe(true);
    });

    it('marks active space in the sheet', async () => {
      setupSpaces([
        { id: 'space-a', name: 'Alpha' },
        { id: 'space-b', name: 'Bravo' },
      ]);
      createElement();
      (element as any).currentSpaceId = 'space-a';
      (element as any).view = 'space';
      (element as any).sheetOpen = true;
      await element.updateComplete;

      const sheetEl = element.querySelector('.bottom-sheet') as HTMLElement;
      const activeButton = Array.from(sheetEl.querySelectorAll('button')).find(
        (btn) => btn.textContent?.includes('Alpha'),
      );
      expect(activeButton).toBeTruthy();
      // Active space button should have active styling and "Active" label
      expect(activeButton!.textContent).toContain('Active');
    });
  });

  // ── Admin gear placement on mobile ─────────────────────────────────

  describe('admin gear on mobile', () => {
    it('renders admin gear in header title row with sm:hidden', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      // Admin gear button in the header (sm:hidden = mobile only)
      const header = element.querySelector('header') as HTMLElement;
      const mobileAdminBtn = header.querySelector('button.sm\\:hidden[aria-label="Admin panel"]');
      expect(mobileAdminBtn).toBeTruthy();
    });

    it('navigates to admin view when mobile admin gear is clicked', async () => {
      setupEmptySpaces();
      createElement();
      await element.updateComplete;

      const header = element.querySelector('header') as HTMLElement;
      const mobileAdminBtn = header.querySelector('button.sm\\:hidden[aria-label="Admin panel"]') as HTMLElement;
      mobileAdminBtn.click();
      await element.updateComplete;

      expect((element as any).view).toBe('admin');
    });
  });
});
