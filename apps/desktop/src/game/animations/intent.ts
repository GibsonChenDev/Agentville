import type { AgentStatus, ToolCategory } from '@agentville/domain';

/**
 * Presentation layer: maps a logical agent status to what the character should
 * visibly do. Layer 3 (logical status) → layer 4 (animation intent). Cosmetic
 * idle motion lives in the renderer and never changes these intents.
 */

export type Activity = 'idle' | 'type' | 'read' | 'think' | 'plan' | 'debug' | 'raise' | 'cheer' | 'slump' | 'talk';
export type Place = 'desk' | 'meeting' | 'away';
export type ScreenMode = 'off' | 'idle' | 'code' | 'doc' | 'terminal' | 'web' | 'question' | 'success' | 'error' | 'plan' | 'delegate';

export interface VisualIntent {
  place: Place;
  activity: Activity;
  screen: ScreenMode;
}

export function intentFor(status: AgentStatus, category?: ToolCategory): VisualIntent {
  switch (status) {
    case 'disconnected':
      return { place: 'away', activity: 'idle', screen: 'off' };
    case 'starting':
    case 'idle':
    case 'unknown':
    case 'cancelled':
      return { place: 'desk', activity: 'idle', screen: 'idle' };
    case 'thinking':
      return { place: 'desk', activity: 'think', screen: 'idle' };
    case 'planning':
      return { place: 'desk', activity: 'plan', screen: 'plan' };
    case 'reading':
      return { place: 'desk', activity: 'read', screen: category === 'web' ? 'web' : 'doc' };
    case 'writing':
      return { place: 'desk', activity: 'type', screen: 'code' };
    case 'executing_tool':
      if (category === 'test') return { place: 'desk', activity: 'debug', screen: 'terminal' };
      if (category === 'delegate') return { place: 'desk', activity: 'think', screen: 'delegate' };
      return { place: 'desk', activity: 'type', screen: 'terminal' };
    case 'waiting_for_permission':
      return { place: 'desk', activity: 'raise', screen: 'question' };
    case 'collaborating':
      return { place: 'meeting', activity: 'talk', screen: 'idle' };
    case 'completed':
      return { place: 'desk', activity: 'cheer', screen: 'success' };
    case 'failed':
      return { place: 'desk', activity: 'slump', screen: 'error' };
  }
}

const same = (a: VisualIntent, b: VisualIntent) => a.place === b.place && a.activity === b.activity && a.screen === b.screen;

/** Activities shown for a fixed time, after which the character settles. */
const TRANSIENT: Partial<Record<Activity, { ms: number; then: Activity }>> = {
  cheer: { ms: 2600, then: 'idle' },
};

/**
 * Debounces intent changes so rapid tool events don't make characters thrash:
 * each intent is held for at least `minDwellMs`, intermediate intents are
 * coalesced to the latest, and attention-critical changes apply immediately.
 */
export class IntentScheduler {
  current: VisualIntent;
  since: number;
  pending?: VisualIntent;

  constructor(
    initial: VisualIntent,
    now: number,
    private readonly minDwellMs = 900,
  ) {
    this.current = initial;
    this.since = now;
  }

  propose(intent: VisualIntent, now: number) {
    if (same(intent, this.current)) {
      this.pending = undefined;
      return;
    }
    const urgent = intent.place !== this.current.place || intent.activity === 'raise' || this.current.activity === 'raise' || intent.activity === 'slump';
    if (urgent || now - this.since >= this.minDwellMs) this.apply(intent, now);
    else this.pending = intent;
  }

  tick(now: number): VisualIntent {
    const transient = TRANSIENT[this.current.activity];
    if (transient && now - this.since >= transient.ms) {
      const settled = { ...this.current, activity: transient.then };
      if (this.pending) this.apply(this.pending, now);
      else this.apply(settled, now);
    } else if (this.pending && now - this.since >= this.minDwellMs && !transient) {
      this.apply(this.pending, now);
    }
    return this.current;
  }

  private apply(intent: VisualIntent, now: number) {
    this.current = intent;
    this.since = now;
    this.pending = undefined;
  }
}
