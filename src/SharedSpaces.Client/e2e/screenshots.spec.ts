import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5165';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-this-in-production';
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

async function seedSpace(name: string) {
  const space = await apiCall(`${SERVER_URL}/v1/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ name }),
  });

  const invitation = await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ clientAppUrl: CLIENT_URL }),
  });

  const pin = invitation.invitationString.split('|')[2];

  const aliceToken = await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, displayName: 'Alice' }),
  });

  // Add a second member
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

  // Add sample items
  for (const content of [
    'Welcome to SharedSpaces! 🚀',
    'This is a shared note visible to all members.',
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

/** Inject tokens into localStorage so the pill bar shows joined spaces */
async function injectTokens(page: Page, tokens: Record<string, string>) {
  await page.evaluate((t) => {
    localStorage.setItem('sharedspaces:tokens', JSON.stringify(t));
  }, tokens);
}

async function navigateToAdminSignedIn(page: Page) {
  // Click the Admin pill in the nav bar
  await page.click('button:has-text("Admin")');
  await page.waitForSelector('admin-view');

  await page.fill('#admin-server-url', SERVER_URL);
  await page.fill('#admin-secret', ADMIN_SECRET);
  await page.locator('admin-view button[type="submit"]').click();

  await page.waitForFunction(
    () => document.body.textContent?.match(/Members\s*\(\d+\)/),
    { timeout: 10_000 },
  );
  await page.waitForTimeout(500);
}

async function capture(page: Page, name: string, vp: ViewportSpec) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(300);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOTS_DIR, `${name}--${vp.name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`  ✓ ${name}--${vp.name}.png`);
}

test.describe('Screenshot Capture', () => {
  let tokenMap: Record<string, string>;
  let invitationString: string;

  test.beforeAll(async () => {
    const space1 = await seedSpace('Project Alpha');
    const space2 = await seedSpace('Design Team');

    invitationString = space1.invitation.invitationString;

    tokenMap = {
      [`${SERVER_URL}:${space1.space.id}`]: space1.token,
      [`${SERVER_URL}:${space2.space.id}`]: space2.token,
    };
    console.log(`Seeded spaces: ${space1.space.id}, ${space2.space.id}`);
  });

  for (const vp of Viewports) {
    test(`home - empty - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await page.waitForSelector('app-shell');
      await page.waitForTimeout(500);
      await capture(page, 'home-empty', vp);
    });

    test(`home - with spaces - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.waitForTimeout(500);
      await capture(page, 'home', vp);
    });

    test(`join view - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('button:has-text("+")');
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
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Click the first space pill
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);
      await capture(page, 'space', vp);
    });

    test(`admin view signed-in - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await navigateToAdminSignedIn(page);
      await capture(page, 'admin-spaces', vp);
    });
  }
});
