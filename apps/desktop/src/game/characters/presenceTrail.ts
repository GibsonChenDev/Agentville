import type { Presence } from '@agentville/team-protocol';

/**
 * How a teammate moves on your screen. Their app reports a position about ten
 * times a second; drawn as-is they'd lurch from point to point, and network
 * jitter makes the gaps uneven. Instead the reports are queued with their
 * arrival time and the character is shown a little in the past, gliding
 * between the two reports around that moment — smooth, at their real speed,
 * facing the way their own app says they face.
 */
export const PEER_DELAY_MS = 150;
/** The delay adapts to how unevenly reports arrive: just over the longest recent gap, within these bounds. */
const MIN_DELAY_MS = 120;
const MAX_DELAY_MS = 350;
/** Reports further apart than this are a jump (through a door, a respawn), not a walk. */
const JUMP_PX = 96;
const KEEP = 24;

interface Report {
  p: Presence;
  at: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  /** The report in effect: facing, pose and seat. */
  p: Presence;
  /** Between two different positions right now (show the walk cycle). */
  moving: boolean;
}

export class PresenceTrail {
  private reports: Report[] = [];
  /** Gaps between recent reports while walking (a pause between walks isn't network delay). */
  private gaps: number[] = [];

  push(p: Presence, at: number) {
    const prev = this.reports.at(-1);
    if (prev && prev.p.pose === 'walk' && p.pose === 'walk') {
      this.gaps.push(at - prev.at);
      if (this.gaps.length > 12) this.gaps.shift();
    }
    this.reports.push({ p, at });
    if (this.reports.length > KEEP) this.reports.shift();
  }

  /** How far in the past to show them: enough that the next report has usually arrived. */
  get delay(): number {
    if (!this.gaps.length) return PEER_DELAY_MS;
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.max(...this.gaps) + 30));
  }

  get latest(): Presence | undefined {
    return this.reports.at(-1)?.p;
  }

  /** Where to draw the teammate at `now`. */
  at(now: number, delay = this.delay): TrailPoint | undefined {
    const r = this.reports;
    if (!r.length) return undefined;
    const t = now - delay;
    // Forget reports that are fully in the past, keeping the one we're leaving.
    while (r.length > 1 && r[1]!.at <= t) r.shift();
    const a = r[0]!;
    const b = r[1];
    if (!b || t <= a.at) {
      // Waiting for the next report: hold still, unless they're still walking and it's just late.
      const stillWalking = !b && a.p.pose === 'walk' && now - a.at < 300;
      return { x: a.p.x, y: a.p.y, p: a.p, moving: stillWalking };
    }
    const dist = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
    if (dist > JUMP_PX || dist < 0.01) return { x: a.p.x, y: a.p.y, p: a.p, moving: false };
    const k = Math.min(1, (t - a.at) / Math.max(1, b.at - a.at));
    return { x: a.p.x + (b.p.x - a.p.x) * k, y: a.p.y + (b.p.y - a.p.y) * k, p: { ...a.p, facing: b.p.facing }, moving: true };
  }
}
