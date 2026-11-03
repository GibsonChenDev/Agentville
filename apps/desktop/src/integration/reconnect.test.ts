import { appearanceFromSeed } from '@agentville/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../state/store';
import { createHookPipeline } from './hookPipeline';
import type { RawHook } from './protocol';

/**
 * Does a running agent stay observed when the app loses its connection and
 * comes back? Drives the real hook pipeline and store the way the bridge
 * client does: hooks are numbered per receiver boot, the stream replays its
 * recent buffer on reconnect, and history is restored on launch.
 */

const SID = 's1';
const AGENT = `ext-${SID}`;

function receiver(boot: string, start = 0) {
  let seq = start;
  let at = 1_000_000;
  return {
    hook: (body: Record<string, unknown>, gapMs = 1000): RawHook => {
      seq++;
      at += gapMs;
      return { id: `${boot}-${seq}`, seq, receivedAt: at, body: { session_id: SID, cwd: '/code/app', ...body } };
    },
  };
}

function app() {
  return createHookPipeline({
    ingest: (e) => useApp.getState().ingest(e),
    discover: (s) => {
      if (!useApp.getState().agents[s.agentId])
        useApp.getState().upsertAgent({ id: s.agentId, name: 'app', role: 'generalist', origin: 'external', kind: 'agent', appearance: appearanceFromSeed(s.sessionId), createdAt: s.firstSeenAt });
    },
    locate: () => {},
  });
}

const status = () => useApp.getState().runtime[AGENT]?.status;
const tool = (name: string, id: string) => ({ hook_event_name: 'PreToolUse', tool_name: name, tool_use_id: id });
const done = (name: string, id: string) => ({ hook_event_name: 'PostToolUse', tool_name: name, tool_use_id: id });

beforeEach(() => {
  useApp.setState({ mode: 'live', agents: {}, baseAgents: {}, runtime: {}, events: [], seenIds: new Set() });
});

describe('the app reconnects while an agent is working', () => {
  it('stream drops and comes back: the replayed buffer fills the gap, nothing counted twice', () => {
    const r = receiver('b1');
    const run = app();
    const h1 = r.hook({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
    const h2 = r.hook(tool('Read', 't1'));
    run(h1);
    run(h2);
    // Connection lost: these arrive at the receiver while the UI is away…
    const h3 = r.hook(done('Read', 't1'));
    const h4 = r.hook(tool('Edit', 't2'));
    // …and come back in `hello.recent` together with ones already seen.
    for (const h of [h1, h2, h3, h4]) run(h);
    expect(status()).toBe('writing');
    expect(useApp.getState().events.filter((e) => e.agentId === AGENT && e.payload.kind === 'tool.started')).toHaveLength(2);
  });

  it('the app restarts mid-turn: the still-running agent is picked up again by its next hook', () => {
    const before = receiver('b1');
    const run1 = app();
    for (let i = 0; i < 40; i++) run1(before.hook(i % 2 ? done('Read', `t${i - 1}`) : tool('Read', `t${i}`)));
    const history = useApp.getState().events;
    const sessions = Object.values(useApp.getState().baseAgents);

    // Quit and relaunch: a fresh store, history restored, a new receiver boot numbering hooks from 1 again.
    useApp.setState({ agents: {}, baseAgents: {}, runtime: {}, events: [], seenIds: new Set() });
    useApp.getState().restoreHistory(sessions, history);
    expect(status()).toBe('disconnected'); // shown as departed until it speaks
    const after = receiver('b2');
    const run2 = app();
    run2(after.hook(tool('Bash', 'x1')));
    expect(status()).toBe('executing_tool');
    run2(after.hook(done('Bash', 'x1')));
    run2(after.hook({ hook_event_name: 'Stop' }));
    expect(status()).toBe('completed');
  });

  it('the receiver restarts while the app stays open: hook numbering resets, the agent keeps being followed', () => {
    const run = app();
    const first = receiver('b1');
    for (let i = 0; i < 30; i++) run(first.hook(i % 2 ? done('Grep', `g${i - 1}`) : tool('Grep', `g${i}`)));
    const second = receiver('b2');
    run(second.hook(tool('Edit', 'e1')));
    expect(status()).toBe('writing');
  });

  it('a silent long-running command marks the agent away, and its next hook brings it back', () => {
    const r = receiver('b1');
    const run = app();
    run(r.hook({ hook_event_name: 'UserPromptSubmit', prompt: 'build' }));
    const started = r.hook(tool('Bash', 'long'));
    run(started);
    useApp.getState().sweepStale(started.receivedAt + 6 * 60_000);
    expect(status()).toBe('disconnected');
    run(r.hook(done('Bash', 'long'), 6 * 60_000));
    expect(status()).toBe('thinking');
    run(r.hook({ hook_event_name: 'Stop' }));
    expect(status()).toBe('completed');
  });

  it('a session that really ended is not brought back by a late hook', () => {
    const r = receiver('b1');
    const run = app();
    run(r.hook(tool('Read', 't1')));
    run(r.hook({ hook_event_name: 'SessionEnd', reason: 'exit' }));
    expect(status()).toBe('disconnected');
    run(r.hook(done('Read', 't1')));
    expect(status()).toBe('disconnected');
  });
});
