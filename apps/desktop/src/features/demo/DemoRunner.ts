import type { DomainEvent } from '@agentville/domain';
import { useApp } from '../../state/store';
import { DEMO_AGENTS, DEMO_LOCATIONS, DEMO_LOOP_MS, DEMO_SCRIPT } from './demoScript';

/** Plays the demo script in a loop against the store. Never runs in Live mode. */
export class DemoRunner {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private loop = 0;
  private startedAt = 0;
  private pausedAt?: number;
  private seq = 0;

  start() {
    this.stop();
    const store = useApp.getState();
    const now = Date.now();
    DEMO_AGENTS.forEach((a, i) => store.upsertAgent({ ...a, createdAt: now + i }));
    for (const [id, location] of Object.entries(DEMO_LOCATIONS)) store.setLocation(id, location);
    this.loop = 0;
    this.schedule(0);
  }

  get paused() {
    return this.pausedAt !== undefined;
  }

  pause() {
    if (this.paused) return;
    this.pausedAt = Date.now();
    this.clear();
  }

  resume() {
    if (this.pausedAt === undefined) return;
    const elapsed = this.pausedAt - this.startedAt;
    this.pausedAt = undefined;
    this.schedule(elapsed);
  }

  stop() {
    this.clear();
    this.pausedAt = undefined;
  }

  private clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private schedule(offset: number) {
    this.startedAt = Date.now() - offset;
    const loop = this.loop;
    for (const step of DEMO_SCRIPT) {
      if (step.at < offset) continue;
      this.timers.push(setTimeout(() => this.emit(step.agent, step.payload, loop), step.at - offset));
    }
    this.timers.push(
      setTimeout(() => {
        this.loop++;
        this.schedule(0);
      }, DEMO_LOOP_MS - offset),
    );
  }

  private emit(agentId: string, payload: DomainEvent['payload'], loop: number) {
    const now = Date.now();
    useApp.getState().ingest({
      id: `demo-${loop}-${++this.seq}`,
      at: now,
      receivedAt: now,
      source: 'demo',
      agentId,
      // Short ids so the team key `session-demo-ada` points at Ada, like real `session-<8 chars>` keys.
      sessionId: agentId.includes('/') ? 'demo-ada' : `demo-${agentId.slice(5)}`,
      payload,
    });
  }
}

export const demoRunner = new DemoRunner();
