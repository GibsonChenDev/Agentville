import { describe, expect, it } from 'vitest';
import { normalizeHookPayload, type NormalizeContext } from './normalize';

let n = 0;
const ctx: NormalizeContext = {
  receivedAt: 42,
  newId: () => `id${++n}`,
  agentIdFor: (session, sub) => (sub ? `${session}/${sub}` : session),
};

describe('normalizeHookPayload', () => {
  it('normalizes PreToolUse with category and target', () => {
    const r = normalizeHookPayload(
      { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_use_id: 'tu1', tool_input: { command: 'npm test' } },
      ctx,
    );
    expect(r.ok && r.event.payload).toEqual({ kind: 'tool.started', toolName: 'Bash', toolUseId: 'tu1', category: 'test', target: 'npm test' });
  });

  it('attributes tool events inside a subagent to the subagent', () => {
    const r = normalizeHookPayload({ hook_event_name: 'PreToolUse', session_id: 's1', agent_id: 'sub9', tool_name: 'Read' }, ctx);
    expect(r.ok && r.event.agentId).toBe('s1/sub9');
  });

  it('attributes subagent lifecycle to the parent', () => {
    const r = normalizeHookPayload({ hook_event_name: 'SubagentStart', session_id: 's1', agent_id: 'sub9', agent_type: 'Explore' }, ctx);
    expect(r.ok && r.event.agentId).toBe('s1');
    expect(r.ok && r.event.payload).toEqual({ kind: 'subagent.started', subagentId: 'sub9', agentType: 'Explore' });
  });

  it('normalizes agent-team task and teammate events', () => {
    const created = normalizeHookPayload(
      { hook_event_name: 'TaskCreated', session_id: 'lead1', task_id: 'task-001', task_subject: 'Implement auth', task_description: 'Add login', teammate_name: 'implementer', team_name: 'session-a1b2c3d4' },
      ctx,
    );
    expect(created.ok && created.event.payload).toEqual({ kind: 'task.created', taskId: 'task-001', subject: 'Implement auth', description: 'Add login', teammateName: 'implementer', teamName: 'session-a1b2c3d4' });
    const done = normalizeHookPayload({ hook_event_name: 'TaskCompleted', session_id: 'lead1', agent_id: 'tm7', task_id: 'task-001', task_subject: 'Implement auth', teammate_name: 'implementer' }, ctx);
    expect(done.ok && done.event.agentId).toBe('lead1/tm7');
    expect(done.ok && done.event.payload.kind).toBe('task.completed');
    const idle = normalizeHookPayload({ hook_event_name: 'TeammateIdle', session_id: 'lead1', teammate_name: 'researcher' }, ctx);
    expect(idle.ok && idle.event.payload).toEqual({ kind: 'teammate.idle', teammateName: 'researcher', teamName: undefined });
    const cwd = normalizeHookPayload({ hook_event_name: 'CwdChanged', session_id: 's', cwd: '/repo/wt-a' }, ctx);
    expect(cwd.ok && cwd.event.payload).toEqual({ kind: 'location.changed', cwd: '/repo/wt-a' });
    expect(normalizeHookPayload({ hook_event_name: 'TaskCreated', session_id: 's', task_id: 't' }, ctx)).toEqual({ ok: false, reason: 'invalid_field' });
    expect(normalizeHookPayload({ hook_event_name: 'TeammateIdle', session_id: 's' }, ctx)).toEqual({ ok: false, reason: 'invalid_field' });
  });

  it.each([
    [null, 'not_object'],
    [[1, 2], 'not_object'],
    ['string', 'not_object'],
    [{ hook_event_name: 'Nope', session_id: 's' }, 'unsupported_event'],
    [{ hook_event_name: 'Stop' }, 'missing_session'],
    [{ hook_event_name: 'Stop', session_id: '../../etc/passwd' }, 'missing_session'],
    [{ hook_event_name: 'PreToolUse', session_id: 's' }, 'invalid_field'],
    [{ hook_event_name: 'SubagentStart', session_id: 's' }, 'invalid_field'],
  ])('rejects malformed payload %#', (raw, reason) => {
    expect(normalizeHookPayload(raw, ctx)).toEqual({ ok: false, reason });
  });

  it('truncates oversized strings and keeps markup inert', () => {
    const prompt = `<img src=x onerror=alert(1)>${'a'.repeat(5000)}`;
    const r = normalizeHookPayload({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok && r.event.payload.kind === 'prompt.submitted') {
      expect(r.event.payload.preview!.length).toBe(280);
      expect(r.event.payload.preview!.startsWith('<img')).toBe(true); // stored verbatim; rendered as text only
    }
  });
});
