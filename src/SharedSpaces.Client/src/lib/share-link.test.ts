import { describe, expect, it } from 'vitest';
import {
  base64UrlEncode,
  base64UrlDecode,
  encodeShareLinkSegment,
  decodeShareLinkSegment,
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
});
