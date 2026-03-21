import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './app-shell';
import { AppShell } from './app-shell';
import type { ConnectionState } from './lib/signalr-client';

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

// Mock jwt-decode (used by loadSpacesFromStorage)
vi.mock('jwt-decode', () => ({
  jwtDecode: () => ({
    server_url: 'http://localhost:5000',
    space_id: 'test-space',
    space_name: 'Test Space',
    display_name: 'Test User',
  }),
}));

// Mock idb-storage (async IndexedDB operations)
vi.mock('./lib/idb-storage', () => ({
  getPendingShares: vi.fn().mockResolvedValue([]),
  removePendingShare: vi.fn().mockResolvedValue(undefined),
  clearPendingShares: vi.fn().mockResolvedValue(undefined),
}));

describe('AppShell - Connection State on View Change', () => {
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  let element: AppShell;

  beforeEach(() => {
    vi.clearAllMocks();

    element = document.createElement('app-shell') as AppShell;
    document.body.appendChild(element);
  });

  afterEach(() => {
    if (element.parentNode) {
      element.remove();
    }
    vi.restoreAllMocks();
  });

  describe('willUpdate: view navigation away from space', () => {
    it('removes space key from spaceConnectionStates when view changes from space to home', async () => {
      // Set up: element is on the 'space' view with a connected space
      (element as any).currentSpaceId = spaceId;
      (element as any).view = 'space';
      (element as any).spaceConnectionStates = { [spaceId]: 'connected' };
      await element.updateComplete;

      // Navigate away from space to home
      (element as any).view = 'home';
      await element.updateComplete;

      const states = (element as any).spaceConnectionStates as Record<string, ConnectionState>;
      expect(states[spaceId]).toBeUndefined();
    });

    it('removes space key from spaceConnectionStates when view changes from space to join', async () => {
      (element as any).currentSpaceId = spaceId;
      (element as any).view = 'space';
      (element as any).spaceConnectionStates = { [spaceId]: 'connected' };
      await element.updateComplete;

      (element as any).view = 'join';
      await element.updateComplete;

      const states = (element as any).spaceConnectionStates as Record<string, ConnectionState>;
      expect(states[spaceId]).toBeUndefined();
    });

    it('removes space key from spaceConnectionStates when view changes from space to admin', async () => {
      (element as any).currentSpaceId = spaceId;
      (element as any).view = 'space';
      (element as any).spaceConnectionStates = { [spaceId]: 'connected' };
      await element.updateComplete;

      (element as any).view = 'admin';
      await element.updateComplete;

      const states = (element as any).spaceConnectionStates as Record<string, ConnectionState>;
      expect(states[spaceId]).toBeUndefined();
    });

    it('does NOT reset spaceConnectionStates when view stays on space (e.g., switching spaces)', async () => {
      // First establish 'space' view
      (element as any).currentSpaceId = spaceId;
      (element as any).view = 'space';
      await element.updateComplete;

      // Set connected state after space-view has rendered and settled
      (element as any).spaceConnectionStates = { [spaceId]: 'connected' };
      await element.updateComplete;

      // Switch to a different space — selectSpace sets view='space' again (same value),
      // so Lit won't schedule an update for view, meaning willUpdate won't have 'view' in changed.
      // We verify this by only changing currentSpaceId.
      (element as any).currentSpaceId = 'other-space-id';
      await element.updateComplete;

      // Wait for any space-view render side-effects to settle
      await new Promise((resolve) => setTimeout(resolve, 20));

      // willUpdate should NOT have reset the original spaceId's state
      // (it only resets when view changes AWAY from 'space')
      const states = (element as any).spaceConnectionStates as Record<string, ConnectionState>;
      // The state might have been updated by a space-view event for the NEW spaceId,
      // but the key point is: willUpdate didn't forcibly reset our spaceId to 'disconnected'
      // because view didn't change.
      // Check that if any state was set for the original spaceId, it was from our manual set, not willUpdate.
      // Since space-view re-renders with other-space-id, it dispatches for other-space-id, not spaceId.
      expect(states[spaceId]).toBe('connected');
    });

    it('does not throw when there is no currentSpaceId', async () => {
      (element as any).view = 'space';
      (element as any).currentSpaceId = undefined;
      await element.updateComplete;

      // Navigate away — should not throw even without a currentSpaceId
      (element as any).view = 'home';
      await expect(element.updateComplete).resolves.toBeDefined();
    });

    it('removes departing space key but preserves other space connection states', async () => {
      const otherSpaceId = 'other-space-id';
      (element as any).currentSpaceId = spaceId;
      (element as any).view = 'space';
      (element as any).spaceConnectionStates = {
        [spaceId]: 'connected',
        [otherSpaceId]: 'connected',
      };
      await element.updateComplete;

      (element as any).view = 'home';
      await element.updateComplete;

      const states = (element as any).spaceConnectionStates as Record<string, ConnectionState>;
      expect(states[spaceId]).toBeUndefined();
      expect(states[otherSpaceId]).toBe('connected');
    });
  });

  describe('dotColor', () => {
    it('returns bg-emerald-400 for connected state', async () => {
      (element as any).spaceConnectionStates = { [spaceId]: 'connected' };
      await element.updateComplete;

      expect((element as any).dotColor(spaceId)).toBe('bg-emerald-400');
    });

    it('returns bg-amber-400 for connecting state', async () => {
      (element as any).spaceConnectionStates = { [spaceId]: 'connecting' };
      await element.updateComplete;

      expect((element as any).dotColor(spaceId)).toBe('bg-amber-400');
    });

    it('returns bg-amber-400 for reconnecting state', async () => {
      (element as any).spaceConnectionStates = { [spaceId]: 'reconnecting' };
      await element.updateComplete;

      expect((element as any).dotColor(spaceId)).toBe('bg-amber-400');
    });

    it('returns bg-red-400 for disconnected only when space is selected and view is space', async () => {
      (element as any).view = 'space';
      (element as any).currentSpaceId = spaceId;
      (element as any).spaceConnectionStates = { [spaceId]: 'disconnected' };
      await element.updateComplete;

      expect((element as any).dotColor(spaceId)).toBe('bg-red-400');
    });

    it('returns bg-slate-500 for disconnected when view is not space', async () => {
      (element as any).view = 'home';
      (element as any).currentSpaceId = spaceId;
      (element as any).spaceConnectionStates = { [spaceId]: 'disconnected' };
      await element.updateComplete;

      expect((element as any).dotColor(spaceId)).toBe('bg-slate-500');
    });

    it('returns bg-slate-500 for disconnected when different space is selected', async () => {
      (element as any).view = 'space';
      (element as any).currentSpaceId = 'other-space-id';
      (element as any).spaceConnectionStates = { [spaceId]: 'disconnected' };
      await element.updateComplete;

      expect((element as any).dotColor(spaceId)).toBe('bg-slate-500');
    });

    it('returns bg-slate-500 when no state exists for a space', async () => {
      (element as any).spaceConnectionStates = {};
      await element.updateComplete;

      expect((element as any).dotColor(spaceId)).toBe('bg-slate-500');
    });
  });

  describe('handleConnectionStateChange', () => {
    it('updates spaceConnectionStates when handler is called', async () => {
      await element.updateComplete;

      // Call handler directly (it's bound to <main> in the template)
      const event = new CustomEvent('connection-state-change', {
        bubbles: true,
        composed: true,
        detail: { spaceId, state: 'connected' as ConnectionState },
      });
      (element as any).handleConnectionStateChange(event);
      await element.updateComplete;

      const states = (element as any).spaceConnectionStates as Record<string, ConnectionState>;
      expect(states[spaceId]).toBe('connected');
    });

    it('tracks reconnecting state', async () => {
      await element.updateComplete;

      const event = new CustomEvent('connection-state-change', {
        bubbles: true,
        composed: true,
        detail: { spaceId, state: 'reconnecting' as ConnectionState },
      });
      (element as any).handleConnectionStateChange(event);
      await element.updateComplete;

      const states = (element as any).spaceConnectionStates as Record<string, ConnectionState>;
      expect(states[spaceId]).toBe('reconnecting');
    });
  });
});
