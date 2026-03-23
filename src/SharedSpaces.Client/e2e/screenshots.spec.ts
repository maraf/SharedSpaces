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

/** Build a structurally valid JWT (decodable by jwt-decode) with arbitrary claims and garbage signature */
function buildFakeJwt(claims: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.fake-signature`;
}

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

  // Revoke Bob so the members modal shows both active and revoked states
  const members: { id: string; displayName: string }[] = await apiCall(
    `${SERVER_URL}/v1/spaces/${space.id}/members`,
    { headers: { 'X-Admin-Secret': ADMIN_SECRET } },
  );
  const bob = members.find((m) => m.displayName === 'Bob');
  if (bob) {
    const revokeRes = await fetch(`${SERVER_URL}/v1/spaces/${space.id}/members/${bob.id}/revoke`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    if (!revokeRes.ok) throw new Error(`Revoke failed: ${revokeRes.status}`);
  }

  // Add sample text items — enough to overflow and show the scrollbar
  for (const content of [
    'Welcome to SharedSpaces! 🚀',
    'This is a shared note visible to all members.',
    'Here are the docs for the new API: https://api.example.com/v2/docs',
    'Can someone review the pull request? It adds offline sync support.',
    'Reminder: standup at 10 AM tomorrow 📅',
    'The deployment went through — staging is green ✅',
    'Updated the color tokens in the design system. Check Figma for the latest.',
    'Quick thought: we should add rate limiting before launch.',
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

  // Add sample file items
  for (const file of [
    { name: 'meeting-notes.txt', content: '# Meeting Notes — Sprint 12\n\n- Reviewed Q2 roadmap\n- Assigned onboarding tasks\n- Next sync: Thursday 3 PM' },
    { name: 'architecture.md', content: '# System Architecture\n\nClient → API Gateway → Services → Database' },
  ]) {
    const fileItemId = crypto.randomUUID();
    const fileForm = new FormData();
    fileForm.append('id', fileItemId);
    fileForm.append('contentType', 'file');
    fileForm.append('file', new Blob([file.content], { type: 'text/plain' }), file.name);
    await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/items/${fileItemId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${aliceToken.token}` },
      body: fileForm,
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
  // Two admin buttons exist (mobile sm:hidden + desktop nav); click the visible one
  const adminBtns = page.locator('button[title="Admin panel"]');
  const mobileBtn = adminBtns.first();
  await (await mobileBtn.isVisible() ? mobileBtn : adminBtns.nth(1)).click();
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

async function capture(page: Page, name: string, vp: ViewportSpec, { fullPage = true } = {}) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(300);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOTS_DIR, `${name}--${vp.name}.png`);
  await page.screenshot({ path: filePath, fullPage });
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

    test(`space view - dead space (auth) - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      // Build a decodable JWT with wrong signature — server returns 401
      const spaceId = Object.keys(tokenMap)[0].split(':')[1];
      const fakeJwt = buildFakeJwt({ server_url: SERVER_URL, space_id: spaceId, space_name: 'Dead Space' });
      const fakeTokenMap: Record<string, string> = {};
      fakeTokenMap[`${SERVER_URL}:${spaceId}`] = fakeJwt;
      await injectTokens(page, fakeTokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1500);
      await capture(page, 'space-dead-auth', vp);
    });

    test(`space view - dead space (network) - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      // Build a decodable JWT pointing to a non-existent server
      const deadServer = 'http://localhost:19999';
      const deadSpaceId = '00000000-0000-0000-0000-000000000000';
      const fakeJwt = buildFakeJwt({ server_url: deadServer, space_id: deadSpaceId, space_name: 'Offline Space' });
      const fakeTokenMap: Record<string, string> = {};
      fakeTokenMap[`${deadServer}:${deadSpaceId}`] = fakeJwt;
      await injectTokens(page, fakeTokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(3000);
      await capture(page, 'space-dead-network', vp);
    });

    test(`admin view signed-in - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await navigateToAdminSignedIn(page);
      await capture(page, 'admin-spaces', vp);
    });

    test(`admin view members modal - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await navigateToAdminSignedIn(page);

      // Click the "Members (N)" button on the first space card to open the modal
      const membersButton = page.locator('button', { hasText: /Members\s*\(\d+\)/ }).first();
      await membersButton.click();
      await page.waitForSelector('[role="dialog"]');
      await page.waitForTimeout(500);
      await capture(page, 'admin-members', vp);
    });

    test(`space view - delete confirmation - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Click the first space pill to enter space view
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForSelector('space-view button[aria-label="Delete item"]', { timeout: 10_000 });
      // Click the delete (trash) button on the first item card
      const deleteBtn = page.locator('space-view button[aria-label="Delete item"]').first();
      await deleteBtn.click();
      await page.waitForTimeout(500);
      await capture(page, 'space-delete-confirm', vp);
    });

    test(`admin view - invitation modal - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await navigateToAdminSignedIn(page);

      // Click the invite button on the first space card to open the modal
      const inviteButton = page.locator('button', { hasText: /Invite/ }).first();
      await inviteButton.click();
      await page.waitForSelector('[role="dialog"]');
      await page.waitForTimeout(500);

      // Fill in the client app URL and generate the invitation
      const dialog = page.locator('[role="dialog"]');
      await dialog.locator('input[type="url"]').fill(CLIENT_URL);
      await dialog.locator('button', { hasText: /Generate/i }).click();

      // Wait for the invitation string and QR code to appear
      await page.waitForFunction(
        () => {
          const input = document.querySelector('input[readonly]') as HTMLInputElement | null;
          return input?.value?.includes('|');
        },
        { timeout: 10_000 },
      );
      await page.waitForSelector('img[alt*="QR" i]', { timeout: 10_000 });
      await page.waitForTimeout(500);

      await capture(page, 'admin-invite', vp);
    });
  }
});
