import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the component
const mockExchangeToken = vi.fn();
vi.mock('../../lib/api-client', () => ({
  exchangeToken: (...args: unknown[]) => mockExchangeToken(...args),
  TokenExchangeError: class TokenExchangeError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.name = 'TokenExchangeError';
      this.statusCode = statusCode;
    }
  },
}));

const mockParseInvitationString = vi.fn();
const mockParseInvitationFromUrl = vi.fn();
vi.mock('../../lib/invitation', () => ({
  parseInvitationString: (...args: unknown[]) => mockParseInvitationString(...args),
  parseInvitationFromUrl: (...args: unknown[]) => mockParseInvitationFromUrl(...args),
}));

const mockGetPrimaryDisplayName = vi.fn().mockReturnValue('');
const mockSetPrimaryDisplayName = vi.fn();
const mockSetToken = vi.fn();
vi.mock('../../lib/token-storage', () => ({
  getPrimaryDisplayName: () => mockGetPrimaryDisplayName(),
  setPrimaryDisplayName: (...args: unknown[]) => mockSetPrimaryDisplayName(...args),
  setToken: (...args: unknown[]) => mockSetToken(...args),
}));

vi.mock('jwt-decode', () => ({
  jwtDecode: () => ({
    sub: 'member-1',
    display_name: 'Alice',
    server_url: 'http://localhost:5000',
    space_id: 'space-1',
    space_name: 'Test Space',
  }),
}));

import './join-view';
import { JoinView } from './join-view';

describe('join-view', () => {
  let element: JoinView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParseInvitationFromUrl.mockReturnValue(null);
    mockGetPrimaryDisplayName.mockReturnValue('');

    element = document.createElement('join-view') as JoinView;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  describe('initialization', () => {
    it('starts in paste entry mode', async () => {
      await element.updateComplete;
      expect((element as any).entryMode).toBe('paste');
    });

    it('pre-fills display name from localStorage', async () => {
      element.remove();
      mockGetPrimaryDisplayName.mockReturnValue('Saved Name');

      element = document.createElement('join-view') as JoinView;
      document.body.appendChild(element);
      await element.updateComplete;

      expect((element as any).displayName).toBe('Saved Name');
    });

    it('parses invitation from URL on connect', async () => {
      element.remove();
      mockParseInvitationFromUrl.mockReturnValue({
        serverUrl: 'http://example.com',
        pin: '123456',
      });

      element = document.createElement('join-view') as JoinView;
      document.body.appendChild(element);
      await element.updateComplete;

      expect((element as any).serverUrl).toBe('http://example.com');
      expect((element as any).pin).toBe('123456');
      expect((element as any).invitationString).toBe('http://example.com|123456');
    });

    it('builds 3-part invitation string for legacy URL invitations', async () => {
      element.remove();
      mockParseInvitationFromUrl.mockReturnValue({
        serverUrl: 'http://example.com',
        spaceId: '550e8400-e29b-41d4-a716-446655440000',
        pin: '123456',
      });

      element = document.createElement('join-view') as JoinView;
      document.body.appendChild(element);
      await element.updateComplete;

      expect((element as any).invitationString).toBe(
        'http://example.com|550e8400-e29b-41d4-a716-446655440000|123456'
      );
    });
  });

  describe('invitation paste mode', () => {
    it('auto-parses a valid invitation string', async () => {
      await element.updateComplete;

      mockParseInvitationString.mockReturnValue({
        serverUrl: 'http://example.com',
        pin: '654321',
      });

      (element as any).handleInvitationPaste({
        target: { value: 'http://example.com|654321' },
      });
      await element.updateComplete;

      expect((element as any).serverUrl).toBe('http://example.com');
      expect((element as any).pin).toBe('654321');
    });

    it('clears fields when invitation string is invalid', async () => {
      await element.updateComplete;

      // First set valid state
      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';

      mockParseInvitationString.mockReturnValue(null);
      (element as any).handleInvitationPaste({
        target: { value: 'garbage' },
      });
      await element.updateComplete;

      expect((element as any).serverUrl).toBe('');
      expect((element as any).pin).toBe('');
    });

    it('clears error message on input', async () => {
      await element.updateComplete;
      (element as any).errorMessage = 'Previous error';

      mockParseInvitationString.mockReturnValue(null);
      (element as any).handleInvitationPaste({
        target: { value: 'test' },
      });

      expect((element as any).errorMessage).toBe('');
    });
  });

  describe('manual entry mode', () => {
    it('toggles between paste and manual modes', async () => {
      await element.updateComplete;

      expect((element as any).entryMode).toBe('paste');
      (element as any).toggleEntryMode();
      expect((element as any).entryMode).toBe('manual');
      (element as any).toggleEntryMode();
      expect((element as any).entryMode).toBe('paste');
    });

    it('updates serverUrl on input', async () => {
      await element.updateComplete;

      (element as any).handleServerUrlInput({
        target: { value: 'http://new-server.com' },
      });

      expect((element as any).serverUrl).toBe('http://new-server.com');
    });

    it('updates pin on input', async () => {
      await element.updateComplete;

      (element as any).handlePinInput({
        target: { value: '999999' },
      });

      expect((element as any).pin).toBe('999999');
    });

    it('has no spaceId state property', async () => {
      await element.updateComplete;

      // spaceId was removed — the manual form only has serverUrl and pin
      expect((element as any).spaceId).toBeUndefined();
    });
  });

  describe('display name', () => {
    it('updates displayName on input', async () => {
      await element.updateComplete;

      (element as any).handleDisplayNameInput({
        target: { value: 'Bob' },
      });

      expect((element as any).displayName).toBe('Bob');
    });
  });

  describe('validation', () => {
    it('requires server URL', async () => {
      await element.updateComplete;

      (element as any).serverUrl = '';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';

      await (element as any).handleJoin();

      expect((element as any).errorMessage).toBe('Please provide server URL and PIN.');
      expect(mockExchangeToken).not.toHaveBeenCalled();
    });

    it('requires PIN', async () => {
      await element.updateComplete;

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '';
      (element as any).displayName = 'Alice';

      await (element as any).handleJoin();

      expect((element as any).errorMessage).toBe('Please provide server URL and PIN.');
      expect(mockExchangeToken).not.toHaveBeenCalled();
    });

    it('requires display name', async () => {
      await element.updateComplete;

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = '   ';

      await (element as any).handleJoin();

      expect((element as any).errorMessage).toBe('Please enter a display name.');
      expect(mockExchangeToken).not.toHaveBeenCalled();
    });
  });

  describe('handleJoin', () => {
    it('calls exchangeToken with serverUrl, pin, and displayName (no spaceId)', async () => {
      await element.updateComplete;

      mockExchangeToken.mockResolvedValue({ token: 'jwt-token' });

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';

      await (element as any).handleJoin();

      expect(mockExchangeToken).toHaveBeenCalledWith(
        'http://example.com',
        '123456',
        'Alice'
      );
    });

    it('stores token and display name on success', async () => {
      await element.updateComplete;

      mockExchangeToken.mockResolvedValue({ token: 'jwt-token' });

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';

      await (element as any).handleJoin();

      expect(mockSetToken).toHaveBeenCalledWith(
        'http://localhost:5000',
        'space-1',
        'jwt-token'
      );
      expect(mockSetPrimaryDisplayName).toHaveBeenCalledWith('Alice');
    });

    it('dispatches view-change event on success', async () => {
      await element.updateComplete;

      mockExchangeToken.mockResolvedValue({ token: 'jwt-token' });

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';

      const eventPromise = new Promise<CustomEvent>((resolve) => {
        element.addEventListener('view-change', (e) => resolve(e as CustomEvent));
      });

      await (element as any).handleJoin();
      const event = await eventPromise;

      expect(event.detail).toEqual({
        view: 'space',
        spaceId: 'space-1',
        serverUrl: 'http://localhost:5000',
        token: 'jwt-token',
        displayName: 'Alice',
        spaceName: 'Test Space',
      });
    });

    it('shows error message on TokenExchangeError', async () => {
      await element.updateComplete;

      const { TokenExchangeError } = await import('../../lib/api-client');
      mockExchangeToken.mockRejectedValue(new TokenExchangeError('Invalid PIN'));

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '000000';
      (element as any).displayName = 'Alice';

      await (element as any).handleJoin();

      expect((element as any).errorMessage).toBe('Invalid PIN');
    });

    it('shows generic error on unexpected failure', async () => {
      await element.updateComplete;

      mockExchangeToken.mockRejectedValue(new Error('kaboom'));

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';

      await (element as any).handleJoin();

      expect((element as any).errorMessage).toBe(
        'An unexpected error occurred. Please try again.'
      );
    });

    it('sets isLoading during request', async () => {
      await element.updateComplete;

      let resolveToken: (value: { token: string }) => void;
      mockExchangeToken.mockReturnValue(
        new Promise((resolve) => { resolveToken = resolve; })
      );

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';

      const joinPromise = (element as any).handleJoin();
      expect((element as any).isLoading).toBe(true);

      resolveToken!({ token: 'jwt-token' });
      await joinPromise;
      expect((element as any).isLoading).toBe(false);
    });

    it('resets isLoading on failure', async () => {
      await element.updateComplete;

      mockExchangeToken.mockRejectedValue(new Error('fail'));

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';

      await (element as any).handleJoin();
      expect((element as any).isLoading).toBe(false);
    });
  });

  describe('form submission', () => {
    it('submits when Enter is pressed in an input', async () => {
      await element.updateComplete;

      mockExchangeToken.mockResolvedValue({ token: 'jwt-token' });

      (element as any).serverUrl = 'http://example.com';
      (element as any).pin = '123456';
      (element as any).displayName = 'Alice';
      await element.updateComplete;

      const form = element.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      // Wait for async handleJoin to complete
      await element.updateComplete;
      await new Promise((r) => setTimeout(r, 0));

      expect(mockExchangeToken).toHaveBeenCalledWith(
        'http://example.com',
        '123456',
        'Alice'
      );
    });

    it('prevents default form submission (no page reload)', async () => {
      await element.updateComplete;

      const form = element.querySelector('form')!;
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('renders a form element wrapping the inputs', async () => {
      await element.updateComplete;

      const form = element.querySelector('form');
      expect(form).toBeTruthy();
      expect(form!.querySelector('#invitation')).toBeTruthy();
      expect(form!.querySelector('#displayName')).toBeTruthy();
    });
  });

  describe('render', () => {
    it('renders invitation input in paste mode', async () => {
      await element.updateComplete;

      const input = element.querySelector('#invitation') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.placeholder).toBe('https://server.com|123456');
    });

    it('renders serverUrl and pin inputs in manual mode', async () => {
      (element as any).entryMode = 'manual';
      await element.updateComplete;

      expect(element.querySelector('#serverUrl')).toBeTruthy();
      expect(element.querySelector('#pin')).toBeTruthy();
    });

    it('does not render spaceId input in manual mode', async () => {
      (element as any).entryMode = 'manual';
      await element.updateComplete;

      expect(element.querySelector('#spaceId')).toBeNull();
    });

    it('renders display name input', async () => {
      await element.updateComplete;
      expect(element.querySelector('#displayName')).toBeTruthy();
    });

    it('shows error message when set', async () => {
      (element as any).errorMessage = 'Something went wrong';
      await element.updateComplete;

      const errorEl = element.querySelector('.text-red-400');
      expect(errorEl).toBeTruthy();
      expect(errorEl!.textContent).toContain('Something went wrong');
    });

    it('shows loading state on join button', async () => {
      (element as any).isLoading = true;
      await element.updateComplete;

      const button = element.querySelector('button[class*="bg-sky-400"]');
      expect(button).toBeTruthy();
      expect(button!.textContent).toContain('Joining...');
    });
  });
});
