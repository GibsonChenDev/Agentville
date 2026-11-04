import { classifyTool, toolTarget, type ToolCategory } from '@agentville/domain';
import type { HookDialect } from '../hooks/normalize';
import type { HookProvider } from './types';

/**
 * OpenAI Codex (https://developers.openai.com/codex/hooks). Same payload
 * vocabulary as Claude Code; differences handled here:
 * - no PostToolUseFailure / Notification / agent-team / CwdChanged events;
 * - `Interrupt` (the user stopped the turn) ends the turn like `Stop`;
 * - its own tool names: shell as `Bash`/`exec_command`, edits as `apply_patch`;
 * - the Codex app runs background threads of its own (suggestions for what to do
 *   next, checking those suggestions) that fire the same hooks. They're ephemeral:
 *   no transcript, so `transcript_path` is null, while every thread the user starts
 *   has one. Those hooks are dropped so no extra characters appear.
 */

const SHELL_TOOLS = new Set(['Bash', 'exec_command', 'shell', 'local_shell', 'unified_exec']);
const CATEGORY: Readonly<Record<string, ToolCategory>> = {
  apply_patch: 'write',
  update_plan: 'plan',
  spawn_agent: 'delegate',
  view_image: 'read',
  web_search: 'web',
};
const TEST_COMMAND = /\b(test|tests|jest|vitest|pytest|cargo test|go test|npm (run )?test|pnpm test|yarn test|flutter test|dart test|rspec)\b/i;
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m;
const MAX_TARGET = 120;

function shellCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const c = (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).cmd;
  if (typeof c === 'string') return c;
  // Codex may pass argv, e.g. ["bash", "-lc", "npm test"]: the script is the last element.
  if (Array.isArray(c) && c.every((x) => typeof x === 'string')) {
    const args = c as string[];
    const flag = args.at(-2);
    return args.length >= 3 && flag && /^-\w*c$/.test(flag) ? args.at(-1) : args.join(' ');
  }
  return undefined;
}

function short(value: string): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > MAX_TARGET ? `${single.slice(0, MAX_TARGET - 1)}…` : single;
}

/** Files touched by an apply_patch call, from whichever string field carries the patch. */
function patchTarget(input: unknown): string | undefined {
  const texts = typeof input === 'string' ? [input] : input && typeof input === 'object' ? Object.values(input).filter((v): v is string => typeof v === 'string') : [];
  for (const text of texts) {
    const files = [...text.matchAll(new RegExp(PATCH_FILE.source, 'gm'))].map((m) => m[1]!.trim());
    if (files.length) return short(files.length > 1 ? `${files[0]} +${files.length - 1}` : files[0]!);
  }
  return undefined;
}

export const codexDialect: HookDialect = {
  events: ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SubagentStart', 'SubagentStop'],
  aliases: { Interrupt: 'Stop' },
  classifyTool(toolName, input) {
    if (SHELL_TOOLS.has(toolName)) {
      const command = shellCommand(input);
      return command && TEST_COMMAND.test(command) ? 'test' : 'execute';
    }
    return CATEGORY[toolName] ?? classifyTool(toolName, input);
  },
  toolTarget(toolName, input) {
    if (SHELL_TOOLS.has(toolName)) {
      const command = shellCommand(input);
      return command ? short(command) : undefined;
    }
    if (toolName === 'apply_patch') return patchTarget(input);
    return toolTarget(toolName, input);
  },
  // Only an explicit null counts: payloads from Codex versions without the field are kept.
  isBackground: (raw) => !raw.agent_id && Object.hasOwn(raw, 'transcript_path') && (raw.transcript_path === null || raw.transcript_path === ''),
};

export const codex: HookProvider = {
  id: 'codex',
  label: 'Codex',
  badge: 'CX',
  color: '#10a37f',
  dialect: codexDialect,
  agentIdFor: (sid, sub) => (sub ? `ext-codex-${sid}/${sub}` : `ext-codex-${sid}`),
  needsTrust: true,
};
