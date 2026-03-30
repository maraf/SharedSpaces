/**
 * Base64url encoding/decoding and share-link URL helpers.
 *
 * New format: /shared/{base64url("token={guid}&api={serverUrl}")}
 * Legacy format: /shared/{guid}  (still supported for backward compat)
 */

export function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
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

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decode a share-link path segment.
 *
 * Returns extracted `token` and `api` when the segment is base64url-encoded.
 * Falls back to treating the segment as a legacy raw GUID token when decoding
 * fails or the segment looks like a bare GUID.
 */
export function decodeShareLinkSegment(
  segment: string,
  fallbackApiUrl: string,
): ShareLinkParams {
  // Legacy: plain GUID token
  if (GUID_RE.test(segment)) {
    return { token: segment, api: fallbackApiUrl };
  }

  try {
    const decoded = base64UrlDecode(segment);
    const params = new URLSearchParams(decoded);
    const token = params.get('token');
    const api = params.get('api');
    if (token && api) {
      return { token, api };
    }
  } catch {
    // Not valid base64 — treat as legacy token
  }

  // Fallback: treat entire segment as a raw token
  return { token: segment, api: fallbackApiUrl };
}
