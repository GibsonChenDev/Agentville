import type { AgentRecord } from '@agentville/domain';
import { claude } from './claude';
import { codex } from './codex';
import type { HookProvider } from './types';

/** Every observed agent, in display order. Add or remove agents here. */
export const HOOK_PROVIDERS: readonly HookProvider[] = [claude, codex];

/** Hooks from receivers older than provider tagging are Claude Code's. */
export const DEFAULT_PROVIDER = claude;

export function hookProvider(id: string | undefined): HookProvider | undefined {
  return id === undefined ? DEFAULT_PROVIDER : HOOK_PROVIDERS.find((p) => p.id === id);
}

/** The coding agent behind an observed character; characters saved before provider tagging are Claude Code's. */
export function providerOf(agent: Pick<AgentRecord, 'origin' | 'provider'>): HookProvider | undefined {
  return agent.origin === 'external' ? hookProvider(agent.provider) : undefined;
}
