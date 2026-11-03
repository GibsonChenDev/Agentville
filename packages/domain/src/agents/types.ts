import type { ToolCategory } from '../events/types';
import type { CharacterAppearance } from './appearance';

/**
 * Where an agent's activity comes from. This drives which controls are offered:
 * only `managed` agents can receive prompts, permission decisions or cancellation.
 */
export type AgentOrigin = 'managed' | 'external' | 'demo';

export type AgentKind = 'agent' | 'subagent';

export type AgentStatus =
  | 'disconnected'
  | 'idle'
  | 'starting'
  | 'planning'
  | 'thinking'
  | 'reading'
  | 'writing'
  | 'executing_tool'
  | 'waiting_for_permission'
  | 'collaborating'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export const AGENT_STATUSES: readonly AgentStatus[] = [
  'disconnected',
  'idle',
  'starting',
  'planning',
  'thinking',
  'reading',
  'writing',
  'executing_tool',
  'waiting_for_permission',
  'collaborating',
  'completed',
  'failed',
  'cancelled',
  'unknown',
];

export type AgentRole =
  | 'engineering_lead'
  | 'flutter_developer'
  | 'backend_engineer'
  | 'frontend_engineer'
  | 'qa_engineer'
  | 'designer'
  | 'code_reviewer'
  | 'researcher'
  | 'devops_engineer'
  | 'generalist';

export const AGENT_ROLES: readonly AgentRole[] = [
  'engineering_lead',
  'flutter_developer',
  'backend_engineer',
  'frontend_engineer',
  'qa_engineer',
  'designer',
  'code_reviewer',
  'researcher',
  'devops_engineer',
  'generalist',
];

export interface AgentRecord {
  id: string;
  /** User-authored; never translated. */
  name: string;
  role: AgentRole;
  origin: AgentOrigin;
  kind: AgentKind;
  /** For subagents: the agent whose session spawned it. */
  parentId?: string;
  /** For subagents: the Claude Code agent type, e.g. "Explore". Never translated. */
  agentType?: string;
  appearance: CharacterAppearance;
  workstationId?: string;
  /** First working directory seen; the stable identity for customization. */
  projectPath?: string;
  /** Current working directory and git location, when known. */
  location?: AgentLocation;
  /** Agent-team membership, when observed. */
  team?: { key: string; role: 'lead' | 'teammate'; teammateName?: string };
  createdAt: number;
}

export interface GitInfo {
  /** Absolute path of the shared git directory; identical for all worktrees of one repository. */
  repo: string;
  /** Root of this working tree. */
  toplevel: string;
  branch: string;
  /** True for a linked worktree (not the repository's main checkout). */
  isWorktree: boolean;
}

export interface AgentLocation {
  cwd: string;
  git?: GitInfo;
}

export interface ActiveTool {
  toolUseId?: string;
  toolName: string;
  category: ToolCategory;
  target?: string;
  startedAt: number;
}

export interface PendingPermission {
  requestId: string;
  toolName: string;
  target?: string;
  requestedAt: number;
}

export interface AgentRuntime {
  status: AgentStatus;
  sessionId?: string;
  /** Tools started but not yet finished, oldest first. */
  openTools: ActiveTool[];
  pendingPermission?: PendingPermission;
  lastEventAt?: number;
  lastSeq?: number;
  lastError?: string;
  /** Last tool failure; recoverable, does not by itself fail the run. */
  lastToolFailure?: { toolName: string; at: number };
  /** Status to restore after a permission decision. */
  statusBeforePermission?: AgentStatus;
  completedAt?: number;
  /** When the current stretch of work began (a turn in progress); undefined while not working. */
  busySince?: number;
  /** Time spent working in finished stretches; add `now - busySince` for the total so far. */
  workedMs?: number;
  /**
   * Disconnected only because nothing was heard for a while (stale, or restored
   * from history after a restart), not because the session ended: any sign of
   * activity brings it back.
   */
  presumedGone?: boolean;
}

export const initialRuntime = (): AgentRuntime => ({ status: 'disconnected', openTools: [] });
