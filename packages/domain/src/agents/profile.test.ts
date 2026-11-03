import { describe, expect, it } from 'vitest';
import { appearanceFromSeed } from './appearance';
import { applyProfile, profileKeyFor, sanitizeAppearance, sanitizeProfile } from './profile';
import type { AgentRecord } from './types';

const base: AgentRecord = {
  id: 'ext-123',
  name: 'storefront',
  role: 'generalist',
  origin: 'external',
  kind: 'agent',
  projectPath: '/Users/a/storefront',
  appearance: appearanceFromSeed('x'),
  createdAt: 0,
};

describe('agent profiles', () => {
  it('keys observed sessions by project so they survive new session ids', () => {
    expect(profileKeyFor(base)).toBe('project:/Users/a/storefront');
    expect(profileKeyFor({ ...base, id: 'ext-456' })).toBe(profileKeyFor(base));
    expect(profileKeyFor({ ...base, kind: 'subagent', agentType: 'Explore' })).toBe('subagent:Explore');
    expect(profileKeyFor({ ...base, origin: 'demo', id: 'demo-ada' })).toBe('demo:demo-ada');
    expect(profileKeyFor({ ...base, projectPath: undefined })).toBe('agent:ext-123');
  });

  it('sanitizes appearance option by option', () => {
    const fallback = appearanceFromSeed('f');
    const a = sanitizeAppearance({ hairStyle: 'bun', skin: 'plaid', accessory: 42 }, fallback);
    expect(a.hairStyle).toBe('bun');
    expect(a.skin).toBe(fallback.skin);
    expect(a.accessory).toBe(fallback.accessory);
    expect(sanitizeAppearance(null, fallback)).toEqual(fallback);
  });

  it('sanitizes profiles and applies overrides', () => {
    const p = sanitizeProfile('k', { name: '  林小雨  ', role: 'qa_engineer', workstationId: 'ws-b1', appearance: { top: 'blazer' } }, base.appearance, 9);
    expect(p).toMatchObject({ name: '林小雨', role: 'qa_engineer', workstationId: 'ws-b1', updatedAt: 9 });
    const shown = applyProfile(base, p);
    expect(shown.name).toBe('林小雨');
    expect(shown.appearance.top).toBe('blazer');
    expect(shown.id).toBe(base.id);
    const bad = sanitizeProfile('k', { name: '', role: 'ceo', workstationId: '../x' }, base.appearance, 1);
    expect(bad).toEqual({ key: 'k', updatedAt: 1 });
    expect(applyProfile(base, undefined)).toBe(base);
  });
});
