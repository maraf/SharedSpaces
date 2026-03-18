import { describe, it, expect } from 'vitest';
import { parseInvitationString } from './invitation';

describe('invitation', () => {
  describe('parseInvitationString', () => {
    it('parses valid invitation string with HTTPS', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      
      expect(result).toEqual({
        serverUrl: 'https://api.example.com',
        spaceId: '550e8400-e29b-41d4-a716-446655440000',
        pin: '123456',
      });
    });

    it('parses valid invitation string with HTTP', () => {
      const result = parseInvitationString(
        'http://localhost:5000|550e8400-e29b-41d4-a716-446655440000|999999'
      );
      
      expect(result).toEqual({
        serverUrl: 'http://localhost:5000',
        spaceId: '550e8400-e29b-41d4-a716-446655440000',
        pin: '999999',
      });
    });

    it('parses invitation with trailing slash on server URL', () => {
      const result = parseInvitationString(
        'https://api.example.com/|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      
      expect(result).not.toBeNull();
      expect(result?.serverUrl).toBe('https://api.example.com/');
    });

    it('returns null for empty string', () => {
      const result = parseInvitationString('');
      expect(result).toBeNull();
    });

    it('returns null for null or undefined input', () => {
      expect(parseInvitationString(null as any)).toBeNull();
      expect(parseInvitationString(undefined as any)).toBeNull();
    });

    it('returns null for string with too few parts', () => {
      const result = parseInvitationString('https://api.example.com|550e8400-e29b-41d4-a716-446655440000');
      expect(result).toBeNull();
    });

    it('returns null for string with too many parts', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456|extra'
      );
      expect(result).toBeNull();
    });

    it('returns null for invalid server URL (not URL-like)', () => {
      const result = parseInvitationString(
        'not-a-url|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      expect(result).toBeNull();
    });

    it('returns null for invalid server URL protocol', () => {
      const result = parseInvitationString(
        'ftp://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      expect(result).toBeNull();
    });

    it('returns null for missing server URL', () => {
      const result = parseInvitationString('|550e8400-e29b-41d4-a716-446655440000|123456');
      expect(result).toBeNull();
    });

    it('returns null for invalid space ID (not GUID-like)', () => {
      const result = parseInvitationString('https://api.example.com|not-a-guid|123456');
      expect(result).toBeNull();
    });

    it('returns null for missing space ID', () => {
      const result = parseInvitationString('https://api.example.com||123456');
      expect(result).toBeNull();
    });

    it('returns null for non-numeric PIN', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|abc123'
      );
      expect(result).toBeNull();
    });

    it('returns null for missing PIN', () => {
      const result = parseInvitationString('https://api.example.com|550e8400-e29b-41d4-a716-446655440000|');
      expect(result).toBeNull();
    });

    it('accepts various GUID case formats', () => {
      const lowerCase = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      const upperCase = parseInvitationString(
        'https://api.example.com|550E8400-E29B-41D4-A716-446655440000|123456'
      );
      const mixedCase = parseInvitationString(
        'https://api.example.com|550e8400-E29B-41d4-A716-446655440000|123456'
      );
      
      expect(lowerCase).not.toBeNull();
      expect(upperCase).not.toBeNull();
      expect(mixedCase).not.toBeNull();
    });

    it('returns null for space ID with wrong format (wrong number of segments)', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716|123456'
      );
      expect(result).toBeNull();
    });

    it('accepts PINs of various lengths', () => {
      const shortPin = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|1'
      );
      const longPin = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456789012'
      );
      
      expect(shortPin).not.toBeNull();
      expect(longPin).not.toBeNull();
    });
  });
});
