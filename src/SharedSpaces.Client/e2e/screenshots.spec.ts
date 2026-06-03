import { test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5165';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-this-in-production';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../../docs/screenshots');
const FROZEN_SCREENSHOT_NOW = '2025-03-19T16:00:00.000Z';
const CLIENT_DB_VERSION = 6;

let deterministicCounter = 0;
function deterministicUUID(): string {
  const seq = deterministicCounter++;
  const hash = createHash('sha256').update(`screenshot-item:${seq}`).digest();
  const hex = hash.subarray(0, 16).toString('hex');
  // Format as UUID v4-like: xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

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

/** Generate a visible test PNG with a gradient pattern */
function generateTestPng(width: number, height: number): Uint8Array {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }
  function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + 4 + data.length + 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 3);
    raw[rowOff] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const off = rowOff + 1 + x * 3;
      raw[off] = Math.floor(59 + 196 * (x / width));
      raw[off + 1] = Math.floor(130 + 70 * (y / height));
      raw[off + 2] = Math.floor(246 - 90 * (x / width));
    }
  }
  const compressed = deflateSync(Buffer.from(raw));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', new Uint8Array(compressed)), pngChunk('IEND', new Uint8Array(0))];
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const png = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) { png.set(c, pos); pos += c.length; }
  return png;
}

/** Build a /shared/{segment} URL for a shared-item link */
function buildTestShareUrl(shareToken: string, serverUrl: string): string {
  const payload = `token=${encodeURIComponent(shareToken)}&api=${encodeURIComponent(serverUrl)}`;
  const segment = Buffer.from(payload).toString('base64url');
  return `${CLIENT_URL}/shared/${segment}`;
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

  const pin = invitation.invitationString.split('|').pop()!;

  const aliceToken = await apiCall(`${SERVER_URL}/v1/tokens`, {
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
  const pin2 = invitation2.invitationString.split('|').pop()!;
  await apiCall(`${SERVER_URL}/v1/tokens`, {
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
  let firstTextItemId = '';
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
    const itemId = deterministicUUID();
    if (!firstTextItemId) firstTextItemId = itemId;
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

  // Add sample file items (text-like)
  for (const file of [
    { name: 'meeting-notes.txt', content: '# Meeting Notes — Sprint 12\n\n- Reviewed Q2 roadmap\n- Assigned onboarding tasks\n- Next sync: Thursday 3 PM' },
    { name: 'architecture.md', content: '# System Architecture\n\nClient → API Gateway → Services → Database' },
  ]) {
    const fileItemId = deterministicUUID();
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

  // Add a JSON file item (for text preview screenshot)
  const jsonContent = JSON.stringify({ greeting: 'Hello', items: [1, 2, 3], nested: { key: 'value' } }, null, 2);
  const jsonItemId = deterministicUUID();
  const jsonForm = new FormData();
  jsonForm.append('id', jsonItemId);
  jsonForm.append('contentType', 'file');
  jsonForm.append('file', new Blob([jsonContent], { type: 'application/json' }), 'data.json');
  await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/items/${jsonItemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${aliceToken.token}` },
    body: jsonForm,
  });

  // Add a PNG image file item (for image preview screenshot)
  const pngBytes = generateTestPng(200, 150);
  const pngItemId = deterministicUUID();
  const pngForm = new FormData();
  pngForm.append('id', pngItemId);
  pngForm.append('contentType', 'file');
  pngForm.append('file', new Blob([pngBytes], { type: 'image/png' }), 'photo.png');
  await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/items/${pngItemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${aliceToken.token}` },
    body: pngForm,
  });

  return { space, invitation, token: aliceToken.token, firstTextItemId, pngItemId };
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
    () => {
      const adminView = document.querySelector('admin-view') as any;
      if (!adminView?.spaces?.length) {
        return false;
      }

      const states = Object.values(adminView.spaceCardState ?? {});
      return (
        states.length === adminView.spaces.length
        && states.every((state: any) => !state.isLoadingMembers && !state.isLoadingInvitations)
      );
    },
    { timeout: 10_000 },
  );
  await page.waitForTimeout(500);
}

async function capture(page: Page, name: string, vp: ViewportSpec, { fullPage = false } = {}) {
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
  let emptySpaceTokenMap: Record<string, string>;
  let shareTextUrl: string;
  let shareFileUrl: string;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((isoNow) => {
      const fixedTime = new Date(isoNow).valueOf();
      const RealDate = Date;

      class FixedDate extends RealDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(fixedTime);
            return;
          }

          super(...args);
        }

        static now() {
          return fixedTime;
        }
      }

      FixedDate.UTC = RealDate.UTC;
      FixedDate.parse = RealDate.parse;
      // @ts-expect-error Deterministic screenshots require overriding the global Date constructor in-page.
      globalThis.Date = FixedDate;
    }, FROZEN_SCREENSHOT_NOW);
  });

  test.beforeAll(async () => {
    const emptySpace = await apiCall(`${SERVER_URL}/v1/spaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ name: 'Empty Space' }),
    });
    const emptyInv = await apiCall(`${SERVER_URL}/v1/spaces/${emptySpace.id}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ clientAppUrl: CLIENT_URL }),
    });
    const emptyPin = emptyInv.invitationString.split('|').pop()!;
    const emptyToken = await apiCall(`${SERVER_URL}/v1/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: emptyPin, displayName: 'Alice' }),
    });
    emptySpaceTokenMap = { [`${SERVER_URL}:${emptySpace.id}`]: emptyToken.token };

    const space2 = await seedSpace('Design Team');
    const space1 = await seedSpace('Project Alpha');

    invitationString = space1.invitation.invitationString;

    tokenMap = {
      [`${SERVER_URL}:${space1.space.id}`]: space1.token,
      [`${SERVER_URL}:${space2.space.id}`]: space2.token,
    };

    // Create shared links for shared-item-view screenshots
    const textShareLink = await apiCall(
      `${SERVER_URL}/v1/spaces/${space1.space.id}/items/${space1.firstTextItemId}/share/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${space1.token}` },
        body: JSON.stringify({ name: 'Demo text share' }),
      },
    );
    shareTextUrl = buildTestShareUrl(textShareLink.token, SERVER_URL);

    const fileShareLink = await apiCall(
      `${SERVER_URL}/v1/spaces/${space1.space.id}/items/${space1.pngItemId}/share/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${space1.token}` },
        body: JSON.stringify({ name: 'Demo image share' }),
      },
    );
    shareFileUrl = buildTestShareUrl(fileShareLink.token, SERVER_URL);

    // Create an unused invitation for admin invitations modal screenshot
    await apiCall(`${SERVER_URL}/v1/spaces/${space1.space.id}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ clientAppUrl: CLIENT_URL }),
    });

    console.log(`Seeded spaces: ${space1.space.id}, ${space2.space.id}, ${emptySpace.id} (empty)`);
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
      await page.click('button[aria-label="Join a space"]');
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

    test(`space view - compose queue - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);

      // Type a message alongside the file to show the combined compose queue.
      await page.locator('textarea[aria-label="Text to share"]').fill(
        'Here are the final release notes',
      );

      await page.locator('#file-input-hidden').setInputFiles([{
        name: 'draft-release-notes.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Draft release notes'),
      }]);

      // The selected file appears inline in the compose box as an editable row.
      const renameInput = page.locator('input[aria-label="Filename for draft-release-notes.md"]');
      await renameInput.waitFor({ state: 'visible', timeout: 5_000 });
      await renameInput.fill('release-notes-final.md');
      await page.waitForTimeout(300);
      await capture(page, 'space-compose-queue', vp, { fullPage: false });
    });

    test(`space view - file preview image - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);

      // Click the image file item to open preview
      await page.getByRole('button', { name: 'photo.png' }).click();
      await page.waitForSelector('button[aria-label="Close preview"]', { timeout: 5_000 });
      // Wait for the image to actually load
      await page.waitForSelector('img[alt="photo.png"]', { state: 'visible', timeout: 5_000 });
      await page.waitForFunction(() => {
        const img = document.querySelector('img[alt="photo.png"]') as HTMLImageElement;
        return img && img.complete && img.naturalWidth > 0;
      }, { timeout: 5_000 });
      await page.waitForTimeout(300);
      await capture(page, 'space-file-preview-image', vp, { fullPage: false });

      // Close preview
      await page.locator('button[aria-label="Close preview"]').click();
    });

    test(`space view - file preview text - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);

      // Click the JSON file item to open text preview
      await page.getByRole('button', { name: 'data.json' }).click();
      await page.waitForSelector('button[aria-label="Close preview"]', { timeout: 5_000 });
      await page.waitForTimeout(500);
      await capture(page, 'space-file-preview-text', vp, { fullPage: false });

      // Close preview
      await page.locator('button[aria-label="Close preview"]').click();
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

    test(`space view - server unreachable - ${vp.name}`, async ({ page }) => {
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
      await capture(page, 'space-server-unreachable', vp);
    });

    test(`space view - offline - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Set offline before navigating to space
      await page.context().setOffline(true);
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(2000);
      await capture(page, 'space-offline', vp);
      // Restore online state for subsequent tests
      await page.context().setOffline(false);
    });

    test(`space view - pending uploads - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Navigate to space and wait for items to load
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);

      // Directly set the component's reactive state to show pending uploads.
      // Pending uploads now live in the unified compose list as rows with
      // status 'pending' (folded into the compose box, not a separate section).
      await page.evaluate(() => {
        const sv = document.querySelector('space-view') as any;
        if (sv) {
          sv.composeItems = [
            { id: '1', status: 'pending', itemId: 'a1', type: 'text', name: '', content: 'This message is waiting to be uploaded', timestamp: Date.now() },
            { id: '2', status: 'pending', itemId: 'a2', type: 'file', name: 'presentation.pdf', fileType: 'application/pdf', timestamp: Date.now() - 30000 },
          ];
        }
      });
      await page.waitForTimeout(500);
      await capture(page, 'space-pending-uploads', vp);
    });

    test(`space view - server unreachable with pending - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      // Build a decodable JWT pointing to a non-existent server
      const deadServer = 'http://localhost:19999';
      const deadSpaceId = '00000000-0000-0000-0000-000000000001';
      const fakeJwt = buildFakeJwt({ server_url: deadServer, space_id: deadSpaceId, space_name: 'Unreachable Space' });
      const fakeTokenMap: Record<string, string> = {};
      fakeTokenMap[`${deadServer}:${deadSpaceId}`] = fakeJwt;
      await injectTokens(page, fakeTokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');

      // Pre-populate the unified compose store with pending items for this dead
      // server. Pending uploads are compose-items with status 'pending'.
      const pendingId1 = deterministicUUID();
      const pendingItemId1 = deterministicUUID();
      const pendingId2 = deterministicUUID();
      const pendingItemId2 = deterministicUUID();
      await page.evaluate(({ serverUrl, spaceId, dbVersion, pendingId1, pendingItemId1, pendingId2, pendingItemId2 }) => {
        return new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('shared-spaces-db', dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('compose-items', 'readwrite');
            const store = tx.objectStore('compose-items');

            store.put({
              id: pendingId1,
              status: 'pending',
              itemId: pendingItemId1,
              spaceId,
              serverUrl,
              type: 'text',
              content: 'Failed to sync: server unreachable',
              timestamp: Date.now() - 60000,
            });
            store.put({
              id: pendingId2,
              status: 'pending',
              itemId: pendingItemId2,
              spaceId,
              serverUrl,
              type: 'file',
              fileName: 'report.docx',
              fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              timestamp: Date.now() - 120000,
            });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        });
      }, { serverUrl: deadServer, spaceId: deadSpaceId, dbVersion: CLIENT_DB_VERSION, pendingId1, pendingItemId1, pendingId2, pendingItemId2 });

      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(3000);
      await capture(page, 'space-server-unreachable-with-pending', vp);
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

      const membersButton = page.locator('button', { hasText: /Members\s*\(\d+\)/ }).first();
      await membersButton.click();
      await page.waitForFunction(() => {
        const adminView = document.querySelector('admin-view') as any;
        return adminView?.activeModal?.type === 'members'
          && adminView?.spaceCardState?.[adminView.activeModal.spaceId]
          && !adminView.spaceCardState[adminView.activeModal.spaceId].isLoadingMembers;
      }, { timeout: 10_000 });
      await page.waitForTimeout(300);
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

    test(`space view - config panel - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Navigate into the first space
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);
      // Open the settings panel via the gear button
      const settingsToggle = page.locator('[data-testid="space-settings-toggle"]').first();
      await settingsToggle.waitFor({ state: 'visible', timeout: 10_000 });
      await settingsToggle.click();
      await page.locator('text=Server').first().waitFor({ state: 'visible', timeout: 10_000 });
      await capture(page, 'space-config', vp);
    });

    test(`space view - transfer button - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Click the first space pill to enter space view
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForSelector('button[aria-label="Send to another space"]', { timeout: 10_000 });
      await page.waitForTimeout(500);
      await capture(page, 'space-transfer-button', vp);
    });

    test(`space view - transfer modal - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Click the first space pill to enter space view
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForSelector('button[aria-label="Send to another space"]', { timeout: 10_000 });
      await page.waitForTimeout(500);
      // Click the "Send to..." button on the first item card
      const sendBtn = page.locator('button[aria-label="Send to another space"]').first();
      await sendBtn.click();
      // Wait for the transfer modal to appear (heading: "Send to…")
      await page.waitForFunction(
        () => document.querySelector('h3')?.textContent?.includes('Send to'),
        { timeout: 5_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'space-transfer-modal', vp);
    });

    test(`space view - share modal - ${vp.name}`, async ({ page }) => {
      // Disable navigator.share so link creation falls back to clipboard copy
      await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, writable: true }); });

      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');

      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);

      // Click "Shared links" button on the first item
      const manageBtn = page.locator('button[aria-label="Shared links"]').first();
      await manageBtn.click();
      // Wait for the share modal to appear (heading: "Shared links")
      await page.waitForFunction(
        () => document.querySelector('h3')?.textContent?.includes('Shared links'),
        { timeout: 5_000 },
      );
      await page.waitForTimeout(500);

      // Create a named shared link to show the name feature
      const nameInput = page.locator('input[placeholder="Link name (optional)"]');
      await nameInput.fill('For the design team');
      await page.locator('button:has-text("Create new link")').click();
      // Wait for the link to appear in the list
      await page.waitForFunction(
        () => document.querySelectorAll('.rounded-lg.border').length > 0,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(300);

      // Create a second link without a name
      await nameInput.fill('');
      await page.locator('button:has-text("Create new link")').click();
      await page.waitForFunction(
        () => document.querySelectorAll('.rounded-lg.border').length > 1,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(500);

      await capture(page, 'space-share-modal', vp, { fullPage: false });
    });

    test(`space view - share link qr inline - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');

      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);

      const manageBtn = page.locator('button[aria-label="Shared links"]').first();
      await manageBtn.click();
      await page.waitForFunction(
        () => document.querySelector('h3')?.textContent?.includes('Shared links'),
        { timeout: 5_000 },
      );

      const createLinkButton = page.locator('button:has-text("Create new link")');
      await createLinkButton.click();
      await page.waitForSelector('button[aria-label="Show link QR code"]', { timeout: 5_000 });

      await page.locator('button[aria-label="Show link QR code"]').first().click();
      await page.waitForSelector('img[alt="Shared link QR code"]', { timeout: 10_000 });
      await page.waitForTimeout(300);

      await capture(page, 'space-share-qr', vp);
    });

    test(`admin view - invitation modal - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await navigateToAdminSignedIn(page);

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
      await page.waitForFunction(() => {
        const image = document.querySelector('img[alt*="QR" i]') as HTMLImageElement | null;
        return !!image && image.complete && image.naturalWidth > 0;
      }, { timeout: 10_000 });
      await page.waitForTimeout(500);

      await capture(page, 'admin-invite', vp);
    });

    // --- New screenshot tests for uncaptured UI states ---

    test(`shared-item-view text - ${vp.name}`, async ({ page }) => {
      await page.goto(shareTextUrl);
      await page.waitForSelector('shared-item-view');
      await page.waitForFunction(
        () => document.querySelector('.animate-spin') === null
          && document.querySelector('shared-item-view p.whitespace-pre-wrap') !== null,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'shared-item-text', vp);
    });

    test(`shared-item-view file - ${vp.name}`, async ({ page }) => {
      await page.goto(shareFileUrl);
      await page.waitForSelector('shared-item-view');
      await page.waitForFunction(
        () => {
          if (document.querySelector('.animate-spin')) return false;
          const img = document.querySelector('shared-item-view img') as HTMLImageElement | null;
          return !img || (img.complete && img.naturalWidth > 0);
        },
        { timeout: 10_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'shared-item-file', vp);
    });

    test(`shared-item-view error - ${vp.name}`, async ({ page }) => {
      await page.goto(`${CLIENT_URL}/shared/invalidbase64segment`);
      await page.waitForFunction(
        () => document.body.textContent?.includes('Invalid share link'),
        { timeout: 10_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'shared-item-error', vp);
    });

    test(`space view - empty state - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, emptySpaceTokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForFunction(
        () => document.body.textContent?.includes('No items shared yet'),
        { timeout: 10_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'space-empty', vp);
    });

    test(`space view - text modal - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.click('nav button:first-child');
      await page.waitForSelector('space-view');
      await page.waitForTimeout(1000);
      // Click the text content of the first text item to open the full-text modal
      const textContent = page.locator('space-view p[title="Click to view full text"]').first();
      await textContent.click();
      await page.waitForFunction(
        () => document.querySelector('h3')?.textContent?.includes('Full Text'),
        { timeout: 5_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'space-text-modal', vp);
    });

    test(`admin view - login form - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Navigate to admin view — shows login form before authentication
      const adminBtns = page.locator('button[title="Admin panel"]');
      const mobileBtn = adminBtns.first();
      await (await mobileBtn.isVisible() ? mobileBtn : adminBtns.nth(1)).click();
      await page.waitForSelector('admin-view');
      await page.waitForTimeout(500);
      await capture(page, 'admin-login', vp);
    });

    test(`admin view - invitations list - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      await navigateToAdminSignedIn(page);
      const invitationsButton = page.locator('button', { hasText: /Invitations\s*\(\d+\)/ }).first();
      await invitationsButton.click();
      await page.waitForFunction(() => {
        const adminView = document.querySelector('admin-view') as any;
        return adminView?.activeModal?.type === 'invitations'
          && adminView?.spaceCardState?.[adminView.activeModal.spaceId]
          && !adminView.spaceCardState[adminView.activeModal.spaceId].isLoadingInvitations;
      }, { timeout: 10_000 });
      await page.waitForTimeout(300);
      await capture(page, 'admin-invitations', vp);
    });

    test(`join view - error state - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      await page.reload();
      await page.waitForSelector('app-shell');
      // Navigate to join view via the "Join a space" button
      await page.click('button[aria-label="Join a space"]');
      await page.waitForSelector('join-view');
      await page.waitForTimeout(500);
      // Switch to manual entry mode
      await page.click('button:has-text("Enter manually")');
      // Fill in invalid credentials and submit
      await page.fill('#serverUrl', SERVER_URL);
      await page.fill('#pin', '000000');
      await page.fill('#displayName', 'TestUser');
      await page.click('button:has-text("Join Space")');
      // Wait for error message to appear
      await page.waitForFunction(
        () => document.querySelector('.text-red-400') !== null,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'join-error', vp);
    });

    test(`pending shares view - ${vp.name}`, async ({ page }) => {
      await page.goto(CLIENT_URL);
      await injectTokens(page, tokenMap);
      // Seed IndexedDB with pending share items
      await page.evaluate(({ dbVersion }) => {
        return new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('shared-spaces-db', dbVersion);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('pending-shares'))
              db.createObjectStore('pending-shares', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('compose-items'))
              db.createObjectStore('compose-items', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('offline-queue'))
              db.createObjectStore('offline-queue', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('auth-tokens'))
              db.createObjectStore('auth-tokens');
          };
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('pending-shares', 'readwrite');
            tx.objectStore('pending-shares').put({
              id: 'pending-text-1',
              type: 'text',
              content: 'Check out this recipe: https://example.com/recipes/pasta-carbonara',
              timestamp: Date.now(),
            });
            tx.objectStore('pending-shares').put({
              id: 'pending-file-1',
              type: 'file',
              fileName: 'vacation-photo.jpg',
              fileType: 'image/jpeg',
              fileSize: 2457600,
              timestamp: Date.now() - 60000,
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        });
      }, { dbVersion: CLIENT_DB_VERSION });
      await page.reload();
      await page.waitForSelector('app-shell');
      await page.waitForTimeout(500);
      // Click the pending shares pill (should appear when count > 0)
      const pendingPill = page.locator('[data-testid="pending-shares-pill"], [data-testid="pending-shares-bar"]').first();
      await pendingPill.waitFor({ state: 'visible', timeout: 5_000 });
      await pendingPill.click();
      await page.waitForFunction(
        () => document.body.textContent?.includes('Shared from other apps'),
        { timeout: 5_000 },
      );
      await page.waitForTimeout(500);
      await capture(page, 'pending-shares', vp);
    });
  }

  // Mobile-only: kebab overflow menu doesn't exist on desktop
  const mobile = Viewports.find((v) => v.name === 'mobile')!;

  test(`space view - kebab menu open - ${mobile.name}`, async ({ page }) => {
    await page.goto(CLIENT_URL);
    await injectTokens(page, tokenMap);
    await page.reload();
    await page.waitForSelector('app-shell');
    // Navigate into the first space
    await page.click('nav button:first-child');
    await page.waitForSelector('space-view');
    await page.waitForTimeout(500);
    // Set mobile viewport so the kebab button is visible
    await page.setViewportSize({ width: mobile.width, height: mobile.height });
    await page.waitForTimeout(300);
    // Click the kebab (⋮) button on the first item to open the overflow menu
    const kebabBtn = page.locator('[data-kebab-menu] button[aria-label="More actions"]').first();
    await kebabBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await kebabBtn.click();
    // Wait for the dropdown menu to appear
    await page.waitForSelector('[data-kebab-menu] div.absolute', { timeout: 5_000 });
    await page.waitForTimeout(300);
    await capture(page, 'space-kebab-menu', mobile);
  });

  test(`mobile bottom sheet open - ${mobile.name}`, async ({ page }) => {
    await page.goto(CLIENT_URL);
    await injectTokens(page, tokenMap);
    await page.reload();
    await page.waitForSelector('app-shell');
    await page.setViewportSize({ width: mobile.width, height: mobile.height });
    await page.waitForTimeout(500);
    // Open the bottom sheet by clicking the bottom bar
    const bottomBar = page.locator('[data-testid="bottom-bar"]');
    await bottomBar.waitFor({ state: 'visible', timeout: 5_000 });
    await bottomBar.click();
    // Wait for the sheet to open
    await page.waitForFunction(
      () => document.querySelector('[data-testid="bottom-sheet"]')?.classList.contains('bottom-sheet-open'),
      { timeout: 5_000 },
    );
    await page.waitForTimeout(500);
    await capture(page, 'mobile-bottom-sheet', mobile);
  });
});
