import { describe, expect, it } from 'vitest';
import { resolveSystemLocale, resources } from './index';

function keys(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object') return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('locale resolution', () => {
  it.each([
    [['zh-TW'], 'zh-TW'],
    [['zh-Hant-TW'], 'zh-TW'],
    [['zh-HK'], 'zh-TW'],
    [['zh-CN'], 'en'],
    [['zh-Hans', 'zh-TW'], 'zh-TW'],
    [['fr-FR'], 'en'],
    [[], 'en'],
  ])('%j -> %s', (tags, expected) => {
    expect(resolveSystemLocale(tags)).toBe(expected);
  });
});

describe('translation parity', () => {
  const en = resources.en as Record<string, unknown>;
  const tw = resources['zh-TW'] as Record<string, unknown>;
  for (const ns of Object.keys(en)) {
    it(`namespace ${ns} has identical keys`, () => {
      expect(keys(tw[ns]).sort()).toEqual(keys(en[ns]).sort());
    });
    it(`namespace ${ns} has no empty values`, () => {
      for (const [, value] of Object.entries(flatten(tw[ns]))) expect(value.trim()).not.toBe('');
      for (const [, value] of Object.entries(flatten(en[ns]))) expect(value.trim()).not.toBe('');
    });
    it(`namespace ${ns} keeps interpolation variables`, () => {
      const enFlat = flatten(en[ns]);
      const twFlat = flatten(tw[ns]);
      for (const [key, value] of Object.entries(enFlat)) {
        expect(vars(twFlat[key] ?? '')).toEqual(vars(value));
      }
    });
  }
});

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof obj === 'string') out[prefix] = obj;
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
