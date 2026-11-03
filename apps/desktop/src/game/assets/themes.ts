import type { OfficeTheme } from '@agentville/domain';
import type { Color } from '../engine/pixel';

export interface ThemeStyle {
  id: OfficeTheme;
  void: Color;
  floor: { kind: 'planks' | 'tiles' | 'carpet'; base: Color; alt: Color; seam: Color };
  wall: { kind: 'brick' | 'plaster' | 'panel'; base: Color; alt: Color; mortar: Color; crown: Color; baseboard: Color };
  cap: Color;
  window: { skyTop: Color; skyBottom: Color; frame: Color; night: boolean; scenery: 'city' | 'hills' | 'nightcity' };
  desk: { top: Color; edge: Color; leg: Color; accent?: Color };
  chair: Color;
  rug: { base: Color; border: Color; pattern: Color };
  sofa: Color;
  /** Darkness overlay for the lightmap (alpha 0 = none). */
  darkness: { color: Color; alpha: number };
  warmLight: Color;
  screenGlow: Color;
  accent: Color;
}

export const THEMES: Record<OfficeTheme, ThemeStyle> = {
  loft: {
    id: 'loft',
    void: '#1b1520',
    floor: { kind: 'planks', base: '#b47a4c', alt: '#9f6840', seam: '#6e4329' },
    wall: { kind: 'brick', base: '#a3533b', alt: '#8f4632', mortar: '#6a3426', crown: '#3a2a2a', baseboard: '#4a3127' },
    cap: '#2e2329',
    window: { skyTop: '#8ec5e8', skyBottom: '#f6d7a6', frame: '#2d2c33', night: false, scenery: 'city' },
    desk: { top: '#c8925c', edge: '#8a5a35', leg: '#2d2c33' },
    chair: '#3b3f4c',
    rug: { base: '#c96f4a', border: '#e9c48a', pattern: '#7c3b2e' },
    sofa: '#4f7a6a',
    darkness: { color: '#2a1630', alpha: 0.06 },
    warmLight: '#ffd79a',
    screenGlow: '#9fe7ff',
    accent: '#e2a93d',
  },
  studio: {
    id: 'studio',
    void: '#1e2230',
    floor: { kind: 'tiles', base: '#dcd6cc', alt: '#d2cbc0', seam: '#bdb5a8' },
    wall: { kind: 'plaster', base: '#f2eee7', alt: '#e6e0d6', mortar: '#d6cfc3', crown: '#c9c1b4', baseboard: '#b9b0a2' },
    cap: '#3a3f52',
    window: { skyTop: '#6fb7ea', skyBottom: '#d9efff', frame: '#e9e5de', night: false, scenery: 'hills' },
    desk: { top: '#f4f1ea', edge: '#cfc8bb', leg: '#b98c5e', accent: '#e2705c' },
    chair: '#e2705c',
    rug: { base: '#2f4170', border: '#e0a93d', pattern: '#4c6c99' },
    sofa: '#e0a93d',
    darkness: { color: '#000000', alpha: 0 },
    warmLight: '#fff2cc',
    screenGlow: '#bfe9ff',
    accent: '#e2705c',
  },
  midnight: {
    id: 'midnight',
    void: '#07070f',
    floor: { kind: 'carpet', base: '#262744', alt: '#22223d', seam: '#1a1a31' },
    wall: { kind: 'panel', base: '#1d1f38', alt: '#23264a', mortar: '#14152a', crown: '#0f1022', baseboard: '#121327' },
    cap: '#0b0b18',
    window: { skyTop: '#0b1030', skyBottom: '#2a2a5c', frame: '#141526', night: true, scenery: 'nightcity' },
    desk: { top: '#34364f', edge: '#22233a', leg: '#14152a', accent: '#43f0d6' },
    chair: '#2a2c44',
    rug: { base: '#33285a', border: '#6a4fb3', pattern: '#43f0d6' },
    sofa: '#5b3f8f',
    darkness: { color: '#0a0920', alpha: 0.62 },
    warmLight: '#ffcf8a',
    screenGlow: '#62e6ff',
    accent: '#ff5fa2',
  },
};

/** The hallway with a door to every office. Not an office theme: no desks, no agents. */
export const LOBBY_STYLE: ThemeStyle = {
  id: 'studio',
  void: '#191a24',
  floor: { kind: 'tiles', base: '#c9b99a', alt: '#bfae8d', seam: '#a8977a' },
  wall: { kind: 'panel', base: '#3f6f6a', alt: '#456f6b', mortar: '#2f5552', crown: '#24403e', baseboard: '#2a2a2f' },
  cap: '#2b2d3a',
  window: { skyTop: '#6fb7ea', skyBottom: '#d9efff', frame: '#e9e5de', night: false, scenery: 'hills' },
  desk: { top: '#f4f1ea', edge: '#cfc8bb', leg: '#b98c5e' },
  chair: '#e2705c',
  rug: { base: '#7a2f3a', border: '#e0a93d', pattern: '#a8454f' },
  sofa: '#4f7a6a',
  darkness: { color: '#000000', alpha: 0 },
  warmLight: '#ffe2a8',
  screenGlow: '#bfe9ff',
  accent: '#e0a93d',
};
