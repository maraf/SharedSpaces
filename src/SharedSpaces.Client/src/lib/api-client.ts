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
 * @param spaceId - Space GUID
 * @param pin - Invitation PIN
 * @param displayName - User's display name
 * @returns JWT token
 * @throws TokenExchangeError on failure
 */
export async function exchangeToken(
  serverUrl: string,
  spaceId: string,
  pin: string,
  displayName: string
): Promise<TokenExchangeResponse> {
  const url = `${serverUrl}/v1/spaces/${spaceId}/tokens`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pin,
        displayName,
      }),
    });

    if (!response.ok) {
      // Parse error details if available
      let errorMessage = `Token exchange failed with status ${response.status}`;
      
      if (response.status === 400) {
        errorMessage = 'Invalid request. Please check your PIN and display name.';
      } else if (response.status === 401) {
        errorMessage = 'Invalid PIN. Please check the PIN and try again.';
      } else if (response.status === 404) {
        errorMessage = 'Space not found. The invitation may be invalid or expired.';
      }

      throw new TokenExchangeError(errorMessage, response.status);
    }

    const data = await response.json();
    
    if (!data || typeof data.token !== 'string') {
      throw new TokenExchangeError('Invalid response from server');
    }

    return data;
  } catch (error) {
    if (error instanceof TokenExchangeError) {
      throw error;
    }

    // Network or other errors
    throw new TokenExchangeError(
      'Network error. Please check your connection and try again.',
      undefined,
      error
    );
  }
}
