// Invitation parsing utilities

export interface InvitationData {
  serverUrl: string;
  spaceId: string;
  pin: string;
}

/**
 * Parse an invitation string in the format: serverUrl|spaceId|pin
 * @param invitation - Pipe-delimited invitation string
 * @returns Parsed invitation data or null if invalid
 */
export function parseInvitationString(invitation: string): InvitationData | null {
  if (!invitation || typeof invitation !== 'string') {
    return null;
  }

  const parts = invitation.split('|');
  if (parts.length !== 3) {
    return null;
  }

  const [rawServerUrl, rawSpaceId, rawPin] = parts;
  const serverUrl = rawServerUrl.trim();
  const spaceId = rawSpaceId.trim();
  const pin = rawPin.trim();

  // Validate server URL (must be URL-like)
  if (!serverUrl || !isValidUrl(serverUrl)) {
    return null;
  }

  // Validate space ID (must be GUID-like)
  if (!spaceId || !isValidGuid(spaceId)) {
    return null;
  }

  // Validate PIN (must be numeric)
  if (!pin || !isValidPin(pin)) {
    return null;
  }

  return { serverUrl, spaceId, pin };
}

/**
 * Parse invitation data from current URL query parameters
 * Expects ?join=serverUrl|spaceId|pin
 * @returns Parsed invitation data or null if not present or invalid
 */
export function parseInvitationFromUrl(): InvitationData | null {
  const params = new URLSearchParams(window.location.search);
  const invitation = params.get('join');
  
  if (!invitation) {
    return null;
  }

  return parseInvitationString(invitation);
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate GUID format (loose check)
 */
function isValidGuid(guid: string): boolean {
  const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return guidPattern.test(guid);
}

/**
 * Validate PIN format (numeric)
 */
function isValidPin(pin: string): boolean {
  return /^\d+$/.test(pin);
}
