import { classifyTool, toolTarget } from '@agentville/domain';
import { normalizeHook, SUPPORTED_HOOK_EVENTS, type HookDialect, type NormalizeContext, type NormalizeResult } from '../hooks/normalize';
import type { HookProvider } from './types';

/** Claude Code (https://code.claude.com/docs/en/hooks): every supported event, Claude tool names. */
export const claudeDialect: HookDialect = { events: SUPPORTED_HOOK_EVENTS, classifyTool, toolTarget };

export const claude: HookProvider = {
  id: 'claude',
  label: 'Claude Code',
  badge: 'CC',
  color: '#d97757',
  dialect: claudeDialect,
  // Unprefixed for compatibility with history saved before Codex support.
  agentIdFor: (sid, sub) => (sub ? `ext-${sid}/${sub}` : `ext-${sid}`),
  needsTrust: false,
};

export function normalizeHookPayload(raw: unknown, ctx: NormalizeContext): NormalizeResult {
  return normalizeHook(raw, ctx, claudeDialect);
}
