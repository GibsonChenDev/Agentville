import type { FurniturePlacement, TilePoint, Workstation } from '@agentville/domain';
import { FURNITURE } from '../furniture/furniture';
import { NavGrid } from '../navigation/grid';
import { DEFAULT_DESK_IDS, type SceneDefinition } from './layouts';

/**
 * Pure office-layout editing rules. Every edit returns a new scene or a stable
 * error code; the renderer and the editor UI never mutate layouts themselves.
 */

export type LayoutError =
  | 'unknown_kind'
  | 'unknown_item'
  | 'out_of_bounds'
  | 'overlaps'
  | 'blocks_door'
  | 'blocks_spot'
  | 'seat_blocked'
  | 'blocks_path'
  | 'last_desk';

export type EditResult = { ok: true; scene: SceneDefinition } | { ok: false; error: LayoutError };

export const EDITABLE_KINDS = ['desk', ...Object.keys(FURNITURE).filter((k) => k !== 'desk')] as const;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function footprint(p: Pick<FurniturePlacement, 'kind' | 'x' | 'y'>): Rect | null {
  const def = FURNITURE[p.kind];
  return def ? { x: p.x, y: p.y, w: def.fw, h: def.fh } : null;
}

const cells = (r: Rect): TilePoint[] => Array.from({ length: r.w * r.h }, (_, i) => ({ x: r.x + (i % r.w), y: r.y + Math.floor(i / r.w) }));
const key = (p: TilePoint) => `${p.x},${p.y}`;

export function seatFor(desk: Pick<FurniturePlacement, 'x' | 'y'>, facing: 'up' | 'down'): TilePoint {
  return facing === 'up' ? { x: desk.x, y: desk.y + 1 } : { x: desk.x, y: desk.y - 1 };
}

function inFloor(scene: SceneDefinition, t: TilePoint) {
  return t.x >= 1 && t.x <= scene.cols - 2 && t.y >= scene.wallRows && t.y <= scene.rows - 2;
}

/** Validates a whole scene; returns the first problem found. */
export function validateScene(scene: SceneDefinition): LayoutError | null {
  const occupied = new Map<string, string>();
  for (const p of scene.furniture) {
    const r = footprint(p);
    if (!r) return 'unknown_kind';
    for (const c of cells(r)) {
      if (!inFloor(scene, c)) return 'out_of_bounds';
      if (occupied.has(key(c))) return 'overlaps';
      occupied.set(key(c), p.id);
    }
  }
  if (occupied.has(key(scene.door))) return 'blocks_door';
  for (const s of [...scene.meetingSpots, ...scene.loungeSpots]) if (occupied.has(key(s))) return 'blocks_spot';
  const seats = new Set<string>();
  for (const ws of scene.workstations) {
    if (!inFloor(scene, ws.seat) || occupied.has(key(ws.seat)) || seats.has(key(ws.seat))) return 'seat_blocked';
    seats.add(key(ws.seat));
  }
  if (!scene.workstations.length) return 'last_desk';

  // Every seat and gathering spot must be reachable on foot from the door.
  const nav = new NavGrid(scene.cols, scene.rows);
  for (let y = 0; y < scene.rows; y++)
    for (let x = 0; x < scene.cols; x++) if (!inFloor(scene, { x, y }) || occupied.has(key({ x, y })) || seats.has(key({ x, y }))) nav.setBlocked(x, y);
  const targets = [...scene.workstations.map((w) => w.seat), ...scene.meetingSpots, ...scene.loungeSpots];
  for (const t of targets) if (!nav.findPath(scene.door, t, [t, scene.door])) return 'blocks_path';
  return null;
}

function result(scene: SceneDefinition): EditResult {
  const error = validateScene(scene);
  return error ? { ok: false, error } : { ok: true, scene };
}

export function moveFurniture(scene: SceneDefinition, id: string, x: number, y: number): EditResult {
  const item = scene.furniture.find((f) => f.id === id);
  if (!item) return { ok: false, error: 'unknown_item' };
  const furniture = scene.furniture.map((f) => (f.id === id ? { ...f, x, y } : f));
  const workstations = scene.workstations.map((w) => (w.deskId === id ? { ...w, seat: seatFor({ x, y }, w.facing) } : w));
  return result({ ...scene, furniture, workstations });
}

/**
 * Adds a piece. `owner` tags it with whoever bought it (shop decorations), so a
 * shared office can tell whose copies are whose: `item-<owner>-u<n>`.
 */
export function addFurniture(scene: SceneDefinition, kind: string, x: number, y: number, owner?: string): EditResult {
  if (!FURNITURE[kind]) return { ok: false, error: 'unknown_kind' };
  const n = nextIndex(scene);
  const item: FurniturePlacement = { id: `${kind === 'desk' ? 'desk' : 'item'}${owner ? `-${owner}` : ''}-u${n}`, kind, x, y };
  const workstations: Workstation[] =
    kind === 'desk' ? [...scene.workstations, { id: `ws-u${n}`, deskId: item.id, facing: 'up', seat: seatFor(item, 'up') }] : scene.workstations;
  return result({ ...scene, furniture: [...scene.furniture, item], workstations });
}

export function removeFurniture(scene: SceneDefinition, id: string): EditResult {
  if (!scene.furniture.some((f) => f.id === id)) return { ok: false, error: 'unknown_item' };
  const workstations = scene.workstations.filter((w) => w.deskId !== id);
  if (!workstations.length) return { ok: false, error: 'last_desk' };
  return result({ ...scene, furniture: scene.furniture.filter((f) => f.id !== id), workstations });
}

export function setDeskFacing(scene: SceneDefinition, deskId: string, facing: 'up' | 'down'): EditResult {
  const desk = scene.furniture.find((f) => f.id === deskId && f.kind === 'desk');
  if (!desk) return { ok: false, error: 'unknown_item' };
  const workstations = scene.workstations.map((w) => (w.deskId === deskId ? { ...w, facing, seat: seatFor(desk, facing) } : w));
  return result({ ...scene, workstations });
}

function nextIndex(scene: SceneDefinition) {
  const used = scene.furniture.map((f) => Number(/-u(\d+)$/.exec(f.id)?.[1] ?? 0));
  return Math.max(0, ...used) + 1;
}

// ───────────────────────────────── persistence

export interface LayoutDoc {
  version: 1;
  furniture: FurniturePlacement[];
  workstations: Workstation[];
}

export function toLayoutDoc(scene: SceneDefinition): LayoutDoc {
  return { version: 1, furniture: scene.furniture, workstations: scene.workstations };
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Applies a stored layout over the theme's base scene; anything invalid yields the base scene. */
export function fromLayoutDoc(raw: unknown, base: SceneDefinition): SceneDefinition {
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.furniture) || !Array.isArray(r.workstations)) return base;
  const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : NaN);
  const furniture: FurniturePlacement[] = [];
  for (const f of r.furniture as Record<string, unknown>[]) {
    if (!f || typeof f.id !== 'string' || !ID.test(f.id) || typeof f.kind !== 'string') return base;
    // A piece this version doesn't know (bought in a newer app by a teammate) is left out, not the whole layout.
    if (!FURNITURE[f.kind]) continue;
    const x = int(f.x);
    const y = int(f.y);
    if (Number.isNaN(x) || Number.isNaN(y)) return base;
    furniture.push({ id: f.id, kind: f.kind, x, y });
  }
  const desks = new Map(furniture.filter((f) => f.kind === 'desk').map((f) => [f.id, f]));
  const workstations: Workstation[] = [];
  for (const w of r.workstations as Record<string, unknown>[]) {
    if (!w || typeof w.id !== 'string' || !ID.test(w.id) || typeof w.deskId !== 'string' || (w.facing !== 'up' && w.facing !== 'down')) return base;
    const desk = desks.get(w.deskId);
    if (!desk) return base;
    workstations.push({ id: w.id, deskId: w.deskId, facing: w.facing, seat: seatFor(desk, w.facing) });
  }
  if (furniture.some((f) => f.kind === 'desk' && !PLACED.test(f.id) && !DEFAULT_DESK_IDS.has(f.id))) return rearranged(base, furniture, workstations);
  const scene = { ...base, furniture, workstations };
  return validateScene(scene) ? base : scene;
}

/** Pieces someone added in the editor or bought, as opposed to the default layout's own. */
const PLACED = /-u\d+$/;

/**
 * An office saved with the desks of an earlier default layout gets the theme's
 * current one, so everyone sees the same new arrangement. What people placed
 * themselves comes along: on its own tile when that's still free, else on the
 * nearest free one, and left out only when nothing nearby fits.
 */
function rearranged(base: SceneDefinition, furniture: FurniturePlacement[], workstations: Workstation[]): SceneDefinition {
  let scene = base;
  for (const item of furniture) {
    if (!PLACED.test(item.id)) continue;
    const seats = workstations.filter((w) => w.deskId === item.id);
    scene = nearestFit(scene, item, seats) ?? scene;
  }
  return scene;
}

function nearestFit(scene: SceneDefinition, item: FurniturePlacement, seats: Workstation[]): SceneDefinition | null {
  for (let r = 0; r <= 6; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const at = { x: item.x + dx, y: item.y + dy };
        const next: SceneDefinition = {
          ...scene,
          furniture: [...scene.furniture, { ...item, ...at }],
          workstations: [...scene.workstations, ...seats.map((w) => ({ ...w, seat: seatFor(at, w.facing) }))],
        };
        if (!validateScene(next)) return next;
      }
  return null;
}

/**
 * Pieces of `kind` someone placed (built-in pieces of the default layout, like
 * its dice table, don't count); with `owner`, only the ones that owner placed.
 */
export function placedCount(scene: Pick<SceneDefinition, 'furniture'>, kind: string, owner?: string): number {
  return scene.furniture.filter((f) => f.kind === kind && f.id.startsWith('item-') && (!owner || f.id.includes(`-${owner}-`))).length;
}
