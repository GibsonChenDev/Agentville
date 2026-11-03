import type { TilePoint } from '@agentville/domain';
import type { OfficeWorld } from '../../game/engine/OfficeWorld';

/** Imperative handle to the mounted world for toolbar/keyboard camera controls. */
export const worldApi: {
  current: OfficeWorld | null;
  /** Pending walk-in for the next scene: through the office door, or a lobby door tile. */
  arrival?: TilePoint | 'office';
} = { current: null };
