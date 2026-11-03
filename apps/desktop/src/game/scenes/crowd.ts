import type { TilePoint } from '@agentville/domain';
import { FURNITURE } from '../furniture/furniture';
import { interactablesFor } from './interactables';
import type { SceneDefinition } from './layouts';

/**
 * Where agents wait when every desk is taken: open floor reachable from the
 * door, nearest first. Never a seat, a tile people step on to use something
 * (desk, sofa, beanbag, arcade), a gathering spot, or the doorway and the row
 * just inside it where people arrive. Alternate tiles come first so a crowd
 * spreads out instead of standing shoulder to shoulder.
 */
export function waitingSpots(scene: SceneDefinition): TilePoint[] {
  const key = (p: TilePoint) => p.y * scene.cols + p.x;
  const blocked = new Set<number>();
  for (const f of scene.furniture) {
    const def = FURNITURE[f.kind];
    if (!def?.blocks) continue;
    for (let dx = 0; dx < def.fw; dx++) for (let dy = 0; dy < def.fh; dy++) blocked.add(key({ x: f.x + dx, y: f.y + dy }));
  }
  const reserved = new Set<number>([key(scene.door)]);
  for (let dx = -1; dx <= 2; dx++) reserved.add(key({ x: scene.door.x + dx, y: scene.door.y + 1 }));
  for (const s of [...scene.meetingSpots, ...scene.loungeSpots]) reserved.add(key(s));
  for (const w of scene.workstations) reserved.add(key(w.seat));
  for (const it of interactablesFor(scene)) reserved.add(key(it.approach));

  const floor = (p: TilePoint) => p.x >= 1 && p.x <= scene.cols - 2 && p.y >= scene.wallRows && p.y <= scene.rows - 2 && !blocked.has(key(p));
  // Breadth-first from the door, so "nearest" means nearest on foot.
  const seen = new Set<number>([key(scene.door)]);
  const queue: TilePoint[] = [scene.door];
  const found: TilePoint[] = [];
  while (queue.length) {
    const p = queue.shift()!;
    if (!reserved.has(key(p))) found.push(p);
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!seen.has(key(n)) && floor(n)) {
        seen.add(key(n));
        queue.push(n);
      }
    }
  }
  const spaced = found.filter((p) => (p.x + p.y) % 2 === 0);
  return [...spaced, ...found.filter((p) => (p.x + p.y) % 2 !== 0)];
}
