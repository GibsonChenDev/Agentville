import type { AgentRecord, DomainEvent } from '@agentville/domain';
import { useApp } from '../state/store';
import { repository } from './repository';

/**
 * Records observed (non-demo) sessions and events to durable storage in small
 * batches, and restores them on startup so the activity log, task board and
 * past sessions survive an app restart.
 */
const FLUSH_MS = 1500;
const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RESTORE_LIMIT = 3000;

const recorded = new Set<string>();
let queueEvents: DomainEvent[] = [];
const queueSessions = new Map<string, AgentRecord>();
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function schedule() {
  timer ??= setTimeout(() => void flush(), FLUSH_MS);
}

async function flush() {
  timer = undefined;
  const events = queueEvents;
  const sessions = [...queueSessions.values()];
  queueEvents = [];
  queueSessions.clear();
  if (!events.length && !sessions.length) return;
  try {
    await repository.appendHistory(
      sessions.map((a) => ({ agentId: a.id, doc: JSON.stringify(a) })),
      events.map((e) => ({ id: e.id, agentId: e.agentId, at: e.at, doc: JSON.stringify(e) })),
    );
  } catch (e) {
    // Keep the app running; the next batch retries with new data only.
    console.warn('history append failed', e);
  }
}

export async function startHistory() {
  if (started) return;
  started = true;
  try {
    const rows = await repository.loadHistory(Date.now() - RESTORE_WINDOW_MS, RESTORE_LIMIT);
    if (rows) {
      const sessions: AgentRecord[] = [];
      for (const r of rows.sessions) {
        try {
          sessions.push(JSON.parse(r.doc) as AgentRecord);
        } catch {
          /* skip unreadable row */
        }
      }
      const events: DomainEvent[] = [];
      for (const r of rows.events) {
        try {
          events.push(JSON.parse(r.doc) as DomainEvent);
          recorded.add(r.id);
        } catch {
          /* skip unreadable row */
        }
      }
      useApp.getState().restoreHistory(sessions, events);
    }
  } catch (e) {
    console.warn('history restore failed', e);
  }

  let prevEvents = useApp.getState().events;
  let prevBase = useApp.getState().baseAgents;
  useApp.subscribe((s) => {
    if (s.events !== prevEvents) {
      for (const e of s.events.slice(-Math.max(1, s.events.length - prevEvents.length))) {
        if (e.source === 'demo' || recorded.has(e.id)) continue;
        recorded.add(e.id);
        queueEvents.push(e);
      }
      prevEvents = s.events;
      schedule();
    }
    if (s.baseAgents !== prevBase) {
      for (const [id, a] of Object.entries(s.baseAgents)) if (a.origin !== 'demo' && prevBase[id] !== a) queueSessions.set(id, a);
      prevBase = s.baseAgents;
      schedule();
    }
  });
}

export async function clearHistory() {
  await repository.clearHistory();
}
