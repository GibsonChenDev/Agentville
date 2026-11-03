import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, sanitizePrefs } from './persistence';

describe('sanitizePrefs', () => {
  it('falls back to defaults for garbage', () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs('x')).toEqual(DEFAULT_PREFS);
  });
  it('keeps valid values and rejects invalid ones', () => {
    const p = sanitizePrefs({ locale: 'zh-TW', theme: 'midnight', mode: 'live', locale2: 1, sidebarWidth: 9999 });
    expect(p.locale).toBe('zh-TW');
    expect(p.theme).toBe('midnight');
    expect(p.mode).toBe('live');
    expect(p.sidebarWidth).toBe(400);
    expect(sanitizePrefs({ locale: 'zh-CN' }).locale).toBe('system');
    expect(sanitizePrefs({ theme: 'castle' }).theme).toBe('loft');
  });
});
