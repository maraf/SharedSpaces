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
});

describe('encodeShareLinkSegment / decodeShareLinkSegment', () => {
  const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const apiUrl = 'https://my-server.example.com';
  const fallback = 'https://fallback.example.com';

  it('round-trips token and api', () => {
    const segment = encodeShareLinkSegment(token, apiUrl);
    const result = decodeShareLinkSegment(segment, fallback);
    expect(result.token).toBe(token);
    expect(result.api).toBe(apiUrl);
  });

  it('handles API URLs with paths and ports', () => {
    const complexUrl = 'https://host:8443/api/v2';
    const segment = encodeShareLinkSegment(token, complexUrl);
    const result = decodeShareLinkSegment(segment, fallback);
    expect(result.api).toBe(complexUrl);
    expect(result.token).toBe(token);
  });
});

describe('decodeShareLinkSegment – backward compatibility', () => {
  const fallback = 'https://fallback.example.com';

  it('treats a bare GUID as legacy token', () => {
    const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const result = decodeShareLinkSegment(guid, fallback);
    expect(result.token).toBe(guid);
    expect(result.api).toBe(fallback);
  });

  it('treats an uppercase GUID as legacy token', () => {
    const guid = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
    const result = decodeShareLinkSegment(guid, fallback);
    expect(result.token).toBe(guid);
    expect(result.api).toBe(fallback);
  });

  it('falls back for non-base64 junk', () => {
    const junk = '!!!not-base64!!!';
    const result = decodeShareLinkSegment(junk, fallback);
    expect(result.token).toBe(junk);
    expect(result.api).toBe(fallback);
  });

  it('falls back when base64 decodes but has no token param', () => {
    const noToken = base64UrlEncode('api=http://example.com');
    const result = decodeShareLinkSegment(noToken, fallback);
    expect(result.token).toBe(noToken);
    expect(result.api).toBe(fallback);
  });

  it('falls back when base64 decodes but has no api param', () => {
    const noApi = base64UrlEncode('token=my-token');
    const result = decodeShareLinkSegment(noApi, fallback);
    expect(result.token).toBe(noApi);
    expect(result.api).toBe(fallback);
  });

  it('falls back on empty string', () => {
    const result = decodeShareLinkSegment('', fallback);
    expect(result.token).toBe('');
    expect(result.api).toBe(fallback);
  });

  it('uses the decoded API URL, not the fallback', () => {
    const token = 'my-token';
    const customApi = 'https://custom-server.example.com:9090';
    const segment = encodeShareLinkSegment(token, customApi);
    const result = decodeShareLinkSegment(segment, fallback);
    expect(result.api).toBe(customApi);
    expect(result.api).not.toBe(fallback);
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
    const result = decodeShareLinkSegment(segment, 'https://unused.com');
    expect(result.token).toBe(token);
    expect(result.api).toBe(serverUrl);
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
    const result = decodeShareLinkSegment(restoredSegment, 'https://fallback.com');
    expect(result.token).toBe(token);
    expect(result.api).toBe(api);
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
