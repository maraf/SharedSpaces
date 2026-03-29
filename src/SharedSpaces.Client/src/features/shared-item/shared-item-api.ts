/**
 * Public API for accessing shared items — no authentication required.
 */

export interface SharedItemResponse {
  contentType: 'text' | 'file';
  content: string;
  fileSize: number;
  sharedAt: string;
}

export class SharedItemApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SharedItemApiError';
    this.status = status;
  }
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, '');
}

async function throwForFailed(response: Response) {
  if (response.ok) return;

  if (response.status === 404) {
    throw new SharedItemApiError(
      'This shared link is no longer available.',
      404,
    );
  }

  let detail = response.statusText;
  try {
    const body = (await response.json()) as { Error?: string };
    if (body.Error) detail = body.Error;
  } catch {
    // ignore parse errors
  }

  throw new SharedItemApiError(`Server error: ${detail}`, response.status);
}

function wrapNetworkError(error: unknown): never {
  if (error instanceof SharedItemApiError) throw error;
  throw new SharedItemApiError(
    `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
}

export async function getSharedItem(
  apiBaseUrl: string,
  token: string,
): Promise<SharedItemResponse> {
  try {
    const base = normalizeUrl(apiBaseUrl);
    const response = await fetch(
      `${base}/v1/shared/${encodeURIComponent(token)}`,
    );
    await throwForFailed(response);
    return await response.json();
  } catch (error) {
    wrapNetworkError(error);
  }
}

export async function downloadSharedItem(
  apiBaseUrl: string,
  token: string,
): Promise<Blob> {
  try {
    const base = normalizeUrl(apiBaseUrl);
    const response = await fetch(
      `${base}/v1/shared/${encodeURIComponent(token)}/download`,
    );
    await throwForFailed(response);
    return await response.blob();
  } catch (error) {
    wrapNetworkError(error);
  }
}
