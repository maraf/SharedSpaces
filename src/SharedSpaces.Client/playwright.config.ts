import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const srcRoot = path.resolve(repoRoot, 'src');
const screenshotsDbPath = path.resolve(repoRoot, 'artifacts', 'screenshots.db');
const screenshotsStoragePath = path.resolve(repoRoot, 'artifacts', 'screenshots-storage');
const cleanupCommand = [
  `$dbPath = '${screenshotsDbPath}'`,
  `$storagePath = '${screenshotsStoragePath}'`,
  "Remove-Item \"$dbPath*\" -Force -ErrorAction SilentlyContinue",
  "Remove-Item $storagePath -Recurse -Force -ErrorAction SilentlyContinue",
  "New-Item -ItemType Directory -Path $storagePath -Force | Out-Null",
].join('; ');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-US',
    trace: 'off',
    screenshot: 'off',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'screenshots',
      use: {
        browserName: 'chromium',
        headless: true,
      },
    },
  ],
  webServer: {
    command: `powershell -NoLogo -NoProfile -Command "${cleanupCommand}; dotnet run .\\AppHost.cs -- --Screenshots:UseDeterministicTime=true"`,
    cwd: srcRoot,
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      ConnectionStrings__DefaultConnection: `Data Source=${screenshotsDbPath}`,
      Storage__BasePath: screenshotsStoragePath,
    },
  },
});
