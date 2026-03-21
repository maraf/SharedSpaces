export interface SpaceResponse {
  id: string;
  name: string;
  createdAt: string;
  maxUploadSize: number | null;
  effectiveMaxUploadSize: number;
}

export interface InvitationResponse {
  invitationString: string;
  qrCodeBase64: string | null;
}

export interface MemberResponse {
  id: string;
  displayName: string;
  joinedAt: string;
  isRevoked: boolean;
}

export interface InvitationListResponse {
  id: string;
  spaceId: string;
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

type RequestErrorOptions = {
  notFoundMessage?: string;
  includeBadRequestMessage?: boolean;
};

function normalizeApiBaseUrl(apiBaseUrl: string) {
  return apiBaseUrl.replace(/\/+$/, '');
}

function createAdminHeaders(adminSecret: string, includeJson = false): HeadersInit {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    'X-Admin-Secret': adminSecret,
  };
}

async function readBadRequestMessage(response: Response) {
  const error = (await response.json().catch(() => ({}))) as BadRequestResponse;
  return error.Error || error.message || 'Bad request';
}

async function throwForFailedResponse(
  response: Response,
  options: RequestErrorOptions = {},
) {
  if (response.ok) {
    return;
  }

  if (response.status === 401) {
    throw new AdminApiError('Invalid admin secret', 401);
  }

  if (response.status === 400 && options.includeBadRequestMessage) {
    throw new AdminApiError(await readBadRequestMessage(response), 400);
  }

  if (response.status === 404 && options.notFoundMessage) {
    throw new AdminApiError(options.notFoundMessage, 404);
  }

  throw new AdminApiError(`Server error: ${response.statusText}`, response.status);
}

function wrapNetworkError(error: unknown): never {
  if (error instanceof AdminApiError) {
    throw error;
  }

  throw new AdminApiError(
    `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
}

export async function listSpaces(
  apiBaseUrl: string,
  adminSecret: string,
): Promise<SpaceResponse[]> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const response = await fetch(`${base}/v1/spaces`, {
      method: 'GET',
      headers: createAdminHeaders(adminSecret),
    });

    await throwForFailedResponse(response);
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function createSpace(
  apiBaseUrl: string,
  adminSecret: string,
  name: string,
  maxUploadSize?: number | null,
): Promise<SpaceResponse> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const response = await fetch(`${base}/v1/spaces`, {
      method: 'POST',
      headers: createAdminHeaders(adminSecret, true),
      body: JSON.stringify({
        name,
        ...(maxUploadSize != null ? { maxUploadSize } : {}),
      }),
    });

    await throwForFailedResponse(response, { includeBadRequestMessage: true });
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
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
    const encodedSpaceId = encodeURIComponent(spaceId);
    const response = await fetch(`${base}/v1/spaces/${encodedSpaceId}/invitations`, {
      method: 'POST',
      headers: createAdminHeaders(adminSecret, true),
      body: JSON.stringify(clientAppUrl ? { clientAppUrl } : {}),
    });

    await throwForFailedResponse(response, {
      includeBadRequestMessage: true,
      notFoundMessage: 'Space not found',
    });

    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function listMembers(
  apiBaseUrl: string,
  adminSecret: string,
  spaceId: string,
): Promise<MemberResponse[]> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const encodedSpaceId = encodeURIComponent(spaceId);
    const response = await fetch(`${base}/v1/spaces/${encodedSpaceId}/members`, {
      method: 'GET',
      headers: createAdminHeaders(adminSecret),
    });

    await throwForFailedResponse(response, { notFoundMessage: 'Space not found' });
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function revokeMember(
  apiBaseUrl: string,
  adminSecret: string,
  spaceId: string,
  memberId: string,
): Promise<void> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const encodedSpaceId = encodeURIComponent(spaceId);
    const encodedMemberId = encodeURIComponent(memberId);
    const response = await fetch(
      `${base}/v1/spaces/${encodedSpaceId}/members/${encodedMemberId}/revoke`,
      {
        method: 'POST',
        headers: createAdminHeaders(adminSecret),
      },
    );

    await throwForFailedResponse(response, { notFoundMessage: 'Member not found' });
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function listInvitations(
  apiBaseUrl: string,
  adminSecret: string,
  spaceId: string,
): Promise<InvitationListResponse[]> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const encodedSpaceId = encodeURIComponent(spaceId);
    const response = await fetch(`${base}/v1/spaces/${encodedSpaceId}/invitations`, {
      method: 'GET',
      headers: createAdminHeaders(adminSecret),
    });

    await throwForFailedResponse(response, { notFoundMessage: 'Space not found' });
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function removeMember(
  apiBaseUrl: string,
  adminSecret: string,
  spaceId: string,
  memberId: string,
): Promise<void> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const encodedSpaceId = encodeURIComponent(spaceId);
    const encodedMemberId = encodeURIComponent(memberId);
    const response = await fetch(
      `${base}/v1/spaces/${encodedSpaceId}/members/${encodedMemberId}`,
      {
        method: 'DELETE',
        headers: createAdminHeaders(adminSecret),
      },
    );

    await throwForFailedResponse(response, { notFoundMessage: 'Member not found' });
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function deleteInvitation(
  apiBaseUrl: string,
  adminSecret: string,
  spaceId: string,
  invitationId: string,
): Promise<void> {
  try {
    const base = normalizeApiBaseUrl(apiBaseUrl);
    const encodedSpaceId = encodeURIComponent(spaceId);
    const encodedInvitationId = encodeURIComponent(invitationId);
    const response = await fetch(
      `${base}/v1/spaces/${encodedSpaceId}/invitations/${encodedInvitationId}`,
      {
        method: 'DELETE',
        headers: createAdminHeaders(adminSecret),
      },
    );

    await throwForFailedResponse(response, { notFoundMessage: 'Invitation not found' });
  } catch (error) {
    wrapNetworkError(error);
  }
}
