/**
 * Normalized domain events. These are language-neutral and source-agnostic:
 * hook payloads, Agent SDK messages and Demo fixtures are all converted into
 * this shape before they touch agent state. Raw payloads never reach the UI.
 */

export type EventSource = 'demo' | 'hook' | 'sdk' | 'app';

export type ToolCategory =
  | 'read'
  | 'search'
  | 'write'
  | 'execute'
  | 'test'
  | 'web'
  | 'delegate'
  | 'plan'
  | 'other';

export type DomainEventPayload =
  | { kind: 'session.started'; cwd?: string; source?: string }
  | { kind: 'session.ended'; reason?: string }
  | { kind: 'session.disconnected'; reason: 'stale' | 'process_exit' | 'transport' }
  | { kind: 'prompt.submitted'; preview?: string }
  | { kind: 'assistant.message'; text: string }
  | {
      kind: 'tool.started';
      toolUseId?: string;
      toolName: string;
      category: ToolCategory;
      /** Short, display-safe description, e.g. a file path or command. Never HTML. */
      target?: string;
    }
  | { kind: 'tool.finished'; toolUseId?: string; toolName: string }
  | { kind: 'tool.failed'; toolUseId?: string; toolName: string; error?: string }
  | { kind: 'permission.requested'; requestId: string; toolName: string; target?: string }
  | { kind: 'permission.resolved'; requestId: string; decision: 'allow' | 'deny' | 'expired' }
  | { kind: 'notification'; notificationType?: string; message?: string }
  | { kind: 'turn.completed' }
  | { kind: 'run.completed'; summary?: string }
  | { kind: 'run.failed'; error: string }
  | { kind: 'run.cancelled' }
  | { kind: 'subagent.started'; subagentId: string; agentType?: string }
  | { kind: 'subagent.stopped'; subagentId: string }
  | { kind: 'collaboration.started'; meetingId: string; participants: string[]; reason: 'handoff' | 'shared_task' | 'meeting' }
  | { kind: 'collaboration.ended'; meetingId: string }
  /** Agent-team task list (Claude Code TaskCreated / TaskCompleted hooks). */
  | { kind: 'task.created'; taskId: string; subject: string; description?: string; teammateName?: string; teamName?: string }
  | { kind: 'task.completed'; taskId: string; subject: string; teammateName?: string; teamName?: string }
  /** An agent-team teammate is about to go idle (TeammateIdle hook). */
  | { kind: 'teammate.idle'; teammateName: string; teamName?: string }
  /** The session's working directory changed (CwdChanged hook, or a new cwd seen on any event). */
  | { kind: 'location.changed'; cwd: string };

export type DomainEventKind = DomainEventPayload['kind'];

export interface DomainEvent<P extends DomainEventPayload = DomainEventPayload> {
  /** Unique id; used for de-duplication. */
  id: string;
  /** Epoch milliseconds when the event happened (source clock when known). */
  at: number;
  /** Epoch milliseconds when Agentville received it. */
  receivedAt: number;
  source: EventSource;
  /** Agentville agent this event is attributed to. */
  agentId: string;
  /** Verified Claude session id, when the source provides one. */
  sessionId?: string;
  /** Monotonic per-source sequence, when available, to detect reordering. */
  seq?: number;
  payload: P;
}

export type EventOf<K extends DomainEventKind> = DomainEvent<Extract<DomainEventPayload, { kind: K }>>;
