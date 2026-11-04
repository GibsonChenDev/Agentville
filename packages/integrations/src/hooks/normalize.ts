import type { DomainEvent, DomainEventPayload, ToolCategory } from '@agentville/domain';

/**
 * Normalizes hook payloads into domain events. Claude Code and Codex share one
 * payload vocabulary (`hook_event_name`, `session_id`, `tool_name`, …); what
 * differs per agent — which events exist, extra event names, tool names — is a
 * `HookDialect` (see `providers/`). All input is untrusted: unknown events are
 * dropped, string fields are length-limited and nothing here executes or
 * renders payload content.
 */

/** Every hook event the normalizer understands. */
export const SUPPORTED_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
  'CwdChanged',
] as const;
export type SupportedHookEvent = (typeof SUPPORTED_HOOK_EVENTS)[number];

/** What one agent's hooks look like. */
export interface HookDialect {
  /** Events this agent emits (a subset of SUPPORTED_HOOK_EVENTS, after aliases). */
  events: readonly SupportedHookEvent[];
  /** Agent-specific event names mapped onto a supported one, e.g. Codex `Interrupt` → `Stop`. */
  aliases?: Readonly<Record<string, SupportedHookEvent>>;
  classifyTool: (toolName: string, input: unknown) => ToolCategory;
  toolTarget: (toolName: string, input: unknown) => string | undefined;
}

export type NormalizeResult =
  | { ok: true; event: DomainEvent; sessionId: string; subagentId?: string }
  | { ok: false; reason: 'not_object' | 'missing_session' | 'unsupported_event' | 'invalid_field' };

export interface NormalizeContext {
  receivedAt: number;
  /** Generates unique ids; injectable for tests. */
  newId: () => string;
  /** Maps a session (and optional subagent id) to an Agentville agent id. */
  agentIdFor: (sessionId: string, subagentId?: string) => string;
}

const MAX_STRING = 2000;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function str(record: Record<string, unknown>, key: string, max = MAX_STRING): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function normalizeHook(raw: unknown, ctx: NormalizeContext, dialect: HookDialect): NormalizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not_object' };
  const r = raw as Record<string, unknown>;
  const rawName = r.hook_event_name;
  const eventName = typeof rawName === 'string' ? (Object.hasOwn(dialect.aliases ?? {}, rawName) ? dialect.aliases![rawName] : rawName) : undefined;
  if (eventName === undefined || !(dialect.events as readonly string[]).includes(eventName)) {
    return { ok: false, reason: 'unsupported_event' };
  }
  const sessionId = r.session_id;
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { ok: false, reason: 'missing_session' };

  // Events fired from inside a subagent carry agent_id; attribute them to the subagent character.
  const rawAgentId = str(r, 'agent_id', 128);
  const subagentId = rawAgentId && SESSION_ID.test(rawAgentId) ? rawAgentId : undefined;

  const toolName = str(r, 'tool_name', 200);
  const toolUseId = str(r, 'tool_use_id', 200);
  let payload: DomainEventPayload | undefined;
  let attributeToSubagent = subagentId !== undefined;

  switch (eventName as SupportedHookEvent) {
    case 'SessionStart':
      payload = { kind: 'session.started', cwd: str(r, 'cwd', 1024), source: str(r, 'source', 32) };
      break;
    case 'SessionEnd':
      payload = { kind: 'session.ended', reason: str(r, 'reason', 64) };
      break;
    case 'UserPromptSubmit':
      payload = { kind: 'prompt.submitted', preview: str(r, 'prompt', 280) };
      break;
    case 'PreToolUse':
      if (!toolName) return { ok: false, reason: 'invalid_field' };
      payload = {
        kind: 'tool.started',
        toolName,
        toolUseId,
        category: dialect.classifyTool(toolName, r.tool_input),
        target: dialect.toolTarget(toolName, r.tool_input),
      };
      break;
    case 'PostToolUse':
      if (!toolName) return { ok: false, reason: 'invalid_field' };
      payload = { kind: 'tool.finished', toolName, toolUseId };
      break;
    case 'PostToolUseFailure':
      if (!toolName) return { ok: false, reason: 'invalid_field' };
      payload = { kind: 'tool.failed', toolName, toolUseId, error: str(r, 'error', 500) };
      break;
    case 'PermissionRequest':
      if (!toolName) return { ok: false, reason: 'invalid_field' };
      // PermissionRequest has no tool_use_id; a fresh request id is minted for correlation in Agentville only.
      payload = { kind: 'permission.requested', requestId: ctx.newId(), toolName, target: dialect.toolTarget(toolName, r.tool_input) };
      break;
    case 'Notification':
      payload = { kind: 'notification', notificationType: str(r, 'notification_type', 64), message: str(r, 'message', 500) };
      break;
    case 'Stop':
      payload = { kind: 'turn.completed' };
      break;
    case 'SubagentStart':
      if (!subagentId) return { ok: false, reason: 'invalid_field' };
      payload = { kind: 'subagent.started', subagentId, agentType: str(r, 'agent_type', 64) };
      attributeToSubagent = false; // lifecycle belongs to the parent session's agent
      break;
    case 'SubagentStop':
      if (!subagentId) return { ok: false, reason: 'invalid_field' };
      payload = { kind: 'subagent.stopped', subagentId };
      attributeToSubagent = false;
      break;
    case 'TaskCreated':
    case 'TaskCompleted': {
      const taskId = str(r, 'task_id', 128);
      const subject = str(r, 'task_subject', 300);
      if (!taskId || !subject) return { ok: false, reason: 'invalid_field' };
      const common = { taskId, subject, teammateName: str(r, 'teammate_name', 64), teamName: str(r, 'team_name', 64) };
      payload = eventName === 'TaskCreated' ? { kind: 'task.created', ...common, description: str(r, 'task_description', 1000) } : { kind: 'task.completed', ...common };
      break;
    }
    case 'TeammateIdle': {
      const teammateName = str(r, 'teammate_name', 64);
      if (!teammateName) return { ok: false, reason: 'invalid_field' };
      payload = { kind: 'teammate.idle', teammateName, teamName: str(r, 'team_name', 64) };
      break;
    }
    case 'CwdChanged': {
      const cwd = str(r, 'cwd', 1024);
      if (!cwd) return { ok: false, reason: 'invalid_field' };
      payload = { kind: 'location.changed', cwd };
      break;
    }
  }
  if (!payload) return { ok: false, reason: 'unsupported_event' };

  const event: DomainEvent = {
    id: ctx.newId(),
    at: ctx.receivedAt,
    receivedAt: ctx.receivedAt,
    source: 'hook',
    agentId: ctx.agentIdFor(sessionId, attributeToSubagent ? subagentId : undefined),
    sessionId,
    payload,
  };
  return { ok: true, event, sessionId, subagentId };
}
