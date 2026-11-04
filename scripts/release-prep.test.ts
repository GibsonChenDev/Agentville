import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION_FILES, notesFromCommits, versionFromTag } from './release-prep.mjs';

const bumpers = VERSION_FILES as Record<string, (text: string, version: string) => string>;

describe('release from a tag alone', () => {
  it('reads the version from the tag', () => {
    expect(versionFromTag('v0.5.1')).toBe('0.5.1');
    expect(versionFromTag('v1.0.0-beta.2')).toBe('1.0.0-beta.2');
    for (const bad of ['0.5.1', 'v0.5', 'release-1', 'v0.5.1 ']) expect(() => versionFromTag(bad)).toThrow();
  });

  it('sets the version in every file the build reads, and nothing else changes', () => {
    for (const [file, bump] of Object.entries(bumpers)) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      const out = bump(text, '9.8.7');
      expect(out, file).toContain('9.8.7');
      const changed = out.split('\n').filter((line, i) => line !== text.split('\n')[i]);
      expect(changed, file).toHaveLength(1);
    }
    // In Cargo.lock it's the app's own entry, not a dependency's.
    const lock = bumpers['apps/desktop/src-tauri/Cargo.lock']!(readFileSync(new URL('../apps/desktop/src-tauri/Cargo.lock', import.meta.url), 'utf8'), '9.8.7');
    expect(lock).toMatch(/name = "agentville"\r?\nversion = "9\.8\.7"/);
  });

  it('without written notes, lists the commits (leaving out version bumps and merges)', () => {
    expect(notesFromCommits(['Office editor frames the map above its panel', '0.5.0: bump the app version', 'Merge pull request #9', 'v0.5.1'])).toBe(
      '<!-- en -->\n- Office editor frames the map above its panel\n',
    );
    expect(notesFromCommits([])).toBe('<!-- en -->\n- Improvements and fixes.\n');
  });
});
