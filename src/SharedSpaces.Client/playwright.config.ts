import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'screenshots',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
