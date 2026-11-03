import type { HairColor, OutfitColor, SkinTone } from '@agentville/domain';
import type { Color } from '../engine/pixel';

/** Master palette. All character colours resolve through these tables. */
export const SKIN: Record<SkinTone, Color> = {
  porcelain: '#f7dcc6',
  light: '#efc39f',
  tan: '#d89c6e',
  olive: '#bf8858',
  brown: '#8e5a3a',
  deep: '#5d3b2a',
};

export const HAIR: Record<HairColor, Color> = {
  espresso: '#4b2f27',
  black: '#24212c',
  auburn: '#8c3a28',
  blonde: '#e4b65e',
  silver: '#c8cbd6',
  teal: '#2f8f8a',
  rose: '#d67b99',
  ginger: '#cc6430',
};

export const OUTFIT: Record<OutfitColor, Color> = {
  coral: '#e2705c',
  mustard: '#e0a93d',
  sage: '#8fae87',
  teal: '#2b8a8a',
  navy: '#2f4170',
  plum: '#73446f',
  charcoal: '#3c3f4a',
  cream: '#eee2cb',
  denim: '#4c6c99',
  forest: '#30604a',
  neon: '#3ff0c8',
  gold: '#e8b923',
};

export const INK = '#231d2b';
export const WHITE = '#fbf7ef';
export const BLUSH = '#ef8c8c';
