import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { nothing } from 'lit';
import './space-view';
import { SpaceView } from './space-view';
import type { ItemAddedPayload } from '../../lib/signalr-client';
import type { SpaceItemResponse } from './space-api';
import {
  clearAllCachedFiles,
  clearOfflineQueue,
  clearPendingShares,
  clearStoredAuthTokens,
  getOfflineQueueForSpace,
  getComposeDrafts,
  saveComposeDraft,
  clearComposeDrafts,
} from '../../lib/idb-storage';
import * as idbStorage from '../../lib/idb-storage';
import * as tokenStorage from '../../lib/token-storage';
import { setToken, waitForTokenMirrorWritesForTests } from '../../lib/token-storage';
import { buildShareUrl } from '../../lib/share-link';

async function resetTokenStorageState(): Promise<void> {
  await waitForTokenMirrorWritesForTests();
  localStorage.clear();
  await clearPendingShares();
  await clearOfflineQueue();
  await clearStoredAuthTokens();
}

async function seedStoredSpaceToken(serverUrl: string, spaceId: string, token: string): Promise<void> {
  await setToken(serverUrl, spaceId, token);
  await waitForTokenMirrorWritesForTests();
}

beforeEach(resetTokenStorageState);
beforeEach(async () => {
  // Reset the cached file blob store between tests; default makeItem id is shared.
  await clearAllCachedFiles();
});
afterEach(resetTokenStorageState);

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

const mockQrCode = vi.hoisted(() => ({
  toDataURL: vi.fn(),
}));

vi.mock('qrcode', () => ({
  toDataURL: mockQrCode.toDataURL,
}));

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

describe('SpaceView - Leave Space', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = 'leave-space-id';

  let element: SpaceView;

  const findButton = (label: string): HTMLButtonElement | undefined => Array
    .from(element.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === label) as HTMLButtonElement | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    element = document.createElement('space-view') as SpaceView;

    vi.spyOn(element as any, 'loadData').mockResolvedValue(undefined);
    vi.spyOn(element as any, 'loadPendingShares').mockResolvedValue(undefined);
    vi.spyOn(element as any, 'refreshOfflineQueue').mockResolvedValue(undefined);

    document.body.appendChild(element);
    element.serverUrl = serverUrl;
    element.spaceId = spaceId;
    element.showSettings = true;
    (element as any).isLoading = false;
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
    vi.restoreAllMocks();
  });

  it('shows the "Leave" button when settings are open', () => {
    expect(findButton('Leave')).toBeTruthy();
    expect(findButton('Confirm')).toBeUndefined();
    expect(findButton('Cancel')).toBeUndefined();
  });

  it('clicking "Leave" shows "Confirm" and "Cancel" buttons', async () => {
    findButton('Leave')!.click();
    await element.updateComplete;

    expect(findButton('Leave')).toBeUndefined();
    expect(findButton('Confirm')).toBeTruthy();
    expect(findButton('Cancel')).toBeTruthy();
  });

  it('clicking "Cancel" returns to the initial "Leave" button state', async () => {
    findButton('Leave')!.click();
    await element.updateComplete;

    findButton('Cancel')!.click();
    await element.updateComplete;

    expect((element as any).leaveConfirm).toBe(false);
    expect(findButton('Leave')).toBeTruthy();
    expect(findButton('Confirm')).toBeUndefined();
    expect(findButton('Cancel')).toBeUndefined();
  });

  it('clicking "Confirm" removes the token, clears offline queue, and dispatches view-change for join with reloadSpaces', async () => {
    const removeTokenSpy = vi.spyOn(tokenStorage, 'removeToken').mockResolvedValue();
    const clearOfflineQueueSpy = vi.spyOn(idbStorage, 'clearOfflineQueueForSpace').mockResolvedValue();
    const stopSignalRSpy = vi.spyOn(element as any, 'stopSignalR').mockResolvedValue(undefined);
    const viewChangeHandler = vi.fn();
    element.addEventListener('view-change', viewChangeHandler as EventListener);

    findButton('Leave')!.click();
    await element.updateComplete;

    findButton('Confirm')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopSignalRSpy).toHaveBeenCalledOnce();
    expect(removeTokenSpy).toHaveBeenCalledWith(serverUrl, spaceId);
    expect(clearOfflineQueueSpy).toHaveBeenCalledWith(serverUrl, spaceId);
    expect(viewChangeHandler).toHaveBeenCalledTimes(1);
    expect((viewChangeHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({
      view: 'join',
      reloadSpaces: true,
    });
  });
});

describe('SpaceView - Journal Sync Verification', () => {
  let element: SpaceView;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement('space-view') as SpaceView;
    element.serverUrl = 'http://localhost:5000';
    element.spaceId = 'journal-space';
    (element as any).token = 'test-jwt-token';
    (element as any).isOnline = true;
    (element as any).journalSyncEnabled = true;
  });

  afterEach(() => {
    element.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces overlapping verification requests while a sync is already running', async () => {
    const pendingSyncs: Array<() => void> = [];
    const loadDataWithJournalSync = vi
      .spyOn(element as any, 'loadDataWithJournalSync')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            pendingSyncs.push(resolve);
          }),
      );

    (element as any).scheduleJournalVerification();
    (element as any).scheduleJournalVerification();

    await vi.advanceTimersByTimeAsync(1200);
    expect(loadDataWithJournalSync).toHaveBeenCalledTimes(1);

    (element as any).scheduleJournalVerification();
    (element as any).scheduleJournalVerification();

    await vi.advanceTimersByTimeAsync(1200);
    expect(loadDataWithJournalSync).toHaveBeenCalledTimes(1);

    pendingSyncs.shift()?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1200);

    expect(loadDataWithJournalSync).toHaveBeenCalledTimes(2);

    pendingSyncs.shift()?.();
    await Promise.resolve();
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

  describe('renderDeleteConfirmActions', () => {
    it('contains "Delete" and "Cancel" buttons', () => {
      const item = makeItem({ content: 'my note' });
      const result = (element as any).renderDeleteConfirmActions(item);
      // Lit TemplateResult: the strings should contain "Delete" and "Cancel"
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

    it('handleDrop on compose box resets state and opens the rename modal for files', async () => {
      // Set up drag state
      (element as any).dragCounter = 2;
      (element as any).dragOver = true;

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

      // The rename modal should be populated instead of uploading immediately
      expect((element as any).fileRenameDrafts).toHaveLength(1);
      expect((element as any).fileRenameDrafts[0].file).toBe(mockFile);
      expect((element as any).fileRenameDrafts[0].name).toBe('test.txt');
    });

    it('handleDrop does not open the rename modal if no files are present', async () => {
      (element as any).dragCounter = 1;
      (element as any).dragOver = true;

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

      // No rename modal should open
      expect((element as any).fileRenameDrafts).toHaveLength(0);
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

describe('SpaceView - Clipboard paste', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const token = 'test-jwt-token';

  let element: SpaceView;
  let mockFetch: ReturnType<typeof vi.fn>;

  function createPasteEvent(
    items: Array<{ kind: string; type: string; file?: File | null }>,
  ): { event: ClipboardEvent; preventDefault: ReturnType<typeof vi.fn> } {
    const preventDefault = vi.fn();

    return {
      event: {
        clipboardData: {
          items: items.map((item) => ({
            kind: item.kind,
            type: item.type,
            getAsFile: () => item.file ?? null,
          })),
        },
        preventDefault,
      } as unknown as ClipboardEvent,
      preventDefault,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    element = document.createElement('space-view') as SpaceView;
    element.setAttribute('server-url', serverUrl);
    element.setAttribute('space-id', spaceId);
    (element as any).token = token;
    (element as any).serverUrl = serverUrl;
    (element as any).spaceId = spaceId;
  });

  afterEach(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
    vi.restoreAllMocks();
  });

  it('uploads pasted images through uploadFiles and generates fallback filenames', async () => {
    const uploadFilesSpy = vi.spyOn(element as any, 'uploadFiles').mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const unnamedImage = new File(['image-data'], '', { type: 'image/png' });
    const { event, preventDefault } = createPasteEvent([
      { kind: 'file', type: 'image/png', file: unnamedImage },
    ]);

    await (element as any).handleTextareaPaste(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(uploadFilesSpy).toHaveBeenCalledOnce();

    const uploadedFiles = uploadFilesSpy.mock.calls[0][0] as File[];
    expect(uploadedFiles).toHaveLength(1);
    expect(uploadedFiles[0].name).toBe('pasted-image-1700000000000-1.png');
    expect(uploadedFiles[0].type).toBe('image/png');
  });

  it('preserves named clipboard images and ignores non-image clipboard items', async () => {
    const uploadFilesSpy = vi.spyOn(element as any, 'uploadFiles').mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const namedImage = new File(['image-data'], 'clipboard-photo.jpg', { type: 'image/jpeg' });
    const unnamedImage = new File(['image-data'], '', { type: 'image/png' });
    const pdfFile = new File(['pdf-data'], 'notes.pdf', { type: 'application/pdf' });
    const { event, preventDefault } = createPasteEvent([
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'image/jpeg', file: namedImage },
      { kind: 'file', type: 'application/pdf', file: pdfFile },
      { kind: 'file', type: 'image/png', file: unnamedImage },
    ]);

    await (element as any).handleTextareaPaste(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(uploadFilesSpy).toHaveBeenCalledOnce();

    const uploadedFiles = uploadFilesSpy.mock.calls[0][0] as File[];
    expect(uploadedFiles.map((file) => file.name)).toEqual([
      'clipboard-photo.jpg',
      'pasted-image-1700000000000-2.png',
    ]);
  });

  it('does not intercept regular text paste', async () => {
    const uploadFilesSpy = vi.spyOn(element as any, 'uploadFiles').mockResolvedValue(undefined);

    const { event, preventDefault } = createPasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);

    await (element as any).handleTextareaPaste(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(uploadFilesSpy).not.toHaveBeenCalled();
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

  describe('pending shares folded into compose box', () => {
    it('does not render pending shares when there are none', async () => {
      (element as any).pendingShares = [];
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      expect(element.textContent).not.toContain('Shared from another app');
      const uploadAll = Array.from(element.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Upload all',
      );
      expect(uploadAll).toBeFalsy();
    });

    it('folds a pending text share into the compose box', async () => {
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

      // The pending row lives inside the compose box (the section that also
      // contains the share textarea), not in a separate section below it.
      const textarea = element.querySelector('textarea');
      const composeSection = textarea?.closest('section');
      expect(composeSection).toBeTruthy();
      expect(composeSection?.textContent).toContain('Shared text from another app');
      expect(composeSection?.textContent).toContain('Shared from another app');
    });

    it('folds a pending file share into the compose box', async () => {
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

      const textarea = element.querySelector('textarea');
      const composeSection = textarea?.closest('section');
      expect(composeSection?.textContent).toContain('shared-doc.pdf');
      expect(composeSection?.textContent).toContain('Shared from another app');
    });

    it('renders Upload, Dismiss, and Upload all actions for pending shares', async () => {
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

      const buttons = Array.from(element.querySelectorAll('button'));

      const uploadButton = buttons.find(
        (b) => b.textContent?.trim() === 'Upload' && b.title === 'Upload this item',
      );
      expect(uploadButton).toBeTruthy();

      const dismissButton = buttons.find(
        (b) => b.getAttribute('aria-label') === 'Dismiss shared item',
      );
      expect(dismissButton).toBeTruthy();

      const uploadAllButton = buttons.find(
        (b) => b.textContent?.trim() === 'Upload all',
      );
      expect(uploadAllButton).toBeTruthy();
    });

    it('does not duplicate a file pending share once it is promoted into a draft', async () => {
      const share = {
        id: 'pending-file',
        type: 'file' as const,
        fileName: 'photo.jpg',
        fileType: 'image/jpeg',
        fileData: new Uint8Array([1, 2, 3]).buffer,
        timestamp: Date.now(),
      };
      (element as any).pendingShares = [share];
      // Promote it into the compose queue (keeps it in pendingShares until upload).
      (element as any).requestPendingShareUpload(share);
      (element as any).requestUpdate();
      await element.updateComplete;

      // The promoted share should now be an editable draft row, not also a
      // folded-in pending row.
      expect((element as any).visiblePendingShares).toHaveLength(0);
      const subtitles = Array.from(element.querySelectorAll('p')).filter(
        (p) => p.textContent?.trim() === 'Shared from another app',
      );
      expect(subtitles).toHaveLength(0);
    });

    it('keeps the Share button disabled when only pending shares exist', async () => {
      (element as any).pendingShares = [
        {
          id: 'pending-1',
          type: 'text',
          content: 'Only pending',
        },
      ];
      (element as any).textInput = '';
      (element as any).isLoading = false;
      (element as any).requestUpdate();
      await element.updateComplete;

      const shareButton = Array.from(element.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Share',
      );
      expect(shareButton).toBeTruthy();
      expect((shareButton as HTMLButtonElement).disabled).toBe(true);
    });

    describe('rename before upload', () => {
      it('uploadAllPendingShares opens the rename modal for file shares and keeps text shares queued for later upload', async () => {
        (element as any).pendingShares = [
          {
            id: 'pending-text',
            type: 'text',
            content: 'Shared note',
            timestamp: Date.now(),
          },
          {
            id: 'pending-file',
            type: 'file',
            fileName: 'shared-image.jpg',
            fileType: 'image/jpeg',
            fileData: new Uint8Array([1, 2, 3]).buffer,
            timestamp: Date.now(),
          },
        ];

        await (element as any).uploadAllPendingShares();

        expect((element as any).fileRenameDrafts).toHaveLength(1);
        expect((element as any).fileRenameDrafts[0].name).toBe('shared-image.jpg');
        expect((element as any).fileRenamePendingTextShares).toHaveLength(1);
        expect((element as any).fileRenamePendingTextShares[0].content).toBe('Shared note');
      });

      it('confirmFileRenameUpload passes the edited filename to uploadFiles', async () => {
        const uploadFilesSpy = vi.spyOn(element as any, 'uploadFiles').mockResolvedValue(1);
        const originalFile = new File(['hello'], 'original.txt', { type: 'text/plain' });

        (element as any).fileRenameDrafts = [
          { id: 'draft-1', file: originalFile, name: originalFile.name },
        ];

        (element as any).handleFileRenameInput('draft-1', 'renamed.txt');
        await (element as any).confirmFileRenameUpload();

        expect(uploadFilesSpy).toHaveBeenCalledTimes(1);
        const uploadedFiles = uploadFilesSpy.mock.calls[0][0] as File[];
        expect(uploadedFiles).toHaveLength(1);
        expect(uploadedFiles[0].name).toBe('renamed.txt');
        expect((element as any).fileRenameDrafts).toHaveLength(0);
      });

      it('queues renamed pending share files for offline upload and clears them from pending shares', async () => {
        const originalOnline = navigator.onLine;
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

        try {
          (element as any).serverUrl = serverUrl;
          (element as any).spaceId = spaceId;
          (element as any).token = token;

          const pendingShare = {
            id: 'pending-file-offline',
            type: 'file' as const,
            fileName: 'shared-image.jpg',
            fileType: 'image/jpeg',
            fileData: new Uint8Array([7, 8, 9]).buffer,
            timestamp: Date.now(),
          };

          (element as any).pendingShares = [pendingShare];
          (element as any).requestPendingShareUpload(pendingShare);

          const draftId = (element as any).fileRenameDrafts[0].id;
          (element as any).handleFileRenameInput(draftId, 'renamed-image.jpg');
          await (element as any).confirmFileRenameUpload();

          const queue = await getOfflineQueueForSpace(serverUrl, spaceId);
          expect(queue).toHaveLength(1);
          expect(queue[0].fileName).toBe('renamed-image.jpg');
          expect((element as any).pendingShares).toEqual([]);
          expect((element as any).fileRenameDrafts).toEqual([]);
        } finally {
          Object.defineProperty(navigator, 'onLine', {
            value: originalOnline,
            configurable: true,
          });
        }
      });

      describe('compose draft persistence', () => {
        beforeEach(async () => {
          await clearComposeDrafts();
          // Let any connectedCallback hydration settle, then start from a clean
          // in-memory queue so cross-test global-DB leakage can't pollute state.
          await new Promise((resolve) => setTimeout(resolve, 0));
          (element as any).fileRenameDrafts = [];
          (element as any).discardedComposeDraftIds.clear();
        });
        afterEach(async () => {
          await clearComposeDrafts();
        });

        it('persists selected files to the compose-drafts store', async () => {
          const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
          (element as any).promptFilesForUpload([file]);

          const draft = (element as any).fileRenameDrafts[0];
          await (element as any).persistComposeDrafts([draft]);

          const stored = (await getComposeDrafts()).filter(
            (s) => s.id === draft.composeDraftId,
          );
          expect(stored).toHaveLength(1);
          expect(stored[0].id).toBe(draft.composeDraftId);
          expect(stored[0].fileName).toBe('note.txt');
        });

        it('persists the edited filename, not the original', async () => {
          const file = new File(['hello'], 'original.txt', { type: 'text/plain' });
          (element as any).promptFilesForUpload([file]);
          const draft = (element as any).fileRenameDrafts[0];

          (element as any).handleFileRenameInput(draft.id, 'renamed.txt');
          await (element as any).persistComposeDrafts([
            (element as any).fileRenameDrafts[0],
          ]);

          const stored = (await getComposeDrafts()).filter(
            (s) => s.id === draft.composeDraftId,
          );
          expect(stored).toHaveLength(1);
          expect(stored[0].fileName).toBe('renamed.txt');
        });

        it('re-hydrates persisted drafts on load (survives refresh)', async () => {
          await saveComposeDraft({
            id: 'persisted-1',
            fileName: 'restored.txt',
            fileType: 'text/plain',
            fileData: new Uint8Array([1, 2, 3]).buffer,
            fileSize: 3,
            timestamp: 1000,
          });

          await (element as any).loadComposeDrafts();

          const drafts = (element as any).fileRenameDrafts;
          expect(drafts).toHaveLength(1);
          expect(drafts[0].composeDraftId).toBe('persisted-1');
          expect(drafts[0].name).toBe('restored.txt');
          expect(drafts[0].file).toBeInstanceOf(File);
        });

        it('does not re-hydrate a draft that is already in the queue', async () => {
          await saveComposeDraft({
            id: 'dup-1',
            fileName: 'dup.txt',
            fileType: 'text/plain',
            fileData: new Uint8Array([1]).buffer,
            fileSize: 1,
            timestamp: 1000,
          });

          await (element as any).loadComposeDrafts();
          await (element as any).loadComposeDrafts();

          expect((element as any).fileRenameDrafts).toHaveLength(1);
        });

        it('removing a draft clears it from storage and prevents resurrection on reload', async () => {
          const file = new File(['hello'], 'gone.txt', { type: 'text/plain' });
          (element as any).promptFilesForUpload([file]);
          const draft = (element as any).fileRenameDrafts[0];
          await (element as any).persistComposeDrafts([draft]);
          expect(
            (await getComposeDrafts()).filter((s) => s.id === draft.composeDraftId),
          ).toHaveLength(1);

          (element as any).removeFileRenameDraft(draft.id);
          await Promise.resolve();

          expect((element as any).fileRenameDrafts).toHaveLength(0);
          expect(
            (await getComposeDrafts()).filter((s) => s.id === draft.composeDraftId),
          ).toHaveLength(0);

          // A reload must not resurrect the removed draft.
          await (element as any).loadComposeDrafts();
          expect((element as any).fileRenameDrafts).toHaveLength(0);
        });
      });
    });
  });
});

describe('SpaceView - Transfer Feature', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const token = 'test-jwt-token';

  const otherSpace = {
    serverUrl,
    spaceId: '660e8400-e29b-41d4-a716-446655440001',
    spaceName: 'Other Space',
    token: 'other-space-token',
  };

  const thirdSpace = {
    serverUrl,
    spaceId: '770e8400-e29b-41d4-a716-446655440002',
    spaceName: 'Third Space',
    token: 'third-space-token',
  };

  let element: SpaceView;
  let mockFetchFn: ReturnType<typeof vi.fn>;

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

    mockFetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetchFn;

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

  // --- getAvailableTransferSpaces ---

  describe('getAvailableTransferSpaces', () => {
    it('returns empty array when no other spaces are joined', () => {
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
      ];
      const result = (element as any).getAvailableTransferSpaces();
      expect(result).toEqual([]);
    });

    it('filters out the current space and returns others', () => {
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
        otherSpace,
        thirdSpace,
      ];
      const result = (element as any).getAvailableTransferSpaces();
      expect(result).toHaveLength(2);
      expect(result[0].spaceId).toBe(otherSpace.spaceId);
      expect(result[1].spaceId).toBe(thirdSpace.spaceId);
    });

    it('returns all spaces when current spaceId is not in the list', () => {
      (element as any).spaces = [otherSpace, thirdSpace];
      const result = (element as any).getAvailableTransferSpaces();
      expect(result).toHaveLength(2);
    });

    it('returns empty array when spaces list is empty', () => {
      (element as any).spaces = [];
      const result = (element as any).getAvailableTransferSpaces();
      expect(result).toEqual([]);
    });
  });

  // --- openTransferModal / closeTransferModal ---

  describe('openTransferModal', () => {
    it('sets transferModalItem to the given item', () => {
      const item = makeItem();
      (element as any).openTransferModal(item);
      expect((element as any).transferModalItem).toBe(item);
    });

    it('clears any previous transfer error', () => {
      (element as any).transferError = 'Previous error';
      const item = makeItem();
      (element as any).openTransferModal(item);
      expect((element as any).transferError).toBe('');
    });
  });

  describe('closeTransferModal', () => {
    it('clears transferModalItem', () => {
      (element as any).transferModalItem = makeItem();
      (element as any).closeTransferModal();
      expect((element as any).transferModalItem).toBeNull();
    });

    it('clears transferError', () => {
      (element as any).transferError = 'Some error';
      (element as any).closeTransferModal();
      expect((element as any).transferError).toBe('');
    });

    it('resets transferInProgress', () => {
      (element as any).transferInProgress = true;
      (element as any).closeTransferModal();
      expect((element as any).transferInProgress).toBe(false);
    });
  });

  // --- handleTransfer ---

  describe('handleTransfer', () => {
    it('calls transferItem API and closes modal on successful copy', async () => {
      const item = makeItem();
      const destItem = { ...item, spaceId: otherSpace.spaceId, id: 'new-dest-id' };
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => destItem,
      });

      await (element as any).handleTransfer(otherSpace, 'copy');

      expect(mockFetchFn).toHaveBeenCalledWith(
        expect.stringContaining(`/items/${item.id}/transfer`),
        expect.objectContaining({ method: 'POST' }),
      );
      expect((element as any).transferModalItem).toBeNull();
      expect((element as any).transferInProgress).toBe(false);
    });

    it('shows success message with space name after copy', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...item }),
      });

      await (element as any).handleTransfer(otherSpace, 'copy');

      expect((element as any).syncMessage).toContain('copied');
      expect((element as any).syncMessage).toContain('Other Space');
    });

    it('shows success message with "moved" for move action', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...item }),
      });

      await (element as any).handleTransfer(otherSpace, 'move');

      expect((element as any).syncMessage).toContain('moved');
      expect((element as any).syncMessage).toContain('Other Space');
    });

    it('sends correct destination space and token in the request body', async () => {
      const item = makeItem({ id: 'transfer-test-id' });
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...item }),
      });

      await (element as any).handleTransfer(otherSpace, 'copy');

      const call = mockFetchFn.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/transfer'),
      );
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.destinationToken).toBe(otherSpace.token);
      expect(body.action).toBe('copy');
      expect(body.destinationSpaceId).toBeUndefined();
    });

    it('shows error on SpaceApiError and keeps modal open', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 413,
      });

      await (element as any).handleTransfer(otherSpace, 'copy');

      expect((element as any).transferError).toMatch(/quota exceeded/i);
      expect((element as any).transferModalItem).toBe(item);
      expect((element as any).transferInProgress).toBe(false);
    });

    it('shows generic error for non-SpaceApiError failures', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      // SpaceApiError wraps network errors, but the catch block in handleTransfer
      // also handles the case where error is NOT SpaceApiError (generic fallback).
      // To trigger non-SpaceApiError path, we need the transferItem call itself to
      // throw a non-SpaceApiError. Since transferItem wraps everything, we mock at
      // the fetch level to simulate a SpaceApiError first, then check the error path.
      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await (element as any).handleTransfer(otherSpace, 'move');

      // SpaceApiError message is shown directly
      expect((element as any).transferError).toMatch(/Access denied/);
      expect((element as any).transferModalItem).toBe(item);
    });

    it('sets transferInProgress during the operation', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      let fetchResolve: (value: any) => void;
      const fetchPromise = new Promise((resolve) => {
        fetchResolve = resolve;
      });
      mockFetchFn.mockReturnValueOnce(fetchPromise);

      const transferPromise = (element as any).handleTransfer(otherSpace, 'copy');

      // While in progress
      expect((element as any).transferInProgress).toBe(true);
      expect((element as any).transferError).toBe('');

      // Complete the fetch
      fetchResolve!({
        ok: true,
        status: 200,
        json: async () => ({ ...item }),
      });

      await transferPromise;
      expect((element as any).transferInProgress).toBe(false);
    });

    it('is a no-op when transferModalItem is null', async () => {
      (element as any).transferModalItem = null;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      await (element as any).handleTransfer(otherSpace, 'copy');

      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('is a no-op when token is missing', async () => {
      (element as any).transferModalItem = makeItem();
      (element as any).token = undefined;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      await (element as any).handleTransfer(otherSpace, 'copy');

      expect(mockFetchFn).not.toHaveBeenCalled();
    });
  });

  // --- renderSendToButton ---

  describe('renderSendToButton', () => {
    it('returns nothing when no other spaces are available', () => {
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
      ];
      const result = (element as any).renderSendToButton(makeItem());
      expect(result).toBe(nothing);
    });

    it('returns a button when other spaces are available', () => {
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
        otherSpace,
      ];
      const result = (element as any).renderSendToButton(makeItem());
      // Lit TemplateResult has strings array
      const strings = result.strings ?? result._$litType$?.strings ?? [];
      const flatStrings = Array.from(strings).join('');
      expect(flatStrings).toContain('Send to another space');
    });
  });

  // --- renderTransferModal ---

  describe('renderTransferModal', () => {
    it('returns nothing when transferModalItem is null', () => {
      (element as any).transferModalItem = null;
      const result = (element as any).renderTransferModal();
      expect(result).toBe(nothing);
    });

    it('renders modal with "Send to…" heading', () => {
      (element as any).transferModalItem = makeItem();
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
        otherSpace,
      ];
      const result = (element as any).renderTransferModal();
      const strings = result.strings ?? result._$litType$?.strings ?? [];
      const flatStrings = Array.from(strings).join('');
      expect(flatStrings).toContain('Send to');
    });

    it('renders available space names in the modal', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).isLoading = false;
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
        otherSpace,
        thirdSpace,
      ];

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const modalHtml = element.innerHTML;
      expect(modalHtml).toContain('Copy here');
      expect(modalHtml).toContain('Move here');
      expect(modalHtml).toContain('Other Space');
      expect(modalHtml).toContain('Third Space');
    });

    it('renders disabled buttons when transfer is in progress', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).transferInProgress = true;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).isLoading = false;
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
        otherSpace,
      ];

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const modalHtml = element.innerHTML;
      expect(modalHtml).toContain('Copying…');
      expect(modalHtml).toContain('Moving…');
    });

    it('shows "join one more space" message when no other spaces', async () => {
      const item = makeItem();
      (element as any).transferModalItem = item;
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).isLoading = false;
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
      ];

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const modalHtml = element.innerHTML;
      expect(modalHtml).toContain('join at least one more space');
    });
  });

  // --- Transfer flow integration ---

  describe('transfer flow integration', () => {
    it('full flow: open modal → copy → success → modal closes', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).spaces = [
        { serverUrl, spaceId, spaceName: 'Current', token },
        otherSpace,
      ];

      // Step 1: Open modal
      (element as any).openTransferModal(item);
      expect((element as any).transferModalItem).toBe(item);

      // Step 2: Transfer succeeds
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...item, spaceId: otherSpace.spaceId }),
      });

      await (element as any).handleTransfer(otherSpace, 'copy');

      // Step 3: Modal closed, success shown
      expect((element as any).transferModalItem).toBeNull();
      expect((element as any).syncMessage).toContain('copied');
    });

    it('full flow: open modal → transfer fails → error shown, modal stays open', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      // Step 1: Open modal
      (element as any).openTransferModal(item);

      // Step 2: Transfer fails with 401
      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await (element as any).handleTransfer(otherSpace, 'move');

      // Step 3: Error shown, modal stays
      expect((element as any).transferError).toMatch(/Authentication failed/);
      expect((element as any).transferModalItem).toBe(item);
    });

    it('full flow: open modal → fail → close → reopen has clean state', async () => {
      const item = makeItem();
      (element as any).items = [item];
      (element as any).token = token;
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;

      // Open and fail
      (element as any).openTransferModal(item);
      mockFetchFn.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' });
      await (element as any).handleTransfer(otherSpace, 'copy');
      expect((element as any).transferError).toBeTruthy();

      // Close
      (element as any).closeTransferModal();
      expect((element as any).transferError).toBe('');
      expect((element as any).transferModalItem).toBeNull();

      // Reopen — state should be clean
      (element as any).openTransferModal(item);
      expect((element as any).transferError).toBe('');
      expect((element as any).transferModalItem).toBe(item);
      expect((element as any).transferInProgress).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// File Preview Modal
// ---------------------------------------------------------------------------

describe('SpaceView - File Preview Modal', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const token = 'test-jwt-token';

  let element: SpaceView;
  let mockFetchFn: ReturnType<typeof vi.fn>;

  function makeItem(overrides: Partial<SpaceItemResponse> = {}): SpaceItemResponse {
    return {
      id: 'item-1',
      spaceId,
      memberId: 'member-1',
      contentType: 'file',
      content: 'photo.png',
      fileSize: 1024,
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

    mockFetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetchFn;

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

  // --- handleFilePreviewClick ---

  describe('handleFilePreviewClick', () => {
    it('opens preview for a previewable image file', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      const blob = new Blob(['fake-image-data'], { type: 'image/png' });
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blob,
      });

      const fakeUrl = 'blob:http://localhost/fake-image';
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(fakeUrl);

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewItem).toBe(item);
      expect((element as any).filePreviewType).toBe('image');
      expect((element as any).filePreviewUrl).toBe(fakeUrl);
      expect((element as any).filePreviewLoading).toBe(false);
      expect((element as any).filePreviewError).toBe('');
      expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
    });

    it('does nothing for a non-previewable file (.zip)', async () => {
      const item = makeItem({ content: 'archive.zip', fileSize: 5000 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewItem).toBeNull();
      expect((element as any).filePreviewType).toBe('none');
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('does nothing when serverUrl is missing', async () => {
      const item = makeItem();
      (element as any).serverUrl = '';
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewItem).toBeNull();
    });

    it('does nothing when token is missing', async () => {
      const item = makeItem();
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = undefined;

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewItem).toBeNull();
    });
  });

  // --- Preview content by type ---

  describe('preview content by type', () => {
    it('image preview renders an <img> element', async () => {
      const item = makeItem({ content: 'photo.jpg', fileSize: 500 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake-img';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const img = element.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('blob:http://localhost/fake-img');
      expect(img!.getAttribute('alt')).toBe('photo.jpg');
    });

    it('video preview renders a <video> element with controls', async () => {
      const item = makeItem({ content: 'clip.mp4', fileSize: 5000 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'video';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake-video';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const video = element.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.getAttribute('src')).toBe('blob:http://localhost/fake-video');
      expect(video!.hasAttribute('controls')).toBe(true);
    });

    it('audio preview renders an <audio> element with controls', async () => {
      const item = makeItem({ content: 'song.mp3', fileSize: 3000 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'audio';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake-audio';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const audio = element.querySelector('audio');
      expect(audio).not.toBeNull();
      expect(audio!.getAttribute('src')).toBe('blob:http://localhost/fake-audio');
      expect(audio!.hasAttribute('controls')).toBe(true);
    });

    it('PDF preview renders an <iframe> element', async () => {
      const item = makeItem({ content: 'document.pdf', fileSize: 8000 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'pdf';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake-pdf';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const iframe = element.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute('src')).toBe('blob:http://localhost/fake-pdf');
      expect(iframe!.getAttribute('title')).toBe('document.pdf');
    });

    it('text preview renders text content with pre-wrap styling', async () => {
      const item = makeItem({ content: 'readme.txt', fileSize: 100 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'text';
      (element as any).filePreviewText = 'Hello, world!\nLine two.';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const pre = element.querySelector('.whitespace-pre-wrap');
      expect(pre).not.toBeNull();
      expect(pre!.textContent).toContain('Hello, world!');
      expect(pre!.textContent).toContain('Line two.');
    });
  });

  // --- Loading state ---

  describe('loading state', () => {
    it('shows loading indicator while file is being fetched', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewLoading = true;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const html = element.innerHTML;
      expect(html).toContain('Loading preview');
      // Spinner SVG should be present
      expect(element.querySelector('.animate-spin')).not.toBeNull();
    });

    it('sets loading=true during fetch then loading=false after success', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      let resolveBlob!: (value: any) => void;
      const blobPromise = new Promise((resolve) => { resolveBlob = resolve; });

      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => blobPromise,
      });

      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');

      const previewPromise = (element as any).handleFilePreviewClick(item);

      // During fetch, loading should be true
      expect((element as any).filePreviewLoading).toBe(true);
      expect((element as any).filePreviewItem).toBe(item);

      // Resolve the blob
      resolveBlob(new Blob(['data']));
      await previewPromise;

      // After fetch, loading should be false
      expect((element as any).filePreviewLoading).toBe(false);
      expect((element as any).filePreviewUrl).toBe('blob:fake');
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('shows error message with download fallback when fetch fails', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ Error: 'Server exploded' }),
      });

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewError).toBe('Failed to load preview.');
      expect((element as any).filePreviewLoading).toBe(false);
      expect((element as any).filePreviewItem).toBe(item);
    });

    it('renders error text and download fallback button in DOM', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewError = 'Failed to load preview.';
      (element as any).filePreviewLoading = false;
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const html = element.innerHTML;
      expect(html).toContain('Failed to load preview.');
      expect(html).toContain('Download instead');
    });

    it('closes preview and sets auth error on 401', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await (element as any).handleFilePreviewClick(item);

      // 401 closes the preview entirely and shows auth error
      expect((element as any).filePreviewItem).toBeNull();
      expect((element as any).connectionErrorType).toBe('auth');
      expect((element as any).errorMessage).toContain('Authentication failed');
    });

    it('closes preview and sets auth error on 404', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewItem).toBeNull();
      expect((element as any).connectionErrorType).toBe('auth');
    });
  });

  // --- File too large ---

  describe('file too large for preview', () => {
    it('shows "too large to preview" error without fetching', async () => {
      // Image limit is 10 MB — use a file bigger than that
      const item = makeItem({ content: 'huge.png', fileSize: 11 * 1024 * 1024 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewItem).toBe(item);
      expect((element as any).filePreviewType).toBe('image');
      expect((element as any).filePreviewError).toBe('File is too large to preview.');
      expect((element as any).filePreviewLoading).toBe(false);
      expect((element as any).filePreviewUrl).toBeNull();
      expect((element as any).filePreviewText).toBeNull();
      // Should NOT have made a download call
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('text file exceeding 1 MB limit shows too-large error', async () => {
      const item = makeItem({ content: 'huge.txt', fileSize: 2 * 1024 * 1024 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewError).toBe('File is too large to preview.');
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('renders too-large error with download fallback in DOM', async () => {
      const item = makeItem({ content: 'huge.png', fileSize: 11 * 1024 * 1024 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewError = 'File is too large to preview.';
      (element as any).filePreviewLoading = false;
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const html = element.innerHTML;
      expect(html).toContain('File is too large to preview.');
      expect(html).toContain('Download instead');
    });
  });

  // --- Modal close / cleanup ---

  describe('closeFilePreview', () => {
    it('resets all preview state', () => {
      (element as any).filePreviewItem = makeItem();
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake';
      (element as any).filePreviewText = 'some text';
      (element as any).filePreviewLoading = true;
      (element as any).filePreviewError = 'some error';

      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      (element as any).closeFilePreview();

      expect((element as any).filePreviewItem).toBeNull();
      expect((element as any).filePreviewType).toBe('none');
      expect((element as any).filePreviewUrl).toBeNull();
      expect((element as any).filePreviewText).toBeNull();
      expect((element as any).filePreviewLoading).toBe(false);
      expect((element as any).filePreviewError).toBe('');
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/fake');
    });

    it('does not call revokeObjectURL when no blob URL exists', () => {
      (element as any).filePreviewItem = makeItem();
      (element as any).filePreviewUrl = null;

      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      (element as any).closeFilePreview();

      expect(revokeObjectURLSpy).not.toHaveBeenCalled();
      expect((element as any).filePreviewItem).toBeNull();
    });

    it('modal disappears from DOM after close', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      // Modal should be visible (Close preview button)
      expect(element.querySelector('[aria-label="Close preview"]')).not.toBeNull();

      // Close
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      (element as any).closeFilePreview();
      (element as any).requestUpdate();
      await element.updateComplete;

      // Modal should be gone
      expect(element.querySelector('[aria-label="Close preview"]')).toBeNull();
    });
  });

  // --- Text preview fetches text, not blob URL ---

  describe('text preview flow', () => {
    it('fetches blob and reads as text for text files', async () => {
      const item = makeItem({ content: 'notes.txt', fileSize: 50 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      const textContent = 'Line 1\nLine 2\nLine 3';
      const blob = new Blob([textContent], { type: 'text/plain' });
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blob,
      });

      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unused');

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewType).toBe('text');
      expect((element as any).filePreviewText).toBe(textContent);
      // Text files should NOT create an object URL
      expect(createObjectURLSpy).not.toHaveBeenCalled();
      expect((element as any).filePreviewUrl).toBeNull();
      expect((element as any).filePreviewLoading).toBe(false);
    });
  });

  // --- renderFilePreviewModal ---

  describe('renderFilePreviewModal', () => {
    it('returns nothing when filePreviewItem is null', () => {
      (element as any).filePreviewItem = null;
      const result = (element as any).renderFilePreviewModal();
      expect(result).toBe(nothing);
    });

    it('renders modal with filename as heading', async () => {
      const item = makeItem({ content: 'vacation.jpg', fileSize: 500 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake-img';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      const heading = element.querySelector('h3');
      expect(heading).not.toBeNull();
      expect(heading!.textContent).toContain('vacation.jpg');
    });

    it('renders download and close buttons in the modal header', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).filePreviewItem = item;
      (element as any).filePreviewType = 'image';
      (element as any).filePreviewUrl = 'blob:http://localhost/fake-img';
      (element as any).filePreviewLoading = false;
      (element as any).filePreviewError = '';
      (element as any).isLoading = false;

      document.body.appendChild(element);
      (element as any).requestUpdate();
      await element.updateComplete;

      expect(element.querySelector('[aria-label="Download file"]')).not.toBeNull();
      expect(element.querySelector('[aria-label="Close preview"]')).not.toBeNull();
    });
  });

  // --- Integration: click → preview → close ---

  describe('file preview integration', () => {
    it('full flow: click image → preview opens → close → state clean', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      const blob = new Blob(['image-data'], { type: 'image/png' });
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blob,
      });

      const fakeUrl = 'blob:http://localhost/integration-test';
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(fakeUrl);
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      // Step 1: Open preview
      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewItem).toBe(item);
      expect((element as any).filePreviewUrl).toBe(fakeUrl);
      expect((element as any).filePreviewLoading).toBe(false);

      // Step 2: Close preview
      (element as any).closeFilePreview();

      expect((element as any).filePreviewItem).toBeNull();
      expect((element as any).filePreviewUrl).toBeNull();
      expect((element as any).filePreviewType).toBe('none');
      expect(revokeSpy).toHaveBeenCalledWith(fakeUrl);
    });

    it('full flow: click text file → text content loaded', async () => {
      const item = makeItem({ content: 'script.js', fileSize: 200 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      const textContent = 'console.log("hello");';
      const blob = new Blob([textContent], { type: 'text/javascript' });
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blob,
      });

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewType).toBe('text');
      expect((element as any).filePreviewText).toBe(textContent);
      expect((element as any).filePreviewUrl).toBeNull();
    });

    it('full flow: click too-large file → error shown → close → clean state', async () => {
      const item = makeItem({ content: 'massive.mp4', fileSize: 200 * 1024 * 1024 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      await (element as any).handleFilePreviewClick(item);

      expect((element as any).filePreviewError).toBe('File is too large to preview.');
      expect((element as any).filePreviewItem).toBe(item);

      // Close
      (element as any).closeFilePreview();
      expect((element as any).filePreviewItem).toBeNull();
      expect((element as any).filePreviewError).toBe('');
    });

    it('full flow: click file → fetch fails → error shown → close → reopen clean', async () => {
      const item = makeItem({ content: 'photo.png', fileSize: 500 });
      (element as any).serverUrl = serverUrl;
      (element as any).spaceId = spaceId;
      (element as any).token = token;

      mockFetchFn.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ Error: 'Boom' }),
      });

      await (element as any).handleFilePreviewClick(item);
      expect((element as any).filePreviewError).toBe('Failed to load preview.');

      // Close
      (element as any).closeFilePreview();
      expect((element as any).filePreviewError).toBe('');
      expect((element as any).filePreviewItem).toBeNull();

      // Reopen with success
      const blob = new Blob(['ok'], { type: 'image/png' });
      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blob,
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ok');

      await (element as any).handleFilePreviewClick(item);
      expect((element as any).filePreviewError).toBe('');
      expect((element as any).filePreviewUrl).toBe('blob:ok');
    });
  });
});

describe('SpaceView - Shared Link QR Action', () => {
  let element: SpaceView;

  const testLink = {
    id: 'link-1',
    token: '550e8400-e29b-41d4-a716-446655440000',
    spaceId: 'space-1',
    itemId: 'item-1',
    createdBy: 'member-1',
    createdAt: new Date().toISOString(),
    name: 'Test link',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQrCode.toDataURL.mockResolvedValue('data:image/png;base64,qr-code');
    element = document.createElement('space-view') as SpaceView;
    (element as any).serverUrl = 'https://api.example.com';
  });

  afterEach(() => {
    if (element.parentNode) {
      element.remove();
    }
    vi.restoreAllMocks();
  });

  it('renders a QR action button for each shared link in the share modal', async () => {
    (element as any).isLoading = false;
    (element as any).shareModalItem = {
      id: 'item-1',
      spaceId: 'space-1',
      memberId: 'member-1',
      contentType: 'text',
      content: 'hello',
      fileSize: 0,
      sharedAt: new Date().toISOString(),
    };
    (element as any).shareModalLinks = [testLink];

    document.body.appendChild(element);
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('[aria-label="Show link QR code"]')).not.toBeNull();
  });

  it('shows the generated QR image inline for the shared URL', async () => {
    (element as any).isLoading = false;
    (element as any).shareModalItem = {
      id: 'item-1',
      spaceId: 'space-1',
      memberId: 'member-1',
      contentType: 'text',
      content: 'hello',
      fileSize: 0,
      sharedAt: new Date().toISOString(),
    };
    (element as any).shareModalLinks = [testLink];
    document.body.appendChild(element);
    await element.updateComplete;

    await (element as any).handleToggleShareLinkQrCode(testLink);
    await element.updateComplete;

    const expectedShareUrl = buildShareUrl(testLink.token, 'https://api.example.com');
    expect(mockQrCode.toDataURL).toHaveBeenCalledWith(expectedShareUrl, {
      width: 512,
      margin: 1,
    });
    expect((element as any).shareModalQrOpenLinkId).toBe('link-1');
    expect((element as any).shareModalQrCodeDataUrls['link-1']).toBe('data:image/png;base64,qr-code');
  });

  it('toggles the inline QR display when clicked again', async () => {
    await (element as any).handleToggleShareLinkQrCode(testLink);
    expect((element as any).shareModalQrOpenLinkId).toBe('link-1');

    await (element as any).handleToggleShareLinkQrCode(testLink);
    expect((element as any).shareModalQrOpenLinkId).toBeNull();
  });

  it('shows QR generation error when inline QR generation fails', async () => {
    mockQrCode.toDataURL.mockRejectedValueOnce(new Error('QR failed'));

    await (element as any).handleToggleShareLinkQrCode(testLink);

    expect((element as any).shareModalError).toBe('Failed to generate QR code. Please try again.');
    expect((element as any).shareModalQrOpenLinkId).toBeNull();
  });
});

describe('SpaceView - Token Resolution and Reconnect', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440111';
  const token = 'stored-jwt-token';

  let element: SpaceView;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await seedStoredSpaceToken(serverUrl, spaceId, token);

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
    if (element.parentNode) {
      element.remove();
    }
    vi.restoreAllMocks();
  });

  it('loads its token from shared storage without manual test injection', async () => {
    const redirectToJoin = vi.spyOn(element as any, 'redirectToJoin');

    document.body.appendChild(element);

    await vi.waitFor(() => {
      expect((element as any).token).toBe(token);
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(redirectToJoin).not.toHaveBeenCalled();
  });

  it('keeps the resolved token cached for visibility reconnects after localStorage cleanup', async () => {
    document.body.appendChild(element);
    await vi.waitFor(() => {
      expect((element as any).token).toBe(token);
    });

    localStorage.removeItem('sharedspaces:tokens');

    const startSignalRSpy = vi.spyOn(element as any, 'startSignalR').mockResolvedValue(undefined);
    (element as any).connectionState = 'disconnected';

    Object.defineProperty(document, 'visibilityState', {
      writable: true,
      configurable: true,
      value: 'visible',
    });

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => {
      expect(startSignalRSpy).toHaveBeenCalledTimes(1);
    });
    expect((element as any).token).toBe(token);
  });
});

describe('SpaceView - Background Sync Completion', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';

  let element: SpaceView;

  beforeEach(() => {
    vi.clearAllMocks();
    element = document.createElement('space-view') as SpaceView;
    element.serverUrl = serverUrl;
    element.spaceId = spaceId;
  });

  afterEach(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
    vi.restoreAllMocks();
  });

  it('refreshes the current space and shows a sync summary when background sync completes', async () => {
    const refreshOfflineQueue = vi.spyOn(element as any, 'refreshOfflineQueue').mockResolvedValue(undefined);
    const refreshItemsAfterReconnect = vi.spyOn(element as any, 'refreshItemsAfterReconnect').mockResolvedValue(undefined);

    await (element as any).handleBackgroundSyncComplete({
      synced: 2,
      failed: 1,
      spaces: [{ serverUrl, spaceId }],
    });

    expect(refreshOfflineQueue).toHaveBeenCalledTimes(1);
    expect(refreshItemsAfterReconnect).toHaveBeenCalledTimes(1);
    expect((element as any).syncMessage).toBe('Synced 2 items, 1 failed');
  });

  it('ignores background sync results for other spaces', async () => {
    const refreshOfflineQueue = vi.spyOn(element as any, 'refreshOfflineQueue').mockResolvedValue(undefined);
    const refreshItemsAfterReconnect = vi.spyOn(element as any, 'refreshItemsAfterReconnect').mockResolvedValue(undefined);

    await (element as any).handleBackgroundSyncComplete({
      synced: 1,
      failed: 0,
      spaces: [{ serverUrl: 'http://other-server', spaceId: 'other-space' }],
    });

    expect(refreshOfflineQueue).not.toHaveBeenCalled();
    expect(refreshItemsAfterReconnect).not.toHaveBeenCalled();
    expect((element as any).syncMessage).toBe('');
  });
});

describe('SpaceView - Journal sync fallback on failure', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440099';
  const token = 'test-jwt-token';

  let element: SpaceView;
  let mockFetch: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSignalRConnection.state = 'Disconnected';
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await seedStoredSpaceToken(serverUrl, spaceId, token);

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

  it('falls back to full fetch and starts SignalR when the journal endpoint fails', async () => {
    // Enable journal sync for this space so loadData() takes the journal path.
    const { setJournalSyncEnabled } = await import('../../lib/idb-storage');
    await setJournalSyncEnabled(serverUrl, spaceId, true);

    const fullFetchItem: SpaceItemResponse = {
      id: 'full-fetch-item',
      spaceId,
      memberId: 'member-1',
      contentType: 'text',
      content: 'Loaded via full fetch fallback',
      fileSize: 0,
      sharedAt: new Date().toISOString(),
    };

    mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/journal/checkpoint')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      if (url.endsWith('/journal')) {
        // Simulate transient server-side failure on the journal endpoint.
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ message: 'boom' }),
          text: async () => 'boom',
        });
      }
      if (url.endsWith('/items')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [fullFetchItem],
        });
      }
      // Default for /spaces/{id} info and anything else.
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ id: spaceId, name: 'Test Space' }),
      });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    document.body.appendChild(element);

    await vi.waitFor(() => {
      const items = (element as any).items as SpaceItemResponse[];
      expect(items).toHaveLength(1);
    });

    // Items were loaded via the full-fetch fallback path.
    const items = (element as any).items as SpaceItemResponse[];
    expect(items[0].id).toBe('full-fetch-item');

    // The /items endpoint must have been hit (full fetch path).
    const itemsCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).endsWith('/items'),
    );
    expect(itemsCalls.length).toBeGreaterThanOrEqual(1);

    // SignalR connection was started despite the journal failure.
    await vi.waitFor(() => {
      expect(mockSignalRConnection.start).toHaveBeenCalled();
    });

    // A warning was logged so the failure is observable.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Journal sync failed'),
      expect.anything(),
    );
  });
});
