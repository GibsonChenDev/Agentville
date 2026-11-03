import { normalizeHookPayload } from '@agentville/claude-integration';
import type { AgentLocation, DomainEvent } from '@agentville/domain';
import type { ExternalSession, RawHook } from './protocol';

/**
 * Turns raw hooks from the receiver into domain events. Ids derive from the
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

  return function process(hook: RawHook): DomainEvent | null {
    let n = 0;
    const result = normalizeHookPayload(hook.body, {
      receivedAt: hook.receivedAt,
      newId: () => (n++ === 0 ? hook.id : `${hook.id}:${n - 1}`),
      agentIdFor: (sid, sub) => (sub ? `ext-${sid}/${sub}` : `ext-${sid}`),
    });
    if (!result.ok) return null;
    const agentId = `ext-${result.sessionId}`;
    const cwd = typeof hook.body.cwd === 'string' ? hook.body.cwd.slice(0, 1024) : undefined;

    if (!seen.has(agentId)) {
      seen.add(agentId);
      deps.discover({ agentId, sessionId: result.sessionId, cwd, firstSeenAt: hook.receivedAt });
      // Observed mid-flight (hooks installed later, or app restarted): synthesize the arrival.
      if (result.event.payload.kind !== 'session.started') {
        deps.ingest({
          id: `${hook.id}:start`,
          at: hook.receivedAt,
          receivedAt: hook.receivedAt,
          source: 'hook',
          agentId,
          sessionId: result.sessionId,
          seq: hook.seq * 2,
          payload: { kind: 'session.started', cwd, source: 'observed' },
        });
      }
    }
    const event: DomainEvent = { ...result.event, seq: hook.seq * 2 + 1 };
    deps.ingest(event);

    if (cwd && lastCwd.get(event.agentId) !== cwd) {
      lastCwd.set(event.agentId, cwd);
      deps.locate(event.agentId, cwd);
    }
    return event;
  };
}

export type { AgentLocation };
