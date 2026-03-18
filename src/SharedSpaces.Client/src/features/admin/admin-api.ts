export interface SpaceResponse {
  id: string;
  name: string;
  createdAt: string;
}

export interface InvitationResponse {
  invitationString: string;
  qrCodeBase64: string | null;
}

export class AdminApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

export async function createSpace(
  apiBaseUrl: string,
  adminSecret: string,
  name: string,
): Promise<SpaceResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/spaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': adminSecret,
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AdminApiError('Invalid admin secret', 401);
      }
      if (response.status === 400) {
        const error = await response.json().catch(() => ({ message: 'Bad request' }));
        throw new AdminApiError(error.message || 'Invalid space name', 400);
      }
      throw new AdminApiError(`Server error: ${response.statusText}`, response.status);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof AdminApiError) {
      throw error;
    }
    throw new AdminApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function createInvitation(
  apiBaseUrl: string,
  adminSecret: string,
  spaceId: string,
  clientAppUrl?: string,
): Promise<InvitationResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/spaces/${spaceId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': adminSecret,
      },
      body: JSON.stringify(clientAppUrl ? { clientAppUrl } : {}),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AdminApiError('Invalid admin secret', 401);
      }
      if (response.status === 404) {
        throw new AdminApiError('Space not found', 404);
      }
      if (response.status === 400) {
        const error = await response.json().catch(() => ({ message: 'Bad request' }));
        throw new AdminApiError(error.message || 'Invalid request', 400);
      }
      throw new AdminApiError(`Server error: ${response.statusText}`, response.status);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof AdminApiError) {
      throw error;
    }
    throw new AdminApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
