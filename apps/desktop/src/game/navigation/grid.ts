import type { TilePoint } from '@agentville/domain';

export class NavGrid {
  private readonly blocked: Uint8Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.blocked = new Uint8Array(cols * rows);
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  setBlocked(x: number, y: number, value = true) {
    if (this.inBounds(x, y)) this.blocked[y * this.cols + x] = value ? 1 : 0;
  }

  isWalkable(x: number, y: number) {
    return this.inBounds(x, y) && this.blocked[y * this.cols + x] === 0;
  }

  /**
   * A* over 8-connected tiles without corner cutting. `allow` lets specific
   * otherwise-blocked tiles (e.g. a seat or doorway) be used as endpoints.
   */
  findPath(from: TilePoint, to: TilePoint, allow: TilePoint[] = []): TilePoint[] | null {
    const allowed = new Set(allow.map((p) => p.y * this.cols + p.x));
    const ok = (x: number, y: number) => this.inBounds(x, y) && (this.blocked[y * this.cols + x] === 0 || allowed.has(y * this.cols + x));
    if (!ok(to.x, to.y)) return null;
    const start = from.y * this.cols + from.x;
    const goal = to.y * this.cols + to.x;
    const g = new Float64Array(this.cols * this.rows).fill(Infinity);
    const came = new Int32Array(this.cols * this.rows).fill(-1);
    const closed = new Uint8Array(this.cols * this.rows);
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - to.x);
      const dy = Math.abs(Math.floor(i / this.cols) - to.y);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const open: { i: number; f: number }[] = [{ i: start, f: h(start) }];
    g[start] = 0;
    while (open.length) {
      let best = 0;
      for (let k = 1; k < open.length; k++) if (open[k]!.f < open[best]!.f) best = k;
      const { i } = open.splice(best, 1)[0]!;
      if (i === goal) return this.reconstruct(came, i);
      if (closed[i]) continue;
      closed[i] = 1;
      const x = i % this.cols;
      const y = Math.floor(i / this.cols);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!ok(nx, ny)) continue;
          if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue;
          const ni = ny * this.cols + nx;
          const cost = g[i]! + (dx && dy ? Math.SQRT2 : 1);
          if (cost < g[ni]!) {
            g[ni] = cost;
            came[ni] = i;
            open.push({ i: ni, f: cost + h(ni) });
          }
        }
      }
    }
    return null;
  }

  /** Nearest walkable tile to `p` (breadth-first), used when an agent spawns inside furniture. */
  nearestWalkable(p: TilePoint): TilePoint | null {
    const seen = new Set<number>();
    const queue: TilePoint[] = [p];
    while (queue.length) {
      const c = queue.shift()!;
      const key = c.y * this.cols + c.x;
      if (seen.has(key) || !this.inBounds(c.x, c.y)) continue;
      seen.add(key);
      if (this.isWalkable(c.x, c.y)) return c;
      queue.push({ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 });
    }
    return null;
  }

  private reconstruct(came: Int32Array, end: number): TilePoint[] {
    const path: TilePoint[] = [];
    for (let i = end; i !== -1; i = came[i]!) path.push({ x: i % this.cols, y: Math.floor(i / this.cols) });
    return path.reverse();
  }
}
