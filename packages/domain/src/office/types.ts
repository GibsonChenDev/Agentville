export const OFFICE_THEMES = ['loft', 'studio', 'midnight', 'garden', 'seaside', 'sakura', 'space'] as const;
export type OfficeTheme = (typeof OFFICE_THEMES)[number];
/** Maps bought in the shop (see CATALOG in team-protocol); the others are free. */
export const PREMIUM_THEMES = ['sakura', 'space'] as const satisfies readonly OfficeTheme[];

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface TilePoint {
  x: number;
  y: number;
}

export interface Workstation {
  id: string;
  /** Tile the character sits on. */
  seat: TilePoint;
  /** Direction the seated character faces. */
  facing: 'up' | 'down';
  deskId: string;
}

export interface FurniturePlacement {
  id: string;
  kind: string;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  variant?: number;
  /** Flip horizontally; the only rotation supported by three-quarter sprites. */
  flipped?: boolean;
}

export interface OfficeLayout {
  theme: OfficeTheme;
  cols: number;
  rows: number;
  /** Floor rows start below the back wall. */
  wallRows: number;
  door: TilePoint;
  furniture: FurniturePlacement[];
  workstations: Workstation[];
  meetingSpots: (TilePoint & { facing: Facing })[];
  loungeSpots: (TilePoint & { facing: Facing })[];
}
