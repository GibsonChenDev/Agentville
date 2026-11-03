import { describe, expect, it } from 'vitest';
import { NavGrid } from './grid';

describe('NavGrid', () => {
  it('finds a straight path', () => {
    const g = new NavGrid(5, 5);
    const p = g.findPath({ x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(p).toHaveLength(5);
    expect(p.at(-1)).toEqual({ x: 4, y: 0 });
  });

  it('routes around obstacles without cutting corners', () => {
    const g = new NavGrid(5, 5);
    for (let y = 0; y < 4; y++) g.setBlocked(2, y);
    const p = g.findPath({ x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(p.some((t) => t.x === 2 && t.y === 4)).toBe(true);
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!;
      const b = p[i]!;
      if (a.x !== b.x && a.y !== b.y) {
        expect(g.isWalkable(b.x, a.y) && g.isWalkable(a.x, b.y)).toBe(true);
      }
    }
  });

  it('returns null when unreachable and allows explicit endpoints', () => {
    const g = new NavGrid(3, 3);
    g.setBlocked(1, 0);
    g.setBlocked(1, 1);
    g.setBlocked(1, 2);
    expect(g.findPath({ x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
    const seat = new NavGrid(3, 1);
    seat.setBlocked(2, 0);
    expect(seat.findPath({ x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(seat.findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, [{ x: 2, y: 0 }])).toHaveLength(3);
  });

  it('finds the nearest walkable tile', () => {
    const g = new NavGrid(3, 3);
    g.setBlocked(1, 1);
    expect(g.isWalkable(1, 1)).toBe(false);
    const n = g.nearestWalkable({ x: 1, y: 1 })!;
    expect(g.isWalkable(n.x, n.y)).toBe(true);
  });
});
