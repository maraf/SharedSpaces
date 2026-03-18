import { createContext } from '@lit/context';

export interface AppConfig {
  apiBaseUrl: string;
}

export const appContext = createContext<AppConfig>(
  Symbol.for('sharedspaces.app-context'),
);

export function getRuntimeAppConfig(): AppConfig {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="api-base-url"]',
  );

  return {
    apiBaseUrl: meta?.content.trim() || '/',
  };
}
