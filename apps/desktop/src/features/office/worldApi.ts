import type { OfficeWorld } from '../../game/engine/OfficeWorld';

/** Imperative handle to the mounted world for toolbar/keyboard camera controls. */
export const worldApi: { current: OfficeWorld | null } = { current: null };
