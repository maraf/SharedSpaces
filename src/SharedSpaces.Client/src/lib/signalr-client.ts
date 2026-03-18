export interface SignalRClientConfig {
  accessToken?: string;
  hubUrl: string;
}

export class SignalRClient {
  readonly config: SignalRClientConfig;

  constructor(config: SignalRClientConfig) {
    this.config = config;
  }
}
