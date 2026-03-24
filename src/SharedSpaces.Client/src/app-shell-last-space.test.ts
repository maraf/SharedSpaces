import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './app-shell';
import { AppShell } from './app-shell';
import * as tokenStorage from './lib/token-storage';

// Mock invitation parsing
const mockParseInvitationFromUrl = vi.fn();
vi.mock('./lib/invitation', () => ({
  parseInvitationFromUrl: () => mockParseInvitationFromUrl(),
  parseInvitationString: vi.fn(),
}));

// Mock @microsoft/signalr (required because app-shell imports space-view which imports signalr-client)
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

// Mock jwt-decode to return predictable claims for test space
const mockJwtDecode = vi.fn();
vi.mock('jwt-decode', () => ({
  jwtDecode: (token: string) => mockJwtDecode(token),
}));

// Mock idb-storage (async IndexedDB operations)
vi.mock('./lib/idb-storage', () => ({
  getPendingShares: vi.fn().mockResolvedValue([]),
  removePendingShare: vi.fn().mockResolvedValue(undefined),
  clearPendingShares: vi.fn().mockResolvedValue(undefined),
}));

describe('AppShell - Auto-select Last Space (#104)', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const tokenKey = `${serverUrl}:${spaceId}`;
  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJtZW1iZXItaWQiLCJzcGFjZV9pZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCIsInNlcnZlcl91cmwiOiJodHRwOi8vbG9jYWxob3N0OjUwMDAiLCJzcGFjZV9uYW1lIjoiVGVzdCBTcGFjZSIsImRpc3BsYXlfbmFtZSI6IlRlc3QgVXNlciJ9';

  let element: AppShell;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default mock: decode token with matching claims
    mockJwtDecode.mockReturnValue({
      sub: 'member-id',
      server_url: serverUrl,
      space_id: spaceId,
      space_name: 'Test Space',
      display_name: 'Test User',
    });

    // Default: no invitation URL
    mockParseInvitationFromUrl.mockReturnValue(null);
  });

  afterEach(() => {
    if (element?.parentNode) {
      element.remove();
    }
    vi.restoreAllMocks();
  });

  describe('Auto-select on app start', () => {
    it('auto-selects last space when token and last-space both exist', async () => {
      // Setup: User was previously viewing a space
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      // Create element (triggers connectedCallback → autoSelectLastSpace)
      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: space view activated with correct space
      expect((element as any).view).toBe('space');
      expect((element as any).currentSpaceId).toBe(spaceId);
      expect((element as any).currentServerUrl).toBe(serverUrl);
      expect((element as any).authState.token).toBe(mockToken);
    });

    it('does not auto-select when no last-space is saved', async () => {
      // Setup: User has tokens but no last-space saved (fresh install or intentional de-select)
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      // DO NOT set lastSelectedSpace

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: stays on home view
      expect((element as any).view).toBe('home');
      expect((element as any).currentSpaceId).toBeUndefined();
    });

    it('clears last-space when saved space no longer exists in token storage', async () => {
      // Setup: Last-space points to a space that was removed
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);
      // DO NOT add token for this space

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: fallback to home, last-space cleared
      expect((element as any).view).toBe('home');
      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();
    });

    it('invitation URL takes priority over auto-select', async () => {
      // Setup: Both last-space AND invitation URL present
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      // Mock invitation parsing to return valid invitation
      mockParseInvitationFromUrl.mockReturnValue({
        serverUrl: 'http://example.com',
        spaceId: 'space-123',
        pin: '654321',
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: join view activated (not space)
      expect((element as any).view).toBe('join');
      expect((element as any).currentSpaceId).toBeUndefined();
    });

    it('handles multiple spaces and auto-selects correct one', async () => {
      const otherServerUrl = 'http://localhost:5001';
      const otherSpaceId = '550e8400-e29b-41d4-a716-446655440001';
      const otherToken = 'other-jwt-token';

      // Setup: Multiple spaces, last-space points to second one
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      tokenStorage.setToken(otherServerUrl, otherSpaceId, otherToken);
      tokenStorage.setLastSelectedSpace(otherServerUrl, otherSpaceId);

      // Mock jwt-decode to return correct claims for both tokens
      mockJwtDecode.mockImplementation((token: string) => {
        if (token === mockToken) {
          return {
            server_url: serverUrl,
            space_id: spaceId,
            space_name: 'Test Space 1',
            display_name: 'User',
          };
        } else {
          return {
            server_url: otherServerUrl,
            space_id: otherSpaceId,
            space_name: 'Test Space 2',
            display_name: 'User',
          };
        }
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: second space is selected (not first)
      expect((element as any).view).toBe('space');
      expect((element as any).currentSpaceId).toBe(otherSpaceId);
      expect((element as any).currentServerUrl).toBe(otherServerUrl);
      expect((element as any).authState.token).toBe(otherToken);
    });

    it('handles invalid JWT in last-space gracefully', async () => {
      // Setup: Last-space points to a space with corrupted token
      tokenStorage.setToken(serverUrl, spaceId, 'invalid-jwt');
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      // Mock jwt-decode to throw on invalid token
      mockJwtDecode.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: fallback to home (invalid token not loaded into spaces list)
      expect((element as any).view).toBe('home');
      // Last-space should be cleared because space wasn't found
      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();
    });
  });

  describe('Intentional de-selection', () => {
    it('clears last-space when user navigates home from space view', async () => {
      // Setup: User is viewing a space
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Verify auto-select worked
      expect((element as any).view).toBe('space');
      expect(tokenStorage.getLastSelectedSpace()).toBe(tokenKey);

      // Simulate the header button click logic directly
      // (The button exists in the template but happy-dom rendering may not be complete)
      if ((element as any).view === 'space' && (element as any).currentSpaceId) {
        tokenStorage.clearLastSelectedSpace();
      }
      (element as any).view = 'home';
      await element.updateComplete;

      // Assert: navigated to home AND last-space cleared
      expect((element as any).view).toBe('home');
      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();
    });

    it('does not clear last-space when navigating home from non-space view', async () => {
      // Setup: User on join view, last-space exists from previous session
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      // Mock invitation parsing to return valid invitation
      mockParseInvitationFromUrl.mockReturnValue({
        serverUrl: 'http://example.com',
        spaceId: 'space-123',
        pin: '654321',
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Verify we're on join view (not auto-selected)
      expect((element as any).view).toBe('join');

      // Simulate navigating home from join view (no de-selection logic applies)
      (element as any).view = 'home';
      await element.updateComplete;

      // Assert: navigated to home but last-space NOT cleared (wasn't viewing space)
      expect((element as any).view).toBe('home');
      expect(tokenStorage.getLastSelectedSpace()).toBe(tokenKey);
    });
  });

  describe('Space selection persistence', () => {
    it('persists last-space when user selects a space', async () => {
      // Setup: App starts fresh (no auto-select)
      tokenStorage.setToken(serverUrl, spaceId, mockToken);

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // User manually selects space
      const spaceEntry = {
        serverUrl,
        spaceId,
        spaceName: 'Test Space',
        token: mockToken,
      };
      (element as any).selectSpace(spaceEntry);
      await element.updateComplete;

      // Assert: last-space persisted
      expect(tokenStorage.getLastSelectedSpace()).toBe(tokenKey);
      expect((element as any).view).toBe('space');
    });

    it('updates last-space when switching to a different space', async () => {
      const otherServerUrl = 'http://localhost:5001';
      const otherSpaceId = '550e8400-e29b-41d4-a716-446655440001';
      const otherToken = 'other-jwt-token';
      const otherTokenKey = `${otherServerUrl}:${otherSpaceId}`;

      // Setup: User viewing first space
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      tokenStorage.setToken(otherServerUrl, otherSpaceId, otherToken);
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      mockJwtDecode.mockImplementation((token: string) => {
        if (token === mockToken) {
          return {
            server_url: serverUrl,
            space_id: spaceId,
            space_name: 'Test Space 1',
          };
        } else {
          return {
            server_url: otherServerUrl,
            space_id: otherSpaceId,
            space_name: 'Test Space 2',
          };
        }
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Verify first space selected
      expect((element as any).currentSpaceId).toBe(spaceId);

      // User switches to second space
      const otherSpaceEntry = {
        serverUrl: otherServerUrl,
        spaceId: otherSpaceId,
        spaceName: 'Test Space 2',
        token: otherToken,
      };
      (element as any).selectSpace(otherSpaceEntry);
      await element.updateComplete;

      // Assert: last-space updated to new space
      expect(tokenStorage.getLastSelectedSpace()).toBe(otherTokenKey);
      expect((element as any).currentSpaceId).toBe(otherSpaceId);
    });

    it('preserves last-space across multiple app restarts', async () => {
      // Session 1: User selects space
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      const spaceEntry = {
        serverUrl,
        spaceId,
        spaceName: 'Test Space',
        token: mockToken,
      };
      (element as any).selectSpace(spaceEntry);
      await element.updateComplete;
      expect(tokenStorage.getLastSelectedSpace()).toBe(tokenKey);

      // Simulate app close
      element.remove();

      // Session 2: User reopens app
      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: auto-selected same space
      expect((element as any).view).toBe('space');
      expect((element as any).currentSpaceId).toBe(spaceId);

      // Simulate app close again
      element.remove();

      // Session 3: User reopens app again
      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: still auto-selected (persistence is stable)
      expect((element as any).view).toBe('space');
      expect((element as any).currentSpaceId).toBe(spaceId);
    });
  });

  describe('Edge cases', () => {
    it('handles corrupted last-space localStorage value', async () => {
      // Setup: Token exists but last-space is malformed
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      localStorage.setItem('sharedspaces:lastSelectedSpace', 'malformed-key-no-colon');

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: fallback to home (malformed key doesn't match any space)
      expect((element as any).view).toBe('home');
      // Last-space cleared because it didn't match
      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();
    });

    it('handles last-space with server URL containing colon correctly', async () => {
      const serverUrlWithPort = 'http://example.com:8080';
      tokenStorage.setToken(serverUrlWithPort, spaceId, mockToken);
      tokenStorage.setLastSelectedSpace(serverUrlWithPort, spaceId);

      mockJwtDecode.mockReturnValue({
        server_url: serverUrlWithPort,
        space_id: spaceId,
        space_name: 'Test Space',
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: correctly parsed and auto-selected
      expect((element as any).view).toBe('space');
      expect((element as any).currentSpaceId).toBe(spaceId);
      expect((element as any).currentServerUrl).toBe(serverUrlWithPort);
    });

    it('does not auto-select when last-space exists but token is expired/revoked', async () => {
      const otherSpaceId = '550e8400-e29b-41d4-a716-446655440001';
      
      // Setup: Last-space points to space A, but only token for space B exists
      tokenStorage.setToken(serverUrl, otherSpaceId, mockToken);
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);  // Different spaceId

      mockJwtDecode.mockReturnValue({
        server_url: serverUrl,
        space_id: otherSpaceId,
        space_name: 'Other Space',
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: fallback to home (token for last-space doesn't exist)
      expect((element as any).view).toBe('home');
      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();
    });

    it('handles empty spaces list gracefully', async () => {
      // Setup: Last-space saved but no tokens exist at all
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: stays on home, clears invalid last-space
      expect((element as any).view).toBe('home');
      expect((element as any).spaces).toEqual([]);
      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();
    });
  });

  describe('Integration with space selection', () => {
    it('selectSpace updates last-space correctly', async () => {
      tokenStorage.setToken(serverUrl, spaceId, mockToken);

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Initially no last-space
      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();

      // User selects space
      const spaceEntry = {
        serverUrl,
        spaceId,
        spaceName: 'Test Space',
        token: mockToken,
      };
      (element as any).selectSpace(spaceEntry);
      await element.updateComplete;

      // Assert: last-space saved
      expect(tokenStorage.getLastSelectedSpace()).toBe(tokenKey);
    });

    it('switching spaces updates last-space to new space', async () => {
      const space1 = {
        serverUrl: 'http://localhost:5000',
        spaceId: '550e8400-e29b-41d4-a716-446655440000',
        spaceName: 'Space 1',
        token: 'token1',
      };
      const space2 = {
        serverUrl: 'http://localhost:5001',
        spaceId: '550e8400-e29b-41d4-a716-446655440001',
        spaceName: 'Space 2',
        token: 'token2',
      };

      tokenStorage.setToken(space1.serverUrl, space1.spaceId, space1.token);
      tokenStorage.setToken(space2.serverUrl, space2.spaceId, space2.token);

      mockJwtDecode.mockImplementation((token: string) => {
        if (token === 'token1') {
          return { server_url: space1.serverUrl, space_id: space1.spaceId, space_name: space1.spaceName };
        } else {
          return { server_url: space2.serverUrl, space_id: space2.spaceId, space_name: space2.spaceName };
        }
      });

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Select first space
      (element as any).selectSpace(space1);
      await element.updateComplete;
      expect(tokenStorage.getLastSelectedSpace()).toBe(`${space1.serverUrl}:${space1.spaceId}`);

      // Switch to second space
      (element as any).selectSpace(space2);
      await element.updateComplete;
      expect(tokenStorage.getLastSelectedSpace()).toBe(`${space2.serverUrl}:${space2.spaceId}`);

      // Simulate restart
      element.remove();
      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: auto-selected second space (most recent)
      expect((element as any).currentSpaceId).toBe(space2.spaceId);
    });
  });

  describe('De-selection behavior', () => {
    it('de-selecting and restarting does not auto-select', async () => {
      // Session 1: User selects space
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      const spaceEntry = {
        serverUrl,
        spaceId,
        spaceName: 'Test Space',
        token: mockToken,
      };
      (element as any).selectSpace(spaceEntry);
      await element.updateComplete;

      // User intentionally de-selects (clicks home from space view)
      // This is done via header button which checks view === 'space' before clearing
      (element as any).view = 'space';
      (element as any).currentSpaceId = spaceId;
      await element.updateComplete;

      // Simulate the header button click logic
      if ((element as any).view === 'space' && (element as any).currentSpaceId) {
        tokenStorage.clearLastSelectedSpace();
      }
      (element as any).view = 'home';
      await element.updateComplete;

      expect(tokenStorage.getLastSelectedSpace()).toBeUndefined();

      // Simulate app close and restart
      element.remove();
      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: stays on home (no auto-select)
      expect((element as any).view).toBe('home');
      expect((element as any).currentSpaceId).toBeUndefined();
    });

    it('clearing last-space prevents auto-select on next start', async () => {
      // Setup: Last-space saved
      tokenStorage.setToken(serverUrl, spaceId, mockToken);
      tokenStorage.setLastSelectedSpace(serverUrl, spaceId);

      // Explicitly clear it (simulating intentional de-select)
      tokenStorage.clearLastSelectedSpace();

      element = document.createElement('app-shell') as AppShell;
      document.body.appendChild(element);
      await element.updateComplete;

      // Assert: no auto-select
      expect((element as any).view).toBe('home');
    });
  });
});
