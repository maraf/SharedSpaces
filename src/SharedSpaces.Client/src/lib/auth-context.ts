import { createContext } from '@lit/context';

export interface AuthState {
  displayName?: string;
  token?: string;
}

export const authContext = createContext<AuthState>(
  Symbol.for('sharedspaces.auth-context'),
);
