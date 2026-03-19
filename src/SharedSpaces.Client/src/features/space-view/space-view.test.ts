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

      await (element as any).handleDelete(uploadingItem);
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
});
