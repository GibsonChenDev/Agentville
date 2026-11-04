import { hookProvider, normalizeHook } from '@agentville/integrations';
import type { AgentLocation, DomainEvent } from '@agentville/domain';
import type { ExternalSession, RawHook } from './protocol';

/**
 * Turns raw hooks from the receiver into domain events, using the normalizer
 * of the agent that sent each one (Claude Code, Codex, …). Ids derive from the
 * receiver's per-run hook id and sequence, so replaying `hello.recent` after a
 * reconnect produces identical events that the store de-duplicates.
 */
export interface PipelineDeps {
  ingest: (event: DomainEvent) => void;
  discover: (session: ExternalSession) => void;
  locate: (agentId: string, cwd: string) => void;
}

export function createHookPipeline(deps: PipelineDeps) {
  /** Sessions seen during this app run (a restored session is revived on its first event). */
  const seen = new Set<string>();
  const lastCwd = new Map<string, string>();
  // Hook numbers restart whenever the receiver restarts (ids are `<boot>-<seq>`).
  // Events from a newer boot are numbered after everything seen so far, so the
  // store's ordering check never drops them as "older".
  let boot: string | undefined;
  let base = 0;
  let top = 0;

  return function process(hook: RawHook): DomainEvent | null {
    const hookBoot = hook.id.slice(0, Math.max(0, hook.id.lastIndexOf('-')));
    if (hookBoot !== boot) {
      if (boot !== undefined) base = top;
      boot = hookBoot;
    }
    const seq = (k: 0 | 1) => {
      const v = base + hook.seq * 2 + k;
      top = Math.max(top, v);
      return v;
    };
    const provider = hookProvider(hook.provider);
    if (!provider) return null;
    let n = 0;
    const result = normalizeHook(
      hook.body,
      {
        receivedAt: hook.receivedAt,
        newId: () => (n++ === 0 ? hook.id : `${hook.id}:${n - 1}`),
        agentIdFor: provider.agentIdFor,
      },
      provider.dialect,
    );
    if (!result.ok) return null;
    const agentId = provider.agentIdFor(result.sessionId);
    const cwd = typeof hook.body.cwd === 'string' ? hook.body.cwd.slice(0, 1024) : undefined;

    if (!seen.has(agentId)) {
      seen.add(agentId);
      deps.discover({ agentId, sessionId: result.sessionId, provider: provider.id, cwd, firstSeenAt: hook.receivedAt });
      // Observed mid-flight (hooks installed later, or app restarted): synthesize the arrival.
      if (result.event.payload.kind !== 'session.started') {
        deps.ingest({
          id: `${hook.id}:start`,
          at: hook.receivedAt,
          receivedAt: hook.receivedAt,
          source: 'hook',
          agentId,
          sessionId: result.sessionId,
          seq: seq(0),
          payload: { kind: 'session.started', cwd, source: 'observed' },
        });
      }
    }
    const event: DomainEvent = { ...result.event, seq: seq(1) };
    deps.ingest(event);

    if (cwd && lastCwd.get(event.agentId) !== cwd) {
      lastCwd.set(event.agentId, cwd);
      deps.locate(event.agentId, cwd);
    }
    return event;
  };
}

export type { AgentLocation };
