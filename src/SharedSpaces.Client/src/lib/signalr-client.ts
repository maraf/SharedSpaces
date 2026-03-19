import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
} from '@microsoft/signalr';

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export interface SignalRClientConfig {
  serverUrl: string;
  spaceId: string;
  accessTokenFactory: () => Promise<string>;
  onItemAdded?: (item: ItemAddedPayload) => void;
  onItemDeleted?: (item: ItemDeletedPayload) => void;
  onStateChange?: (state: ConnectionState) => void;
  onReconnected?: () => void;
}

export interface ItemAddedPayload {
  id: string;
  spaceId: string;
  memberId: string;
  displayName: string;
  contentType: 'text' | 'file';
  content: string;
  fileSize: number;
  sharedAt: string;
}

export interface ItemDeletedPayload {
  id: string;
  spaceId: string;
}

export class SignalRClient {
  private connection: HubConnection;
  private config: SignalRClientConfig;

  constructor(config: SignalRClientConfig) {
    this.config = config;

    const normalizedServerUrl = config.serverUrl.replace(/\/+$/, '');
    const encodedSpaceId = encodeURIComponent(config.spaceId);
    const hubUrl = `${normalizedServerUrl}/v1/spaces/${encodedSpaceId}/hub`;

    this.connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: config.accessTokenFactory,
      })
      .withAutomaticReconnect()
      .build();

    // Listen for ItemAdded events
    this.connection.on('ItemAdded', (payload: ItemAddedPayload) => {
      if (this.config.onItemAdded) {
        this.config.onItemAdded(payload);
      }
    });

    // Listen for ItemDeleted events
    this.connection.on('ItemDeleted', (payload: ItemDeletedPayload) => {
      if (this.config.onItemDeleted) {
        this.config.onItemDeleted(payload);
      }
    });

    // Track connection state changes
    this.connection.onreconnecting(() => {
      if (this.config.onStateChange) {
        this.config.onStateChange('reconnecting');
      }
    });

    this.connection.onreconnected(() => {
      if (this.config.onStateChange) {
        this.config.onStateChange('connected');
      }
      if (this.config.onReconnected) {
        this.config.onReconnected();
      }
    });

    this.connection.onclose(() => {
      if (this.config.onStateChange) {
        this.config.onStateChange('disconnected');
      }
    });
  }

  async start(): Promise<void> {
    try {
      await this.connection.start();
      if (this.config.onStateChange) {
        this.config.onStateChange('connected');
      }
    } catch (error) {
      if (this.config.onStateChange) {
        this.config.onStateChange('disconnected');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (
      this.connection.state !== HubConnectionState.Disconnected &&
      this.connection.state !== HubConnectionState.Disconnecting
    ) {
      await this.connection.stop();
    }
  }

  get state(): ConnectionState {
    switch (this.connection.state) {
      case HubConnectionState.Connected:
        return 'connected';
      case HubConnectionState.Reconnecting:
        return 'reconnecting';
      default:
        return 'disconnected';
    }
  }
}
