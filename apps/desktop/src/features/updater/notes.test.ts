import { describe, expect, it } from 'vitest';
import { formatBytes, pickNotes } from './notes';

const BODY = '<!-- en -->\n- Faster office\n<!-- zh-TW -->\n- 辦公室更快\n';

describe('pickNotes', () => {
  it('picks the section for the UI language', () => {
    expect(pickNotes(BODY, 'zh-TW')).toBe('- 辦公室更快');
    expect(pickNotes(BODY, 'en')).toBe('- Faster office');
  });
  it('falls back to English, then to the whole body', () => {
    expect(pickNotes(BODY, 'ja')).toBe('- Faster office');
    expect(pickNotes('Just fixes', 'zh-TW')).toBe('Just fixes');
    expect(pickNotes(undefined, 'en')).toBe('');
  });
});

describe('formatBytes', () => {
  it('uses KB below a megabyte and MB above', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(12.34 * 1024 * 1024)).toBe('12.3 MB');
  });
});
