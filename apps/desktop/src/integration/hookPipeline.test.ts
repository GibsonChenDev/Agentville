import type { DomainEvent } from '@agentville/domain';
import { describe, expect, it } from 'vitest';
import { createHookPipeline } from './hookPipeline';
import type { ExternalSession, RawHook } from './protocol';

const hook = (seq: number, body: Record<string, unknown>): RawHook => ({ id: `boot-${seq}`, seq, receivedAt: 1000 + seq, body });

function setup() {
  const events: DomainEvent[] = [];
  const sessions: ExternalSession[] = [];
  const located: [string, string][] = [];
  const run = createHookPipeline({ ingest: (e) => events.push(e), discover: (s) => sessions.push(s), locate: (a, c) => located.push([a, c]) });
  return { run, events, sessions, located };
}

describe('hook pipeline', () => {
  it('discovers a session mid-flight and synthesizes its arrival before the event', () => {
    const { run, events, sessions } = setup();
    run(hook(1, { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/w', tool_name: 'Read', tool_use_id: 't' }));
    expect(sessions).toEqual([{ agentId: 'ext-s1', sessionId: 's1', cwd: '/w', firstSeenAt: 1001 }]);
    expect(events.map((e) => [e.id, e.payload.kind, e.seq])).toEqual([
      ['boot-1:start', 'session.started', 2],
      ['boot-1', 'tool.started', 3],
    ]);
  });

  it('is deterministic, so replays after a reconnect produce the same ids', () => {
    const a = setup();
    const b = setup();
    const h = hook(7, { hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    const ea = a.run(h)!;
    const eb = b.run(h)!;
    expect(ea.id).toBe(eb.id);
    expect(ea.payload).toEqual(eb.payload);
    expect(ea.payload.kind === 'permission.requested' && ea.payload.requestId).toBe('boot-7');
    expect(ea.id).toBe('boot-7:1');
  });

  it('attributes subagent events and reports each new working directory once', () => {
    const { run, events, located } = setup();
    run(hook(1, { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/repo' }));
    run(hook(2, { hook_event_name: 'PreToolUse', session_id: 's1', agent_id: 'sub', cwd: '/repo-wt', tool_name: 'Grep' }));
    run(hook(3, { hook_event_name: 'PostToolUse', session_id: 's1', agent_id: 'sub', cwd: '/repo-wt', tool_name: 'Grep' }));
    expect(events.map((e) => e.agentId)).toEqual(['ext-s1', 'ext-s1/sub', 'ext-s1/sub']);
    expect(located).toEqual([
      ['ext-s1', '/repo'],
      ['ext-s1/sub', '/repo-wt'],
    ]);
  });

  it('drops payloads the normalizer rejects', () => {
    const { run, events } = setup();
    expect(run(hook(1, { hook_event_name: 'Nope', session_id: 's1' }))).toBeNull();
    expect(events).toHaveLength(0);
  });
});
