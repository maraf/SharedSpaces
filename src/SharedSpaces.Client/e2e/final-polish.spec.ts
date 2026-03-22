import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5165';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-this-in-production';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../../docs/screenshots/variants');

async function apiCall(url: string, options: RequestInit = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${options.method ?? 'GET'} ${url} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function createSpaceAndJoin(name: string) {
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
  const tokenRes = await apiCall(`${SERVER_URL}/v1/spaces/${space.id}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, displayName: 'Alice' }),
  });

  return { space, token: tokenRes.token };
}

async function addTextItem(spaceId: string, token: string, content: string) {
  const itemId = crypto.randomUUID();
  const form = new FormData();
  form.append('id', itemId);
  form.append('contentType', 'text');
  form.append('content', content);
  await apiCall(`${SERVER_URL}/v1/spaces/${spaceId}/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function addFileItem(spaceId: string, token: string, fileName: string, fileContent: string) {
  const itemId = crypto.randomUUID();
  const form = new FormData();
  form.append('id', itemId);
  form.append('contentType', 'file');
  form.append('file', new Blob([fileContent], { type: 'text/plain' }), fileName);
  await apiCall(`${SERVER_URL}/v1/spaces/${spaceId}/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function injectTokens(page: Page, tokens: Record<string, string>) {
  await page.evaluate((t) => {
    localStorage.setItem('sharedspaces:tokens', JSON.stringify(t));
  }, tokens);
}

async function capture(page: Page, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  ✓ ${name}.png`);
}

test.describe('Final Polish Screenshots', () => {
  let tokenMap: Record<string, string>;
  let projectAlphaSpaceId: string;
  let projectAlphaToken: string;

  test.beforeAll(async () => {
    // Create 6 spaces, join each as Alice
    const spaceNames = [
      'Project Alpha',
      'Design Team',
      'Backend Crew',
      'Marketing Hub',
      'QA Testing',
      'DevOps Central',
    ];

    tokenMap = {};
    for (const name of spaceNames) {
      const { space, token } = await createSpaceAndJoin(name);
      tokenMap[`${SERVER_URL}:${space.id}`] = token;

      if (name === 'Project Alpha') {
        projectAlphaSpaceId = space.id;
        projectAlphaToken = token;
      }
    }

    // Add 10 items to Project Alpha (8 text + 2 file)
    const textItems = [
      'Welcome to the project!',
      'Meeting notes from standup',
      'API endpoint: https://api.example.com/v1/spaces',
      'TODO: Review PR #42 before end of day',
      'The new design looks great 🎨',
      'Bug report: Login fails on Safari mobile',
      'Deployment scheduled for Friday 3pm UTC',
      'Quick link: https://docs.sharedspaces.dev',
    ];
    for (const content of textItems) {
      await addTextItem(projectAlphaSpaceId, projectAlphaToken, content);
    }

    // File items
    await addFileItem(
      projectAlphaSpaceId,
      projectAlphaToken,
      'meeting-notes.txt',
      '# Sprint 12 Meeting Notes\n\n- Reviewed Q2 roadmap\n- Assigned onboarding tasks',
    );
    await addTextItem(projectAlphaSpaceId, projectAlphaToken, 'Final review checklist complete ✅');

    console.log(`Seeded 6 spaces, 10 items in Project Alpha (${projectAlphaSpaceId})`);
  });

  test('final-closed--mobile', async ({ page }) => {
    await page.goto(CLIENT_URL);
    await injectTokens(page, tokenMap);
    await page.reload();
    await page.waitForSelector('app-shell');

    // Navigate to Project Alpha space view
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
      { spaceId: projectAlphaSpaceId, serverUrl: SERVER_URL, token: projectAlphaToken },
    );
    await page.waitForSelector('space-view');
    await page.waitForTimeout(1500);

    await capture(page, 'final-closed--mobile', 390, 844);
  });

  test('final-open--mobile', async ({ page }) => {
    await page.goto(CLIENT_URL);
    await injectTokens(page, tokenMap);
    await page.reload();
    await page.waitForSelector('app-shell');

    // Navigate to a space so connections show
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
      { spaceId: projectAlphaSpaceId, serverUrl: SERVER_URL, token: projectAlphaToken },
    );
    await page.waitForSelector('space-view');
    await page.waitForTimeout(1500);

    // Set mobile viewport then open the sheet
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // Click the bottom bar to open the sheet
    const bottomBar = page.locator('.fixed.bottom-0.z-30');
    await bottomBar.click();
    await page.waitForTimeout(500);

    await capture(page, 'final-open--mobile', 390, 844);
  });

  test('final-space-10-items--mobile', async ({ page }) => {
    await page.goto(CLIENT_URL);
    await injectTokens(page, tokenMap);
    await page.reload();
    await page.waitForSelector('app-shell');

    // Navigate to Project Alpha (has 10 items)
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
      { spaceId: projectAlphaSpaceId, serverUrl: SERVER_URL, token: projectAlphaToken },
    );
    await page.waitForSelector('space-view');
    await page.waitForTimeout(2000);

    await capture(page, 'final-space-10-items--mobile', 390, 844);
  });

  test('final--desktop', async ({ page }) => {
    await page.goto(CLIENT_URL);
    await injectTokens(page, tokenMap);
    await page.reload();
    await page.waitForSelector('app-shell');

    // Navigate to Project Alpha to show active state + pill layout
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
      { spaceId: projectAlphaSpaceId, serverUrl: SERVER_URL, token: projectAlphaToken },
    );
    await page.waitForSelector('space-view');
    await page.waitForTimeout(1500);

    await capture(page, 'final--desktop', 1280, 800);
  });
});
