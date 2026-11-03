import { describe, expect, it } from 'vitest';
import type { DomainEvent, DomainEventPayload } from '../events/types';
import { CONFLICT_WINDOW_MS, collabReduce, emptyCollab, teamKeyFor } from './collab';

let n = 0;
const ev = (agentId: string, payload: DomainEventPayload, at = 1000, sessionId = 'abcdef1234567890'): DomainEvent => ({ id: `e${++n}`, at, receivedAt: at, source: 'hook', agentId, sessionId, payload });
const none = () => null;

describe('collaboration', () => {
  it('derives the team key from the deprecated team_name or the lead session', () => {
    expect(teamKeyFor('session-a1b2c3d4', 'zzz')).toBe('session-a1b2c3d4');
    expect(teamKeyFor(undefined, 'abcdef1234567890')).toBe('session-abcdef12');
    expect(teamKeyFor(undefined, undefined)).toBeUndefined();
  });

  it('tracks a task from creation to completion with its owner', () => {
    let s = collabReduce(emptyCollab(), ev('ext-lead', { kind: 'task.created', taskId: 't1', subject: 'Write tests' }), none);
    expect(Object.values(s.tasks)).toMatchObject([{ status: 'open', subject: 'Write tests', teamKey: 'session-abcdef12' }]);
    s = collabReduce(s, ev('ext-lead/tm1', { kind: 'task.completed', taskId: 't1', subject: 'Write tests', teammateName: 'tester' }, 2000), () => 'ext-lead/tm1');
    const task = s.tasks['session-abcdef12:t1']!;
    expect(task).toMatchObject({ status: 'completed', completedBy: 'tester', completedByAgentId: 'ext-lead/tm1', createdAt: 1000, completedAt: 2000 });
    expect(s.teams['session-abcdef12']!.members).toEqual({ tester: 'ext-lead/tm1' });
  });

  it('records teammates without a character as names only', () => {
    const s = collabReduce(emptyCollab(), ev('ext-lead', { kind: 'teammate.idle', teammateName: 'researcher' }), none);
    expect(s.teams['session-abcdef12']!.members).toEqual({ researcher: null });
    const later = collabReduce(s, ev('ext-lead/x', { kind: 'teammate.idle', teammateName: 'researcher' }), () => 'ext-lead/x');
    expect(later.teams['session-abcdef12']!.members.researcher).toBe('ext-lead/x');
  });

  it('completion without a prior creation still lands on the board', () => {
    const s = collabReduce(emptyCollab(), ev('ext-a', { kind: 'task.completed', taskId: 't9', subject: 'Docs', teamName: 'session-11112222' }), none);
    expect(s.tasks['session-11112222:t9']).toMatchObject({ status: 'completed', subject: 'Docs', completedByAgentId: 'ext-a' });
  });

  it('flags two agents editing the same file within the window', () => {
    const edit = (agent: string, at: number, path = '/repo/src/app.ts') => ev(agent, { kind: 'tool.started', toolName: 'Edit', category: 'write', target: path }, at);
    let s = collabReduce(emptyCollab(), edit('a', 0), none);
    s = collabReduce(s, edit('a', 10), none);
    expect(s.conflicts).toHaveLength(0);
    s = collabReduce(s, edit('b', 20), none);
    expect(s.conflicts).toEqual([{ path: '/repo/src/app.ts', agentIds: ['a', 'b'], at: 20 }]);
    s = collabReduce(s, edit('b', 30), none);
    expect(s.conflicts).toHaveLength(1);
    // Windows paths are absolute too.
    const win = collabReduce(collabReduce(emptyCollab(), edit('a', 0, 'C:\\repo\\app.ts'), none), edit('b', 5, 'C:\\repo\\app.ts'), none);
    expect(win.conflicts).toHaveLength(1);
    // Different worktrees have different absolute paths: no conflict.
    s = collabReduce(s, edit('c', 40, '/repo-wt/src/app.ts'), none);
    expect(s.conflicts).toHaveLength(1);
    // Outside the window: no new conflict.
    const late = collabReduce(collabReduce(emptyCollab(), edit('a', 0), none), edit('b', CONFLICT_WINDOW_MS + 1), none);
    expect(late.conflicts).toHaveLength(0);
  });
});
