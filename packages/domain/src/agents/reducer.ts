import type { DomainEvent, ToolCategory } from '../events/types';
import type { ActiveTool, AgentRuntime, AgentStatus } from './types';

const STATUS_FOR_CATEGORY: Record<ToolCategory, AgentStatus> = {
  read: 'reading',
  search: 'reading',
  web: 'reading',
  write: 'writing',
  plan: 'planning',
  execute: 'executing_tool',
  test: 'executing_tool',
  delegate: 'executing_tool',
  other: 'executing_tool',
};

/** Statuses that only a new session/prompt may leave. */
const TERMINAL: ReadonlySet<AgentStatus> = new Set(['disconnected', 'cancelled', 'failed']);

/**
 * Derives the logical status while a turn is in progress: the most recently
 * started open tool wins; with none open the agent is "thinking", which is an
 * inference that a model turn is in progress — not access to model reasoning.
 */
function busyStatus(openTools: ActiveTool[]): AgentStatus {
  const latest = openTools[openTools.length - 1];
  return latest ? STATUS_FOR_CATEGORY[latest.category] : 'thinking';
}

/** Statuses that count as working time (waiting for the user's permission doesn't). */
const WORKING: ReadonlySet<AgentStatus> = new Set(['planning', 'thinking', 'reading', 'writing', 'executing_tool', 'collaborating']);

/**
 * Pure state machine: applies one normalized event to an agent's runtime.
 * Out-of-order events (lower `seq` than already applied) are ignored for status
 * but callers should still log them.
 */
export function applyEvent(state: AgentRuntime, event: DomainEvent): AgentRuntime {
  const next = transition(revive(state, event), event);
  if (next === state) return state;
  return trackWork(next.presumedGone && next.status !== 'disconnected' ? { ...next, presumedGone: undefined } : next, event.at);
}

/** Events that prove a session is still running. */
const ALIVE: ReadonlySet<DomainEvent['payload']['kind']> = new Set(['tool.started', 'tool.finished', 'tool.failed', 'permission.requested', 'turn.completed', 'run.completed', 'subagent.started', 'collaboration.started']);

/** A session only presumed gone (silent too long, or restored after a restart) resumes on its next sign of activity. */
function revive(state: AgentRuntime, event: DomainEvent): AgentRuntime {
  if (state.status !== 'disconnected' || !state.presumedGone || !ALIVE.has(event.payload.kind)) return state;
  // Its old numbering may be from before a restart; ordering starts over from here.
  return { ...state, status: 'thinking', presumedGone: undefined, lastSeq: undefined };
}

/** Opens a working stretch when work starts and banks it when work stops. */
function trackWork(r: AgentRuntime, at: number): AgentRuntime {
  const working = WORKING.has(r.status);
  if (working && r.busySince === undefined) return { ...r, busySince: at };
  if (!working && r.busySince !== undefined) return { ...r, busySince: undefined, workedMs: (r.workedMs ?? 0) + Math.max(0, at - r.busySince) };
  return r;
}

/** Total time an agent has spent working, including the stretch in progress. */
export function workedMs(r: Pick<AgentRuntime, 'busySince' | 'workedMs'>, now: number): number {
  return (r.workedMs ?? 0) + (r.busySince === undefined ? 0 : Math.max(0, now - r.busySince));
}

function transition(state: AgentRuntime, event: DomainEvent): AgentRuntime {
  if (event.seq !== undefined && state.lastSeq !== undefined && event.seq <= state.lastSeq) {
    return state;
  }
  const base: AgentRuntime = {
    ...state,
    lastEventAt: Math.max(state.lastEventAt ?? 0, event.at),
    lastSeq: event.seq ?? state.lastSeq,
    sessionId: event.sessionId ?? state.sessionId,
  };
  const p = event.payload;

  switch (p.kind) {
    case 'session.started':
      return { ...base, status: 'starting', openTools: [], pendingPermission: undefined, lastError: undefined };

    case 'prompt.submitted':
      return { ...base, status: 'thinking', openTools: [], pendingPermission: undefined, lastError: undefined, completedAt: undefined };

    case 'tool.started': {
      if (TERMINAL.has(state.status)) return base;
      if (state.pendingPermission) return transition(implicitlyResolved(base), event);
      const tool: ActiveTool = {
        toolUseId: p.toolUseId,
        toolName: p.toolName,
        category: p.category,
        target: p.target,
        startedAt: event.at,
      };
      const openTools = [...base.openTools.filter((t) => !p.toolUseId || t.toolUseId !== p.toolUseId), tool];
      if (state.status === 'waiting_for_permission') return { ...base, openTools };
      return { ...base, openTools, status: busyStatus(openTools) };
    }

    case 'tool.finished':
    case 'tool.failed': {
      // Hooks never report the user's answer to a permission prompt; the gated
      // tool finishing (or failing, when denied) is the observable resolution.
      if (state.pendingPermission?.toolName === p.toolName) return transition(implicitlyResolved(base), event);
      const openTools = removeTool(base.openTools, p.toolUseId, p.toolName);
      const failure = p.kind === 'tool.failed' ? { lastToolFailure: { toolName: p.toolName, at: event.at } } : {};
      if (TERMINAL.has(state.status) || state.status === 'completed' || state.status === 'idle') {
        return { ...base, openTools, ...failure };
      }
      if (state.status === 'waiting_for_permission') return { ...base, openTools, ...failure };
      return { ...base, openTools, ...failure, status: busyStatus(openTools) };
    }

    case 'permission.requested':
      return {
        ...base,
        status: 'waiting_for_permission',
        statusBeforePermission: state.status === 'waiting_for_permission' ? state.statusBeforePermission : state.status,
        pendingPermission: { requestId: p.requestId, toolName: p.toolName, target: p.target, requestedAt: event.at },
      };

    case 'permission.resolved': {
      if (!state.pendingPermission || state.pendingPermission.requestId !== p.requestId) return base;
      const resumed = base.openTools.length ? busyStatus(base.openTools) : 'thinking';
      return { ...base, pendingPermission: undefined, statusBeforePermission: undefined, status: resumed };
    }

    case 'turn.completed':
    case 'run.completed':
      if (TERMINAL.has(state.status)) return base;
      return { ...base, status: 'completed', openTools: [], pendingPermission: undefined, completedAt: event.at };

    case 'run.failed':
      return { ...base, status: 'failed', openTools: [], pendingPermission: undefined, lastError: p.error };

    case 'run.cancelled':
      return { ...base, status: 'cancelled', openTools: [], pendingPermission: undefined };

    case 'session.ended':
    case 'session.disconnected':
      return { ...base, status: 'disconnected', openTools: [], pendingPermission: undefined, presumedGone: p.kind === 'session.disconnected' && p.reason === 'stale' };

    case 'collaboration.started':
      if (TERMINAL.has(state.status)) return base;
      return { ...base, status: 'collaborating' };

    case 'collaboration.ended':
      if (state.status !== 'collaborating') return base;
      return { ...base, status: base.openTools.length ? busyStatus(base.openTools) : 'idle' };

    case 'teammate.idle':
      // Only the teammate's own character goes idle; attribution happens upstream.
      if (TERMINAL.has(state.status)) return base;
      return { ...base, status: 'idle', openTools: [], pendingPermission: undefined };

    case 'assistant.message':
    case 'notification':
    case 'subagent.started':
    case 'subagent.stopped':
    case 'task.created':
    case 'task.completed':
    case 'location.changed':
      return base;
  }
}

function implicitlyResolved(state: AgentRuntime): AgentRuntime {
  const restored = state.statusBeforePermission && state.statusBeforePermission !== 'waiting_for_permission' ? state.statusBeforePermission : 'thinking';
  return { ...state, pendingPermission: undefined, statusBeforePermission: undefined, status: restored, lastSeq: undefined };
}

function removeTool(tools: ActiveTool[], toolUseId: string | undefined, toolName: string): ActiveTool[] {
  if (toolUseId) return tools.filter((t) => t.toolUseId !== toolUseId);
  // Without a correlation id, remove the oldest open call of the same tool.
  const index = tools.findIndex((t) => t.toolName === toolName);
  return index === -1 ? tools : [...tools.slice(0, index), ...tools.slice(index + 1)];
}

const BUSY: ReadonlySet<AgentStatus> = new Set(['starting', 'planning', 'thinking', 'reading', 'writing', 'executing_tool', 'collaborating']);

/**
 * Marks a session stale when no event arrived for a while. A busy agent goes
 * quiet quickly when its process dies; an idle one may legitimately wait for the
 * user for a long time, so it gets a longer window. Never stale while waiting
 * for a permission decision.
 */
export function isStale(state: AgentRuntime, now: number, busyAfterMs: number, idleAfterMs = busyAfterMs * 12): boolean {
  if (state.status === 'disconnected' || state.lastEventAt === undefined) return false;
  if (state.status === 'waiting_for_permission') return false;
  return now - state.lastEventAt > (BUSY.has(state.status) ? busyAfterMs : idleAfterMs);
}
