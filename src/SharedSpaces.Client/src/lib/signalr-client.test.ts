import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignalRClient } from './signalr-client';

// Mock @microsoft/signalr
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

interface ItemAddedPayload {
  id: string;
  spaceId: string;
  memberId: string;
  displayName: string;
  contentType: 'text' | 'file';
  content: string;
  fileSize: number;
  sharedAt: string;
}

interface ItemDeletedPayload {
  id: string;
  spaceId: string;
}

describe('SignalRClient', () => {
  const serverUrl = 'http://localhost:5000';
  const spaceId = '550e8400-e29b-41d4-a716-446655440000';
  const accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
  const accessTokenFactory = async () => accessToken;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.state = 'Disconnected';
  });

  describe('Connection Lifecycle', () => {
    it('creates connection with correct hub URL format', () => {
      new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      expect(mockBuilder.withUrl).toHaveBeenCalledWith(
        `${serverUrl}/v1/spaces/${spaceId}/hub`,
        expect.objectContaining({
          accessTokenFactory: expect.any(Function),
        })
      );
    });

    it('passes accessTokenFactory that returns JWT', async () => {
      new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      const callArgs = mockBuilder.withUrl.mock.calls[0];
      const options = callArgs[1];
      const token = await options.accessTokenFactory();

      expect(token).toBe(accessToken);
    });

    it('configures automatic reconnect', () => {
      new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      expect(mockBuilder.withAutomaticReconnect).toHaveBeenCalled();
    });

    it('calls start() successfully', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      await client.start();

      expect(mockConnection.start).toHaveBeenCalledTimes(1);
    });

    it('calls stop() and cleans up', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      mockConnection.state = 'Connected';
      await client.start();
      await client.stop();

      expect(mockConnection.stop).toHaveBeenCalledTimes(1);
    });

    it('reports connected state after start', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      mockConnection.start.mockImplementation(async () => {
        mockConnection.state = 'Connected';
      });

      await client.start();

      expect(client.state).toBe('connected');
    });

    it('reports disconnected state after stop', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      mockConnection.start.mockImplementation(async () => {
        mockConnection.state = 'Connected';
      });
      mockConnection.stop.mockImplementation(async () => {
        mockConnection.state = 'Disconnected';
      });

      await client.start();
      await client.stop();

      expect(client.state).toBe('disconnected');
    });

    it('reports reconnecting state during reconnection', () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      // Simulate reconnecting callback
      const reconnectingHandler = mockConnection.onreconnecting.mock.calls[0]?.[0];
      if (reconnectingHandler) {
        mockConnection.state = 'Reconnecting';
        reconnectingHandler();
      }

      expect(client.state).toBe('reconnecting');
    });
  });

  describe('Event Handling', () => {
    it('ItemAdded event triggers onItemAdded callback with correct payload', async () => {
      const onItemAdded = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onItemAdded,
      });

      await client.start();

      // Find the ItemAdded handler registration
      const itemAddedCall = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'ItemAdded'
      );
      expect(itemAddedCall).toBeDefined();

      // Simulate server event
      const handler = itemAddedCall![1];
      const payload: ItemAddedPayload = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        spaceId,
        memberId: 'abc123',
        displayName: 'Alice',
        contentType: 'text',
        content: 'Hello world',
        fileSize: 0,
        sharedAt: new Date().toISOString(),
      };

      handler(payload);

      expect(onItemAdded).toHaveBeenCalledWith(payload);
    });

    it('ItemDeleted event triggers onItemDeleted callback with correct payload', async () => {
      const onItemDeleted = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onItemDeleted,
      });

      await client.start();

      // Find the ItemDeleted handler registration
      const itemDeletedCall = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'ItemDeleted'
      );
      expect(itemDeletedCall).toBeDefined();

      // Simulate server event
      const handler = itemDeletedCall![1];
      const payload: ItemDeletedPayload = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        spaceId,
      };

      handler(payload);

      expect(onItemDeleted).toHaveBeenCalledWith(payload);
    });

    it('handles ItemAdded with file type payload', async () => {
      const onItemAdded = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onItemAdded,
      });

      await client.start();

      const itemAddedCall = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'ItemAdded'
      );
      const handler = itemAddedCall![1];
      const payload: ItemAddedPayload = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        spaceId,
        memberId: 'abc123',
        displayName: 'Bob',
        contentType: 'file',
        content: '/files/document.pdf',
        fileSize: 2048000,
        sharedAt: new Date().toISOString(),
      };

      handler(payload);

      expect(onItemAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'file',
          fileSize: 2048000,
        })
      );
    });

    it('does not call callbacks if none provided', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      await client.start();

      // Simulate events - should not throw
      const itemAddedCall = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'ItemAdded'
      );
      if (itemAddedCall) {
        const handler = itemAddedCall[1];
        handler({
          id: '123',
          spaceId,
          memberId: 'abc',
          displayName: 'Test',
          contentType: 'text',
          content: 'Test',
          fileSize: 0,
          sharedAt: new Date().toISOString(),
        });
      }

      // No expectations - just verifying no errors thrown
    });
  });

  describe('Error and Edge Cases', () => {
    it('handles start failure when server unreachable', async () => {
      const error = new Error('Connection failed');
      mockConnection.start.mockRejectedValueOnce(error);

      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      await expect(client.start()).rejects.toThrow('Connection failed');
      expect(client.state).toBe('disconnected');
    });

    it('stop on already-stopped connection is safe', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      // Stop without starting (connection is already disconnected)
      await expect(client.stop()).resolves.not.toThrow();
      // Should not attempt to stop already-disconnected connection
      expect(mockConnection.stop).toHaveBeenCalledTimes(0);
    });

    it('stop is idempotent', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      mockConnection.start.mockImplementation(async () => {
        mockConnection.state = 'Connected';
      });
      
      await client.start();
      
      mockConnection.stop.mockImplementation(async () => {
        mockConnection.state = 'Disconnected';
      });
      
      await client.stop();
      await client.stop(); // Second stop should be no-op

      // Should only call stop once since it's already disconnected on second call
      expect(mockConnection.stop).toHaveBeenCalledTimes(1);
    });

    it('handles reconnection flow', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      await client.start();

      // Simulate reconnecting
      const reconnectingHandler = mockConnection.onreconnecting.mock.calls[0]?.[0];
      if (reconnectingHandler) {
        mockConnection.state = 'Reconnecting';
        reconnectingHandler();
      }
      expect(client.state).toBe('reconnecting');

      // Simulate reconnected
      const reconnectedHandler = mockConnection.onreconnected.mock.calls[0]?.[0];
      if (reconnectedHandler) {
        mockConnection.state = 'Connected';
        reconnectedHandler();
      }
      expect(client.state).toBe('connected');
    });

    it('handles connection close', async () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      await client.start();

      // Simulate connection close
      const closeHandler = mockConnection.onclose.mock.calls[0]?.[0];
      if (closeHandler) {
        mockConnection.state = 'Disconnected';
        closeHandler();
      }

      expect(client.state).toBe('disconnected');
    });

    it('continues to deliver events after stop (handlers registered in constructor)', async () => {
      const onItemAdded = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onItemAdded,
      });

      await client.start();
      
      mockConnection.stop.mockImplementation(async () => {
        mockConnection.state = 'Disconnected';
      });
      
      await client.stop();

      // Clear the mock to check for new calls
      onItemAdded.mockClear();

      // Trigger event after stop - handler still registered
      const itemAddedCall = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'ItemAdded'
      );
      if (itemAddedCall) {
        const handler = itemAddedCall[1];
        handler({
          id: '123',
          spaceId,
          memberId: 'abc',
          displayName: 'Test',
          contentType: 'text',
          content: 'Test',
          fileSize: 0,
          sharedAt: new Date().toISOString(),
        });
      }

      // Handlers remain registered, so callback will be called
      // This is expected behavior - stop() doesn't unregister handlers
      expect(onItemAdded).toHaveBeenCalled();
    });
  });

  describe('Configuration', () => {
    it('creates client without callbacks', () => {
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
      });

      expect(client).toBeDefined();
      expect(client.state).toBe('disconnected');
    });

    it('creates client with only onItemAdded', () => {
      const onItemAdded = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onItemAdded,
      });

      expect(client).toBeDefined();
    });

    it('creates client with only onItemDeleted', () => {
      const onItemDeleted = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onItemDeleted,
      });

      expect(client).toBeDefined();
    });

    it('creates client with both callbacks', () => {
      const onItemAdded = vi.fn();
      const onItemDeleted = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onItemAdded,
        onItemDeleted,
      });

      expect(client).toBeDefined();
    });

    it('calls onStateChange callback on connection state changes', async () => {
      const onStateChange = vi.fn();
      const client = new SignalRClient({
        serverUrl,
        spaceId,
        accessTokenFactory,
        onStateChange,
      });

      mockConnection.start.mockImplementation(async () => {
        mockConnection.state = 'Connected';
      });

      await client.start();

      expect(onStateChange).toHaveBeenCalledWith('connected');
    });
  });
});
