import { describe, expect, it } from 'vitest';
import { claude } from './claude';
import { HOOK_PROVIDERS, hookProvider, providerOf } from './registry';

describe('provider registry', () => {
  it('keeps ids, badges and agent ids distinct', () => {
    expect(new Set(HOOK_PROVIDERS.map((p) => p.id)).size).toBe(HOOK_PROVIDERS.length);
    expect(new Set(HOOK_PROVIDERS.map((p) => p.badge)).size).toBe(HOOK_PROVIDERS.length);
    expect(new Set(HOOK_PROVIDERS.map((p) => p.agentIdFor('s'))).size).toBe(HOOK_PROVIDERS.length);
  });

  it('treats untagged hooks and characters as Claude Code', () => {
    expect(hookProvider(undefined)).toBe(claude);
    expect(hookProvider('nope')).toBeUndefined();
    expect(providerOf({ origin: 'external' })).toBe(claude);
    expect(providerOf({ origin: 'external', provider: 'codex' })?.label).toBe('Codex');
    expect(providerOf({ origin: 'demo' })).toBeUndefined();
  });
});
