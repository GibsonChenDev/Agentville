import type { OfficeTheme } from '@agentville/domain';
import type { Color } from '../engine/pixel';

export interface ThemeStyle {
  id: OfficeTheme;
  void: Color;
  floor: { kind: 'planks' | 'tiles' | 'carpet' | 'tatami' | 'metal'; base: Color; alt: Color; seam: Color };
  wall: { kind: 'brick' | 'plaster' | 'panel' | 'shiplap' | 'shoji' | 'hull'; base: Color; alt: Color; mortar: Color; crown: Color; baseboard: Color };
  cap: Color;
  window: { skyTop: Color; skyBottom: Color; frame: Color; night: boolean; scenery: 'city' | 'hills' | 'nightcity' | 'garden' | 'sea' | 'sakura' | 'space' };
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
  garden: {
    id: 'garden',
    void: '#1a2219',
    floor: { kind: 'tiles', base: '#c98a62', alt: '#bd7d56', seam: '#9c6243' },
    wall: { kind: 'plaster', base: '#dfe9d2', alt: '#d2dfc3', mortar: '#b9c9a8', crown: '#5e7f4e', baseboard: '#4f6b41' },
    cap: '#2f4030',
    window: { skyTop: '#86c9ef', skyBottom: '#e6f6d9', frame: '#4f6b41', night: false, scenery: 'garden' },
    desk: { top: '#d9c29a', edge: '#a88c62', leg: '#4f6b41', accent: '#7cc06a' },
    chair: '#6f9a58',
    rug: { base: '#8fae87', border: '#f2e3b3', pattern: '#5e7f4e' },
    sofa: '#d98b5f',
    darkness: { color: '#000000', alpha: 0 },
    warmLight: '#fff4c9',
    screenGlow: '#c9f2ff',
    accent: '#ff9db0',
  },
  seaside: {
    id: 'seaside',
    void: '#141c26',
    floor: { kind: 'planks', base: '#e3d6bf', alt: '#d8c9ae', seam: '#b8a78a' },
    wall: { kind: 'shiplap', base: '#eef3f5', alt: '#e2eaee', mortar: '#c3d0d6', crown: '#2f5f7a', baseboard: '#2f5f7a' },
    cap: '#21384a',
    window: { skyTop: '#f7a76c', skyBottom: '#ffe1b3', frame: '#f4f7f8', night: false, scenery: 'sea' },
    desk: { top: '#f1ebe0', edge: '#c9bda8', leg: '#2f5f7a', accent: '#3fa7c4' },
    chair: '#3fa7c4',
    rug: { base: '#e9c46a', border: '#f4f7f8', pattern: '#f4845f' },
    sofa: '#e9c46a',
    darkness: { color: '#3a1f2a', alpha: 0.08 },
    warmLight: '#ffd9a0',
    screenGlow: '#bfe9ff',
    accent: '#f4845f',
  },
  // Bought in the shop (PREMIUM_THEMES).
  sakura: {
    id: 'sakura',
    void: '#1f1618',
    floor: { kind: 'tatami', base: '#cdbf86', alt: '#c4b67c', seam: '#3f5a3a' },
    wall: { kind: 'shoji', base: '#f6f0e3', alt: '#ece3d1', mortar: '#7a5034', crown: '#4f3426', baseboard: '#4a3428' },
    cap: '#3a2a24',
    window: { skyTop: '#a8d8f5', skyBottom: '#ffe6ee', frame: '#5c4030', night: false, scenery: 'sakura' },
    desk: { top: '#b98a5e', edge: '#7a5034', leg: '#3a2a24', accent: '#f28fb0' },
    chair: '#7a5034',
    rug: { base: '#a33b3b', border: '#e8c25a', pattern: '#f2c9d6' },
    sofa: '#a33b3b',
    darkness: { color: '#2a1418', alpha: 0.04 },
    warmLight: '#ffe2b8',
    screenGlow: '#c9f2ff',
    accent: '#f28fb0',
  },
  space: {
    id: 'space',
    void: '#04050b',
    floor: { kind: 'metal', base: '#454d5e', alt: '#3e4655', seam: '#232835' },
    wall: { kind: 'hull', base: '#2b3245', alt: '#333b51', mortar: '#1a1f2c', crown: '#141824', baseboard: '#1b2030' },
    cap: '#0b0d16',
    window: { skyTop: '#03040c', skyBottom: '#141a3e', frame: '#9aa3b8', night: true, scenery: 'space' },
    desk: { top: '#d3d9e4', edge: '#8a93a8', leg: '#2b3245', accent: '#8b6dff' },
    chair: '#3d4660',
    rug: { base: '#232a3c', border: '#8b6dff', pattern: '#43f0d6' },
    sofa: '#5b4fbf',
    darkness: { color: '#070a24', alpha: 0.4 },
    warmLight: '#d6e4ff',
    screenGlow: '#7fe6ff',
    accent: '#8b6dff',
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
