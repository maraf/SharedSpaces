---
name: playwright-screenshots
description: "Capture Playwright screenshots of the SharedSpaces app. Use when refreshing screenshots, updating UI documentation, or running visual regression tests."
---

## Context

Screenshot capture for SharedSpaces must demonstrate the app across all three views (join, space, admin) in two viewports. The app uses Lit Web Components with event-based view navigation (no URL routing), so Playwright tests must seed data via the admin API and trigger view transitions programmatically. The app currently has a dark theme only.

The app is orchestrated via .NET Aspire (`dotnet run .\src\AppHost.cs`), which starts both the ASP.NET Core server and the Vite dev client.

## Patterns

### 1. Isolated Database Setup

Use a dedicated SQLite database and storage path for screenshot runs to prevent test data from mixing with real data.

**AppHost.cs** supports optional configuration overrides via environment variables:

```bash
# Set before running AppHost
$env:ConnectionStrings__DefaultConnection = "Data Source=D:\path\to\artifacts\screenshots.db"
$env:Storage__BasePath = "D:\path\to\artifacts\screenshots-storage"
```

These are forwarded to the server project only when set. Without them, the server uses its default `sharedspaces.db`.

**Cleanup:** Delete `artifacts/screenshots.db*` files (`.db`, `.db-wal`, `.db-shm`) and `artifacts/screenshots-storage/` before each run for a clean slate.

### 2. App Startup via Aspire

Launch the full stack with Aspire from the `src/` directory:

```bash
cd src

# For isolated screenshot runs:
$env:ConnectionStrings__DefaultConnection = "Data Source=<repo-root>\artifacts\screenshots.db"
$env:Storage__BasePath = "<repo-root>\artifacts\screenshots-storage"

dotnet run AppHost.cs
```

**Ports:**
- Client (Vite): `http://localhost:5173` (fixed via `WithHttpEndpoint(port: 5173)`)
- Server (ASP.NET Core): `http://localhost:5165` (from `launchSettings.json` http profile)

**Wait pattern:** Poll `http://localhost:5165/` (server health endpoint) and `http://localhost:5173/` until both respond before running tests.

**Important:** Use absolute paths for `ConnectionStrings__DefaultConnection` and `Storage__BasePath`. Relative paths resolve from the server's working directory, which differs from the repo root under Aspire.

### 2. Data Seeding via Admin API

Screenshots require representative data. Seed it through the server's admin API before capturing.

**Admin authentication:** All admin endpoints require the `X-Admin-Secret` header. The development default is `change-this-in-production` (from `appsettings.Development.json`).

**Seeding flow:**

```typescript
const SERVER_URL = 'http://localhost:5165';
const CLIENT_URL = 'http://localhost:5173';
const ADMIN_SECRET = 'change-this-in-production';

// Step 1: Create a space
const spaceRes = await fetch(`${SERVER_URL}/v1/spaces`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Secret': ADMIN_SECRET,
  },
  body: JSON.stringify({ name: 'My Shared Space' }),
});
const space = await spaceRes.json(); // { id, name, createdAt }

// Step 2: Create an invitation (generates a PIN)
const invRes = await fetch(`${SERVER_URL}/v1/spaces/${space.id}/invitations`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Secret': ADMIN_SECRET,
  },
  body: JSON.stringify({ clientAppUrl: CLIENT_URL }),
});
const invitation = await invRes.json();
// { invitationString: "http://localhost:5165|<spaceId>|<pin>", qrCodeBase64: "..." }

// Step 3: Exchange PIN for JWT token (joins the space as a member)
// PIN is extracted from invitationString (format: "serverUrl|spaceId|pin")
const pin = invitation.invitationString.split('|')[2];
const tokenRes = await fetch(`${SERVER_URL}/v1/spaces/${space.id}/tokens`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pin, displayName: 'Alice' }),
});
const { token } = await tokenRes.json();

// Step 4 (optional): Add items to the space
// NOTE: The items endpoint expects multipart/form-data, NOT JSON
const itemId = crypto.randomUUID();
const form = new FormData();
form.append('id', itemId);
form.append('contentType', 'text');
form.append('content', 'Hello from SharedSpaces!');
await fetch(`${SERVER_URL}/v1/spaces/${space.id}/items/${itemId}`, {
  method: 'PUT',
  headers: { 'Authorization': `Bearer ${token}` },
  body: form,
});
```

**Key point:** Create multiple members by repeating Steps 2–3 with different display names to populate the members list.

### 3. View Navigation

The app has three views (`join`, `space`, `admin`) switched via `view-change` CustomEvents — there is no URL-based routing. All views render at the same URL (`/`).

**Join view (default):**
No setup needed. This is the landing page. To show a pre-filled invitation:
```typescript
await page.goto(`${CLIENT_URL}/?join=${encodeURIComponent(invitation.invitationString)}`);
// Format: ?join=serverUrl|spaceId|pin
```

**Space view (requires token):**
Navigate via the join flow or inject token directly into localStorage:
```typescript
// Option A: Full join flow via invitation URL
await page.goto(`${CLIENT_URL}/?join=${encodeURIComponent(invitation.invitationString)}`);
// Fill in display name and submit the form

// Option B: Direct token injection (faster, more reliable)
await page.goto(CLIENT_URL);
await page.evaluate(
  ({ serverUrl, spaceId, token }) => {
    const key = 'sharedspaces:tokens';
    const tokens = JSON.parse(localStorage.getItem(key) || '{}');
    tokens[`${serverUrl}:${spaceId}`] = token;
    localStorage.setItem(key, JSON.stringify(tokens));
  },
  { serverUrl: SERVER_URL, spaceId: space.id, token },
);
// Trigger navigation to space view via CustomEvent
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
  { spaceId: space.id, serverUrl: SERVER_URL, token },
);
await page.waitForSelector('space-view');
```

**Admin view:**
```typescript
// Click the admin button in the header
await page.click('button:has-text("Admin")');
await page.waitForSelector('admin-view');

// Fill in admin credentials
await page.fill('input[placeholder*="Server"]', SERVER_URL);
await page.fill('input[placeholder*="Secret"], input[type="password"]', ADMIN_SECRET);
// Submit and wait for data to load
```

### 4. Screenshot Naming Convention

Use the pattern: `{view}--{device}.png`

**Examples:**
- `join--desktop.png`
- `join-prefilled--mobile.png` (join view with invitation pre-filled)
- `space--desktop.png`
- `admin--desktop.png`

When theme support is added, extend to: `{view}--{device}-{theme}.png`

**Viewport specifications:**
- Desktop: 1280 × 800
- Mobile: 390 × 844

### 5. Output Location

**Primary output:** `docs/screenshots/` (at repo root)

Create the directory if it doesn't exist before capturing.

### 6. Cleanup

The server uses SQLite (`sharedspaces.db`). After screenshot capture:
- Stop the Aspire host
- Delete any test database files if an isolated database was used
- Screenshots in `docs/screenshots/` are the persistent output

### 7. Test Execution

Run the screenshot tests (once set up) via:

```bash
npx playwright test --project=screenshots
```

Or from a dedicated test file:

```bash
npx playwright test tests/screenshots.spec.ts
```

## Examples

### Full Screenshot Capture Structure

```typescript
import { test } from '@playwright/test';

const SERVER_URL = 'http://localhost:5165';
const CLIENT_URL = 'http://localhost:5173';
const ADMIN_SECRET = 'change-this-in-production';
const SCREENSHOTS_DIR = '../../docs/screenshots';

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
}

const Viewports: ViewportSpec[] = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

test.describe('Screenshot Capture', () => {
  let spaceId: string;
  let token: string;
  let invitationString: string;

  test.beforeAll(async () => {
    // Seed data via admin API
    const spaceRes = await fetch(`${SERVER_URL}/v1/spaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': ADMIN_SECRET,
      },
      body: JSON.stringify({ name: 'Screenshot Space' }),
    });
    const space = await spaceRes.json();
    spaceId = space.id;

    const invRes = await fetch(`${SERVER_URL}/v1/spaces/${spaceId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': ADMIN_SECRET,
      },
      body: JSON.stringify({ clientAppUrl: CLIENT_URL }),
    });
    const invitation = await invRes.json();
    invitationString = invitation.invitationString;

    // Join as first member
    const pin = invitation.invitationString.split('|')[2];
    const tokenRes = await fetch(`${SERVER_URL}/v1/spaces/${spaceId}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, displayName: 'Alice' }),
    });
    const tokenData = await tokenRes.json();
    token = tokenData.token;

    // Add sample items (must use multipart/form-data, not JSON)
    for (const content of ['Welcome to SharedSpaces!', 'This is a shared note.']) {
      const itemId = crypto.randomUUID();
      const form = new FormData();
      form.append('id', itemId);
      form.append('contentType', 'text');
      form.append('content', content);
      await fetch(`${SERVER_URL}/v1/spaces/${spaceId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form,
      });
    }
  });

  for (const vp of Viewports) {
    test(`join view - ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(CLIENT_URL);
      await page.waitForSelector('join-view');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/join--${vp.name}.png` });
    });

    test(`join view pre-filled - ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${CLIENT_URL}/?join=${encodeURIComponent(invitationString)}`);
      await page.waitForSelector('join-view');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/join-prefilled--${vp.name}.png` });
    });

    test(`space view - ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(CLIENT_URL);

      // Inject token and navigate to space view
      await page.evaluate(
        ({ serverUrl, spaceId, token }) => {
          const key = 'sharedspaces:tokens';
          const tokens = JSON.parse(localStorage.getItem(key) || '{}');
          tokens[`${serverUrl}:${spaceId}`] = token;
          localStorage.setItem(key, JSON.stringify(tokens));
        },
        { serverUrl: SERVER_URL, spaceId, token },
      );
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
      await page.waitForTimeout(1000); // Wait for SignalR connection and items to load
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/space--${vp.name}.png` });
    });

    test(`admin view - ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(CLIENT_URL);
      await page.waitForSelector('join-view');

      // Navigate to admin view
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
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/admin--${vp.name}.png` });
    });
  }
});
```

### Wait Selectors by View

```typescript
// Each view renders as a custom element — wait for it to appear in the DOM
const ViewSelectors: Record<string, string> = {
  join: 'join-view',
  space: 'space-view',
  admin: 'admin-view',
};
```

## Anti-Patterns

### ❌ Don't Touch UI Without Screenshot Verification

**When making any UI change** (layout, styling, components, views), always:

1. **Before** — Capture current screenshots as a baseline (`npx playwright test`)
2. **Make your changes** — Edit component templates, styles, etc.
3. **After** — Recapture screenshots and compare with the baseline
4. **Review mobile** — Check mobile screenshots for layout issues (see below)

This ensures regressions are caught visually, not just via lint/build.

### ❌ Don't Ignore Mobile Layout Issues

After capturing screenshots, inspect the mobile viewport (`390 × 844`) for:

- **Text overflow** — Long strings (UUIDs, URLs, invitation strings) escaping their containers
- **Button wrapping** — Action buttons pushed below inputs when there isn't enough horizontal space
- **Pill bar overflow** — Too many space pills causing horizontal overflow or wrapping to a second row
- **Truncated labels** — Uppercase tracking labels cut off on narrow screens
- **Touch targets** — Buttons smaller than 44×44px on mobile (especially in modals)
- **Modal overflow** — Modal content exceeding the viewport height without scrolling

**How to check:** Open the mobile screenshot and visually scan for elements that look broken, misaligned, or clipped. If the Playwright test is set up, you can also add assertions:

```typescript
// Check no horizontal overflow on mobile
const body = await page.evaluate(() => ({
  scrollWidth: document.body.scrollWidth,
  clientWidth: document.body.clientWidth,
}));
expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
```

### ❌ Don't Use URL-Based Navigation

```typescript
// BAD: The app has no URL routing — these paths don't exist
await page.goto('http://localhost:5173/space');
await page.goto('http://localhost:5173/admin');
```

**Problem:** SharedSpaces uses event-based view switching. All views render at `/`.

**Solution:** Use `view-change` CustomEvent dispatch or UI interaction to switch views.

### ❌ Don't Skip Data Seeding

```typescript
// BAD: Space view with no space/token shows nothing useful
await page.goto(CLIENT_URL);
// ... navigate to space view without creating a space first
```

**Problem:** The space view requires a valid JWT token and space ID to display content.

**Solution:** Always seed data via admin API (create space → create invitation → exchange token) before capturing space view screenshots.

### ❌ Don't Click Buttons Before the App Is Ready

```typescript
// RISKY: Lit components may not have finished rendering
await page.goto(CLIENT_URL);
await page.click('button:has-text("Admin")'); // May fail — component not mounted yet
```

**Problem:** Lit Web Components render asynchronously after the page loads. Clicking before `connectedCallback` completes will fail.

**Solution:** Wait for the view's custom element to appear: `await page.waitForSelector('join-view')`.

### ❌ Don't Hardcode Dynamic Aspire Ports for the Server

```typescript
// RISKY: Aspire may assign a different port
const SERVER_URL = 'http://localhost:12345';
```

**Problem:** While the client port (5173) is fixed, the server port may vary if the default port is busy.

**Solution:** Use the server's `launchSettings.json` http profile port (`5165`) as default, or check the Aspire dashboard to confirm actual endpoints.

### ❌ Don't Forget Layout Settle Time

```typescript
// RISKY: Screenshot before Tailwind transitions complete
await page.waitForSelector('space-view');
await page.screenshot(...); // May capture mid-transition
```

**Problem:** CSS transitions and SignalR data loading may still be in progress.

**Solution:** Add a brief wait after view transitions: `await page.waitForTimeout(500)` for static views, `await page.waitForTimeout(1000)` for the space view (which loads data via SignalR).

### ❌ Don't Use Relative Paths for Isolated Database

```bash
# BAD: Relative path resolves from server's working directory, not repo root
$env:ConnectionStrings__DefaultConnection = "Data Source=../../artifacts/screenshots.db"
```

**Problem:** Under Aspire, the server's working directory differs from the repo root. Relative paths may point to unexpected locations or fail to create the database file.

**Solution:** Always use absolute paths:
```bash
$env:ConnectionStrings__DefaultConnection = "Data Source=D:\repo\artifacts\screenshots.db"
$env:Storage__BasePath = "D:\repo\artifacts\screenshots-storage"
```

### ❌ Don't Use the Real Database for Screenshots

```bash
# BAD: Screenshot test data pollutes the real database
cd src && dotnet run AppHost.cs
```

**Problem:** Seeded spaces, members, and items accumulate across runs, producing cluttered screenshots.

**Solution:** Set `ConnectionStrings__DefaultConnection` and `Storage__BasePath` environment variables before launching Aspire, and delete the artifacts before each run.
