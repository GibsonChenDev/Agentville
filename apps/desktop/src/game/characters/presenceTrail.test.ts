import type { Presence } from '@agentville/team-protocol';
import { describe, expect, it } from 'vitest';
import { PEER_DELAY_MS, PresenceTrail } from './presenceTrail';

const walk = (x: number, y = 100, facing: Presence['facing'] = 'right'): Presence => ({ x, y, facing, pose: 'walk' });

describe("a teammate's movement on your screen", () => {
  it('glides at an even speed between reports instead of lurching', () => {
    const trail = new PresenceTrail();
    // Their app reports 7.2 px every 100 ms (walking at 72 px/s).
    for (let i = 0; i <= 10; i++) trail.push(walk(100 + i * 7.2), 1000 + i * 100);
    expect(trail.at(1200)!.moving).toBe(true);
    const xs: number[] = [];
    for (let now = 1200; now <= 1900; now += 16) xs.push(trail.at(now)!.x);
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const s of steps) expect(s).toBeCloseTo(7.2 * 0.16, 1); // same distance every frame
  });

  it('smooths over uneven network timing', () => {
    const trail = new PresenceTrail();
    // Reports arrive bunched up: 40 ms, 160 ms, 100 ms apart…
    const arrivals = [1000, 1040, 1200, 1300, 1420, 1500];
    arrivals.forEach((at, i) => trail.push(walk(100 + i * 7.2), at));
    let last = -Infinity;
    for (let now = 1150; now <= 1650; now += 10) {
      const x = trail.at(now)!.x;
      expect(x).toBeGreaterThanOrEqual(last); // never jumps backwards
      expect(x - (last === -Infinity ? x : last)).toBeLessThan(7.2); // never jumps a whole report at once
      last = x;
    }
  });

  it('waits a little longer when reports arrive unevenly, so it never stalls and jumps', () => {
    const trail = new PresenceTrail();
    // Gaps of up to 190 ms between reports, as in a jittery network.
    const arrivals = [0, 100, 160, 140, 380, 400, 440, 630, 700, 800, 900, 1060, 1100];
    arrivals.forEach((at, i) => trail.push(walk(100 + i * 7.2), 1000 + at));
    expect(trail.delay).toBeGreaterThan(190);
    expect(trail.delay).toBeLessThanOrEqual(350);
    let last = trail.at(1000 + 380)!.x;
    let stalls = 0;
    for (let now = 1000 + 400; now <= 1000 + 1100; now += 16) {
      const x = trail.at(now)!.x;
      if (x === last) stalls++;
      last = x;
    }
    expect(stalls).toBe(0);
  });

  it('faces the way their own app says, not the way it guesses from small moves', () => {
    const trail = new PresenceTrail();
    trail.push(walk(100, 100, 'up'), 1000);
    trail.push({ ...walk(101, 93), facing: 'up' }, 1100);
    expect(trail.at(1000 + 50 + PEER_DELAY_MS)!.p.facing).toBe('up');
  });

  it('stops where they stopped, standing, and jumps instead of sliding across a door', () => {
    const trail = new PresenceTrail();
    trail.push(walk(100), 1000);
    trail.push({ x: 110, y: 100, facing: 'down', pose: 'stand' }, 1100);
    const stopped = trail.at(2000)!;
    expect(stopped).toMatchObject({ x: 110, moving: false, p: { pose: 'stand', facing: 'down' } });
    trail.push(walk(400, 60), 2100); // came back in through another door
    expect(trail.at(2100 + PEER_DELAY_MS - 10)!.x).toBe(110);
    expect(trail.at(2100 + PEER_DELAY_MS + 1)!.x).toBe(400);
  });

  it('keeps the walk cycle going when a report is a little late, then holds', () => {
    const trail = new PresenceTrail();
    trail.push(walk(100), 1000);
    expect(trail.at(1000 + 200)!.moving).toBe(true);
    expect(trail.at(1000 + 400)!.moving).toBe(false);
  });
});
