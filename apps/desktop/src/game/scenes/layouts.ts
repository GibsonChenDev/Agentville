import type { FurniturePlacement, OfficeLayout, OfficeTheme, TilePoint, Workstation } from '@agentville/domain';

export const TILE = 16;

export type WallDecor =
  | { kind: 'window'; x: number; w: number; panes?: number }
  | { kind: 'door'; x: number }
  /** A closed office door in the lobby; `plate` colours its name plate. */
  | { kind: 'office_door'; x: number; plate: string }
  | { kind: 'poster'; x: number; y: number; variant: number }
  | { kind: 'clock'; x: number; y: number }
  | { kind: 'shelf'; x: number; y: number; w: number }
  | { kind: 'neon'; x: number; y: number }
  | { kind: 'wall_whiteboard'; x: number; w: number }
  | { kind: 'pendant'; x: number }
  | { kind: 'slats'; x: number; w: number }
  | { kind: 'chalkboard'; x: number; y: number };

export interface Rug {
  x: number;
  y: number;
  w: number;
  h: number;
  style: 'persian' | 'stripe' | 'round' | 'grid';
}

export interface SceneDefinition extends OfficeLayout {
  wallDecor: WallDecor[];
  rugs: Rug[];
}

/** Desk + its workstation. `facing: 'up'` = sitter in front of desk looking at the screen. */
function station(id: string, x: number, y: number, facing: 'up' | 'down'): { desk: FurniturePlacement; ws: Workstation } {
  const desk: FurniturePlacement = { id: `desk-${id}`, kind: 'desk', x, y };
  const seat: TilePoint = facing === 'up' ? { x, y: y + 1 } : { x, y: y - 1 };
  return { desk, ws: { id: `ws-${id}`, seat, facing, deskId: desk.id } };
}

function build(
  base: Omit<SceneDefinition, 'furniture' | 'workstations'>,
  stations: [string, number, number, 'up' | 'down'][],
  furniture: FurniturePlacement[],
): SceneDefinition {
  const built = stations.map(([id, x, y, f]) => station(id, x, y, f));
  return { ...base, furniture: [...built.map((b) => b.desk), ...furniture], workstations: built.map((b) => b.ws) };
}

const f = (id: string, kind: string, x: number, y: number, variant?: number): FurniturePlacement => ({ id, kind, x, y, variant });

const COMMON = { cols: 30, rows: 20, wallRows: 4, door: { x: 24, y: 4 } } as const;

export const DEFAULT_SCENES: Record<OfficeTheme, SceneDefinition> = {
  loft: build(
    {
      theme: 'loft',
      ...COMMON,
      meetingSpots: [
        { x: 19, y: 7, facing: 'right' },
        { x: 19, y: 8, facing: 'right' },
        { x: 23, y: 7, facing: 'left' },
        { x: 23, y: 8, facing: 'left' },
        { x: 21, y: 9, facing: 'up' },
        { x: 20, y: 9, facing: 'up' },
      ],
      loungeSpots: [
        { x: 17, y: 5, facing: 'up' },
        { x: 18, y: 5, facing: 'up' },
        { x: 21, y: 14, facing: 'up' },
      ],
      wallDecor: [
        { kind: 'window', x: 28, w: 84, panes: 4 },
        { kind: 'window', x: 132, w: 84, panes: 4 },
        { kind: 'chalkboard', x: 262, y: 12 },
        { kind: 'clock', x: 232, y: 14 },
        { kind: 'door', x: 384 },
        { kind: 'poster', x: 424, y: 14, variant: 0 },
        { kind: 'pendant', x: 72 },
        { kind: 'pendant', x: 176 },
      ],
      rugs: [
        { x: 3, y: 8, w: 11, h: 6, style: 'persian' },
        { x: 18, y: 12, w: 8, h: 5, style: 'stripe' },
      ],
    },
    [
      ['b1', 2, 4, 'up'],
      ['b2', 5, 4, 'up'],
      ['b3', 8, 4, 'up'],
      ['b4', 11, 4, 'up'],
      ['i1', 4, 10, 'down'],
      ['i2', 7, 10, 'down'],
      ['i3', 10, 10, 'down'],
      ['i4', 4, 11, 'up'],
      ['i5', 7, 11, 'up'],
      ['i6', 10, 11, 'up'],
      ['k1', 10, 15, 'down'],
      ['k2', 13, 15, 'down'],
      ['k3', 16, 15, 'down'],
      ['k4', 10, 16, 'up'],
      ['k5', 13, 16, 'up'],
      ['k6', 16, 16, 'up'],
    ],
    [
      f('bar', 'coffee_bar', 16, 4),
      f('shelf', 'bookshelf', 21, 4),
      f('m1', 'plant_monstera', 1, 4),
      f('m2', 'plant_monstera', 27, 4),
      f('fid', 'plant_fiddle', 14, 4),
      f('m3', 'plant_monstera', 1, 17),
      f('m4', 'plant_fiddle', 28, 17),
      f('meet', 'meeting_table', 20, 7),
      f('wb', 'whiteboard', 25, 7),
      f('sofa', 'sofa', 19, 13),
      f('ct', 'coffee_table', 20, 15),
      f('lamp', 'floor_lamp', 18, 13),
      f('bean', 'beanbag', 24, 15),
      f('succ', 'plant_succulent', 14, 11),
      f('water', 'water_cooler', 28, 10),
      f('arcade', 'arcade', 27, 13),
      f('dice', 'dice_table', 6, 16),
    ],
  ),
  studio: build(
    {
      theme: 'studio',
      ...COMMON,
      meetingSpots: [
        { x: 19, y: 10, facing: 'right' },
        { x: 19, y: 11, facing: 'right' },
        { x: 23, y: 10, facing: 'left' },
        { x: 23, y: 11, facing: 'left' },
        { x: 21, y: 12, facing: 'up' },
        { x: 21, y: 9, facing: 'down' },
      ],
      loungeSpots: [
        { x: 18, y: 17, facing: 'right' },
        { x: 25, y: 17, facing: 'left' },
      ],
      wallDecor: [
        { kind: 'wall_whiteboard', x: 26, w: 92 },
        { kind: 'clock', x: 129, y: 14 },
        { kind: 'window', x: 140, w: 140, panes: 5 },
        { kind: 'slats', x: 296, w: 72 },
        { kind: 'door', x: 384 },
        { kind: 'poster', x: 440, y: 12, variant: 1 },
        { kind: 'pendant', x: 104 },
        { kind: 'pendant', x: 210 },
      ],
      rugs: [
        { x: 2, y: 6, w: 11, h: 6, style: 'grid' },
        { x: 18, y: 15, w: 9, h: 4, style: 'round' },
      ],
    },
    [
      ['a1', 3, 8, 'down'],
      ['a2', 5, 8, 'down'],
      ['a3', 7, 8, 'down'],
      ['a4', 9, 8, 'down'],
      ['a5', 3, 9, 'up'],
      ['a6', 5, 9, 'up'],
      ['a7', 7, 9, 'up'],
      ['a8', 9, 9, 'up'],
      ['c1', 4, 14, 'up'],
      ['c2', 8, 14, 'up'],
      ['c3', 12, 14, 'up'],
      ['c4', 4, 13, 'down'],
      ['c5', 8, 13, 'down'],
      ['c6', 12, 13, 'down'],
      ['t1', 4, 4, 'up'],
      ['t2', 8, 4, 'up'],
    ],
    [
      f('bar', 'coffee_bar', 19, 4),
      f('water', 'water_cooler', 23, 4),
      f('shelf', 'bookshelf', 27, 4),
      f('m1', 'plant_monstera', 1, 4),
      f('m2', 'plant_monstera', 13, 4),
      f('fid', 'plant_fiddle', 15, 9),
      f('meet', 'meeting_table', 20, 10),
      f('wb', 'whiteboard', 25, 9),
      f('sofa', 'sofa', 20, 15),
      f('ct', 'coffee_table', 21, 17),
      f('bean1', 'beanbag', 24, 17),
      f('bean2', 'beanbag', 18, 16),
      f('succ1', 'plant_succulent', 11, 8),
      f('succ2', 'plant_succulent', 11, 9),
      f('m3', 'plant_monstera', 28, 17),
      f('lamp', 'floor_lamp', 11, 17),
      f('arcade', 'arcade', 28, 12),
      f('dice', 'dice_table', 14, 16),
    ],
  ),
  midnight: build(
    {
      theme: 'midnight',
      ...COMMON,
      meetingSpots: [
        { x: 19, y: 8, facing: 'right' },
        { x: 19, y: 9, facing: 'right' },
        { x: 23, y: 8, facing: 'left' },
        { x: 23, y: 9, facing: 'left' },
        { x: 21, y: 10, facing: 'up' },
        { x: 20, y: 10, facing: 'up' },
      ],
      loungeSpots: [
        { x: 18, y: 17, facing: 'right' },
        { x: 26, y: 16, facing: 'up' },
      ],
      wallDecor: [
        { kind: 'window', x: 40, w: 104, panes: 3 },
        { kind: 'neon', x: 196, y: 16 },
        { kind: 'clock', x: 292, y: 14 },
        { kind: 'poster', x: 160, y: 14, variant: 2 },
        { kind: 'door', x: 384 },
        { kind: 'shelf', x: 336, y: 22, w: 36 },
      ],
      rugs: [
        { x: 4, y: 8, w: 11, h: 6, style: 'grid' },
        { x: 17, y: 13, w: 9, h: 5, style: 'round' },
      ],
    },
    [
      ['w1', 3, 4, 'up'],
      ['w2', 6, 4, 'up'],
      ['w3', 12, 4, 'up'],
      ['p1', 5, 10, 'down'],
      ['p2', 8, 10, 'down'],
      ['p3', 11, 10, 'down'],
      ['p4', 5, 11, 'up'],
      ['p5', 8, 11, 'up'],
      ['p6', 11, 11, 'up'],
      ['w4', 9, 4, 'up'],
      ['q1', 3, 15, 'down'],
      ['q2', 6, 15, 'down'],
      ['q3', 9, 15, 'down'],
      ['q4', 3, 16, 'up'],
      ['q5', 6, 16, 'up'],
      ['q6', 9, 16, 'up'],
    ],
    [
      f('rack1', 'server_rack', 17, 4),
      f('rack2', 'server_rack', 18, 4),
      f('rack3', 'server_rack', 19, 4),
      f('arcade', 'arcade', 27, 4),
      f('m1', 'plant_monstera', 1, 4),
      f('m2', 'plant_monstera', 1, 17),
      f('fid', 'plant_fiddle', 28, 17),
      f('meet', 'meeting_table', 20, 8),
      f('wb', 'whiteboard', 25, 8),
      f('sofa', 'sofa', 19, 14),
      f('ct', 'coffee_table', 20, 16),
      f('lamp', 'floor_lamp', 17, 14),
      f('bean', 'beanbag', 24, 16),
      f('water', 'water_cooler', 22, 4),
      f('lamp2', 'floor_lamp', 15, 4),
      f('dice', 'dice_table', 13, 16),
    ],
  ),
  garden: build(
    {
      theme: 'garden',
      ...COMMON,
      meetingSpots: [
        { x: 18, y: 8, facing: 'right' },
        { x: 18, y: 9, facing: 'right' },
        { x: 22, y: 8, facing: 'left' },
        { x: 22, y: 9, facing: 'left' },
        { x: 20, y: 10, facing: 'up' },
        { x: 19, y: 10, facing: 'up' },
      ],
      loungeSpots: [
        { x: 17, y: 16, facing: 'right' },
        { x: 25, y: 17, facing: 'left' },
      ],
      wallDecor: [
        { kind: 'window', x: 24, w: 100, panes: 5 },
        { kind: 'window', x: 140, w: 100, panes: 5 },
        { kind: 'clock', x: 256, y: 14 },
        { kind: 'door', x: 384 },
        { kind: 'poster', x: 424, y: 14, variant: 1 },
        { kind: 'pendant', x: 74 },
        { kind: 'pendant', x: 190 },
      ],
      rugs: [
        { x: 2, y: 8, w: 10, h: 6, style: 'grid' },
        { x: 18, y: 13, w: 8, h: 5, style: 'round' },
      ],
    },
    [
      ['g1', 3, 4, 'up'],
      ['g2', 6, 4, 'up'],
      ['g3', 9, 4, 'up'],
      ['g4', 12, 4, 'up'],
      ['g5', 4, 10, 'down'],
      ['g6', 8, 10, 'down'],
      ['g7', 4, 11, 'up'],
      ['g8', 8, 11, 'up'],
      ['g9', 2, 16, 'up'],
      ['g10', 5, 16, 'up'],
      ['g11', 8, 16, 'up'],
      ['g12', 2, 15, 'down'],
      ['g13', 5, 15, 'down'],
      ['g14', 8, 15, 'down'],
      ['g15', 12, 10, 'down'],
      ['g16', 12, 11, 'up'],
    ],
    [
      f('bar', 'coffee_bar', 17, 4),
      f('shelf', 'bookshelf', 21, 4),
      f('m1', 'plant_monstera', 1, 4),
      f('m2', 'plant_monstera', 15, 4),
      f('m3', 'plant_monstera', 1, 17),
      f('m4', 'plant_monstera', 28, 17),
      f('fid1', 'plant_fiddle', 14, 12),
      f('fid2', 'plant_fiddle', 27, 4),
      f('succ1', 'plant_succulent', 15, 10),
      f('succ2', 'plant_succulent', 15, 11),
      f('succ3', 'plant_succulent', 11, 13),
      f('meet', 'meeting_table', 19, 8),
      f('wb', 'whiteboard', 24, 8),
      f('sofa', 'sofa', 19, 14),
      f('ct', 'coffee_table', 20, 16),
      f('lamp', 'floor_lamp', 18, 14),
      f('bean', 'beanbag', 24, 16),
      f('water', 'water_cooler', 28, 9),
      f('arcade', 'arcade', 27, 12),
      f('dice', 'dice_table', 12, 16),
    ],
  ),
  seaside: build(
    {
      theme: 'seaside',
      ...COMMON,
      meetingSpots: [
        { x: 18, y: 10, facing: 'right' },
        { x: 18, y: 11, facing: 'right' },
        { x: 22, y: 10, facing: 'left' },
        { x: 22, y: 11, facing: 'left' },
        { x: 20, y: 12, facing: 'up' },
        { x: 20, y: 9, facing: 'down' },
      ],
      loungeSpots: [
        { x: 17, y: 17, facing: 'right' },
        { x: 23, y: 17, facing: 'left' },
      ],
      wallDecor: [
        { kind: 'window', x: 24, w: 120, panes: 4 },
        { kind: 'window', x: 156, w: 96, panes: 3 },
        { kind: 'clock', x: 296, y: 14 },
        { kind: 'door', x: 384 },
        { kind: 'shelf', x: 340, y: 22, w: 36 },
        { kind: 'poster', x: 448, y: 14, variant: 0 },
        { kind: 'pendant', x: 84 },
        { kind: 'pendant', x: 204 },
      ],
      rugs: [
        { x: 2, y: 4, w: 11, h: 11, style: 'stripe' },
        { x: 17, y: 14, w: 9, h: 5, style: 'round' },
      ],
    },
    [
      ['s1', 3, 6, 'down'],
      ['s2', 6, 6, 'down'],
      ['s3', 9, 6, 'down'],
      ['s4', 3, 7, 'up'],
      ['s5', 6, 7, 'up'],
      ['s6', 9, 7, 'up'],
      ['s7', 3, 12, 'down'],
      ['s8', 6, 12, 'down'],
      ['s9', 3, 13, 'up'],
      ['s10', 6, 13, 'up'],
      ['s11', 9, 12, 'down'],
      ['s12', 9, 13, 'up'],
      ['r1', 13, 6, 'down'],
      ['r2', 16, 6, 'down'],
      ['r3', 13, 7, 'up'],
      ['r4', 16, 7, 'up'],
    ],
    [
      f('bar', 'coffee_bar', 17, 4),
      f('shelf', 'bookshelf', 26, 4),
      f('m1', 'plant_monstera', 1, 4),
      f('m2', 'plant_monstera', 14, 4),
      f('m3', 'plant_monstera', 1, 17),
      f('fid', 'plant_fiddle', 28, 17),
      f('succ', 'plant_succulent', 12, 12),
      f('meet', 'meeting_table', 19, 10),
      f('wb', 'whiteboard', 24, 10),
      f('sofa', 'sofa', 18, 15),
      f('ct', 'coffee_table', 19, 17),
      f('lamp', 'floor_lamp', 17, 15),
      f('lamp2', 'floor_lamp', 22, 4),
      f('bean1', 'beanbag', 25, 16),
      f('bean2', 'beanbag', 13, 16),
      f('water', 'water_cooler', 28, 7),
      f('arcade', 'arcade', 28, 13),
      f('dice', 'dice_table', 9, 16),
    ],
  ),
  // Bought in the shop: they come with a few of the shop's decorations.
  sakura: build(
    {
      theme: 'sakura',
      ...COMMON,
      meetingSpots: [
        { x: 18, y: 8, facing: 'right' },
        { x: 18, y: 9, facing: 'right' },
        { x: 22, y: 8, facing: 'left' },
        { x: 22, y: 9, facing: 'left' },
        { x: 20, y: 10, facing: 'up' },
        { x: 19, y: 10, facing: 'up' },
      ],
      loungeSpots: [
        { x: 17, y: 16, facing: 'right' },
        { x: 25, y: 17, facing: 'left' },
      ],
      wallDecor: [
        { kind: 'window', x: 24, w: 100, panes: 4 },
        { kind: 'window', x: 140, w: 100, panes: 4 },
        { kind: 'clock', x: 262, y: 14 },
        { kind: 'door', x: 384 },
        { kind: 'poster', x: 424, y: 14, variant: 1 },
        { kind: 'pendant', x: 74 },
        { kind: 'pendant', x: 190 },
      ],
      rugs: [{ x: 17, y: 13, w: 9, h: 5, style: 'round' }],
    },
    [
      ['h1', 2, 4, 'up'],
      ['h2', 5, 4, 'up'],
      ['h3', 8, 4, 'up'],
      ['h4', 11, 4, 'up'],
      ['m1', 2, 9, 'down'],
      ['m2', 5, 9, 'down'],
      ['m3', 8, 9, 'down'],
      ['m4', 2, 10, 'up'],
      ['m5', 5, 10, 'up'],
      ['m6', 8, 10, 'up'],
      ['n1', 2, 14, 'down'],
      ['n2', 5, 14, 'down'],
      ['n3', 8, 14, 'down'],
      ['n4', 2, 15, 'up'],
      ['n5', 5, 15, 'up'],
      ['n6', 8, 15, 'up'],
    ],
    [
      f('koi', 'aquarium', 14, 4),
      f('bar', 'coffee_bar', 17, 4),
      f('shelf', 'bookshelf', 21, 4),
      f('bonsai1', 'bonsai', 1, 4),
      f('bonsai2', 'bonsai', 11, 12),
      f('meet', 'meeting_table', 19, 8),
      f('wb', 'whiteboard', 24, 8),
      f('sofa', 'sofa', 19, 14),
      f('ct', 'coffee_table', 20, 16),
      f('lamp', 'floor_lamp', 18, 14),
      f('bean', 'beanbag', 24, 16),
      f('water', 'water_cooler', 28, 9),
      f('arcade', 'arcade', 28, 12),
      f('dice', 'dice_table', 13, 13),
      f('piano', 'piano', 13, 17),
      f('cat', 'cat', 16, 17),
      f('fid', 'plant_fiddle', 28, 17),
      f('m1', 'plant_monstera', 1, 17),
    ],
  ),
  space: build(
    {
      theme: 'space',
      ...COMMON,
      meetingSpots: [
        { x: 18, y: 8, facing: 'right' },
        { x: 18, y: 9, facing: 'right' },
        { x: 22, y: 8, facing: 'left' },
        { x: 22, y: 9, facing: 'left' },
        { x: 20, y: 10, facing: 'up' },
        { x: 19, y: 10, facing: 'up' },
      ],
      loungeSpots: [
        { x: 17, y: 16, facing: 'right' },
        { x: 25, y: 17, facing: 'left' },
      ],
      wallDecor: [
        { kind: 'window', x: 28, w: 84, panes: 3 },
        { kind: 'window', x: 132, w: 84, panes: 3 },
        { kind: 'neon', x: 236, y: 16 },
        { kind: 'clock', x: 300, y: 14 },
        { kind: 'door', x: 384 },
        { kind: 'poster', x: 440, y: 14, variant: 2 },
      ],
      rugs: [
        { x: 2, y: 7, w: 13, h: 6, style: 'grid' },
        { x: 18, y: 13, w: 8, h: 5, style: 'round' },
      ],
    },
    [
      ['o1', 2, 4, 'up'],
      ['o2', 5, 4, 'up'],
      ['o3', 8, 4, 'up'],
      ['o4', 11, 4, 'up'],
      ['v1', 3, 9, 'down'],
      ['v2', 6, 9, 'down'],
      ['v3', 9, 9, 'down'],
      ['v4', 12, 9, 'down'],
      ['v5', 3, 10, 'up'],
      ['v6', 6, 10, 'up'],
      ['v7', 9, 10, 'up'],
      ['v8', 12, 10, 'up'],
      ['x1', 3, 15, 'down'],
      ['x2', 6, 15, 'down'],
      ['x3', 3, 16, 'up'],
      ['x4', 6, 16, 'up'],
    ],
    [
      f('rack1', 'server_rack', 15, 4),
      f('rack2', 'server_rack', 16, 4),
      f('rack3', 'server_rack', 17, 4),
      f('water', 'water_cooler', 21, 4),
      f('tele', 'telescope', 27, 4),
      f('meet', 'meeting_table', 19, 8),
      f('wb', 'whiteboard', 24, 8),
      f('vend', 'vending', 28, 8),
      f('robot', 'robot', 28, 11),
      f('arcade', 'arcade', 28, 14),
      f('sofa', 'sofa', 19, 14),
      f('ct', 'coffee_table', 20, 16),
      f('lava', 'lava_lamp', 18, 14),
      f('bean', 'beanbag', 24, 16),
      f('dice', 'dice_table', 10, 16),
      f('claw', 'claw_machine', 28, 17),
      f('globe', 'globe', 14, 12),
    ],
  ),
};

// ───────────────────────────────── lobby

export interface LobbyDoor {
  id: string;
  plate: string;
}

/** Door `i` of the lobby: the floor tile in front of it, where walking in begins. */
export const lobbyDoorTile = (i: number): TilePoint => ({ x: 3 + i * 5, y: 4 });

/** A hallway with one door per office, plants between them and a runner rug. */
export function lobbyScene(doors: LobbyDoor[]): SceneDefinition {
  const cols = Math.max(18, 6 + doors.length * 5);
  const furniture: FurniturePlacement[] = [];
  for (let i = 0; i <= doors.length; i++) {
    const x = 1 + i * 5;
    if (x < cols - 1) furniture.push(f(`plant-${i}`, i % 2 ? 'plant_fiddle' : 'plant_monstera', x, 4));
  }
  furniture.push(f('bench', 'sofa', Math.floor(cols / 2) - 1, 9), f('water', 'water_cooler', cols - 2, 9));
  return {
    theme: 'studio',
    cols,
    rows: 11,
    wallRows: 4,
    door: lobbyDoorTile(0),
    furniture,
    workstations: [],
    meetingSpots: [],
    loungeSpots: [],
    wallDecor: [
      ...doors.map((d, i) => ({ kind: 'office_door' as const, x: lobbyDoorTile(i).x * TILE, plate: d.plate })),
      ...doors.map((_, i) => ({ kind: 'pendant' as const, x: lobbyDoorTile(i).x * TILE + 16 })),
      // A clock on the wall past the last door (the hallway is always at least one door's width longer).
      { kind: 'clock' as const, x: Math.max(lobbyDoorTile(doors.length - 1).x * TILE + 32 + 20, cols * TILE - 32), y: 14 },
    ],
    rugs: [{ x: 2, y: 6, w: cols - 4, h: 2, style: 'stripe' }],
  };
}
