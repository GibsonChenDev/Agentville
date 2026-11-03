import type { ToolCategory } from './types';

const READ_TOOLS = new Set(['Read', 'NotebookRead', 'LS']);
const SEARCH_TOOLS = new Set(['Glob', 'Grep', 'ToolSearch']);
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const DELEGATE_TOOLS = new Set(['Task', 'Agent']);
const PLAN_TOOLS = new Set(['TodoWrite', 'ExitPlanMode', 'EnterPlanMode']);

const TEST_COMMAND =
  /\b(test|tests|vitest|jest|pytest|mocha|playwright|cypress|cargo\s+(test|build|check|clippy)|go\s+(test|build|vet)|swift\s+(test|build)|xcodebuild|flutter\s+(test|analyze)|gradle\w*\s+\w*test|tsc|eslint|lint|typecheck|(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|lint|check))\b/i;

/**
 * Classifies a Claude Code tool call into a coarse category used to choose
 * the visible activity. Purely heuristic and documented as such; unknown tools
 * (including MCP tools) fall back to `other`.
 */
export function classifyTool(toolName: string, input?: unknown): ToolCategory {
  if (READ_TOOLS.has(toolName)) return 'read';
  if (SEARCH_TOOLS.has(toolName)) return 'search';
  if (WRITE_TOOLS.has(toolName)) return 'write';
  if (WEB_TOOLS.has(toolName)) return 'web';
  if (DELEGATE_TOOLS.has(toolName)) return 'delegate';
  if (PLAN_TOOLS.has(toolName)) return 'plan';
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const command = commandOf(input);
    return command && TEST_COMMAND.test(command) ? 'test' : 'execute';
  }
  return 'other';
}

function commandOf(input: unknown): string | undefined {
  if (input && typeof input === 'object' && 'command' in input) {
    const command = (input as { command: unknown }).command;
    return typeof command === 'string' ? command : undefined;
  }
  return undefined;
}

/** Extracts a short, display-safe target (path, pattern or command) from tool input. */
export function toolTarget(toolName: string, input: unknown, maxLength = 120): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const keys =
    toolName === 'Bash'
      ? ['description', 'command']
      : ['file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'subagent_type'];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      const single = value.replace(/\s+/g, ' ').trim();
      return single.length > maxLength ? `${single.slice(0, maxLength - 1)}…` : single;
    }
  }
  return undefined;
}
