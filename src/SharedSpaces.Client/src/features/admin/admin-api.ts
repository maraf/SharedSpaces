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

type BadRequestResponse = {
  Error?: string;
  message?: string;
};

function normalizeApiBaseUrl(apiBaseUrl: string) {
  return apiBaseUrl.replace(/\/+$/, '');
}

async function readBadRequestMessage(response: Response) {
  const error = (await response.json().catch(() => ({}))) as BadRequestResponse;
  return error.Error || error.message || 'Bad request';
}

export async function listSpaces(
  apiBaseUrl: string,
  adminSecret: string,
): Promise<SpaceResponse[]> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const response = await fetch(`${base}/v1/spaces`, {
      method: 'GET',
      headers: {
        'X-Admin-Secret': adminSecret,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AdminApiError('Invalid admin secret', 401);
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

export async function createSpace(
  apiBaseUrl: string,
  adminSecret: string,
  name: string,
): Promise<SpaceResponse> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const response = await fetch(`${base}/v1/spaces`, {
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
        throw new AdminApiError(await readBadRequestMessage(response), 400);
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
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const response = await fetch(`${base}/v1/spaces/${spaceId}/invitations`, {
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
        throw new AdminApiError(await readBadRequestMessage(response), 400);
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
