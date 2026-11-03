import type { Facing, TilePoint } from '@agentville/domain';
import { FURNITURE } from '../furniture/furniture';
import { TILE, type SceneDefinition } from './layouts';

/**
 * Things a person (you or a teammate) can use: desk chairs, sofa places,
 * beanbags and the arcade. Ids are stable for a given layout, so a teammate's
 * "sitting on sofa:sofa:1" means the same place on every screen.
 */
export type InteractKind = 'desk' | 'sofa' | 'arcade';

export interface Interactable {
  id: string;
  kind: InteractKind;
  /** Tiles that select this thing when clicked. */
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
}

export function interactablesFor(scene: SceneDefinition): Interactable[] {
  const out: Interactable[] = [];
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
        out.push({ id: `sofa:${p.id}:${i}`, kind: 'sofa', hit: [{ x: p.x + dx, y: p.y }, ...(i === 0 ? [{ x: p.x + 1, y: p.y }] : [])], approach: { x: p.x + dx, y: p.y + 1 }, x: p.x * TILE + px, y: p.y * TILE + 13, facing: 'down', z }),
      );
    }
    if (p.kind === 'beanbag') {
      out.push({ id: `bean:${p.id}`, kind: 'sofa', hit: [{ x: p.x, y: p.y }], approach: { x: p.x, y: p.y + 1 }, x: p.x * TILE + 8, y: p.y * TILE + 12, facing: 'down', z });
    }
    if (p.kind === 'arcade') {
      out.push({ id: `arcade:${p.id}`, kind: 'arcade', hit: [{ x: p.x, y: p.y }], approach: { x: p.x, y: p.y + 1 }, x: p.x * TILE + 8, y: (p.y + 1) * TILE + 12, facing: 'up', z: (p.y + 1) * TILE + 12 });
    }
  }
  return out;
}

export function interactableAt(list: Interactable[], tile: TilePoint): Interactable | undefined {
  return list.find((it) => it.hit.some((h) => h.x === tile.x && h.y === tile.y));
}
