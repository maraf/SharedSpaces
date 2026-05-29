import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('platform', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(['MacIntel', 'MacPPC', 'iPhone', 'iPad', 'iPod'])(
    'returns ⌘ on %s',
    async (platform) => {
      vi.stubGlobal('navigator', { platform });
      const { modifierKey } = await import('./platform');
      expect(modifierKey).toBe('⌘');
    }
  );

  it.each(['Win32', 'Linux x86_64', 'Linux armv7l'])(
    'returns Ctrl on %s',
    async (platform) => {
      vi.stubGlobal('navigator', { platform });
      const { modifierKey } = await import('./platform');
      expect(modifierKey).toBe('Ctrl');
    }
  );

  it('returns Ctrl when navigator is undefined', async () => {
    vi.stubGlobal('navigator', undefined);
    const { modifierKey } = await import('./platform');
    expect(modifierKey).toBe('Ctrl');
  });
});
