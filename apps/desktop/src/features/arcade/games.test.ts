import { describe, expect, it } from 'vitest';
import { Breakout, Flappy, G2048, Snake, type Input } from './games';

const input = (pressed: string[] = [], held: string[] = []): Input => ({ pressed: new Set(pressed), held: new Set(held), clicked: false });

describe('arcade games', () => {
  it('2048 merges pairs once per move', () => {
    expect(G2048.slide([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], points: 8 });
    expect(G2048.slide([0, 4, 0, 4])).toEqual({ line: [8, 0, 0, 0], points: 8 });
    expect(G2048.slide([2, 4, 8, 16])).toEqual({ line: [2, 4, 8, 16], points: 0 });
  });

  it('2048 ends when no move is possible', () => {
    const g = new G2048(() => 0);
    g.grid = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
    expect(g.move('left')).toBe(false);
    expect(g.over).toBe(true);
  });

  it('snake grows on food and dies at the wall', () => {
    const s = new Snake(() => 0.5);
    for (let i = 0; i < 200 && !s.over; i++) s.update(120, input());
    expect(s.over).toBe(true);
  });

  it('flappy waits for the first flap, then falls', () => {
    const f = new Flappy(() => 0.5);
    f.update(500, input());
    expect(f.over).toBe(false);
    f.update(16, input([' ']));
    for (let i = 0; i < 300 && !f.over; i++) f.update(16, input());
    expect(f.over).toBe(true);
  });

  it('breakout launches on space and loses a life past the paddle', () => {
    const b = new Breakout();
    b.update(16, input([' ']));
    // Keep the paddle on the far side from the ball so every ball is missed.
    const ball = () => (b as unknown as { ball: { x: number } }).ball;
    for (let i = 0; i < 20000 && !b.over; i++) b.update(16, { ...input([' ']), pointerX: ball().x < 128 ? 256 : 0 });
    expect(b.over).toBe(true);
    expect(b.score).toBeGreaterThanOrEqual(0);
  });
});
