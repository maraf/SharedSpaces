import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const srcRoot = path.resolve(repoRoot, 'src');
const clientRoot = path.resolve(srcRoot, 'SharedSpaces.Client');
const serverProjectPath = path.resolve(
  srcRoot,
  'SharedSpaces.Server',
  'SharedSpaces.Server.csproj',
);
const screenshotsDbPath = path.resolve(repoRoot, 'artifacts', 'screenshots.db');
const screenshotsStoragePath = path.resolve(
  repoRoot,
  'artifacts',
  'screenshots-storage',
);
const screenshotsServerLogPath = path.resolve(
  repoRoot,
  'artifacts',
  'screenshots-server.log',
);
const screenshotsClientLogPath = path.resolve(
  repoRoot,
  'artifacts',
  'screenshots-client.log',
);
const serverBaseUrl = 'http://127.0.0.1:5165';
const clientBaseUrl = 'http://localhost:5173';
const clientReadyUrl = 'http://127.0.0.1:5173';
const cleanupCommand =
  process.platform === 'win32'
    ? [
        `$dbPath = '${screenshotsDbPath}'`,
        `$storagePath = '${screenshotsStoragePath}'`,
        'Remove-Item "$dbPath*" -Force -ErrorAction SilentlyContinue',
        'Remove-Item $storagePath -Recurse -Force -ErrorAction SilentlyContinue',
        'New-Item -ItemType Directory -Path $storagePath -Force | Out-Null',
      ].join('; ')
    : [
        `rm -rf '${screenshotsDbPath}'*`,
        `rm -rf '${screenshotsStoragePath}'`,
        `mkdir -p '${screenshotsStoragePath}'`,
      ].join(' && ');

const serverWebServerCommand =
  process.platform === 'win32'
    ? `powershell -NoLogo -NoProfile -Command "${cleanupCommand}; dotnet run --project '${serverProjectPath}' --no-launch-profile > '${screenshotsServerLogPath}' 2>&1"`
    : [
        'bash -lc "',
        `${cleanupCommand} && `,
        `dotnet run --project '${serverProjectPath}' --no-launch-profile > '${screenshotsServerLogPath}' 2>&1`,
        '"',
      ].join('');

const clientWebServerCommand =
  process.platform === 'win32'
    ? `powershell -NoLogo -NoProfile -Command "Set-Location '${clientRoot}'; npx vite --host 127.0.0.1 --port 5173 > '${screenshotsClientLogPath}' 2>&1"`
    : `bash -lc "cd '${clientRoot}' && npx vite --host 127.0.0.1 --port 5173 > '${screenshotsClientLogPath}' 2>&1"`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: clientBaseUrl,
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
  webServer: [
    {
      command: serverWebServerCommand,
      cwd: srcRoot,
      url: serverBaseUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        ConnectionStrings__DefaultConnection: `Data Source=${screenshotsDbPath}`,
        Storage__BasePath: screenshotsStoragePath,
        Cors__Origins: clientBaseUrl,
        Screenshots__UseDeterministicTime: 'true',
        ASPNETCORE_ENVIRONMENT: 'Development',
        ASPNETCORE_URLS: serverBaseUrl,
      },
    },
    {
      command: clientWebServerCommand,
      cwd: clientRoot,
      url: clientReadyUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
