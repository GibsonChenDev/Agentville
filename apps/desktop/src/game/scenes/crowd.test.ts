import { describe, expect, it } from 'vitest';
import { FURNITURE } from '../furniture/furniture';
import { NavGrid } from '../navigation/grid';
import { waitingSpots } from './crowd';
import { interactablesFor } from './interactables';
import { DEFAULT_SCENES } from './layouts';

describe('waiting spots (more agents than desks)', () => {
  for (const scene of Object.values(DEFAULT_SCENES)) {
    it(`${scene.theme}: room for a crowd, all reachable and out of everyone's way`, () => {
      const spots = waitingSpots(scene);
      // Far more than the 32 agents one person can have, beyond the ~10 desks.
      expect(spots.length).toBeGreaterThan(60);
      expect(new Set(spots.map((p) => `${p.x},${p.y}`)).size).toBe(spots.length);

      const reserved = new Set([
        `${scene.door.x},${scene.door.y}`,
        ...scene.workstations.map((w) => `${w.seat.x},${w.seat.y}`),
        ...[...scene.meetingSpots, ...scene.loungeSpots].map((s) => `${s.x},${s.y}`),
        ...interactablesFor(scene).map((i) => `${i.approach.x},${i.approach.y}`),
      ]);
      const nav = new NavGrid(scene.cols, scene.rows);
      for (let x = 0; x < scene.cols; x++) for (let y = 0; y < scene.wallRows; y++) nav.setBlocked(x, y);
      for (const f of scene.furniture) {
        const def = FURNITURE[f.kind]!;
        for (let dx = 0; dx < def.fw; dx++) for (let dy = 0; dy < def.fh; dy++) nav.setBlocked(f.x + dx, f.y + dy);
      }
      for (const p of spots) {
        expect(reserved.has(`${p.x},${p.y}`), `${p.x},${p.y} is reserved`).toBe(false);
        expect(nav.findPath(scene.door, p, [p]), `${p.x},${p.y} unreachable`).not.toBeNull();
      }
    });
  }

  it('fills the nearest spots first, spread out', () => {
    const scene = DEFAULT_SCENES.loft;
    const [a, b] = waitingSpots(scene);
    const dist = (p: { x: number; y: number }) => Math.abs(p.x - scene.door.x) + Math.abs(p.y - scene.door.y);
    expect(dist(a!)).toBeLessThanOrEqual(4);
    expect((a!.x + a!.y) % 2).toBe(0);
    expect((b!.x + b!.y) % 2).toBe(0);
  });
});
