import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  base64UrlEncode,
  base64UrlDecode,
  encodeShareLinkSegment,
  decodeShareLinkSegment,
  buildShareUrl,
} from './share-link';

describe('base64UrlEncode / base64UrlDecode', () => {
  it('round-trips a plain string', () => {
    const input = 'hello world';
    expect(base64UrlDecode(base64UrlEncode(input))).toBe(input);
  });

  it('produces URL-safe output (no +, /, =)', () => {
    // Use a string that would produce +, / or = in standard base64
    const input = 'subjects?_d/+test==';
    const encoded = base64UrlEncode(input);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(encoded)).toBe(input);
  });

  it('restores padding for lengths not divisible by 4', () => {
    // 1 byte → 2 base64url chars (needs ==)
    expect(base64UrlDecode(base64UrlEncode('a'))).toBe('a');
    // 2 bytes → 3 base64url chars (needs =)
    expect(base64UrlDecode(base64UrlEncode('ab'))).toBe('ab');
    // 3 bytes → 4 base64url chars (no padding)
    expect(base64UrlDecode(base64UrlEncode('abc'))).toBe('abc');
  });

  it('throws on invalid base64url (length % 4 === 1)', () => {
    expect(() => base64UrlDecode('A')).toThrow('Invalid base64url string');
  });
});

describe('encodeShareLinkSegment / decodeShareLinkSegment', () => {
  const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const apiUrl = 'https://my-server.example.com';

  it('round-trips token and api', () => {
    const segment = encodeShareLinkSegment(token, apiUrl);
    const result = decodeShareLinkSegment(segment);
    expect(result).not.toBeNull();
    expect(result!.token).toBe(token);
    expect(result!.api).toBe(apiUrl);
  });

  it('handles API URLs with paths and ports', () => {
    const complexUrl = 'https://host:8443/api/v2';
    const segment = encodeShareLinkSegment(token, complexUrl);
    const result = decodeShareLinkSegment(segment);
    expect(result).not.toBeNull();
    expect(result!.api).toBe(complexUrl);
    expect(result!.token).toBe(token);
  });
});

describe('decodeShareLinkSegment – invalid input', () => {
  it('returns null for a bare GUID', () => {
    const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(decodeShareLinkSegment(guid)).toBeNull();
  });

  it('returns null for non-base64 junk', () => {
    expect(decodeShareLinkSegment('!!!not-base64!!!')).toBeNull();
  });

  it('returns null when base64 decodes but has no token param', () => {
    const noToken = base64UrlEncode('api=http://example.com');
    expect(decodeShareLinkSegment(noToken)).toBeNull();
  });

  it('returns null when base64 decodes but has no api param', () => {
    const noApi = base64UrlEncode('token=my-token');
    expect(decodeShareLinkSegment(noApi)).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(decodeShareLinkSegment('')).toBeNull();
  });
});

describe('buildShareUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://app.sharedspaces.io' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a URL under /shared/ with a base64url segment', () => {
    const url = buildShareUrl(
      '550e8400-e29b-41d4-a716-446655440000',
      'https://api.sharedspaces.io',
    );
    expect(url).toMatch(
      /^https:\/\/app\.sharedspaces\.io\/shared\/[A-Za-z0-9_-]+$/,
    );
  });

  it('produces a URL that round-trips through decodeShareLinkSegment', () => {
    const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const serverUrl = 'https://api.sharedspaces.io';
    const url = buildShareUrl(token, serverUrl);
    const segment = url.split('/shared/')[1];
    const result = decodeShareLinkSegment(segment);
    expect(result).not.toBeNull();
    expect(result!.token).toBe(token);
    expect(result!.api).toBe(serverUrl);
  });
});

// ────────────────────────────────────────────────
// GitHub Pages SPA redirect contract
//
// 404.html encodes the path into ?ghpath=...&ghsearch=...&ghhash=...
// index.html reads these params and calls history.replaceState to restore the URL.
// These tests verify the contract between those two scripts.
// ────────────────────────────────────────────────

describe('GitHub Pages SPA redirect contract', () => {
  it('preserves /shared/{base64url-segment} through the redirect round-trip', () => {
    const token = '550e8400-e29b-41d4-a716-446655440000';
    const api = 'http://localhost:5000';
    const segment = encodeShareLinkSegment(token, api);
    const originalPath = `/shared/${segment}`;

    // 404.html encodes → index.html decodes
    const redirectUrl =
      '/index.html?ghpath=' + encodeURIComponent(originalPath);
    const params = new URLSearchParams(redirectUrl.split('?')[1]);
    const restoredPath = params.get('ghpath')!;

    expect(restoredPath).toBe(originalPath);

    // After replaceState, app-shell parses the restored segment
    const restoredSegment = restoredPath.match(/^\/shared\/([^/]+)$/)![1];
    const result = decodeShareLinkSegment(restoredSegment);
    expect(result).not.toBeNull();
    expect(result!.token).toBe(token);
    expect(result!.api).toBe(api);
  });

  it('handles search and hash through the redirect', () => {
    const path = '/shared/some-segment';
    const search = '?foo=bar';
    const hash = '#section';

    // 404.html encoding
    const redirectUrl =
      '/index.html?ghpath=' +
      encodeURIComponent(path) +
      '&ghsearch=' +
      encodeURIComponent(search) +
      '&ghhash=' +
      encodeURIComponent(hash);

    // index.html decoding
    const params = new URLSearchParams(redirectUrl.split('?')[1]);
    const restored =
      (params.get('ghpath') || '') +
      (params.get('ghsearch') || '') +
      (params.get('ghhash') || '');

    expect(restored).toBe('/shared/some-segment?foo=bar#section');
  });

  it('works with no search or hash', () => {
    const path = '/shared/some-token';
    const redirectUrl = '/index.html?ghpath=' + encodeURIComponent(path);
    const params = new URLSearchParams(redirectUrl.split('?')[1]);
    const restored =
      (params.get('ghpath') || '') +
      (params.get('ghsearch') || '') +
      (params.get('ghhash') || '');
    expect(restored).toBe(path);
  });
});
