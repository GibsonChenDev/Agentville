import type { DomainEvent } from '../events/types';

/**
 * Cross-agent coordination derived from observed events: agent-team tasks,
 * team membership and file-edit conflicts. Everything here is reconstructed
 * from real hook events; nothing is inferred from timing alone except the
 * conflict window, which is documented as a heuristic.
 */

export interface ObservedTask {
  key: string;
  teamKey: string;
  taskId: string;
  subject: string;
  description?: string;
  /** Teammate that created the task, if reported. */
  createdBy?: string;
  /** Teammate that completed the task, if reported. */
  completedBy?: string;
  /** Agent that reported the completion. */
  completedByAgentId?: string;
  status: 'open' | 'completed';
  createdAt: number;
  completedAt?: number;
}

export interface TeamInfo {
  key: string;
  /** Lead session id prefix encoded in the team key (`session-xxxxxxxx`). */
  leadSessionPrefix?: string;
  /** Teammate name → agent id of the character that represents it, if any. */
  members: Record<string, string | null>;
}

export interface FileConflict {
  path: string;
  agentIds: [string, string];
  at: number;
}

export interface CollabState {
  tasks: Record<string, ObservedTask>;
  teams: Record<string, TeamInfo>;
  /** Most recent write per file, per agent. */
  writes: Record<string, Record<string, number>>;
  conflicts: FileConflict[];
}

/** POSIX (`/x`) or Windows (`C:\x`, `\\server\x`) absolute path. */
export function isAbsolutePath(p: string) {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export const emptyCollab = (): CollabState => ({ tasks: {}, teams: {}, writes: {}, conflicts: [] });

/** Edits to the same file by two different agents within this window raise a warning. */
export const CONFLICT_WINDOW_MS = 10 * 60_000;
const MAX_CONFLICTS = 50;

export function teamKeyFor(teamName: string | undefined, sessionId: string | undefined): string | undefined {
  if (teamName) return teamName;
  return sessionId ? `session-${sessionId.slice(0, 8)}` : undefined;
}

function withMember(state: CollabState, teamKey: string, name: string | undefined, agentId: string | null): CollabState {
  const team = state.teams[teamKey] ?? { key: teamKey, leadSessionPrefix: /^session-([A-Za-z0-9-]{1,8})$/.exec(teamKey)?.[1], members: {} };
  if (!name) return state.teams[teamKey] ? state : { ...state, teams: { ...state.teams, [teamKey]: team } };
  const known = team.members[name];
  if (known !== undefined && (known !== null || agentId === null)) return state.teams[teamKey] ? state : { ...state, teams: { ...state.teams, [teamKey]: team } };
  return { ...state, teams: { ...state.teams, [teamKey]: { ...team, members: { ...team.members, [name]: agentId } } } };
}

/**
 * `teammateAgent` resolves which character (if any) a teammate-tagged event
 * belongs to: events from inside an in-process teammate carry an agent id, and
 * split-pane teammates are their own sessions. Lead-session events without an
 * agent id return null so no character is fabricated.
 */
export function collabReduce(state: CollabState, event: DomainEvent, teammateAgent: (event: DomainEvent) => string | null): CollabState {
  const p = event.payload;
  switch (p.kind) {
    case 'task.created': {
      const teamKey = teamKeyFor(p.teamName, event.sessionId);
      if (!teamKey) return state;
      const key = `${teamKey}:${p.taskId}`;
      const next = withMember(state, teamKey, p.teammateName, p.teammateName ? teammateAgent(event) : null);
      if (next.tasks[key]) return next;
      return {
        ...next,
        tasks: { ...next.tasks, [key]: { key, teamKey, taskId: p.taskId, subject: p.subject, description: p.description, createdBy: p.teammateName, status: 'open', createdAt: event.at } },
      };
    }
    case 'task.completed': {
      const teamKey = teamKeyFor(p.teamName, event.sessionId);
      if (!teamKey) return state;
      const key = `${teamKey}:${p.taskId}`;
      const agent = p.teammateName ? teammateAgent(event) : null;
      const next = withMember(state, teamKey, p.teammateName, agent);
      const prev = next.tasks[key];
      const task: ObservedTask = {
        ...(prev ?? { key, teamKey, taskId: p.taskId, subject: p.subject, createdAt: event.at }),
        status: 'completed',
        completedBy: p.teammateName,
        completedByAgentId: agent ?? event.agentId,
        completedAt: event.at,
      };
      return { ...next, tasks: { ...next.tasks, [key]: task } };
    }
    case 'teammate.idle': {
      const teamKey = teamKeyFor(p.teamName, event.sessionId);
      return teamKey ? withMember(state, teamKey, p.teammateName, teammateAgent(event)) : state;
    }
    case 'tool.started': {
      if (p.category !== 'write' || !p.target || !isAbsolutePath(p.target)) return state;
      const path = p.target;
      const byAgent = state.writes[path] ?? {};
      let conflicts = state.conflicts;
      for (const [other, at] of Object.entries(byAgent)) {
        if (other === event.agentId || event.at - at > CONFLICT_WINDOW_MS) continue;
        const pair = [other, event.agentId].sort() as [string, string];
        if (!conflicts.some((c) => c.path === path && c.agentIds[0] === pair[0] && c.agentIds[1] === pair[1])) {
          conflicts = [...conflicts, { path, agentIds: pair, at: event.at }].slice(-MAX_CONFLICTS);
        }
      }
      return { ...state, writes: { ...state.writes, [path]: { ...byAgent, [event.agentId]: event.at } }, conflicts };
    }
    default:
      return state;
  }
}
