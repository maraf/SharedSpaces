export type AppView = 'join' | 'space' | 'admin';

export interface AppViewChangeDetail {
  view: AppView;
  spaceId?: string;
  serverUrl?: string;
  token?: string;
  displayName?: string;
}
