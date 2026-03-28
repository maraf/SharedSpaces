import { describe, it, expect } from 'vitest';
import { parseInvitationString } from './invitation';

describe('invitation', () => {
  describe('parseInvitationString', () => {
    // ========== Legacy 3-part format: serverUrl|spaceId|pin ==========

    it('parses valid 3-part invitation string with HTTPS', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      
      expect(result).toEqual({
        serverUrl: 'https://api.example.com',
        spaceId: '550e8400-e29b-41d4-a716-446655440000',
        pin: '123456',
      });
    });

    it('parses valid 3-part invitation string with HTTP', () => {
      const result = parseInvitationString(
        'http://localhost:5000|550e8400-e29b-41d4-a716-446655440000|999999'
      );
      
      expect(result).toEqual({
        serverUrl: 'http://localhost:5000',
        spaceId: '550e8400-e29b-41d4-a716-446655440000',
        pin: '999999',
      });
    });

    it('parses 3-part invitation with trailing slash on server URL', () => {
      const result = parseInvitationString(
        'https://api.example.com/|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      
      expect(result).not.toBeNull();
      expect(result?.serverUrl).toBe('https://api.example.com/');
      expect(result?.spaceId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('accepts various GUID case formats in 3-part', () => {
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

    // ========== Simplified 2-part format: serverUrl|pin ==========

    it('parses valid 2-part invitation string', () => {
      const result = parseInvitationString('https://api.example.com|123456');
      
      expect(result).toEqual({
        serverUrl: 'https://api.example.com',
        pin: '123456',
      });
    });

    it('parses 2-part invitation with HTTP', () => {
      const result = parseInvitationString('http://localhost:5000|654321');
      
      expect(result).toEqual({
        serverUrl: 'http://localhost:5000',
        pin: '654321',
      });
    });

    it('2-part format does not include spaceId property', () => {
      const result = parseInvitationString('https://api.example.com|123456');
      
      expect(result).not.toBeNull();
      expect(result?.spaceId).toBeUndefined();
    });

    it('rejects PINs that are not exactly 6 digits in 2-part', () => {
      expect(parseInvitationString('https://api.example.com|1')).toBeNull();
      expect(parseInvitationString('https://api.example.com|123456789012')).toBeNull();
      expect(parseInvitationString('https://api.example.com|abcdef')).toBeNull();
    });

    // ========== Discrimination between formats ==========

    it('discriminates: GUID in position 2 = spaceId (3-part)', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456'
      );
      
      expect(result).not.toBeNull();
      expect(result?.spaceId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result?.pin).toBe('123456');
    });

    it('discriminates: numeric in position 2 = pin (2-part)', () => {
      const result = parseInvitationString('https://api.example.com|123456');
      
      expect(result).not.toBeNull();
      expect(result?.spaceId).toBeUndefined();
      expect(result?.pin).toBe('123456');
    });

    // ========== Invalid inputs ==========

    it('returns null for empty string', () => {
      const result = parseInvitationString('');
      expect(result).toBeNull();
    });

    it('returns null for null or undefined input', () => {
      expect(parseInvitationString(null as unknown as string)).toBeNull();
      expect(parseInvitationString(undefined as unknown as string)).toBeNull();
    });

    it('returns null for single part (URL only)', () => {
      const result = parseInvitationString('https://api.example.com');
      expect(result).toBeNull();
    });

    it('returns null for string with too many parts (4+)', () => {
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

    it('returns null for invalid space ID (not GUID-like) in 3-part', () => {
      const result = parseInvitationString('https://api.example.com|not-a-guid|123456');
      expect(result).toBeNull();
    });

    it('returns null for missing space ID in 3-part', () => {
      const result = parseInvitationString('https://api.example.com||123456');
      expect(result).toBeNull();
    });

    it('returns null for non-numeric PIN in 3-part', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|abc123'
      );
      expect(result).toBeNull();
    });

    it('returns null for missing PIN in 3-part', () => {
      const result = parseInvitationString('https://api.example.com|550e8400-e29b-41d4-a716-446655440000|');
      expect(result).toBeNull();
    });

    it('returns null for non-numeric second part in 2-part', () => {
      const result = parseInvitationString('https://api.example.com|notapin');
      expect(result).toBeNull();
    });

    it('returns null for empty second part in 2-part', () => {
      const result = parseInvitationString('https://api.example.com|');
      expect(result).toBeNull();
    });

    it('returns null for space ID with wrong format (wrong number of segments)', () => {
      const result = parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716|123456'
      );
      expect(result).toBeNull();
    });

    it('returns null for invalid URL in 2-part format', () => {
      const result = parseInvitationString('not-a-url|123456');
      expect(result).toBeNull();
    });

    it('rejects PINs that are not exactly 6 digits in 3-part', () => {
      expect(parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|1'
      )).toBeNull();
      expect(parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|123456789012'
      )).toBeNull();
      expect(parseInvitationString(
        'https://api.example.com|550e8400-e29b-41d4-a716-446655440000|abcdef'
      )).toBeNull();
    });
  });
});
