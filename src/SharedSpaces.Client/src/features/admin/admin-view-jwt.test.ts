import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenExchangeError } from '../../lib/api-client';
import type { AdminView } from './admin-view';

const mocks = vi.hoisted(() => ({
  listSpaces: vi.fn(),
  createInvitation: vi.fn(),
  listMembers: vi.fn(),
  listInvitations: vi.fn(),
  exchangeToken: vi.fn(),
}));

vi.mock('./admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-api')>()),
  ...mocks,
}));
vi.mock('../../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api-client')>()),
  exchangeToken: mocks.exchangeToken,
}));
import './admin-view';

const serverUrl = 'https://admin-server.example';
const spaceId = '11111111-1111-4111-8111-111111111111';
const token = 'synthetic.jwt.test-signature';
let element: AdminView;

function query<T extends Element>(selector: string): T {
  const result = element.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

function button(text: string): HTMLButtonElement {
  const result = [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim().replace(/\s+/g, ' ') === text ||
      b.querySelector('span')?.textContent === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

async function input(selector: string, value: string) {
  const field = query<HTMLInputElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
}

async function settle() {
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(button('Generate').disabled).toBe(false);
  });
}

async function openInvite() {
  button('Invite').click();
  await element.updateComplete;
  button('Generate').click();
  await vi.waitFor(() =>
    expect(element.querySelector('#jwt-client-name')).not.toBeNull(),
  );
  await element.updateComplete;
}

async function exchange(name = '  Automation client  ') {
  await input('#jwt-client-name', name);
  query<HTMLFormElement>('[role="dialog"] form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await element.updateComplete;
}

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.listSpaces.mockResolvedValue([
    {
      id: spaceId,
      name: 'Test space',
      createdAt: '2026-01-01T00:00:00Z',
      maxUploadSize: null,
      effectiveMaxUploadSize: 10485760,
    },
  ]);
  mocks.listMembers.mockResolvedValue([]);
  mocks.listInvitations.mockResolvedValue([{ id: 'invitation-id', spaceId }]);
  mocks.createInvitation.mockResolvedValue({
    invitationString: `${serverUrl}|123456`,
    qrCodeBase64: 'test-qr',
  });
  mocks.exchangeToken.mockResolvedValue({ token });
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  element = document.createElement('admin-view');
  document.body.appendChild(element);
  await element.updateComplete;
  await input('#admin-server-url', serverUrl);
  await input('#admin-secret', 'test-admin-secret');
  query<HTMLFormElement>('form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(element.textContent).toContain('Test space'));
  await element.updateComplete;
  await openInvite();
});

afterEach(() => {
  element.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin invitation JWT exchange', () => {
  it('uses the connected server and trimmed client name without persisting or navigating', async () => {
    const navigation = vi.fn();
    element.addEventListener('view-change', navigation);
    const localBefore = JSON.stringify(localStorage);
    const sessionBefore = JSON.stringify(sessionStorage);
    mocks.listMembers.mockClear();
    mocks.listInvitations.mockClear();
    await exchange();
    await vi.waitFor(() =>
      expect(
        element.querySelector<HTMLTextAreaElement>('#invitation-jwt')?.value,
      ).toBe(token),
    );
    expect(mocks.exchangeToken).toHaveBeenCalledWith(
      serverUrl,
      '123456',
      'Automation client',
    );
    expect(element.querySelector('img[alt="QR Code"]')).toBeNull();
    expect(element.querySelector('#jwt-client-name')).toBeNull();
    expect(element.textContent).toContain('Copy this JWT before closing');
    expect(button('Generate').disabled).toBe(true);
    expect(mocks.listMembers).toHaveBeenCalledWith(
      serverUrl,
      'test-admin-secret',
      spaceId,
    );
    expect(mocks.listInvitations).toHaveBeenCalledWith(
      serverUrl,
      'test-admin-secret',
      spaceId,
    );
    expect(JSON.stringify(localStorage)).toBe(localBefore);
    expect(JSON.stringify(sessionStorage)).toBe(sessionBefore);
    expect(navigation).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(101)])(
    'rejects invalid names: %j',
    async (name) => {
      await exchange(name);
      expect(mocks.exchangeToken).not.toHaveBeenCalled();
      expect(element.textContent).toContain('between 1 and 100');
    },
  );

  it('accepts a 100-character name and legacy invitation format', async () => {
    query<HTMLButtonElement>('[aria-label="Close dialog"]').click();
    mocks.createInvitation.mockResolvedValue({
      invitationString: `${serverUrl}|${spaceId}|123456`,
      qrCodeBase64: null,
    });
    await element.updateComplete;
    await openInvite();
    await exchange('x'.repeat(100));
    expect(mocks.exchangeToken).toHaveBeenCalledWith(
      serverUrl,
      '123456',
      'x'.repeat(100),
    );
  });

  it('reports malformed invitation data without exchanging', async () => {
    query<HTMLButtonElement>('[aria-label="Close dialog"]').click();
    mocks.createInvitation.mockResolvedValue({
      invitationString: 'malformed',
      qrCodeBase64: null,
    });
    await element.updateComplete;
    await openInvite();
    await exchange();
    expect(mocks.exchangeToken).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Invalid invitation');
  });

  it('blocks duplicate submits and all dismissal paths during exchange', async () => {
    let resolve!: (value: { token: string }) => void;
    mocks.exchangeToken.mockReturnValue(
      new Promise<{ token: string }>((r) => {
        resolve = r;
      }),
    );
    await exchange();
    expect(
      query<HTMLButtonElement>('[aria-label="Close dialog"]').disabled,
    ).toBe(true);
    query<HTMLFormElement>('[role="dialog"] form').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    query<HTMLDivElement>('[role="dialog"]').parentElement?.click();
    expect(element.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.exchangeToken).toHaveBeenCalledTimes(1);
    resolve({ token });
    await vi.waitFor(() =>
      expect(element.querySelector('#invitation-jwt')).not.toBeNull(),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await element.updateComplete;
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(['close', 'escape', 'backdrop'])(
    'discards JWT on %s and reopening',
    async (dismissal) => {
      await exchange();
      await vi.waitFor(() =>
        expect(element.querySelector('#invitation-jwt')).not.toBeNull(),
      );
      if (dismissal === 'close')
        query<HTMLButtonElement>('[aria-label="Close dialog"]').click();
      if (dismissal === 'escape')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (dismissal === 'backdrop')
        query<HTMLDivElement>('[role="dialog"]').parentElement?.click();
      await element.updateComplete;
      expect(element.querySelector('[role="dialog"]')).toBeNull();
      button('Invite').click();
      await element.updateComplete;
      expect(element.querySelector('#invitation-jwt')).toBeNull();
      expect(element.textContent).not.toContain(token);
      await settle();
    },
  );

  it('copies the JWT and reports clipboard failures in the modal', async () => {
    await exchange();
    await vi.waitFor(() =>
      expect(element.querySelector('#invitation-jwt')).not.toBeNull(),
    );
    button('Copy JWT').click();
    await vi.waitFor(() => expect(element.textContent).toContain('Copied!'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(token);
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
      new Error('Clipboard denied'),
    );
    button('Copied!').click();
    await vi.waitFor(() =>
      expect(element.textContent).toContain('Failed to copy JWT'),
    );
    expect(query<HTMLTextAreaElement>('#invitation-jwt').value).toBe(token);
  });

  it('shows invalid PIN errors without logging the admin out', async () => {
    mocks.exchangeToken.mockRejectedValue(
      new TokenExchangeError('Invalid PIN', 401),
    );
    await exchange();
    await vi.waitFor(() =>
      expect(element.textContent).toContain('Invalid PIN'),
    );
    expect(element.textContent).toContain('cannot be recovered');
    expect(element.querySelector('#admin-secret')).toBeNull();
    expect(button('Get JWT').disabled).toBe(false);
  });

  it.each(['logout', 'disconnect'])(
    'discards late responses after %s',
    async (action) => {
      let resolve!: (value: { token: string }) => void;
      mocks.exchangeToken.mockReturnValue(
        new Promise<{ token: string }>((r) => {
          resolve = r;
        }),
      );
      await exchange();
      if (action === 'logout') button('Log out').click();
      else element.remove();
      resolve({ token });
      await Promise.resolve();
      await element.updateComplete;
      if (action === 'disconnect') document.body.appendChild(element);
      await element.updateComplete;
      expect(element.querySelector('#invitation-jwt')).toBeNull();
      expect(element.textContent).not.toContain(token);
    },
  );
});
