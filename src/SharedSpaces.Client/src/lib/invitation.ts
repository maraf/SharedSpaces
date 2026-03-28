// Invitation parsing utilities

export interface InvitationData {
  serverUrl: string;
  spaceId?: string;
  pin: string;
}

/**
 * Parse an invitation string in one of two formats:
 * - New (2-part): serverUrl|pin
 * - Legacy (3-part): serverUrl|spaceId|pin
 *
 * Discrimination: 3 parts where parts[1] is a GUID → legacy.
 * 2 parts where parts[1] is a numeric PIN → new format.
 *
 * @param invitation - Pipe-delimited invitation string
 * @returns Parsed invitation data or null if invalid
 */
export function parseInvitationString(invitation: string): InvitationData | null {
  if (!invitation || typeof invitation !== 'string') {
    return null;
  }

  const parts = invitation.split('|');

  if (parts.length === 3) {
    return parseLegacyInvitation(parts);
  }

  if (parts.length === 2) {
    return parseSimplifiedInvitation(parts);
  }

  return null;
}

/**
 * Parse legacy 3-part format: serverUrl|spaceId|pin
 */
function parseLegacyInvitation(parts: string[]): InvitationData | null {
  const serverUrl = parts[0].trim();
  const spaceId = parts[1].trim();
  const pin = parts[2].trim();

  if (!serverUrl || !isValidUrl(serverUrl)) {
    return null;
  }

  if (!spaceId || !isValidGuid(spaceId)) {
    return null;
  }

  if (!pin || !isValidPin(pin)) {
    return null;
  }

  return { serverUrl, spaceId, pin };
}

/**
 * Parse simplified 2-part format: serverUrl|pin
 */
function parseSimplifiedInvitation(parts: string[]): InvitationData | null {
  const serverUrl = parts[0].trim();
  const pin = parts[1].trim();

  if (!serverUrl || !isValidUrl(serverUrl)) {
    return null;
  }

  if (!pin || !isValidPin(pin)) {
    return null;
  }

  return { serverUrl, pin };
}

/**
 * Parse invitation data from current URL query parameters
 * Expects ?join=serverUrl|pin or ?join=serverUrl|spaceId|pin
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
 * Validate PIN format (exactly 6 digits, matching server's ^\d{6}$ pattern)
 */
function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}
