import { HOOK_PROVIDERS } from '@agentville/integrations';
import { describe, expect, it } from 'vitest';
import rust from '../../src-tauri/src/providers.rs?raw';

/** Rust installs the hooks and the UI normalizes them: both registries must name the same agents and events. */
function rustProvider(id: string) {
  const block = rust.match(new RegExp(`Provider = Provider \\{\\s*id: "${id}",([\\s\\S]*?)\\n\\};`));
  if (!block) return undefined;
  const events = block[1]!.match(/events: &\[([\s\S]*?)\]/)![1]!;
  return [...events.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
}

describe('provider registries (Rust ↔ TypeScript)', () => {
  it('list the same agents', () => {
    const all = rust.match(/^pub const ALL: \[&Provider; (\d+)\]/m);
    expect(Number(all![1])).toBe(HOOK_PROVIDERS.length);
  });

  it.each(HOOK_PROVIDERS.map((p) => [p.id, p] as const))('%s: installs exactly the events it understands', (_id, p) => {
    const events = rustProvider(p.id);
    expect(events).toBeDefined();
    const understood = (e: string) => p.dialect.aliases?.[e] ?? e;
    for (const e of events!) expect(p.dialect.events, e).toContain(understood(e));
    expect(new Set(events!.map(understood))).toEqual(new Set(p.dialect.events));
  });
});
