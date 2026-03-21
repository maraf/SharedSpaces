import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatRelativeTime } from './format-time';

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const mockNow = (dateStr: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(dateStr));
  };

  describe('Today', () => {
    it('returns "Today" for current moment', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-19T14:30:00');
      expect(formatRelativeTime(date)).toBe('Today');
    });

    it('returns "Today" for 1 minute ago', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-19T14:29:00');
      expect(formatRelativeTime(date)).toBe('Today');
    });

    it('returns "Today" for 6 hours ago on same day', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-19T08:30:00');
      expect(formatRelativeTime(date)).toBe('Today');
    });

    it('returns "Today" for item shared at midnight today', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-19T00:00:00');
      expect(formatRelativeTime(date)).toBe('Today');
    });

    it('returns "Today" for item shared at 11:59 PM today', () => {
      mockNow('2024-03-19T23:59:59');
      const date = new Date('2024-03-19T00:00:00');
      expect(formatRelativeTime(date)).toBe('Today');
    });
  });

  describe('Yesterday', () => {
    it('returns "Yesterday" for previous calendar day', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-18T14:30:00');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('returns "Yesterday" for item shared at 11:59 PM yesterday, checked at 12:01 AM', () => {
      mockNow('2024-03-19T00:01:00');
      const date = new Date('2024-03-18T23:59:00');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('returns "Yesterday" for item shared at 1 AM yesterday', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-18T01:00:00');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('returns "Yesterday" at boundary - just after midnight', () => {
      mockNow('2024-03-19T00:00:01');
      const date = new Date('2024-03-18T23:59:59');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('returns "Yesterday" for any time on previous calendar day', () => {
      mockNow('2024-03-19T08:00:00');
      const date = new Date('2024-03-18T20:00:00');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });
  });

  describe('X days ago', () => {
    it('returns "2d ago" for 2 days ago', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-17T14:30:00');
      expect(formatRelativeTime(date)).toBe('2d ago');
    });

    it('returns "3d ago" for 3 days ago', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-16T14:30:00');
      expect(formatRelativeTime(date)).toBe('3d ago');
    });

    it('returns "6d ago" for 6 days ago', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-13T14:30:00');
      expect(formatRelativeTime(date)).toBe('6d ago');
    });

    it('returns "6d ago" for 6 full calendar days ago', () => {
      mockNow('2024-03-19T00:00:00');
      const date = new Date('2024-03-13T23:59:59');
      expect(formatRelativeTime(date)).toBe('6d ago');
    });
  });

  describe('Short date format (7+ days)', () => {
    it('returns short date for 7 days ago', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-12T14:30:00');
      expect(formatRelativeTime(date)).toBe('Mar 12');
    });

    it('returns short date for 30 days ago', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-02-18T14:30:00');
      expect(formatRelativeTime(date)).toBe('Feb 18');
    });

    it('returns short date for 365 days ago', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2023-03-19T14:30:00');
      expect(formatRelativeTime(date)).toBe('Mar 19');
    });

    it('formats all months correctly', () => {
      mockNow('2024-12-31T14:30:00');
      const months = [
        { date: new Date('2024-01-01T00:00:00'), expected: 'Jan 1' },
        { date: new Date('2024-02-02T00:00:00'), expected: 'Feb 2' },
        { date: new Date('2024-03-03T00:00:00'), expected: 'Mar 3' },
        { date: new Date('2024-04-04T00:00:00'), expected: 'Apr 4' },
        { date: new Date('2024-05-05T00:00:00'), expected: 'May 5' },
        { date: new Date('2024-06-06T00:00:00'), expected: 'Jun 6' },
        { date: new Date('2024-07-07T00:00:00'), expected: 'Jul 7' },
        { date: new Date('2024-08-08T00:00:00'), expected: 'Aug 8' },
        { date: new Date('2024-09-09T00:00:00'), expected: 'Sep 9' },
        { date: new Date('2024-10-10T00:00:00'), expected: 'Oct 10' },
        { date: new Date('2024-11-11T00:00:00'), expected: 'Nov 11' },
        { date: new Date('2024-12-12T00:00:00'), expected: 'Dec 12' },
      ];

      months.forEach(({ date, expected }) => {
        expect(formatRelativeTime(date)).toBe(expected);
      });
    });
  });

  describe('Edge cases', () => {
    it('handles future dates (clock skew)', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-20T14:30:00');
      // Future date should show as negative days, format depends on implementation
      // Based on the logic, -1 day would be < 7, so it would return "-1d ago"
      const result = formatRelativeTime(date);
      expect(result).toBe('-1d ago');
    });

    it('handles dates far in the future', () => {
      mockNow('2024-03-19T14:30:00');
      const date = new Date('2024-03-30T14:30:00');
      // -11 days is < 7 (negative), so it returns "-11d ago"
      const result = formatRelativeTime(date);
      expect(result).toBe('-11d ago');
    });

    it('handles same exact moment (0ms difference)', () => {
      mockNow('2024-03-19T14:30:00.000');
      const date = new Date('2024-03-19T14:30:00.000');
      expect(formatRelativeTime(date)).toBe('Today');
    });

    it('handles dates at month boundaries', () => {
      mockNow('2024-04-01T00:00:00');
      const date = new Date('2024-03-31T23:59:59');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('handles dates at year boundaries', () => {
      mockNow('2024-01-01T00:00:00');
      const date = new Date('2023-12-31T23:59:59');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('handles leap year dates', () => {
      mockNow('2024-03-01T14:30:00'); // 2024 is a leap year
      const date = new Date('2024-02-29T14:30:00');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('handles dates across DST boundary', () => {
      // DST typically occurs in March in Northern Hemisphere
      mockNow('2024-03-11T14:30:00');
      const date = new Date('2024-03-10T14:30:00');
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });
  });

  describe('Calendar day boundary precision', () => {
    it('treats 11:59 PM and 12:01 AM as different days', () => {
      mockNow('2024-03-19T00:01:00');
      const lastNight = new Date('2024-03-18T23:59:00');
      expect(formatRelativeTime(lastNight)).toBe('Yesterday');
    });

    it('treats early morning items as same day', () => {
      mockNow('2024-03-19T23:59:00');
      const earlyMorning = new Date('2024-03-19T00:01:00');
      expect(formatRelativeTime(earlyMorning)).toBe('Today');
    });

    it('calculates days based on calendar days, not 24-hour periods', () => {
      // 23 hours and 59 minutes ago, but same calendar day
      mockNow('2024-03-19T23:59:00');
      const almostOneDayAgo = new Date('2024-03-19T00:00:00');
      expect(formatRelativeTime(almostOneDayAgo)).toBe('Today');

      // 1 hour ago, but different calendar day
      mockNow('2024-03-19T00:30:00');
      const oneHourAgoYesterday = new Date('2024-03-18T23:30:00');
      expect(formatRelativeTime(oneHourAgoYesterday)).toBe('Yesterday');
    });
  });
});
