import { describe, expect, it } from 'vitest';
import type { DomainEvent, DomainEventPayload } from '../events/types';
import { applyEvent, isStale, workedMs } from './reducer';
import { initialRuntime, type AgentRuntime } from './types';

let n = 0;
const ev = (payload: DomainEventPayload, extra: Partial<DomainEvent> = {}): DomainEvent => ({
  id: `e${++n}`,
  at: 1000 + n,
  receivedAt: 1000 + n,
  source: 'demo',
  agentId: 'a1',
  payload,
  ...extra,
});
const run = (...events: DomainEvent[]): AgentRuntime => events.reduce(applyEvent, initialRuntime());

describe('agent state machine', () => {
  it('moves through a typical turn', () => {
    let s = run(ev({ kind: 'session.started' }));
    expect(s.status).toBe('starting');
    s = applyEvent(s, ev({ kind: 'prompt.submitted' }));
    expect(s.status).toBe('thinking');
    s = applyEvent(s, ev({ kind: 'tool.started', toolUseId: 't1', toolName: 'Read', category: 'read' }));
    expect(s.status).toBe('reading');
    s = applyEvent(s, ev({ kind: 'tool.finished', toolUseId: 't1', toolName: 'Read' }));
    expect(s.status).toBe('thinking');
    s = applyEvent(s, ev({ kind: 'tool.started', toolUseId: 't2', toolName: 'Edit', category: 'write' }));
    expect(s.status).toBe('writing');
    s = applyEvent(s, ev({ kind: 'tool.finished', toolUseId: 't2', toolName: 'Edit' }));
    s = applyEvent(s, ev({ kind: 'turn.completed' }));
    expect(s.status).toBe('completed');
  });

  it('does not treat a successful tool call as completion', () => {
    const s = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'tool.started', toolUseId: 't', toolName: 'Bash', category: 'test' }),
      ev({ kind: 'tool.finished', toolUseId: 't', toolName: 'Bash' }),
    );
    expect(s.status).toBe('thinking');
  });

  it('keeps tool failure recoverable', () => {
    const s = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'tool.started', toolUseId: 't', toolName: 'Bash', category: 'test' }),
      ev({ kind: 'tool.failed', toolUseId: 't', toolName: 'Bash', error: 'exit 1' }),
    );
    expect(s.status).toBe('thinking');
    expect(s.lastToolFailure?.toolName).toBe('Bash');
  });

  it('waits for permission and restores afterwards', () => {
    let s = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'tool.started', toolUseId: 't', toolName: 'Bash', category: 'execute' }),
      ev({ kind: 'permission.requested', requestId: 'p1', toolName: 'Bash' }),
    );
    expect(s.status).toBe('waiting_for_permission');
    // A different request id must not clear the pending one.
    s = applyEvent(s, ev({ kind: 'permission.resolved', requestId: 'other', decision: 'allow' }));
    expect(s.status).toBe('waiting_for_permission');
    s = applyEvent(s, ev({ kind: 'permission.resolved', requestId: 'p1', decision: 'allow' }));
    expect(s.status).toBe('executing_tool');
    expect(s.pendingPermission).toBeUndefined();
  });

  it('treats the gated tool finishing as an implicit permission resolution (hooks)', () => {
    const s = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'tool.started', toolUseId: 'b', toolName: 'Bash', category: 'execute' }),
      ev({ kind: 'permission.requested', requestId: 'p', toolName: 'Bash' }),
      ev({ kind: 'tool.finished', toolUseId: 'b', toolName: 'Bash' }),
    );
    expect(s.status).toBe('thinking');
    expect(s.pendingPermission).toBeUndefined();
    const next = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'permission.requested', requestId: 'p2', toolName: 'Write' }),
      ev({ kind: 'tool.started', toolUseId: 'w', toolName: 'Write', category: 'write' }),
    );
    expect(next.status).toBe('writing');
  });

  it('implicit resolution also works with sequenced (bridge) events', () => {
    const s = run(
      ev({ kind: 'prompt.submitted' }, { seq: 1 }),
      ev({ kind: 'tool.started', toolUseId: 'b', toolName: 'Bash', category: 'test' }, { seq: 2 }),
      ev({ kind: 'permission.requested', requestId: 'p', toolName: 'Bash' }, { seq: 3 }),
      ev({ kind: 'tool.failed', toolUseId: 'b', toolName: 'Bash', error: 'denied' }, { seq: 4 }),
    );
    expect(s.status).toBe('thinking');
    expect(s.lastSeq).toBe(4);
    expect(s.lastToolFailure?.toolName).toBe('Bash');
  });

  it('keeps waiting when an unrelated tool finishes', () => {
    const s = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'tool.started', toolUseId: 'r', toolName: 'Read', category: 'read' }),
      ev({ kind: 'permission.requested', requestId: 'p', toolName: 'Bash' }),
      ev({ kind: 'tool.finished', toolUseId: 'r', toolName: 'Read' }),
    );
    expect(s.status).toBe('waiting_for_permission');
  });

  it('ignores reordered events by sequence', () => {
    let s = run(ev({ kind: 'prompt.submitted' }, { seq: 5 }));
    s = applyEvent(s, ev({ kind: 'tool.started', toolName: 'Read', category: 'read' }, { seq: 3 }));
    expect(s.status).toBe('thinking');
  });

  it('removes uncorrelated tool calls oldest-first', () => {
    const s = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'tool.started', toolName: 'Read', category: 'read' }),
      ev({ kind: 'tool.started', toolName: 'Edit', category: 'write' }),
      ev({ kind: 'tool.finished', toolName: 'Read' }),
    );
    expect(s.openTools.map((t) => t.toolName)).toEqual(['Edit']);
    expect(s.status).toBe('writing');
  });

  it('late tool events after completion do not resurrect activity', () => {
    const s = run(
      ev({ kind: 'prompt.submitted' }),
      ev({ kind: 'turn.completed' }),
      ev({ kind: 'tool.finished', toolUseId: 'late', toolName: 'Read' }),
    );
    expect(s.status).toBe('completed');
  });

  it('disconnects on session end and stays there for tool events', () => {
    const s = run(
      ev({ kind: 'session.started' }),
      ev({ kind: 'session.ended' }),
      ev({ kind: 'tool.started', toolName: 'Read', category: 'read' }),
    );
    expect(s.status).toBe('disconnected');
  });

  it('detects stale sessions but not ones waiting on the user', () => {
    const busy = run(ev({ kind: 'prompt.submitted' }));
    expect(isStale(busy, busy.lastEventAt! + 10_000, 5_000)).toBe(true);
    const waiting = applyEvent(busy, ev({ kind: 'permission.requested', requestId: 'p', toolName: 'Bash' }));
    expect(isStale(waiting, waiting.lastEventAt! + 10_000, 5_000)).toBe(false);
    const done = applyEvent(busy, ev({ kind: 'turn.completed' }));
    expect(isStale(done, done.lastEventAt! + 10_000, 5_000, 60_000)).toBe(false);
    expect(isStale(done, done.lastEventAt! + 70_000, 5_000, 60_000)).toBe(true);
  });
});

describe('working time', () => {
  it('counts turns in progress and banks them when the turn ends', () => {
    let s = run(ev({ kind: 'session.started' }, { at: 0 }));
    expect(workedMs(s, 5_000)).toBe(0);
    s = applyEvent(s, ev({ kind: 'prompt.submitted' }, { at: 10_000 }));
    expect(s.busySince).toBe(10_000);
    s = applyEvent(s, ev({ kind: 'tool.started', toolUseId: 't', toolName: 'Read', category: 'read' }, { at: 20_000 }));
    expect(s.busySince).toBe(10_000); // still the same stretch
    expect(workedMs(s, 40_000)).toBe(30_000);
    s = applyEvent(s, ev({ kind: 'turn.completed' }, { at: 70_000 }));
    expect(s.busySince).toBeUndefined();
    expect(workedMs(s, 999_999)).toBe(60_000);
    s = applyEvent(s, ev({ kind: 'prompt.submitted' }, { at: 100_000 }));
    expect(workedMs(s, 105_000)).toBe(65_000);
  });

  it('does not count waiting for permission, and stops on disconnect', () => {
    let s = run(ev({ kind: 'prompt.submitted' }, { at: 0 }));
    s = applyEvent(s, ev({ kind: 'permission.requested', requestId: 'p', toolName: 'Bash' }, { at: 10_000 }));
    expect(workedMs(s, 50_000)).toBe(10_000);
    s = applyEvent(s, ev({ kind: 'tool.finished', toolName: 'Bash' }, { at: 60_000 }));
    expect(s.status).toBe('thinking');
    s = applyEvent(s, ev({ kind: 'session.disconnected', reason: 'stale' }, { at: 65_000 }));
    expect(workedMs(s, 1e9)).toBe(15_000);
  });
});
