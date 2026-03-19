export interface SpaceDetailsResponse {
  id: string;
  name: string;
  createdAt: string;
}

export interface SpaceItemResponse {
  id: string;
  spaceId: string;
  memberId: string;
  contentType: 'text' | 'file';
  content: string;
  fileSize: number;
  sharedAt: string;
}

export class SpaceApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SpaceApiError';
    this.status = status;
  }
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, '');
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function throwForFailed(response: Response) {
  if (response.ok) return;

  if (response.status === 401) {
    throw new SpaceApiError(
      'Authentication failed. Please rejoin the space.',
      401,
    );
  }

  if (response.status === 403) {
    throw new SpaceApiError(
      'Access denied. Your membership may have been revoked.',
      403,
    );
  }

  if (response.status === 404) {
    throw new SpaceApiError('Space or item not found.', 404);
  }

  if (response.status === 413) {
    throw new SpaceApiError(
      'Space storage quota exceeded. Remove some items and try again.',
      413,
    );
  }

  let detail = response.statusText;
  try {
    const body = (await response.json()) as { Error?: string };
    if (body.Error) detail = body.Error;
  } catch {
    // ignore parse errors
  }

  throw new SpaceApiError(`Server error: ${detail}`, response.status);
}

function wrapNetworkError(error: unknown): never {
  if (error instanceof SpaceApiError) throw error;
  throw new SpaceApiError(
    `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
}

export async function getSpaceInfo(
  serverUrl: string,
  spaceId: string,
  token: string,
): Promise<SpaceDetailsResponse> {
  try {
    const base = normalizeUrl(serverUrl);
    const response = await fetch(
      `${base}/v1/spaces/${encodeURIComponent(spaceId)}`,
      { headers: authHeaders(token) },
    );
    await throwForFailed(response);
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function getItems(
  serverUrl: string,
  spaceId: string,
  token: string,
): Promise<SpaceItemResponse[]> {
  try {
    const base = normalizeUrl(serverUrl);
    const response = await fetch(
      `${base}/v1/spaces/${encodeURIComponent(spaceId)}/items`,
      { headers: authHeaders(token) },
    );
    await throwForFailed(response);
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function shareText(
  serverUrl: string,
  spaceId: string,
  itemId: string,
  text: string,
  token: string,
): Promise<SpaceItemResponse> {
  try {
    const base = normalizeUrl(serverUrl);
    const form = new FormData();
    form.append('id', itemId);
    form.append('contentType', 'text');
    form.append('content', text);

    const response = await fetch(
      `${base}/v1/spaces/${encodeURIComponent(spaceId)}/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PUT',
        headers: authHeaders(token),
        body: form,
      },
    );
    await throwForFailed(response);
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function shareFile(
  serverUrl: string,
  spaceId: string,
  itemId: string,
  file: File,
  token: string,
): Promise<SpaceItemResponse> {
  try {
    const base = normalizeUrl(serverUrl);
    const form = new FormData();
    form.append('id', itemId);
    form.append('contentType', 'file');
    form.append('file', file);

    const response = await fetch(
      `${base}/v1/spaces/${encodeURIComponent(spaceId)}/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PUT',
        headers: authHeaders(token),
        body: form,
      },
    );
    await throwForFailed(response);
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}
