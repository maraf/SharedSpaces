import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSpaceInfo,
  getItems,
  shareText,
  shareFile,
  transferItem,
  SpaceApiError,
} from './space-api';

function mockFetch(response: Partial<Response>) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    ...response,
  });
}

function mockFetchReject(error: Error) {
  globalThis.fetch = vi.fn().mockRejectedValue(error);
}

const SERVER = 'http://localhost:5000';
const SPACE = '550e8400-e29b-41d4-a716-446655440000';
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test';
const ITEM_ID = '660e8400-e29b-41d4-a716-446655440001';

describe('space-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- getSpaceInfo ---

  describe('getSpaceInfo', () => {
    it('returns space details on success', async () => {
      const data = { id: SPACE, name: 'Test', createdAt: '2024-01-01T00:00:00Z' };
      mockFetch({ json: async () => data });

      const result = await getSpaceInfo(SERVER, SPACE, TOKEN);

      expect(result).toEqual(data);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${SERVER}/v1/spaces/${SPACE}`,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${TOKEN}` },
        }),
      );
    });

    it('strips trailing slash from server URL', async () => {
      mockFetch({ json: async () => ({}) });
      await getSpaceInfo(`${SERVER}/`, SPACE, TOKEN);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${SERVER}/v1/spaces/${SPACE}`,
        expect.anything(),
      );
    });

    it('throws SpaceApiError on 401', async () => {
      mockFetch({ ok: false, status: 401 });
      await expect(getSpaceInfo(SERVER, SPACE, TOKEN)).rejects.toThrow(SpaceApiError);
      await expect(getSpaceInfo(SERVER, SPACE, TOKEN)).rejects.toThrow(
        /Authentication failed/,
      );
    });

    it('throws SpaceApiError on 404', async () => {
      mockFetch({ ok: false, status: 404 });
      await expect(getSpaceInfo(SERVER, SPACE, TOKEN)).rejects.toThrow(
        /not found/,
      );
    });

    it('throws on network error', async () => {
      mockFetchReject(new TypeError('Failed to fetch'));
      const err = await getSpaceInfo(SERVER, SPACE, TOKEN).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SpaceApiError);
      expect((err as SpaceApiError).message).toMatch(/Network error/);
    });
  });

  // --- getItems ---

  describe('getItems', () => {
    it('returns items array', async () => {
      const items = [
        {
          id: ITEM_ID,
          spaceId: SPACE,
          memberId: '00000000-0000-0000-0000-000000000001',
          contentType: 'text',
          content: 'Hello',
          fileSize: 0,
          sharedAt: '2024-01-01T00:00:00Z',
        },
      ];
      mockFetch({ json: async () => items });

      const result = await getItems(SERVER, SPACE, TOKEN);

      expect(result).toEqual(items);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${SERVER}/v1/spaces/${SPACE}/items`,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${TOKEN}` },
        }),
      );
    });

    it('throws SpaceApiError on 403', async () => {
      mockFetch({ ok: false, status: 403 });
      await expect(getItems(SERVER, SPACE, TOKEN)).rejects.toThrow(/Access denied/);
    });
  });

  // --- shareText ---

  describe('shareText', () => {
    it('sends multipart/form-data with text fields', async () => {
      const item = {
        id: ITEM_ID,
        spaceId: SPACE,
        memberId: '00000000-0000-0000-0000-000000000001',
        contentType: 'text',
        content: 'Hello world',
        fileSize: 0,
        sharedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch({ status: 201, json: async () => item });

      const result = await shareText(SERVER, SPACE, ITEM_ID, 'Hello world', TOKEN);

      expect(result).toEqual(item);
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(`${SERVER}/v1/spaces/${SPACE}/items/${ITEM_ID}`);
      expect(call[1].method).toBe('PUT');

      const body = call[1].body as FormData;
      expect(body.get('id')).toBe(ITEM_ID);
      expect(body.get('contentType')).toBe('text');
      expect(body.get('content')).toBe('Hello world');
    });

    it('throws SpaceApiError on 413 quota exceeded', async () => {
      mockFetch({
        ok: false,
        status: 413,
        json: async () => ({ Error: 'Space storage quota exceeded' }),
      });
      await expect(
        shareText(SERVER, SPACE, ITEM_ID, 'text', TOKEN),
      ).rejects.toThrow(/quota exceeded/i);
    });

    it('throws on server error with detail', async () => {
      mockFetch({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ Error: 'Database error' }),
      });
      const err = await shareText(SERVER, SPACE, ITEM_ID, 'text', TOKEN).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SpaceApiError);
      expect((err as SpaceApiError).message).toMatch(/Database error/);
      expect((err as SpaceApiError).status).toBe(500);
    });
  });

  // --- shareFile ---

  describe('shareFile', () => {
    it('sends multipart/form-data with file', async () => {
      const item = {
        id: ITEM_ID,
        spaceId: SPACE,
        memberId: '00000000-0000-0000-0000-000000000001',
        contentType: 'file',
        content: 'photo.png',
        fileSize: 12345,
        sharedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch({ status: 201, json: async () => item });

      const file = new File(['binary'], 'photo.png', { type: 'image/png' });
      const result = await shareFile(SERVER, SPACE, ITEM_ID, file, TOKEN);

      expect(result).toEqual(item);
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(`${SERVER}/v1/spaces/${SPACE}/items/${ITEM_ID}`);
      expect(call[1].method).toBe('PUT');

      const body = call[1].body as FormData;
      expect(body.get('id')).toBe(ITEM_ID);
      expect(body.get('contentType')).toBe('file');
      expect(body.get('file')).toBeInstanceOf(File);
    });

    it('throws SpaceApiError on 413', async () => {
      mockFetch({ ok: false, status: 413 });
      const file = new File(['x'], 'big.zip');
      await expect(
        shareFile(SERVER, SPACE, ITEM_ID, file, TOKEN),
      ).rejects.toThrow(/quota exceeded/i);
    });

    it('throws on network error', async () => {
      mockFetchReject(new TypeError('Failed to fetch'));
      const file = new File(['x'], 'test.txt');
      const err = await shareFile(SERVER, SPACE, ITEM_ID, file, TOKEN).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SpaceApiError);
      expect((err as SpaceApiError).message).toMatch(/Network error/);
    });
  });

  // --- transferItem ---

  const DEST_SPACE = '770e8400-e29b-41d4-a716-446655440002';
  const DEST_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.dest';

  describe('transferItem', () => {
    it('returns transferred item on successful copy', async () => {
      const item = {
        id: 'new-item-in-dest',
        spaceId: DEST_SPACE,
        memberId: '00000000-0000-0000-0000-000000000002',
        contentType: 'text',
        content: 'Hello world',
        fileSize: 0,
        sharedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch({ json: async () => item });

      const result = await transferItem(
        SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN,
      );

      expect(result).toEqual(item);
    });

    it('returns transferred item on successful move', async () => {
      const item = {
        id: 'moved-item-id',
        spaceId: DEST_SPACE,
        memberId: '00000000-0000-0000-0000-000000000002',
        contentType: 'file',
        content: 'photo.png',
        fileSize: 12345,
        sharedAt: '2024-01-01T00:00:00Z',
      };
      mockFetch({ json: async () => item });

      const result = await transferItem(
        SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'move', TOKEN,
      );

      expect(result).toEqual(item);
    });

    it('sends POST with correct URL and JSON body', async () => {
      mockFetch({ json: async () => ({}) });

      await transferItem(
        SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN,
      );

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(
        `${SERVER}/v1/spaces/${SPACE}/items/${ITEM_ID}/transfer`,
      );
      expect(call[1].method).toBe('POST');

      const body = JSON.parse(call[1].body);
      expect(body).toEqual({
        destinationToken: DEST_TOKEN,
        action: 'copy',
      });
    });

    it('sends move action in request body', async () => {
      mockFetch({ json: async () => ({}) });

      await transferItem(
        SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'move', TOKEN,
      );

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.action).toBe('move');
    });

    it('includes Content-Type and Authorization headers', async () => {
      mockFetch({ json: async () => ({}) });

      await transferItem(
        SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN,
      );

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].headers).toEqual({
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      });
    });

    it('strips trailing slash from server URL', async () => {
      mockFetch({ json: async () => ({}) });
      await transferItem(
        `${SERVER}/`, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN,
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${SERVER}/v1/spaces/${SPACE}/items/${ITEM_ID}/transfer`,
        expect.anything(),
      );
    });

    it('throws SpaceApiError on 401', async () => {
      mockFetch({ ok: false, status: 401 });
      await expect(
        transferItem(SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN),
      ).rejects.toThrow(/Authentication failed/);
    });

    it('throws SpaceApiError on 403', async () => {
      mockFetch({ ok: false, status: 403 });
      await expect(
        transferItem(SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN),
      ).rejects.toThrow(/Access denied/);
    });

    it('throws SpaceApiError on 413 quota exceeded', async () => {
      mockFetch({ ok: false, status: 413 });
      await expect(
        transferItem(SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'move', TOKEN),
      ).rejects.toThrow(/quota exceeded/i);
    });

    it('throws on server error with detail', async () => {
      mockFetch({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ Error: 'Transfer failed' }),
      });
      const err = await transferItem(
        SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN,
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SpaceApiError);
      expect((err as SpaceApiError).message).toMatch(/Transfer failed/);
      expect((err as SpaceApiError).status).toBe(500);
    });

    it('throws on network error', async () => {
      mockFetchReject(new TypeError('Failed to fetch'));
      const err = await transferItem(
        SERVER, SPACE, ITEM_ID, DEST_TOKEN, 'copy', TOKEN,
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SpaceApiError);
      expect((err as SpaceApiError).message).toMatch(/Network error/);
    });
  });
});
