import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './space-view';
import { SpaceView } from './space-view';
import type { ItemAddedPayload } from '../../lib/signalr-client';
import type { SpaceItemResponse } from './space-api';

// Mock SignalR client
const mockSignalRConnection = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  onreconnecting: vi.fn(),
  onreconnected: vi.fn(),
  onclose: vi.fn(),
  state: 'Disconnected',
};

const mockSignalRBuilder = {
  withUrl: vi.fn().mockReturnThis(),
  withAutomaticReconnect: vi.fn().mockReturnThis(),
  build: vi.fn().mockReturnValue(mockSignalRConnection),
};

vi.mock('@microsoft/signalr', () => {
  class MockHubConnectionBuilder {
    withUrl = mockSignalRBuilder.withUrl;
    withAutomaticReconnect = mockSignalRBuilder.withAutomaticReconnect;
    build = mockSignalRBuilder.build;
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

describe('SpaceView - Deduplication Logic', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const token = 'test-jwt-token';

  let element: SpaceView;
  let signalRItemAddedHandler: ((payload: ItemAddedPayload) => void) | null = null;

  // Mock fetch globally
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    signalRItemAddedHandler = null;
    mockSignalRConnection.state = 'Disconnected';

    // Set up token storage mock
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === `${serverUrl}:${spaceId}`) {
        return token;
      }
      return null;
    });

    // Capture SignalR ItemAdded handler
    mockSignalRConnection.on.mockImplementation((eventName: string, handler: any) => {
      if (eventName === 'ItemAdded') {
        signalRItemAddedHandler = handler;
      }
    });

    // Set up default fetch mock
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    // Create element
    element = document.createElement('space-view') as SpaceView;
    element.setAttribute('server-url', serverUrl);
    element.setAttribute('space-id', spaceId);
  });

  afterEach(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
    vi.restoreAllMocks();
  });

  describe('Scenario 1: SignalR event arrives AFTER API response (existing dedup)', () => {
    it('handleItemAdded ignores items already in the list', () => {
      // Directly test the handleItemAdded logic without full component initialization
      const existingItem: SpaceItemResponse = {
        id: 'existing-id',
        spaceId,
        memberId: 'member-1',
        contentType: 'text' as const,
        content: 'Existing text',
        fileSize: 0,
        sharedAt: new Date().toISOString(),
      };

      // Set up component state directly
      (element as any).items = [existingItem];
      (element as any).pendingItemIds = new Set<string>();

      const initialLength = (element as any).items.length;

      // Simulate SignalR event for an item already in the list
      const payload: ItemAddedPayload = {
        id: 'existing-id',
        spaceId,
        memberId: 'member-1',
        displayName: 'User 1',
        contentType: 'text',
        content: 'Existing text',
        fileSize: 0,
        sharedAt: existingItem.sharedAt,
      };

      (element as any).handleItemAdded(payload);

      // Verify item was NOT added again (existing dedup works)
      expect((element as any).items.length).toBe(initialLength);
      expect((element as any).items.filter((i: SpaceItemResponse) => i.id === 'existing-id')).toHaveLength(1);
    });
  });

  describe('Scenario 2: SignalR event arrives BEFORE API response (race condition)', () => {
    it('does not duplicate item when SignalR event arrives before API response completes', async () => {
      // Mock API responses
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      // Mount and wait for initial load
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate text upload with delayed API response
      const newItemId = 'race-item-id';
      const newItem: SpaceItemResponse = {
        id: newItemId,
        spaceId,
        memberId: 'member-1',
        contentType: 'text' as const,
        content: 'Race text',
        fileSize: 0,
        sharedAt: new Date().toISOString(),
      };

      let uploadResolve: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        uploadResolve = resolve;
      });

      mockFetch.mockImplementationOnce(() => uploadPromise);

      // Simulate crypto.randomUUID
      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(newItemId);

      // Trigger text submit (API call starts but doesn't complete yet)
      (element as any).textInput = 'Race text';
      (element as any).token = token;
      const submitPromise = (element as any).handleTextSubmit();

      // Wait a bit for pendingItemIds.add to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify pendingItemIds contains the new item
      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(newItemId)).toBe(true);

      // Simulate SignalR event arriving BEFORE API response completes
      if (signalRItemAddedHandler) {
        const signalRPayload: ItemAddedPayload = {
          id: newItemId,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'text',
          content: 'Race text',
          fileSize: 0,
          sharedAt: newItem.sharedAt,
        };

        signalRItemAddedHandler(signalRPayload);

        // Wait for handler processing
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify item is NOT added via SignalR (blocked by pendingItemIds check)
        const itemsAfterSignalR = (element as any).items as SpaceItemResponse[];
        expect(itemsAfterSignalR).toHaveLength(0);
      }

      // Now complete the API response
      uploadResolve!({
        ok: true,
        status: 200,
        json: async () => newItem,
      });

      await submitPromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify item was added via API response
      const itemsAfterUpload = (element as any).items as SpaceItemResponse[];
      expect(itemsAfterUpload).toHaveLength(1);
      expect(itemsAfterUpload[0].id).toBe(newItemId);

      // Verify pendingItemIds was cleaned up
      expect(pendingIds.has(newItemId)).toBe(false);

      // If SignalR event arrives AGAIN after upload completes, still no duplicate
      if (signalRItemAddedHandler) {
        const signalRPayload: ItemAddedPayload = {
          id: newItemId,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'text',
          content: 'Race text',
          fileSize: 0,
          sharedAt: newItem.sharedAt,
        };

        signalRItemAddedHandler(signalRPayload);
        await new Promise((resolve) => setTimeout(resolve, 10));

        const finalItems = (element as any).items as SpaceItemResponse[];
        expect(finalItems).toHaveLength(1);
      }
    });
  });

  describe('Scenario 3: Multiple files uploaded - SignalR events arrive before API responses', () => {
    it('does not duplicate items when multiple SignalR events arrive before their respective API responses', async () => {
      // Mock API responses
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      // Mount and wait for initial load
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Prepare multiple file uploads
      const file1Id = 'file-1-id';
      const file2Id = 'file-2-id';
      const file3Id = 'file-3-id';

      const file1: SpaceItemResponse = {
        id: file1Id,
        spaceId,
        memberId: 'member-1',
        contentType: 'file' as const,
        content: '/files/file1.txt',
        fileSize: 1024,
        sharedAt: new Date().toISOString(),
      };

      const file2: SpaceItemResponse = {
        id: file2Id,
        spaceId,
        memberId: 'member-1',
        contentType: 'file' as const,
        content: '/files/file2.txt',
        fileSize: 2048,
        sharedAt: new Date().toISOString(),
      };

      const file3: SpaceItemResponse = {
        id: file3Id,
        spaceId,
        memberId: 'member-1',
        contentType: 'file' as const,
        content: '/files/file3.txt',
        fileSize: 4096,
        sharedAt: new Date().toISOString(),
      };

      // Create delayed API responses
      let upload1Resolve: (value: any) => void;
      let upload2Resolve: (value: any) => void;
      let upload3Resolve: (value: any) => void;

      const upload1Promise = new Promise((resolve) => {
        upload1Resolve = resolve;
      });
      const upload2Promise = new Promise((resolve) => {
        upload2Resolve = resolve;
      });
      const upload3Promise = new Promise((resolve) => {
        upload3Resolve = resolve;
      });

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return upload1Promise;
        if (callCount === 2) return upload2Promise;
        if (callCount === 3) return upload3Promise;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      // Mock crypto.randomUUID for predictable IDs
      const uuidMock = vi.spyOn(crypto, 'randomUUID');
      uuidMock
        .mockReturnValueOnce(file1Id)
        .mockReturnValueOnce(file2Id)
        .mockReturnValueOnce(file3Id);

      // Trigger file uploads
      const mockFiles = [
        new File(['content1'], 'file1.txt', { type: 'text/plain' }),
        new File(['content2'], 'file2.txt', { type: 'text/plain' }),
        new File(['content3'], 'file3.txt', { type: 'text/plain' }),
      ];

      (element as any).token = token;
      const uploadPromise = (element as any).uploadFiles(mockFiles);

      // Wait for pendingItemIds to be populated
      await new Promise((resolve) => setTimeout(resolve, 20));

      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(file1Id)).toBe(true);

      // Simulate SignalR events arriving before API responses
      if (signalRItemAddedHandler) {
        const payload1: ItemAddedPayload = {
          id: file1Id,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'file',
          content: '/files/file1.txt',
          fileSize: 1024,
          sharedAt: file1.sharedAt,
        };

        const payload2: ItemAddedPayload = {
          id: file2Id,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'file',
          content: '/files/file2.txt',
          fileSize: 2048,
          sharedAt: file2.sharedAt,
        };

        const payload3: ItemAddedPayload = {
          id: file3Id,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'file',
          content: '/files/file3.txt',
          fileSize: 4096,
          sharedAt: file3.sharedAt,
        };

        // Send all SignalR events while uploads are pending
        signalRItemAddedHandler(payload1);
        signalRItemAddedHandler(payload2);
        signalRItemAddedHandler(payload3);

        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify no items added yet (all blocked by pendingItemIds)
        const itemsAfterSignalR = (element as any).items as SpaceItemResponse[];
        expect(itemsAfterSignalR).toHaveLength(0);
      }

      // Complete API responses
      upload1Resolve!({
        ok: true,
        status: 200,
        json: async () => file1,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      upload2Resolve!({
        ok: true,
        status: 200,
        json: async () => file2,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      upload3Resolve!({
        ok: true,
        status: 200,
        json: async () => file3,
      });

      await uploadPromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify all items added exactly once via API responses
      const itemsAfterUploads = (element as any).items as SpaceItemResponse[];
      expect(itemsAfterUploads).toHaveLength(3);
      expect(itemsAfterUploads.map((i) => i.id)).toEqual(
        expect.arrayContaining([file1Id, file2Id, file3Id])
      );

      // Verify pendingItemIds cleaned up
      expect(pendingIds.size).toBe(0);
    });
  });

  describe('Scenario 4: Failed upload - pending ID cleanup', () => {
    it('removes item from pendingItemIds when upload fails', async () => {
      // Mock API responses
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      // Mount and wait for initial load
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const failedItemId = 'failed-item-id';

      // Mock failed upload
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
      });

      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(failedItemId);

      (element as any).textInput = 'Failed text';
      (element as any).token = token;

      try {
        await (element as any).handleTextSubmit();
      } catch {
        // Expected to fail
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify pendingItemIds was cleaned up even on failure
      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(failedItemId)).toBe(false);

      // Verify item was NOT added to items list
      const items = (element as any).items as SpaceItemResponse[];
      expect(items).toHaveLength(0);

      // If SignalR event arrives later (shouldn't happen, but test defensive behavior)
      if (signalRItemAddedHandler) {
        const payload: ItemAddedPayload = {
          id: failedItemId,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'text',
          content: 'Failed text',
          fileSize: 0,
          sharedAt: new Date().toISOString(),
        };

        signalRItemAddedHandler(payload);
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Item should now be added via SignalR (since it's not in pendingItemIds or items)
        const itemsAfterSignalR = (element as any).items as SpaceItemResponse[];
        expect(itemsAfterSignalR).toHaveLength(1);
        expect(itemsAfterSignalR[0].id).toBe(failedItemId);
      }
    });

    it('allows SignalR event for failed upload if event never arrives during upload', async () => {
      // This test verifies that if an upload fails and the SignalR event never arrives
      // during the upload attempt, a later SignalR event (e.g., from retry) can still add the item
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const retryItemId = 'retry-item-id';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(retryItemId);

      (element as any).textInput = 'Retry text';
      (element as any).token = token;

      try {
        await (element as any).handleTextSubmit();
      } catch {
        // Expected to fail
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify cleanup
      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(retryItemId)).toBe(false);

      // Later, a SignalR event arrives (perhaps from a retry by another mechanism)
      if (signalRItemAddedHandler) {
        const payload: ItemAddedPayload = {
          id: retryItemId,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'text',
          content: 'Retry text',
          fileSize: 0,
          sharedAt: new Date().toISOString(),
        };

        signalRItemAddedHandler(payload);
        await new Promise((resolve) => setTimeout(resolve, 10));

        const items = (element as any).items as SpaceItemResponse[];
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe(retryItemId);
      }
    });
  });

  describe('Scenario 5: Delete during pending upload', () => {
    it('handles delete of item that is currently being uploaded', async () => {
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const uploadingItemId = 'uploading-item-id';
      const uploadingItem: SpaceItemResponse = {
        id: uploadingItemId,
        spaceId,
        memberId: 'member-1',
        contentType: 'text' as const,
        content: 'Uploading text',
        fileSize: 0,
        sharedAt: new Date().toISOString(),
      };

      // Create delayed upload
      let uploadResolve: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        uploadResolve = resolve;
      });

      mockFetch.mockImplementationOnce(() => uploadPromise);

      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uploadingItemId);

      (element as any).textInput = 'Uploading text';
      (element as any).token = token;
      const submitPromise = (element as any).handleTextSubmit();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify item is pending
      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(uploadingItemId)).toBe(true);

      // Complete the upload
      uploadResolve!({
        ok: true,
        status: 200,
        json: async () => uploadingItem,
      });

      await submitPromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify item was added
      let items = (element as any).items as SpaceItemResponse[];
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(uploadingItemId);

      // Verify pendingItemIds cleaned up
      expect(pendingIds.has(uploadingItemId)).toBe(false);

      // Now delete the item
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await (element as any).confirmDelete(uploadingItem);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify item removed
      items = (element as any).items as SpaceItemResponse[];
      expect(items).toHaveLength(0);

      // If SignalR ItemDeleted event arrives, it should be handled safely
      const deleteHandler = mockSignalRConnection.on.mock.calls.find(
        (call) => call[0] === 'ItemDeleted'
      );
      if (deleteHandler) {
        const handler = deleteHandler[1];
        handler({ id: uploadingItemId, spaceId });
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify no errors and item still not in list
        items = (element as any).items as SpaceItemResponse[];
        expect(items).toHaveLength(0);
      }
    });
  });

  describe('Connection Lifecycle', () => {
    it('disconnectedCallback calls stopSignalR and stops the SignalR connection', async () => {
      // Create a mock SignalR client on the element directly
      const mockClient = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        state: 'connected' as const,
      };
      (element as any).signalRClient = mockClient;
      (element as any).connectionState = 'connected';

      // Mount element to establish connected state
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Remove from DOM — triggers disconnectedCallback → stopSignalR
      element.remove();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockClient.stop).toHaveBeenCalled();
    });

    it('sets signalRClient to undefined after disconnection', async () => {
      const mockClient = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        state: 'connected' as const,
      };
      (element as any).signalRClient = mockClient;

      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify signalRClient exists while connected
      expect((element as any).signalRClient).toBeDefined();

      // Disconnect
      element.remove();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // signalRClient cleaned up
      expect((element as any).signalRClient).toBeUndefined();
    });

    it('sets connectionState to disconnected after stopSignalR', async () => {
      const mockClient = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        state: 'connected' as const,
      };
      (element as any).signalRClient = mockClient;
      (element as any).connectionState = 'connected';

      // Call stopSignalR directly
      await (element as any).stopSignalR();

      expect((element as any).connectionState).toBe('disconnected');
      expect((element as any).signalRClient).toBeUndefined();
    });

    it('dispatches connection-state-change event when connectionState changes while connected', async () => {
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stateChanges: Array<{ spaceId: string; state: string }> = [];
      element.addEventListener('connection-state-change', ((event: CustomEvent) => {
        stateChanges.push(event.detail);
      }) as EventListener);

      // Directly change connectionState (simulating onStateChange callback)
      (element as any).spaceId = spaceId;
      (element as any).connectionState = 'connected';
      await element.updateComplete;

      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[0]).toEqual({ spaceId, state: 'connected' });
    });

    it('does not dispatch connection-state-change when spaceId is not set', async () => {
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stateChanges: Array<{ spaceId: string; state: string }> = [];
      element.addEventListener('connection-state-change', ((event: CustomEvent) => {
        stateChanges.push(event.detail);
      }) as EventListener);

      // Change connectionState without a spaceId
      (element as any).spaceId = undefined;
      (element as any).connectionState = 'connected';
      await element.updateComplete;

      expect(stateChanges).toHaveLength(0);
    });
  });

  describe('startSignalR sets connecting state', () => {
    it('sets connectionState to connecting before start() resolves', async () => {
      let stateAtStartCall: string | undefined;
      mockSignalRConnection.start.mockImplementation(async () => {
        stateAtStartCall = (element as any).connectionState;
        mockSignalRConnection.state = 'Connected';
      });

      // Set required properties directly (same pattern as Connection Lifecycle tests)
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      await (element as any).startSignalR();

      expect(stateAtStartCall).toBe('connecting');
    });
  });

  describe('Edge case: SignalR event for different member during upload', () => {
    it('adds item from another member even when pending upload exists', () => {
      // Directly test the handleItemAdded logic
      const myItemId = 'my-upload-id';
      const otherItemId = 'other-member-id';

      // Set up component state - my item is pending
      (element as any).items = [];
      (element as any).pendingItemIds = new Set<string>([myItemId]);

      // SignalR event arrives for another member's upload (different ID)
      const otherPayload: ItemAddedPayload = {
        id: otherItemId,
        spaceId,
        memberId: 'member-2',
        displayName: 'Other User',
        contentType: 'text',
        content: 'Other text',
        fileSize: 0,
        sharedAt: new Date().toISOString(),
      };

      (element as any).handleItemAdded(otherPayload);

      // Other member's item should be added (not blocked by my pending upload)
      const items = (element as any).items as SpaceItemResponse[];
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(otherItemId);
    });
  });

  describe('Scenario 6: Share Target Deduplication (Issue #73)', () => {
    it('does not duplicate text item when shared via share_target and SignalR event arrives before API response', async () => {
      // Mock API responses
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      // Mount and wait for initial load
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sharedItemId = 'share-target-text-id';
      const sharedItem: SpaceItemResponse = {
        id: sharedItemId,
        spaceId,
        memberId: 'member-1',
        contentType: 'text' as const,
        content: 'Shared text content',
        fileSize: 0,
        sharedAt: new Date().toISOString(),
      };

      // Create delayed API response
      let uploadResolve: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        uploadResolve = resolve;
      });

      mockFetch.mockImplementationOnce(() => uploadPromise);

      // Mock crypto.randomUUID
      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(sharedItemId);

      // Simulate uploadPendingShare call with text share
      (element as any).token = token;
      const pendingShare = {
        id: 'pending-share-1',
        type: 'text' as const,
        content: 'Shared text content',
        timestamp: Date.now(),
      };

      const uploadSharePromise = (element as any).uploadPendingShare(pendingShare);

      // Wait for pendingItemIds.add to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify pendingItemIds contains the shared item
      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(sharedItemId)).toBe(true);

      // Simulate SignalR event arriving BEFORE API response completes
      if (signalRItemAddedHandler) {
        const signalRPayload: ItemAddedPayload = {
          id: sharedItemId,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'text',
          content: 'Shared text content',
          fileSize: 0,
          sharedAt: sharedItem.sharedAt,
        };

        signalRItemAddedHandler(signalRPayload);
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify item is NOT added via SignalR (blocked by pendingItemIds check)
        const itemsAfterSignalR = (element as any).items as SpaceItemResponse[];
        expect(itemsAfterSignalR).toHaveLength(0);
      }

      // Now complete the API response
      uploadResolve!({
        ok: true,
        status: 200,
        json: async () => sharedItem,
      });

      await uploadSharePromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify item was added via API response (no duplicate)
      const itemsAfterUpload = (element as any).items as SpaceItemResponse[];
      expect(itemsAfterUpload).toHaveLength(1);
      expect(itemsAfterUpload[0].id).toBe(sharedItemId);

      // Verify pendingItemIds was cleaned up
      expect(pendingIds.has(sharedItemId)).toBe(false);
    });

    it('does not duplicate file item when shared via share_target and SignalR event arrives before API response', async () => {
      // Mock API responses
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      // Mount and wait for initial load
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sharedFileId = 'share-target-file-id';
      const sharedFile: SpaceItemResponse = {
        id: sharedFileId,
        spaceId,
        memberId: 'member-1',
        contentType: 'file' as const,
        content: '/files/shared-image.jpg',
        fileSize: 2048,
        sharedAt: new Date().toISOString(),
      };

      // Create delayed API response
      let uploadResolve: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        uploadResolve = resolve;
      });

      mockFetch.mockImplementationOnce(() => uploadPromise);

      // Mock crypto.randomUUID
      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(sharedFileId);

      // Simulate uploadPendingShare call with file share
      (element as any).token = token;
      const fileData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const pendingShare = {
        id: 'pending-share-2',
        type: 'file' as const,
        fileName: 'shared-image.jpg',
        fileType: 'image/jpeg',
        fileData,
        timestamp: Date.now(),
      };

      const uploadSharePromise = (element as any).uploadPendingShare(pendingShare);

      // Wait for pendingItemIds.add to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify pendingItemIds contains the shared file
      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(sharedFileId)).toBe(true);

      // Simulate SignalR event arriving BEFORE API response completes
      if (signalRItemAddedHandler) {
        const signalRPayload: ItemAddedPayload = {
          id: sharedFileId,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'file',
          content: '/files/shared-image.jpg',
          fileSize: 2048,
          sharedAt: sharedFile.sharedAt,
        };

        signalRItemAddedHandler(signalRPayload);
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify file is NOT added via SignalR (blocked by pendingItemIds check)
        const itemsAfterSignalR = (element as any).items as SpaceItemResponse[];
        expect(itemsAfterSignalR).toHaveLength(0);
      }

      // Now complete the API response
      uploadResolve!({
        ok: true,
        status: 200,
        json: async () => sharedFile,
      });

      await uploadSharePromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify file was added via API response (no duplicate)
      const itemsAfterUpload = (element as any).items as SpaceItemResponse[];
      expect(itemsAfterUpload).toHaveLength(1);
      expect(itemsAfterUpload[0].id).toBe(sharedFileId);

      // Verify pendingItemIds was cleaned up
      expect(pendingIds.has(sharedFileId)).toBe(false);
    });

    it('cleans up pendingItemIds even when share upload fails', async () => {
      // Mock API responses
      const spaceInfo = {
        id: spaceId,
        name: 'Test Space',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/v1/spaces/') && !url.includes('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => spaceInfo,
          });
        }
        if (url.endsWith('/items')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      // Mount and wait for initial load
      document.body.appendChild(element);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const failedShareId = 'failed-share-id';

      // Mock failed upload
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(failedShareId);

      (element as any).token = token;
      const pendingShare = {
        id: 'pending-share-3',
        type: 'text' as const,
        content: 'Failed share content',
        timestamp: Date.now(),
      };

      try {
        await (element as any).uploadPendingShare(pendingShare);
      } catch {
        // Expected to fail
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify pendingItemIds was cleaned up even on failure (finally block)
      const pendingIds = (element as any).pendingItemIds as Set<string>;
      expect(pendingIds.has(failedShareId)).toBe(false);

      // Verify item was NOT added to items list
      const items = (element as any).items as SpaceItemResponse[];
      expect(items).toHaveLength(0);

      // If SignalR event arrives later, it should be added (not blocked)
      if (signalRItemAddedHandler) {
        const payload: ItemAddedPayload = {
          id: failedShareId,
          spaceId,
          memberId: 'member-1',
          displayName: 'User 1',
          contentType: 'text',
          content: 'Failed share content',
          fileSize: 0,
          sharedAt: new Date().toISOString(),
        };

        signalRItemAddedHandler(payload);
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Item should now be added via SignalR (since it's not in pendingItemIds or items)
        const itemsAfterSignalR = (element as any).items as SpaceItemResponse[];
        expect(itemsAfterSignalR).toHaveLength(1);
        expect(itemsAfterSignalR[0].id).toBe(failedShareId);
      }
    });
  });
});

describe('SpaceView - Delete Confirmation', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const token = 'test-jwt-token';

  let element: SpaceView;
  let mockFetch: ReturnType<typeof vi.fn>;

  function makeItem(overrides: Partial<SpaceItemResponse> = {}): SpaceItemResponse {
    return {
      id: 'item-1',
      spaceId,
      memberId: 'member-1',
      contentType: 'text',
      content: 'Hello world',
      fileSize: 0,
      sharedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === `${serverUrl}:${spaceId}`) return token;
      return null;
    });

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    element = document.createElement('space-view') as SpaceView;
    element.setAttribute('server-url', serverUrl);
    element.setAttribute('space-id', spaceId);
  });

  afterEach(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
    vi.restoreAllMocks();
  });

  describe('handleDeleteRequest', () => {
    it('sets deleteConfirmItemId to the item id', () => {
      const item = makeItem();
      (element as any).handleDeleteRequest(item);
      expect((element as any).deleteConfirmItemId).toBe(item.id);
    });

    it('does NOT remove the item from the list', () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).handleDeleteRequest(item);
      expect((element as any).items).toHaveLength(1);
      expect((element as any).items[0].id).toBe(item.id);
    });

    it('replaces a previous confirmation when a different item is requested', () => {
      const item1 = makeItem({ id: 'item-1' });
      const item2 = makeItem({ id: 'item-2' });
      (element as any).items = [item1, item2];

      (element as any).handleDeleteRequest(item1);
      expect((element as any).deleteConfirmItemId).toBe('item-1');

      (element as any).handleDeleteRequest(item2);
      expect((element as any).deleteConfirmItemId).toBe('item-2');
    });
  });

  describe('cancelDelete', () => {
    it('clears deleteConfirmItemId', () => {
      const item = makeItem();
      (element as any).handleDeleteRequest(item);
      expect((element as any).deleteConfirmItemId).toBe(item.id);

      (element as any).cancelDelete();
      expect((element as any).deleteConfirmItemId).toBeNull();
    });

    it('does NOT remove the item from the list', () => {
      const item = makeItem();
      (element as any).items = [item];

      (element as any).handleDeleteRequest(item);
      (element as any).cancelDelete();

      expect((element as any).items).toHaveLength(1);
      expect((element as any).items[0].id).toBe(item.id);
    });
  });

  describe('confirmDelete', () => {
    it('clears deleteConfirmItemId and removes item optimistically', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      (element as any).handleDeleteRequest(item);
      await (element as any).confirmDelete(item);

      expect((element as any).deleteConfirmItemId).toBeNull();
      expect((element as any).items).toHaveLength(0);
    });

    it('calls deleteItem API with correct parameters', async () => {
      const item = makeItem({ id: 'del-id' });
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
      await (element as any).confirmDelete(item);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/v1/spaces/${spaceId}/items/del-id`),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('reverts item on API failure (non-auth error)', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await (element as any).confirmDelete(item);

      // Item should be restored
      expect((element as any).items).toHaveLength(1);
      expect((element as any).items[0].id).toBe(item.id);
    });

    it('does NOT revert on 401 auth failure (shows error instead)', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      await (element as any).confirmDelete(item);

      expect((element as any).items).toHaveLength(0);
      expect((element as any).connectionErrorType).toBe('auth');
    });

    it('is a no-op when token is missing', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = undefined;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      await (element as any).confirmDelete(item);

      // Item should not be removed (guard clause exited early)
      expect((element as any).items).toHaveLength(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getItemPreviewLabel', () => {
    it('returns full content for file items', () => {
      const item = makeItem({ contentType: 'file', content: 'document.pdf' });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe('document.pdf');
    });

    it('returns full content for short text', () => {
      const item = makeItem({ content: 'Short note' });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe('Short note');
    });

    it('truncates text longer than 40 characters with ellipsis', () => {
      const longText = 'A'.repeat(50);
      const item = makeItem({ content: longText });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe('A'.repeat(40) + '…');
      expect(label.length).toBe(41);
    });

    it('returns exactly 40 characters without truncation at boundary', () => {
      const exactly40 = 'B'.repeat(40);
      const item = makeItem({ content: exactly40 });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe(exactly40);
    });

    it('trims whitespace before measuring length', () => {
      const item = makeItem({ content: '   padded text   ' });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe('padded text');
    });

    it('handles empty string content', () => {
      const item = makeItem({ content: '' });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe('');
    });

    it('does not truncate long filenames for file items', () => {
      const longFilename = 'a'.repeat(80) + '.pdf';
      const item = makeItem({ contentType: 'file', content: longFilename });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe(longFilename);
    });

    it('trims trailing whitespace from truncated text', () => {
      // 38 chars + 2 spaces + more chars = truncation at 40 should trimEnd
      const text = 'A'.repeat(38) + '  ' + 'B'.repeat(10);
      const item = makeItem({ content: text });
      const label = (element as any).getItemPreviewLabel(item);
      expect(label).toBe('A'.repeat(38) + '…');
    });
  });

  describe('renderDeleteConfirmOverlay', () => {
    it('contains "Delete" text and the preview label', () => {
      const item = makeItem({ content: 'my note' });
      const result = (element as any).renderDeleteConfirmOverlay(item);
      // Lit TemplateResult: the strings should contain "Delete" and we can verify the structure
      const strings = result.strings ?? result._$litType$?.strings ?? [];
      const flatStrings = Array.from(strings).join('');
      expect(flatStrings).toContain('Delete');
      expect(flatStrings).toContain('Cancel');
    });
  });

  describe('delete flow integration', () => {
    it('full flow: request → confirm performs deletion', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      // Step 1: delete request shows overlay
      (element as any).handleDeleteRequest(item);
      expect((element as any).deleteConfirmItemId).toBe(item.id);
      expect((element as any).items).toHaveLength(1);

      // Step 2: confirm deletes the item
      await (element as any).confirmDelete(item);
      expect((element as any).deleteConfirmItemId).toBeNull();
      expect((element as any).items).toHaveLength(0);
    });

    it('full flow: request → cancel preserves item', () => {
      const item = makeItem();
      (element as any).items = [item];

      // Step 1: delete request
      (element as any).handleDeleteRequest(item);
      expect((element as any).deleteConfirmItemId).toBe(item.id);

      // Step 2: cancel
      (element as any).cancelDelete();
      expect((element as any).deleteConfirmItemId).toBeNull();
      expect((element as any).items).toHaveLength(1);
    });

    it('only shows overlay for the targeted item, not all items', () => {
      const item1 = makeItem({ id: 'item-1' });
      const item2 = makeItem({ id: 'item-2' });
      (element as any).items = [item1, item2];

      (element as any).handleDeleteRequest(item1);
      expect((element as any).deleteConfirmItemId).toBe('item-1');

      // item-2 should not have overlay
      expect((element as any).deleteConfirmItemId).not.toBe('item-2');
    });

    it('confirm then request another item works correctly', async () => {
      const item1 = makeItem({ id: 'item-1' });
      const item2 = makeItem({ id: 'item-2' });
      (element as any).items = [item1, item2];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      // Delete item1
      (element as any).handleDeleteRequest(item1);
      await (element as any).confirmDelete(item1);
      expect((element as any).items).toHaveLength(1);

      // Now request delete on item2
      (element as any).handleDeleteRequest(item2);
      expect((element as any).deleteConfirmItemId).toBe('item-2');
      expect((element as any).items).toHaveLength(1);
    });
  });

  describe('visibility change reconnect', () => {
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
    let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    });

    it('registers visibilitychange listener on connect', () => {
      document.body.appendChild(element);
      expect(addEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('removes visibilitychange listener on disconnect', () => {
      document.body.appendChild(element);
      const handler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'visibilitychange'
      )?.[1];

      element.remove();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('visibilitychange', handler);
    });

    it('reconnects when page becomes visible and connection is disconnected', async () => {
      document.body.appendChild(element);
      await element.updateComplete;

      // Capture the handleVisibilityChange handler
      const visibilityHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'visibilitychange'
      )?.[1] as () => void;
      expect(visibilityHandler).toBeDefined();

      // Spy on startSignalR
      const startSignalRSpy = vi.spyOn(element as any, 'startSignalR');

      // Set connection state to disconnected
      (element as any).connectionState = 'disconnected';
      await element.updateComplete;

      // Mock document.visibilityState as visible
      Object.defineProperty(document, 'visibilityState', {
        writable: true,
        configurable: true,
        value: 'visible',
      });

      // Trigger the visibility change
      visibilityHandler();
      await element.updateComplete;

      expect(startSignalRSpy).toHaveBeenCalled();
    });

    it('does NOT reconnect when page becomes visible but connection is already connected', async () => {
      document.body.appendChild(element);
      await element.updateComplete;

      const visibilityHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'visibilitychange'
      )?.[1] as () => void;

      const startSignalRSpy = vi.spyOn(element as any, 'startSignalR');

      // Connection is already connected
      (element as any).connectionState = 'connected';
      await element.updateComplete;

      Object.defineProperty(document, 'visibilityState', {
        writable: true,
        configurable: true,
        value: 'visible',
      });

      visibilityHandler();
      await element.updateComplete;

      expect(startSignalRSpy).not.toHaveBeenCalled();
    });

    it('does NOT reconnect when page becomes hidden', async () => {
      document.body.appendChild(element);
      await element.updateComplete;

      const visibilityHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'visibilitychange'
      )?.[1] as () => void;

      const startSignalRSpy = vi.spyOn(element as any, 'startSignalR');

      (element as any).connectionState = 'disconnected';
      await element.updateComplete;

      Object.defineProperty(document, 'visibilityState', {
        writable: true,
        configurable: true,
        value: 'hidden',
      });

      visibilityHandler();
      await element.updateComplete;

      expect(startSignalRSpy).not.toHaveBeenCalled();
    });

    it('does NOT reconnect when page becomes visible but connection is connecting', async () => {
      document.body.appendChild(element);
      await element.updateComplete;

      const visibilityHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'visibilitychange'
      )?.[1] as () => void;

      const startSignalRSpy = vi.spyOn(element as any, 'startSignalR');

      (element as any).connectionState = 'connecting';
      await element.updateComplete;

      Object.defineProperty(document, 'visibilityState', {
        writable: true,
        configurable: true,
        value: 'visible',
      });

      visibilityHandler();
      await element.updateComplete;

      expect(startSignalRSpy).not.toHaveBeenCalled();
    });

    it('does NOT reconnect when page becomes visible but connection is reconnecting', async () => {
      document.body.appendChild(element);
      await element.updateComplete;

      const visibilityHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'visibilitychange'
      )?.[1] as () => void;

      const startSignalRSpy = vi.spyOn(element as any, 'startSignalR');

      (element as any).connectionState = 'reconnecting';
      await element.updateComplete;

      Object.defineProperty(document, 'visibilityState', {
        writable: true,
        configurable: true,
        value: 'visible',
      });

      visibilityHandler();
      await element.updateComplete;

      expect(startSignalRSpy).not.toHaveBeenCalled();
    });
  });

  describe('Drag and Drop', () => {
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
    let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    });

    // Helper to create a drag event with controllable dataTransfer.types
    const createDragEvent = (type: string, includeFiles: boolean): DragEvent => {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
      });
      
      // Mock dataTransfer with types property
      const mockDataTransfer = {
        types: includeFiles ? ['Files'] : ['text/plain'],
        files: includeFiles ? ({} as FileList) : ({} as FileList),
      };
      
      Object.defineProperty(event, 'dataTransfer', {
        value: mockDataTransfer,
        writable: false,
      });
      
      return event;
    };

    it('registers document-level drag listeners on connect', () => {
      document.body.appendChild(element);
      
      expect(addEventListenerSpy).toHaveBeenCalledWith('dragenter', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function));
    });

    it('removes document-level drag listeners on disconnect', () => {
      document.body.appendChild(element);
      
      const dragEnterHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'dragenter'
      )?.[1];
      const dragLeaveHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'dragleave'
      )?.[1];
      const dropHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'drop'
      )?.[1];
      const dragOverHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'dragover'
      )?.[1];

      element.remove();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragenter', dragEnterHandler);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragleave', dragLeaveHandler);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', dropHandler);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', dragOverHandler);
    });

    it('dragOver toggles to true on file dragenter', () => {
      expect((element as any).dragOver).toBe(false);
      expect((element as any).dragCounter).toBe(0);

      const event = createDragEvent('dragenter', true);
      (element as any).handleDragEnter(event);

      expect((element as any).dragCounter).toBe(1);
      expect((element as any).dragOver).toBe(true);
    });

    it('dragOver stays false on non-file dragenter (text/link)', () => {
      expect((element as any).dragOver).toBe(false);
      expect((element as any).dragCounter).toBe(0);

      const event = createDragEvent('dragenter', false);
      (element as any).handleDragEnter(event);

      // Counter and overlay should remain unchanged
      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false);
    });

    it('dragOver toggles to false when counter reaches 0', () => {
      // Set up: enter once
      (element as any).dragCounter = 0;
      (element as any).dragOver = false;

      const enterEvent = createDragEvent('dragenter', true);
      (element as any).handleDragEnter(enterEvent);
      expect((element as any).dragOver).toBe(true);
      expect((element as any).dragCounter).toBe(1);

      // Leave once
      const leaveEvent = createDragEvent('dragleave', true);
      (element as any).handleDragLeave(leaveEvent);
      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false);
    });

    it('dragCounter cannot go negative', () => {
      // Start clean
      (element as any).dragCounter = 0;
      (element as any).dragOver = false;

      // Dragleave without prior dragenter
      const leaveEvent = createDragEvent('dragleave', true);
      (element as any).handleDragLeave(leaveEvent);

      // Counter should stay at 0, not go negative
      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false);

      // Additional dragleave should still not go negative
      (element as any).handleDragLeave(leaveEvent);
      expect((element as any).dragCounter).toBe(0);
    });

    it('handleDocumentDrop resets both counter and dragOver', () => {
      // Set up: simulated mid-drag state
      (element as any).dragCounter = 3;
      (element as any).dragOver = true;

      const dropEvent = createDragEvent('drop', true);
      (element as any).handleDocumentDrop(dropEvent);

      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false);
    });

    it('handleDrop on compose box resets state and processes files', async () => {
      // Set up drag state
      (element as any).dragCounter = 2;
      (element as any).dragOver = true;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      // Mock uploadFiles
      const uploadFilesSpy = vi.spyOn(element as any, 'uploadFiles').mockResolvedValue(undefined);

      // Create drop event with files
      const dropEvent = createDragEvent('drop', true);
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      Object.defineProperty(dropEvent.dataTransfer, 'files', {
        value: [mockFile],
        writable: false,
      });

      await (element as any).handleDrop(dropEvent);

      // State should be reset
      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false);

      // uploadFiles should be called with the files
      expect(uploadFilesSpy).toHaveBeenCalledWith([mockFile]);
    });

    it('handleDrop does not call uploadFiles if no files present', async () => {
      (element as any).dragCounter = 1;
      (element as any).dragOver = true;

      const uploadFilesSpy = vi.spyOn(element as any, 'uploadFiles').mockResolvedValue(undefined);

      // Drop event with no files
      const dropEvent = createDragEvent('drop', true);
      Object.defineProperty(dropEvent.dataTransfer, 'files', {
        value: [],
        writable: false,
      });

      await (element as any).handleDrop(dropEvent);

      // State still reset
      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false);

      // But uploadFiles not called
      expect(uploadFilesSpy).not.toHaveBeenCalled();
    });

    it('multiple nested dragenter/dragleave pairs work correctly', () => {
      // Simulate nested elements: drag enters child, enters parent, leaves child, leaves parent
      (element as any).dragCounter = 0;
      (element as any).dragOver = false;

      const enterEvent = createDragEvent('dragenter', true);
      const leaveEvent = createDragEvent('dragleave', true);

      // Enter element 1
      (element as any).handleDragEnter(enterEvent);
      expect((element as any).dragCounter).toBe(1);
      expect((element as any).dragOver).toBe(true);

      // Enter nested element 2
      (element as any).handleDragEnter(enterEvent);
      expect((element as any).dragCounter).toBe(2);
      expect((element as any).dragOver).toBe(true);

      // Enter nested element 3
      (element as any).handleDragEnter(enterEvent);
      expect((element as any).dragCounter).toBe(3);
      expect((element as any).dragOver).toBe(true);

      // Leave element 3
      (element as any).handleDragLeave(leaveEvent);
      expect((element as any).dragCounter).toBe(2);
      expect((element as any).dragOver).toBe(true); // Still > 0

      // Leave element 2
      (element as any).handleDragLeave(leaveEvent);
      expect((element as any).dragCounter).toBe(1);
      expect((element as any).dragOver).toBe(true); // Still > 0

      // Leave element 1
      (element as any).handleDragLeave(leaveEvent);
      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false); // Now false
    });

    it('non-file drags do not affect counter balance', () => {
      // Start with file drag
      (element as any).dragCounter = 0;
      (element as any).dragOver = false;

      const fileEnter = createDragEvent('dragenter', true);
      (element as any).handleDragEnter(fileEnter);
      expect((element as any).dragCounter).toBe(1);
      expect((element as any).dragOver).toBe(true);

      // Non-file drag enters (should be ignored)
      const textEnter = createDragEvent('dragenter', false);
      (element as any).handleDragEnter(textEnter);
      expect((element as any).dragCounter).toBe(1); // Unchanged
      expect((element as any).dragOver).toBe(true);

      // Non-file drag leaves (should be ignored)
      const textLeave = createDragEvent('dragleave', false);
      (element as any).handleDragLeave(textLeave);
      expect((element as any).dragCounter).toBe(1); // Still unchanged
      expect((element as any).dragOver).toBe(true);

      // File drag leaves (should decrement)
      const fileLeave = createDragEvent('dragleave', true);
      (element as any).handleDragLeave(fileLeave);
      expect((element as any).dragCounter).toBe(0);
      expect((element as any).dragOver).toBe(false);
    });
  });
});




describe('SpaceView - WebSocket Disconnect on Space Switching (Issue #86)', () => {
  // Regression tests for Issue #86: WebSocket is not disconnected when switching between spaces
  // The bug manifests as stale connection state in the dot indicator when rapidly switching spaces
  
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const token = 'test-jwt-token';
  
  let element: SpaceView;
  let mockFetch: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Re-mock SignalR connection after clearAllMocks
    mockSignalRConnection.start = vi.fn().mockResolvedValue(undefined);
    mockSignalRConnection.stop = vi.fn().mockResolvedValue(undefined);
    mockSignalRConnection.on = vi.fn();
    mockSignalRConnection.state = 'Disconnected';
    
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === `${serverUrl}:${spaceId}`) return token;
      return null;
    });
    
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    globalThis.fetch = mockFetch;
    
    element = document.createElement('space-view') as SpaceView;
    element.setAttribute('server-url', serverUrl);
    element.setAttribute('space-id', spaceId);
  });
  
  afterEach(() => {
    if (element?.parentNode) {
      element.parentNode.removeChild(element);
    }
    vi.restoreAllMocks();
  });
  
  it('calls stopSignalR when element is removed from DOM', async () => {
    // Set up a mock SignalR client to verify cleanup
    const mockClient = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    (element as any).signalRClient = mockClient;
    (element as any).connectionState = 'connected';
    
    document.body.appendChild(element);
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    // Remove from DOM - should trigger disconnectedCallback
    document.body.removeChild(element);
    
    // Wait for async stopSignalR to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Verify stop was called
    expect(mockClient.stop).toHaveBeenCalled();
    
    // Verify signalRClient is cleared
    expect((element as any).signalRClient).toBeUndefined();
    
    // Verify state is set to disconnected
    expect((element as any).connectionState).toBe('disconnected');
  });
  
  it('emits connection-state-change event with correct spaceId when state changes', async () => {
    const spaceId1 = '550e8400-e29b-41d4-a716-446655440001';
    const element1 = document.createElement('space-view') as SpaceView;
    element1.setAttribute('server-url', serverUrl);
    element1.setAttribute('space-id', spaceId1);
    
    let capturedEvent: CustomEvent | null = null;
    element1.addEventListener('connection-state-change', (e) => {
      capturedEvent = e as CustomEvent;
    });
    
    document.body.appendChild(element1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    // Change connection state
    (element1 as any).connectionState = 'connected';
    await (element1 as any).updateComplete;
    
    // Verify event was emitted with correct spaceId
    expect(capturedEvent).not.toBeNull();
    if (capturedEvent) {
      expect(capturedEvent.detail.spaceId).toBe(spaceId1);
      expect(capturedEvent.detail.state).toBe('connected');
    }
    
    // Clean up
    document.body.removeChild(element1);
  });
  
  it('each space-view instance tracks its own connection state independently', () => {
    const spaceId1 = '550e8400-e29b-41d4-a716-446655440001';
    const spaceId2 = '550e8400-e29b-41d4-a716-446655440002';
    
    const element1 = document.createElement('space-view') as SpaceView;
    element1.setAttribute('server-url', serverUrl);
    element1.setAttribute('space-id', spaceId1);
    (element1 as any).connectionState = 'connected';
    
    const element2 = document.createElement('space-view') as SpaceView;
    element2.setAttribute('server-url', serverUrl);
    element2.setAttribute('space-id', spaceId2);
    (element2 as any).connectionState = 'disconnected';
    
    // Each element should have its own state
    expect((element1 as any).spaceId).toBe(spaceId1);
    expect((element1 as any).connectionState).toBe('connected');
    
    expect((element2 as any).spaceId).toBe(spaceId2);
    expect((element2 as any).connectionState).toBe('disconnected');
    
    // States should be independent
    (element1 as any).connectionState = 'disconnected';
    expect((element1 as any).connectionState).toBe('disconnected');
    expect((element2 as any).connectionState).toBe('disconnected'); // Still disconnected, not affected
  });
  
  it('startSignalR stops existing connection before starting new one', async () => {
    const mockClient1 = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    
    (element as any).serverUrl = serverUrl;
    (element as any).spaceId = spaceId;
    (element as any).token = token;
    (element as any).signalRClient = mockClient1;
    
    // Call startSignalR - should stop existing client first
    await (element as any).startSignalR();
    
    // Verify old client was stopped
    expect(mockClient1.stop).toHaveBeenCalled();
  });
  
  it('stopSignalR clears signalRClient and sets state to disconnected', async () => {
    const mockClient = {
      stop: vi.fn().mockResolvedValue(undefined),
    };
    
    (element as any).signalRClient = mockClient;
    (element as any).connectionState = 'connected';
    
    await (element as any).stopSignalR();
    
    expect(mockClient.stop).toHaveBeenCalled();
    expect((element as any).signalRClient).toBeUndefined();
    expect((element as any).connectionState).toBe('disconnected');
  });
  
  it('connection state remains independent when multiple space-view elements exist', async () => {
    const spaceId1 = '550e8400-e29b-41d4-a716-446655440001';
    const spaceId2 = '550e8400-e29b-41d4-a716-446655440002';
    
    // Create two space-view elements
    const element1 = document.createElement('space-view') as SpaceView;
    element1.setAttribute('server-url', serverUrl);
    element1.setAttribute('space-id', spaceId1);
    
    const element2 = document.createElement('space-view') as SpaceView;
    element2.setAttribute('server-url', serverUrl);
    element2.setAttribute('space-id', spaceId2);
    
    // Set up mock clients
    const mockClient1 = { stop: vi.fn().mockResolvedValue(undefined) };
    const mockClient2 = { stop: vi.fn().mockResolvedValue(undefined) };
    (element1 as any).signalRClient = mockClient1;
    (element2 as any).signalRClient = mockClient2;
    
    document.body.appendChild(element1);
    document.body.appendChild(element2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    // Remove first element
    document.body.removeChild(element1);
    
    // Wait for async cleanup
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Only element1's client should be stopped
    expect(mockClient1.stop).toHaveBeenCalled();
    expect(mockClient2.stop).not.toHaveBeenCalled();
    
    // Clean up
    document.body.removeChild(element2);
  });
  
  it('re-adding a space-view after removal creates fresh connection state', async () => {
    const spaceId1 = '550e8400-e29b-41d4-a716-446655440001';
    const element1 = document.createElement('space-view') as SpaceView;
    element1.setAttribute('server-url', serverUrl);
    element1.setAttribute('space-id', spaceId1);
    
    // Set up mock client
    const mockClient1 = { stop: vi.fn().mockResolvedValue(undefined) };
    (element1 as any).signalRClient = mockClient1;
    (element1 as any).connectionState = 'connected';
    
    document.body.appendChild(element1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    // Remove element
    document.body.removeChild(element1);
    
    // Wait for async cleanup
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    expect(mockClient1.stop).toHaveBeenCalled();
    expect((element1 as any).signalRClient).toBeUndefined();
    
    // Re-add the same element
    document.body.appendChild(element1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    // Connection state should still be disconnected (until startSignalR is called)
    // This tests that we don't have stale state from before removal
    expect((element1 as any).signalRClient).toBeUndefined();
    
    // Clean up
    document.body.removeChild(element1);
  });
});

describe('SpaceView - Unified Item Card Layout', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const token = 'test-jwt-token';

  let element: SpaceView;
  let mockFetch: ReturnType<typeof vi.fn>;

  function makeItem(overrides: Partial<SpaceItemResponse> = {}): SpaceItemResponse {
    return {
      id: 'item-1',
      spaceId,
      memberId: 'member-1',
      contentType: 'text',
      content: 'Hello world',
      fileSize: 0,
      sharedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === `${serverUrl}:${spaceId}`) return token;
      return null;
    });

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    element = document.createElement('space-view') as SpaceView;
    element.setAttribute('server-url', serverUrl);
    element.setAttribute('space-id', spaceId);
    document.body.appendChild(element);
  });

  afterEach(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
    vi.restoreAllMocks();
  });

  describe('renderUnifiedItemCard', () => {
    it('applies the unified card CSS classes', async () => {
      // Set up an item
      const item = makeItem({ content: 'Test item' });
      (element as any).items = [item];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      // Query the rendered card - use individual class checks
      const cards = element.querySelectorAll('li');
      const card = Array.from(cards).find(c => 
        c.classList.contains('rounded-lg') && 
        c.classList.contains('border') && 
        c.classList.contains('border-slate-800')
      );
      expect(card).toBeTruthy();
      expect(card?.classList.contains('px-4')).toBe(true);
      expect(card?.classList.contains('py-3')).toBe(true);
      expect(card?.classList.contains('relative')).toBe(true);
      expect(card?.classList.contains('overflow-hidden')).toBe(true);
    });

    it('renders regular text items with unified card layout', async () => {
      const item = makeItem({ contentType: 'text', content: 'My test note' });
      (element as any).items = [item];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      const cards = element.querySelectorAll('li');
      const card = Array.from(cards).find(c => 
        c.classList.contains('rounded-lg') && 
        c.classList.contains('border') && 
        c.classList.contains('border-slate-800') &&
        c.textContent?.includes('My test note')
      );
      expect(card).toBeTruthy();
      expect(card?.classList.contains('px-4')).toBe(true);
      expect(card?.classList.contains('py-3')).toBe(true);
    });

    it('renders file items with unified card layout', async () => {
      const item = makeItem({ 
        contentType: 'file', 
        content: 'test.pdf',
        fileSize: 12345,
        fileName: 'test.pdf'
      });
      (element as any).items = [item];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      const cards = element.querySelectorAll('li');
      const card = Array.from(cards).find(c => 
        c.classList.contains('rounded-lg') && 
        c.classList.contains('border') && 
        c.classList.contains('border-slate-800') &&
        c.textContent?.includes('test.pdf')
      );
      expect(card).toBeTruthy();
      expect(card?.classList.contains('px-4')).toBe(true);
      expect(card?.classList.contains('py-3')).toBe(true);
    });
  });

  describe('renderPendingSharesSection', () => {
    it('does not render when there are no pending shares', async () => {
      (element as any).pendingShares = [];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      const sections = element.querySelectorAll('section');
      const section = Array.from(sections).find(s => s.classList.contains('border-amber-500/30'));
      expect(section).toBeFalsy();
    });

    it('renders pending text share with unified card layout', async () => {
      (element as any).pendingShares = [
        {
          id: 'pending-1',
          type: 'text',
          content: 'Shared text from another app',
        },
      ];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      // Verify the pending shares section exists
      const sections = element.querySelectorAll('section');
      const section = Array.from(sections).find(s => 
        s.textContent?.includes('Shared text from another app')
      );
      expect(section).toBeTruthy();

      // Verify the unified card layout is used
      const cards = section?.querySelectorAll('li');
      const card = Array.from(cards || []).find(c => 
        c.classList.contains('rounded-lg') && 
        c.classList.contains('border') && 
        c.classList.contains('border-slate-800')
      );
      expect(card).toBeTruthy();
      expect(card?.classList.contains('px-4')).toBe(true);
      expect(card?.classList.contains('py-3')).toBe(true);

      // Verify content is rendered
      expect(section?.textContent).toContain('Shared text from another app');
    });

    it('renders pending file share with unified card layout', async () => {
      (element as any).pendingShares = [
        {
          id: 'pending-2',
          type: 'file',
          fileName: 'shared-doc.pdf',
          blob: new Blob(['test']),
        },
      ];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      const sections = element.querySelectorAll('section');
      const section = Array.from(sections).find(s => 
        s.textContent?.includes('shared-doc.pdf')
      );
      expect(section).toBeTruthy();

      // Verify the unified card layout is used
      const cards = section?.querySelectorAll('li');
      const card = Array.from(cards || []).find(c => 
        c.classList.contains('rounded-lg') && 
        c.classList.contains('border') && 
        c.classList.contains('border-slate-800')
      );
      expect(card).toBeTruthy();
      expect(card?.classList.contains('px-4')).toBe(true);
      expect(card?.classList.contains('py-3')).toBe(true);

      // Verify file name is rendered
      expect(section?.textContent).toContain('shared-doc.pdf');
    });

    it('renders Upload and Dismiss buttons for each pending share', async () => {
      (element as any).pendingShares = [
        {
          id: 'pending-1',
          type: 'text',
          content: 'Test share',
        },
      ];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      const sections = element.querySelectorAll('section');
      const section = Array.from(sections).find(s => 
        s.textContent?.includes('Test share')
      );
      const buttons = section?.querySelectorAll('button');
      
      // Should have Upload All, Upload (per item), and Dismiss (per item)
      expect(buttons?.length).toBeGreaterThanOrEqual(3);

      // Find the Upload button (per item)
      const uploadButton = Array.from(buttons || []).find(b => 
        b.textContent?.trim() === 'Upload' && b.title === 'Upload this item'
      );
      expect(uploadButton).toBeTruthy();

      // Find the Dismiss button
      const dismissButton = Array.from(buttons || []).find(b => 
        b.getAttribute('aria-label') === 'Dismiss shared item'
      );
      expect(dismissButton).toBeTruthy();
    });

    it('renders multiple pending shares each with unified card layout', async () => {
      (element as any).pendingShares = [
        {
          id: 'pending-1',
          type: 'text',
          content: 'First share',
        },
        {
          id: 'pending-2',
          type: 'file',
          fileName: 'document.pdf',
          blob: new Blob(['test']),
        },
      ];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      const sections = element.querySelectorAll('section');
      const section = Array.from(sections).find(s => 
        s.textContent?.includes('First share')
      );
      
      const allLis = section?.querySelectorAll('li');
      const cards = Array.from(allLis || []).filter(c => 
        c.classList.contains('rounded-lg') && 
        c.classList.contains('border') && 
        c.classList.contains('border-slate-800')
      );
      
      // Should have 2 cards
      expect(cards.length).toBe(2);

      // Each card should have the unified layout classes
      cards.forEach(card => {
        expect(card.classList.contains('px-4')).toBe(true);
        expect(card.classList.contains('py-3')).toBe(true);
        expect(card.classList.contains('relative')).toBe(true);
        expect(card.classList.contains('overflow-hidden')).toBe(true);
      });
    });

    it('pending share cards and regular item cards have the same wrapper classes', async () => {
      // Set up both regular items and pending shares
      const item = makeItem({ content: 'Regular item' });
      (element as any).items = [item];
      (element as any).pendingShares = [
        {
          id: 'pending-1',
          type: 'text',
          content: 'Pending share',
        },
      ];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      // Get all cards
      const allLis = element.querySelectorAll('li');
      const allCards = Array.from(allLis).filter(c => 
        c.classList.contains('rounded-lg') && 
        c.classList.contains('border') && 
        c.classList.contains('border-slate-800')
      );
      expect(allCards.length).toBeGreaterThanOrEqual(2);

      // Verify all cards have the same base classes
      const expectedClasses = ['relative', 'overflow-hidden', 'rounded-lg', 'border', 'px-4', 'py-3'];
      allCards.forEach(card => {
        expectedClasses.forEach(cls => {
          expect(card.classList.contains(cls)).toBe(true);
        });
      });
    });
  });
});
