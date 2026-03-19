import { test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_URL = 'http://localhost:5165';
const CLIENT_URL = 'http://localhost:5173';
const ADMIN_SECRET = 'change-this-in-production';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../../docs/screenshots');

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
}

const Viewports: ViewportSpec[] = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

async function apiCall(url: string, options: RequestInit = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${options.method ?? 'GET'} ${url} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function seedSpace() {
  // Create a space
  const space = await apiCall(`${SERVER_URL}/v1/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ name: 'Demo Space' }),
  });

  // Create invitation
  const invitation = await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ clientAppUrl: CLIENT_URL }),
  });

  // Parse PIN from invitationString (format: "serverUrl|spaceId|pin")
  const pin = invitation.invitationString.split('|')[2];

  // Join as "Alice"
  const aliceToken = await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, displayName: 'Alice' }),
  });

  // Create a second invitation + member for richer screenshots
  const invitation2 = await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ clientAppUrl: CLIENT_URL }),
  });
  const pin2 = invitation2.invitationString.split('|')[2];
  await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pin2, displayName: 'Bob' }),
  });

  // Add sample items (endpoint expects multipart/form-data)
  for (const content of [
    'Welcome to SharedSpaces! 🚀',
    'This is a shared note visible to all members.',
    'Try adding your own items below.',
  ]) {
    const itemId = crypto.randomUUID();
    const form = new FormData();
    form.append('id', itemId);
    form.append('contentType', 'text');
    form.append('content', content);
    await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/items/${itemId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${aliceToken.token}` },
      body: form,
    });
  }

  return { space, invitation, token: aliceToken.token };
}

async function navigateToSpaceView(
  page: Page,
  spaceId: string,
  token: string,
) {
  await page.goto(CLIENT_URL);
  await page.waitForSelector('app-shell');

  // Inject token into localStorage
  await page.evaluate(
    ({ serverUrl, spaceId, token }) => {
      const key = 'sharedspaces:tokens';
      const tokens = JSON.parse(localStorage.getItem(key) || '{}');
      tokens[`${serverUrl}:${spaceId}`] = token;
      localStorage.setItem(key, JSON.stringify(tokens));
    },
    { serverUrl: SERVER_URL, spaceId, token },
  );

  // Dispatch view-change event to switch to space view
  await page.evaluate(
    ({ spaceId, serverUrl, token }) => {
      document.querySelector('main')?.dispatchEvent(
        new CustomEvent('view-change', {
          bubbles: true,
          composed: true,
          detail: { view: 'space', spaceId, serverUrl, token, displayName: 'Alice' },
        }),
      );
    },
    { spaceId, serverUrl: SERVER_URL, token },
  );

  await page.waitForSelector('space-view');
  // Wait for SignalR connection + data load
  await page.waitForTimeout(1500);
}

async function navigateToAdminView(page: Page) {
  await page.goto(CLIENT_URL);
  await page.waitForSelector('app-shell');

  // Switch to admin view via CustomEvent
  await page.evaluate(() => {
    document.querySelector('main')?.dispatchEvent(
      new CustomEvent('view-change', {
        bubbles: true,
        composed: true,
        detail: { view: 'admin' },
      }),
    );
  });

  await page.waitForSelector('admin-view');
  await page.waitForTimeout(500);
}

async function navigateToAdminSignedIn(page: Page) {
  await navigateToAdminView(page);

  // Fill in admin credentials and submit
  await page.fill('#admin-server-url', SERVER_URL);
  await page.fill('#admin-secret', ADMIN_SECRET);
  await page.locator('admin-view button[type="submit"]').click();

  // Wait for spaces list to load (heading shows "Spaces (N)")
  await page.waitForFunction(
    () => document.body.textContent?.match(/Spaces\s*\(\d+\)/),
    { timeout: 10_000 },
  );
  await page.waitForTimeout(500);
}

async function capture(page: Page, name: string, vp: ViewportSpec) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(300);
  const filePath = path.join(SCREENSHOTS_DIR, `${name}--${vp.name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`  ✓ ${name}--${vp.name}.png`);
}

test.describe('Screenshot Capture', () => {
  let spaceId: string;
  let token: string;
  let invitationString: string;

  test.beforeAll(async () => {
    const data = await seedSpace();
    spaceId = data.space.id;
    token = data.token;
    invitationString = data.invitation.invitationString;
    console.log(`Seeded space ${spaceId}`);
  });

  for (const vp of Viewports) {
    test(`join view - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await page.waitForSelector('join-view');
      await page.waitForTimeout(500);
      await capture(page, 'join', vp);
    });

    test(`join view pre-filled - ${vp.name}`, async ({ page }) => {
      await page.goto(`${CLIENT_URL}/?join=${encodeURIComponent(invitationString)}`);
      await page.waitForSelector('join-view');
      await page.waitForTimeout(500);
      await capture(page, 'join-prefilled', vp);
    });

    test(`space view - ${vp.name}`, async ({ page }) => {
      await navigateToSpaceView(page, spaceId, token);
      await capture(page, 'space', vp);
    });

    test(`admin view - ${vp.name}`, async ({ page }) => {
      await navigateToAdminView(page);
      await capture(page, 'admin', vp);
    });

    test(`admin view signed-in - ${vp.name}`, async ({ page }) => {
      await navigateToAdminSignedIn(page);
      await capture(page, 'admin-spaces', vp);
    });
  }
});
