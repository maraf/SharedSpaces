import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSharedItem,
  downloadSharedItem,
  SharedItemApiError,
} from './shared-item-api';

describe('shared-item-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────
  // getSharedItem
  // ────────────────────────────────────────────────

  describe('getSharedItem', () => {
    it('calls the correct URL with apiBaseUrl and token', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contentType: 'text',
          content: 'Hello',
          fileSize: 0,
          sharedAt: '2025-01-01T00:00:00Z',
        }),
      });
      globalThis.fetch = mockFetch;

      await getSharedItem('http://localhost:5000', 'my-token-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/v1/shared/my-token-123',
      );
    });

    it('uses custom API URL from decoded share link (not default)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contentType: 'text',
          content: 'Remote content',
          fileSize: 0,
          sharedAt: '2025-01-01T00:00:00Z',
        }),
      });
      globalThis.fetch = mockFetch;

      // Simulate decoded api URL from a base64url share link
      const customApiUrl = 'https://custom-server.example.com:9090';
      await getSharedItem(customApiUrl, 'abc-def-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-server.example.com:9090/v1/shared/abc-def-token',
      );
    });

    it('strips trailing slashes from apiBaseUrl', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contentType: 'text',
          content: 'test',
          fileSize: 0,
          sharedAt: '2025-01-01T00:00:00Z',
        }),
      });
      globalThis.fetch = mockFetch;

      await getSharedItem('http://localhost:5000/', 'tok');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/v1/shared/tok',
      );
    });

    it('URL-encodes the token in the request path', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contentType: 'text',
          content: 'test',
          fileSize: 0,
          sharedAt: '2025-01-01T00:00:00Z',
        }),
      });
      globalThis.fetch = mockFetch;

      await getSharedItem('http://host', 'token/with+special&chars');

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(
        encodeURIComponent('token/with+special&chars'),
      );
    });

    it('returns parsed response for text items', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contentType: 'text',
          content: 'Hello shared world',
          fileSize: 0,
          sharedAt: '2025-01-01T00:00:00Z',
        }),
      });

      const result = await getSharedItem('http://host', 'tok');

      expect(result.contentType).toBe('text');
      expect(result.content).toBe('Hello shared world');
      expect(result.fileSize).toBe(0);
    });

    it('returns parsed response for file items', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contentType: 'file',
          content: 'report.pdf',
          fileSize: 1024,
          sharedAt: '2025-06-01T12:00:00Z',
        }),
      });

      const result = await getSharedItem('http://host', 'tok');

      expect(result.contentType).toBe('file');
      expect(result.content).toBe('report.pdf');
      expect(result.fileSize).toBe(1024);
    });

    it('throws SharedItemApiError with status 404 for missing links', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(getSharedItem('http://host', 'missing')).rejects.toThrow(
        SharedItemApiError,
      );
      await expect(
        getSharedItem('http://host', 'missing'),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('throws SharedItemApiError on server error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ Error: 'Unexpected failure' }),
      });

      await expect(getSharedItem('http://host', 'tok')).rejects.toThrow(
        SharedItemApiError,
      );
    });

    it('throws SharedItemApiError on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(getSharedItem('http://host', 'tok')).rejects.toThrow(
        SharedItemApiError,
      );
    });
  });

  // ────────────────────────────────────────────────
  // downloadSharedItem
  // ────────────────────────────────────────────────

  describe('downloadSharedItem', () => {
    it('calls the correct download URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['file content']),
      });
      globalThis.fetch = mockFetch;

      await downloadSharedItem('http://localhost:5000', 'dl-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/v1/shared/dl-token/download',
      );
    });

    it('uses custom API URL for download requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['data']),
      });
      globalThis.fetch = mockFetch;

      await downloadSharedItem('https://custom-api.example.com', 'tok');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-api.example.com/v1/shared/tok/download',
      );
    });

    it('returns a Blob on success', async () => {
      const expectedBlob = new Blob(['binary data'], { type: 'application/octet-stream' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => expectedBlob,
      });

      const result = await downloadSharedItem('http://host', 'tok');

      expect(result).toBeInstanceOf(Blob);
    });

    it('throws SharedItemApiError on 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        downloadSharedItem('http://host', 'missing'),
      ).rejects.toThrow(SharedItemApiError);
    });
  });
});
