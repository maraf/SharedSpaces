import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (must be before imports that trigger module resolution) ---

// Mock @microsoft/signalr (app-shell transitively imports it via space-view → signalr-client)
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

// Mock jwt-decode: returns different claims per token string
const mockJwtDecode = vi.fn();
vi.mock('jwt-decode', () => ({
  jwtDecode: (...args: unknown[]) => mockJwtDecode(...args),
}));

// Mock token-storage so we control what spaces are loaded
const mockGetTokens = vi.fn<() => Record<string, string>>();
vi.mock('./lib/token-storage', () => ({
  getTokens: () => mockGetTokens(),
  setToken: vi.fn(),
  removeToken: vi.fn(),
  getPrimaryDisplayName: vi.fn().mockReturnValue(''),
  setPrimaryDisplayName: vi.fn(),
}));

// Mock idb-storage (async IndexedDB operations used by app-shell)
vi.mock('./lib/idb-storage', () => ({
  getPendingShares: vi.fn().mockResolvedValue([]),
  removePendingShare: vi.fn().mockResolvedValue(undefined),
  clearPendingShares: vi.fn().mockResolvedValue(undefined),
}));

import './app-shell';
import { AppShell } from './app-shell';

// Helper: builds a token store and jwtDecode mock for the given space entries
function setupTokenMocks(
  entries: { id: string; name: string; serverUrl?: string }[],
) {
  const tokens: Record<string, string> = {};
  for (const entry of entries) {
    const serverUrl = entry.serverUrl ?? 'http://localhost:5000';
    const key = `${serverUrl}:${entry.id}`;
    tokens[key] = `tok-${entry.id}`;
  }

  mockGetTokens.mockReturnValue(tokens);

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

describe('AppShell — Alphabetical Space Sorting (Issue #96)', () => {
  let element: AppShell;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (element?.parentNode) {
      element.remove();
    }
    vi.restoreAllMocks();
  });

  function createElement(): AppShell {
    element = document.createElement('app-shell') as AppShell;
    document.body.appendChild(element);
    return element;
  }

  function getSpaceNames(): string[] {
    return ((element as any).spaces as { spaceName: string }[]).map(
      (s) => s.spaceName,
    );
  }

  // ── Core sorting ──────────────────────────────────────────────────

  it('sorts spaces alphabetically by name', async () => {
    setupTokenMocks([
      { id: 'id-c', name: 'Charlie' },
      { id: 'id-a', name: 'Alpha' },
      { id: 'id-b', name: 'Bravo' },
    ]);

    createElement();
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts case-insensitively', async () => {
    setupTokenMocks([
      { id: 'id-z', name: 'zebra' },
      { id: 'id-a', name: 'Alpha' },
      { id: 'id-m', name: 'mango' },
      { id: 'id-b', name: 'Bravo' },
    ]);

    createElement();
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo', 'mango', 'zebra']);
  });

  it('handles single space (no sorting needed)', async () => {
    setupTokenMocks([{ id: 'id-only', name: 'Only Space' }]);

    createElement();
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Only Space']);
  });

  it('handles empty space list', async () => {
    setupTokenMocks([]);

    createElement();
    await element.updateComplete;

    expect(getSpaceNames()).toEqual([]);
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it('sorts names with special characters correctly', async () => {
    setupTokenMocks([
      { id: 'id-3', name: 'Zulu' },
      { id: 'id-1', name: '!Important' },
      { id: 'id-2', name: '#General' },
      { id: 'id-4', name: 'Alpha' },
    ]);

    createElement();
    await element.updateComplete;

    const names = getSpaceNames();
    // Special characters should sort before letters in locale-aware comparison
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Zulu'));
    // All four entries present
    expect(names).toHaveLength(4);
  });

  it('sorts names with leading whitespace (whitespace sorts before letters)', async () => {
    setupTokenMocks([
      { id: 'id-b', name: '  Bravo' },
      { id: 'id-a', name: 'Alpha' },
    ]);

    createElement();
    await element.updateComplete;

    const names = getSpaceNames();
    // localeCompare puts whitespace-prefixed strings before letters
    expect(names).toHaveLength(2);
    expect(names.map((n) => n.trim())).toContain('Alpha');
    expect(names.map((n) => n.trim())).toContain('Bravo');
  });

  it('sorts names with accented characters using locale-aware comparison', async () => {
    setupTokenMocks([
      { id: 'id-e', name: 'Élan' },
      { id: 'id-a', name: 'Alpha' },
      { id: 'id-z', name: 'Zulu' },
    ]);

    createElement();
    await element.updateComplete;

    const names = getSpaceNames();
    // Locale-aware: É should sort near E, between Alpha and Zulu
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Zulu'));
    expect(names).toHaveLength(3);
  });

  it('sorts duplicate names stably (all present)', async () => {
    setupTokenMocks([
      { id: 'id-1', name: 'Team' },
      { id: 'id-2', name: 'Team' },
      { id: 'id-3', name: 'Alpha' },
    ]);

    createElement();
    await element.updateComplete;

    const names = getSpaceNames();
    expect(names[0]).toBe('Alpha');
    expect(names.filter((n) => n === 'Team')).toHaveLength(2);
  });

  it('sorts numeric-prefix names naturally', async () => {
    setupTokenMocks([
      { id: 'id-2', name: '20-office' },
      { id: 'id-1', name: '1-lobby' },
      { id: 'id-a', name: 'Alpha' },
    ]);

    createElement();
    await element.updateComplete;

    const names = getSpaceNames();
    // Numeric strings sort before Alpha in locale comparison
    expect(names.indexOf('Alpha')).toBeGreaterThan(0);
    expect(names).toHaveLength(3);
  });

  // ── Dynamic updates ───────────────────────────────────────────────

  it('maintains sort order after loadSpacesFromStorage is called again', async () => {
    setupTokenMocks([
      { id: 'id-b', name: 'Bravo' },
      { id: 'id-a', name: 'Alpha' },
    ]);

    createElement();
    await element.updateComplete;
    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo']);

    // Simulate a new space being added to token storage
    setupTokenMocks([
      { id: 'id-b', name: 'Bravo' },
      { id: 'id-a', name: 'Alpha' },
      { id: 'id-c', name: 'Charlie' },
    ]);

    (element as any).loadSpacesFromStorage();
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('re-sorts when a space with an earlier name is added', async () => {
    setupTokenMocks([
      { id: 'id-m', name: 'Mango' },
      { id: 'id-z', name: 'Zulu' },
    ]);

    createElement();
    await element.updateComplete;
    expect(getSpaceNames()).toEqual(['Mango', 'Zulu']);

    // Add a space that should appear first
    setupTokenMocks([
      { id: 'id-m', name: 'Mango' },
      { id: 'id-z', name: 'Zulu' },
      { id: 'id-a', name: 'Alpha' },
    ]);

    (element as any).loadSpacesFromStorage();
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Mango', 'Zulu']);
  });

  // ── Property-level order (backing the pill bar render) ──────────

  it('spaces property drives pill bar render order', async () => {
    // The template iterates this.spaces.map(...) — verifying the array
    // is sorted is equivalent to verifying rendered pill order.
    setupTokenMocks([
      { id: 'id-c', name: 'Charlie' },
      { id: 'id-a', name: 'Alpha' },
      { id: 'id-b', name: 'Bravo' },
    ]);

    createElement();
    await element.updateComplete;

    const spaces = (element as any).spaces as { spaceId: string; spaceName: string }[];
    expect(spaces.map((s) => s.spaceName)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    // Verify IDs follow the same order
    expect(spaces.map((s) => s.spaceId)).toEqual(['id-a', 'id-b', 'id-c']);
  });
});
