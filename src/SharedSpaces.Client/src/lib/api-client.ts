// API client for token exchange

export interface TokenExchangeResponse {
  token: string;
}

export class TokenExchangeError extends Error {
  statusCode?: number;
  originalError?: unknown;

  constructor(
    message: string,
    statusCode?: number,
    originalError?: unknown
  ) {
    super(message);
    this.name = 'TokenExchangeError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

/**
 * Exchange PIN + display name for a JWT token
 * @param serverUrl - Server URL (e.g., 'http://localhost:5000')
 * @param spaceId - Space GUID (optional; omit for simplified invitations)
 * @param pin - Invitation PIN
 * @param displayName - User's display name
 * @returns JWT token
 * @throws TokenExchangeError on failure
 */
export async function exchangeToken(
  serverUrl: string,
  spaceId: string | undefined,
  pin: string,
  displayName: string
): Promise<TokenExchangeResponse> {
  const normalizedServerUrl = serverUrl.replace(/\/+$/, '');
  const url = spaceId
    ? `${normalizedServerUrl}/v1/spaces/${spaceId}/tokens`
    : `${normalizedServerUrl}/v1/tokens`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pin,
        displayName,
      }),
    });
  } catch (error) {
    throw new TokenExchangeError(
      'Network error. Please check your connection and try again.',
      undefined,
      error
    );
  }

  if (!response.ok) {
    let errorMessage = `Token exchange failed with status ${response.status}`;
    
    if (response.status === 400) {
      errorMessage = 'Invalid request. Please check your PIN and display name.';
    } else if (response.status === 401) {
      errorMessage = 'Invalid PIN. Please check the PIN and try again.';
    } else if (response.status === 404) {
      errorMessage = 'Space not found. The invitation may be invalid or expired.';
    } else if (response.status === 409) {
      errorMessage = 'Multiple spaces match this PIN. Please use the full invitation link that includes the space ID.';
    }

    throw new TokenExchangeError(errorMessage, response.status);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new TokenExchangeError('Invalid response from server', response.status, error);
  }
  
  if (!data || typeof (data as Record<string, unknown>).token !== 'string') {
    throw new TokenExchangeError('Invalid response from server');
  }

  return data as TokenExchangeResponse;
}
