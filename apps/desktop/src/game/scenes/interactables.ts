import type { Facing, TilePoint } from '@agentville/domain';
import { FURNITURE } from '../furniture/furniture';
import { TILE, type SceneDefinition } from './layouts';

/**
 * Things a person (you or a teammate) can use: desk chairs, sofa places,
 * beanbags, the arcade and the dice table. Ids are stable for a given layout, so a teammate's
 * "sitting on sofa:sofa:1" means the same place on every screen.
 *
 * The arcade and the dice table have several spots so a few people can use
 * them at once: three in front of the cabinet, six around the table. The
 * first spot keeps the id older versions used (`arcade:<id>`, `dice:<id>`).
 */
export type InteractKind = 'desk' | 'sofa' | 'arcade' | 'dice';

export interface Interactable {
  id: string;
  kind: InteractKind;
  /** Tiles that select this thing when clicked (including the parts of tall sprites drawn above the footprint). */
  hit: TilePoint[];
  /** Walkable tile to stand on before using it. */
  approach: TilePoint;
  /** Where the feet go while using it (art px), and which way the person faces. */
  x: number;
  y: number;
  facing: Facing;
  /** Draw order while in use. */
  z: number;
  /** Workstation id, for desks. */
  workstationId?: string;
  /** The piece of furniture, when several spots share it (arcade, dice table). */
  furnitureId?: string;
}

/** A spot to stand at next to a piece of furniture: tile offset from its top-left, and which way you face. */
type Spot = [dx: number, dy: number, facing: Facing];

const ARCADE_SPOTS: Spot[] = [
  [0, 1, 'up'],
  [-1, 1, 'up'],
  [1, 1, 'up'],
];
const DICE_SPOTS: Spot[] = [
  [0, 1, 'up'],
  [1, 1, 'up'],
  [0, -1, 'down'],
  [1, -1, 'down'],
  [-1, 0, 'right'],
  [2, 0, 'left'],
];

/**
 * Everything usable in a scene. `isFloor` drops the extra spots of shared
 * furniture that stand on something (a wall, another piece of furniture).
 */
export function interactablesFor(scene: SceneDefinition, isFloor: (t: TilePoint) => boolean = () => true): Interactable[] {
  const out: Interactable[] = [];
  const spots = (p: { id: string; x: number; y: number }, prefix: string, kind: InteractKind, list: Spot[], hit: TilePoint[]) =>
    list.forEach(([dx, dy, facing], i) => {
      const approach = { x: p.x + dx, y: p.y + dy };
      if (!isFloor(approach)) return;
      const y = approach.y * TILE + 12;
      out.push({ id: i ? `${prefix}:${p.id}:${i}` : `${prefix}:${p.id}`, kind, hit, approach, x: approach.x * TILE + 8, y, facing, z: y, furnitureId: p.id });
    });
  for (const ws of scene.workstations) {
    const desk = scene.furniture.find((f) => f.id === ws.deskId);
    if (!desk) continue;
    const deskBottom = (desk.y + 1) * TILE;
    const up = ws.facing === 'up';
    out.push({
      id: ws.id,
      kind: 'desk',
      hit: [ws.seat, { x: desk.x, y: desk.y }, { x: desk.x + 1, y: desk.y }],
      approach: ws.seat,
      // Same geometry as the renderer's seats (OfficeWorld.buildStation).
      x: up ? desk.x * TILE + 16 : desk.x * TILE + 21,
      y: up ? desk.y * TILE + 17 : desk.y * TILE + 4,
      facing: ws.facing,
      z: up ? deskBottom + 6 : deskBottom - 3,
      workstationId: ws.id,
    });
  }
  for (const p of scene.furniture) {
    const def = FURNITURE[p.kind];
    if (!def) continue;
    const z = (p.y + def.fh) * TILE + 1;
    if (p.kind === 'sofa') {
      // Two cushions; each is a seat reached from the floor in front of it.
      [
        { dx: 0, px: 15 },
        { dx: 2, px: 33 },
      ].forEach(({ dx, px }, i) =>
        out.push({ id: `sofa:${p.id}:${i}`, kind: 'sofa', hit: [{ x: p.x + dx, y: p.y }, { x: p.x + dx, y: p.y - 1 }, ...(i === 0 ? [{ x: p.x + 1, y: p.y }, { x: p.x + 1, y: p.y - 1 }] : [])], approach: { x: p.x + dx, y: p.y + 1 }, x: p.x * TILE + px, y: p.y * TILE + 13, facing: 'down', z }),
      );
    }
    if (p.kind === 'beanbag') {
      out.push({ id: `bean:${p.id}`, kind: 'sofa', hit: [{ x: p.x, y: p.y }], approach: { x: p.x, y: p.y + 1 }, x: p.x * TILE + 8, y: p.y * TILE + 12, facing: 'down', z });
    }
    if (p.kind === 'dice_table') {
      const hit = [0, 1].flatMap((dx) => [
        { x: p.x + dx, y: p.y },
        { x: p.x + dx, y: p.y - 1 },
      ]);
      spots(p, 'dice', 'dice', DICE_SPOTS, hit);
    }
    if (p.kind === 'arcade') {
      // The cabinet stands about three tiles tall: clicking anywhere on it counts.
      spots(p, 'arcade', 'arcade', ARCADE_SPOTS, [{ x: p.x, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y - 2 }]);
    }
  }
  return out;
}

export function interactableAt(list: Interactable[], tile: TilePoint): Interactable | undefined {
  return list.find((it) => it.hit.some((h) => h.x === tile.x && h.y === tile.y));
}

/**
 * Things you can use from where you stand: you're on or next to (diagonals
 * count) any tile of them or the spot in front of them, from any side.
 * Nearest first; ties go to the one whose spot is closest.
 */
export function withinReach(list: Interactable[], tile: TilePoint, reach = 1): Interactable[] {
  const cheb = (a: TilePoint) => Math.max(Math.abs(a.x - tile.x), Math.abs(a.y - tile.y));
  return list
    .map((it) => ({ it, d: Math.min(cheb(it.approach), ...it.hit.map(cheb)), spot: Math.hypot(it.approach.x - tile.x, it.approach.y - tile.y) }))
    .filter((c) => c.d <= reach)
    .sort((a, b) => a.d - b.d || a.spot - b.spot)
    .map((c) => c.it);
}
