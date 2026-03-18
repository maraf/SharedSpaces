import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exchangeToken, TokenExchangeError } from './api-client';

describe('api-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('exchangeToken', () => {
    it('successfully exchanges PIN for token', async () => {
      const mockResponse = { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' };
      
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await exchangeToken(
        'http://localhost:5000',
        '550e8400-e29b-41d4-a716-446655440000',
        '123456',
        'Alice'
      );

      expect(result).toEqual(mockResponse);
    });

    it('calls correct URL with correct method and headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: 'test-token' }),
      });
      globalThis.fetch = mockFetch;

      await exchangeToken(
        'http://localhost:5000',
        '550e8400-e29b-41d4-a716-446655440000',
        '123456',
        'Alice'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/v1/spaces/550e8400-e29b-41d4-a716-446655440000/tokens',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pin: '123456',
            displayName: 'Alice',
          }),
        }
      );
    });

    it('throws TokenExchangeError on 400 response (bad request)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', '')
      ).rejects.toThrow(TokenExchangeError);

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', '')
      ).rejects.toThrow('Invalid request');
    });

    it('throws TokenExchangeError with statusCode 400', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });

      try {
        await exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', '');
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExchangeError);
        expect((error as TokenExchangeError).statusCode).toBe(400);
      }
    });

    it('throws TokenExchangeError on 401 response (invalid PIN)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'wrong', 'Alice')
      ).rejects.toThrow(TokenExchangeError);

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'wrong', 'Alice')
      ).rejects.toThrow('Invalid PIN');
    });

    it('throws TokenExchangeError with statusCode 401', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      try {
        await exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', 'wrong', 'Alice');
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExchangeError);
        expect((error as TokenExchangeError).statusCode).toBe(401);
      }
    });

    it('throws TokenExchangeError on 404 response (space not found)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-999999999999', '123456', 'Alice')
      ).rejects.toThrow(TokenExchangeError);

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-999999999999', '123456', 'Alice')
      ).rejects.toThrow('Space not found');
    });

    it('throws TokenExchangeError with statusCode 404', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      try {
        await exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-999999999999', '123456', 'Alice');
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExchangeError);
        expect((error as TokenExchangeError).statusCode).toBe(404);
      }
    });

    it('throws TokenExchangeError on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow(TokenExchangeError);

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow('Network error');
    });

    it('throws TokenExchangeError on non-JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow(TokenExchangeError);
    });

    it('throws TokenExchangeError when response is missing token field', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ notAToken: 'value' }),
      });

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow(TokenExchangeError);

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow('Invalid response from server');
    });

    it('throws TokenExchangeError when response token is not a string', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: 12345 }),
      });

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow(TokenExchangeError);

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow('Invalid response from server');
    });

    it('preserves original error in TokenExchangeError on network failure', async () => {
      const networkError = new Error('Connection refused');
      global.fetch = vi.fn().mockRejectedValue(networkError);

      try {
        await exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice');
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExchangeError);
        expect((error as TokenExchangeError).originalError).toBe(networkError);
      }
    });

    it('handles 500 server error with generic message', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice')
      ).rejects.toThrow(TokenExchangeError);

      try {
        await exchangeToken('http://localhost:5000', '550e8400-e29b-41d4-a716-446655440000', '123456', 'Alice');
      } catch (error) {
        expect((error as TokenExchangeError).statusCode).toBe(500);
        expect((error as TokenExchangeError).message).toContain('500');
      }
    });
  });
});
