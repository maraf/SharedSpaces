export type AppView = 'join' | 'space';

export interface AppViewChangeDetail {
  view: AppView;
  spaceId?: string;
  serverUrl?: string;
  token?: string;
}
