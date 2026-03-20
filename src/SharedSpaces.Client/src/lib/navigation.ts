export type AppView = 'home' | 'join' | 'space' | 'pending-shares' | 'admin';

export interface AppViewChangeDetail {
  view: AppView;
  spaceId?: string;
  serverUrl?: string;
  token?: string;
  displayName?: string;
  spaceName?: string;
  reloadSpaces?: boolean;
}
