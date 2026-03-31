/**
 * Base64url encoding/decoding and share-link URL helpers.
 *
 * Format: /shared/{base64url("token={guid}&api={serverUrl}")}
 */

export function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  else if (pad === 1) throw new Error('Invalid base64url string');
  return atob(base64);
}

export interface ShareLinkParams {
  token: string;
  api: string;
}

/**
 * Build a share-link path segment by encoding token + API URL.
 */
export function encodeShareLinkSegment(
  token: string,
  apiUrl: string,
): string {
  const payload = `token=${encodeURIComponent(token)}&api=${encodeURIComponent(apiUrl)}`;
  return base64UrlEncode(payload);
}

/**
 * Build the full share URL for a given link token and server URL.
 */
export function buildShareUrl(
  token: string,
  serverUrl: string,
): string {
  const segment = encodeShareLinkSegment(token, serverUrl);
  return `${window.location.origin}/shared/${segment}`;
}

/**
 * Decode a share-link path segment.
 *
 * Returns extracted `token` and `api` when the segment is a valid
 * base64url-encoded payload, or `null` when decoding fails.
 */
export function decodeShareLinkSegment(
  segment: string,
): ShareLinkParams | null {
  try {
    const decoded = base64UrlDecode(segment);
    const params = new URLSearchParams(decoded);
    const token = params.get('token');
    const api = params.get('api');
    if (token && api) {
      return { token, api };
    }
  } catch {
    // Not valid base64url
  }

  return null;
}
