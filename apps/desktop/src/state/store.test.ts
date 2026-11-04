import { appearanceFromSeed, type AgentRecord, type DomainEvent, type DomainEventPayload } from '@agentville/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './store';

const agent: AgentRecord = {
  id: 'ext-s1',
  name: 'storefront',
  role: 'generalist',
  origin: 'external',
  kind: 'agent',
  projectPath: '/code/storefront',
  appearance: appearanceFromSeed('s1'),
  createdAt: 1,
};
let n = 0;
const ev = (agentId: string, payload: DomainEventPayload, at = 100): DomainEvent => ({ id: `h${++n}`, at, receivedAt: at, source: 'hook', agentId, sessionId: 's1aaaaaaaa', payload });

beforeEach(() => {
  useApp.setState({ agents: {}, baseAgents: {}, runtime: {}, events: [], seenIds: new Set() });
});

describe('history restore', () => {
  it('replays events into the log and task board but keeps restored sessions out of the office', () => {
    useApp.getState().restoreHistory(
      [agent],
      [
        ev('ext-s1', { kind: 'session.started' }),
        ev('ext-s1', { kind: 'prompt.submitted', preview: 'go' }),
        ev('ext-s1', { kind: 'task.created', taskId: 't1', subject: 'Write docs' }),
        ev('ext-s1', { kind: 'tool.started', toolName: 'Read', category: 'read', toolUseId: 'x' }),
      ],
    );
    const s = useApp.getState();
    expect(s.events).toHaveLength(4);
    expect(s.agents['ext-s1']?.name).toBe('storefront');
    expect(s.runtime['ext-s1']?.status).toBe('disconnected');
    expect(Object.values(s.collab.tasks).map((t) => t.subject)).toEqual(['Write docs']);
  });

  it('a restored session comes back when it is observed again', () => {
    useApp.getState().restoreHistory([agent], [ev('ext-s1', { kind: 'session.started' })]);
    useApp.getState().ingest(ev('ext-s1', { kind: 'session.started', source: 'observed' }, 200));
    useApp.getState().ingest(ev('ext-s1', { kind: 'tool.started', toolName: 'Edit', category: 'write' }, 201));
    expect(useApp.getState().runtime['ext-s1']?.status).toBe('writing');
  });

  it('ignores events it has already seen', () => {
    const e = ev('ext-s1', { kind: 'session.started' });
    useApp.getState().restoreHistory([agent], [e]);
    useApp.getState().ingest(e);
    expect(useApp.getState().events).toHaveLength(1);
  });
});

describe('two sessions on one project', () => {
  const session = (sid: string, createdAt: number): AgentRecord => ({ ...agent, id: `ext-${sid}`, appearance: appearanceFromSeed(sid), createdAt });
  const custom = { ...appearanceFromSeed('custom'), top: 'suit' as const };
  // The project was customized earlier (set directly: tests have no storage).
  beforeEach(() => useApp.setState({ profiles: { 'project:/code/storefront': { key: 'project:/code/storefront', updatedAt: 0, appearance: custom, name: 'Shop' } } }));

  it('look different even after the project was customized', () => {
    useApp.getState().upsertAgent(session('a1', 1));
    useApp.getState().ingest(ev('ext-a1', { kind: 'session.started' }));
    useApp.getState().upsertAgent(session('b2', 2));
    const s = useApp.getState();
    expect(s.agents['ext-a1']).toMatchObject({ name: 'Shop', appearance: custom });
    expect(s.agents['ext-b2']).toMatchObject({ name: 'storefront', separateLook: true, appearance: appearanceFromSeed('b2') });
  });

  it('a later session after the first one ended wears the project look again', () => {
    useApp.getState().upsertAgent(session('a1', 1));
    useApp.getState().ingest(ev('ext-a1', { kind: 'session.started' }));
    useApp.getState().ingest(ev('ext-a1', { kind: 'session.ended' }));
    useApp.getState().upsertAgent(session('c3', 3));
    expect(useApp.getState().agents['ext-c3']).toMatchObject({ appearance: custom });
    expect(useApp.getState().agents['ext-c3']?.separateLook).toBeUndefined();
  });
});
