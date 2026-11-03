import type { CharacterAppearance } from '@agentville/domain';
import { Texture, TextureSource } from 'pixi.js';
import { appearanceKey, buildCharacterSheet, type AnimName } from '../assets/characterSprites';
import { drawIcon, drawRing, drawShadow, type IconKind } from '../assets/icons';

// Every procedural asset is pixel art: never sample with bilinear filtering.
TextureSource.defaultOptions.scaleMode = 'nearest';

export function texture(canvas: HTMLCanvasElement): Texture {
  const t = Texture.from(canvas);
  t.source.scaleMode = 'nearest';
  return t;
}

export interface CharacterTextures {
  frames: Record<AnimName, Texture[]>;
  flipped: Partial<Record<AnimName, Texture[]>>;
}

export interface WorldTextures {
  shadow: Texture;
  ring: Texture;
  icons: Record<IconKind, Texture>;
}

const ICON_KINDS: IconKind[] = ['think', 'read', 'type', 'test', 'plan', 'raise', 'cheer', 'slump', 'talk', 'delegate', 'exec', 'phone'];

let world: WorldTextures | null = null;
export function worldTextures(): WorldTextures {
  if (!world) {
    world = {
      shadow: texture(drawShadow().canvas),
      ring: texture(drawRing('#f2b33d').canvas),
      icons: Object.fromEntries(ICON_KINDS.map((k) => [k, texture(drawIcon(k).canvas)])) as Record<IconKind, Texture>,
    };
  }
  return world;
}

const characterCache = new Map<string, CharacterTextures>();

/** Character sheets are cached per appearance so identical outfits share GPU textures. */
export function characterTextures(appearance: CharacterAppearance): CharacterTextures {
  const key = appearanceKey(appearance);
  const hit = characterCache.get(key);
  if (hit) return hit;
  const sheet = buildCharacterSheet(appearance);
  const frames = {} as Record<AnimName, Texture[]>;
  const flipped: Partial<Record<AnimName, Texture[]>> = {};
  for (const [name, canvases] of Object.entries(sheet.frames) as [AnimName, HTMLCanvasElement[]][]) frames[name] = canvases.map(texture);
  for (const [name, canvases] of Object.entries(sheet.flipped) as [AnimName, HTMLCanvasElement[]][]) flipped[name] = canvases.map(texture);
  const result = { frames, flipped };
  characterCache.set(key, result);
  return result;
}

const portraitCache = new Map<string, string>();
/** Data URL of a character's portrait for the React UI (rendered with `image-rendering: pixelated`). */
export function portraitUrl(appearance: CharacterAppearance): string {
  const key = appearanceKey(appearance);
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const url = buildCharacterSheet(appearance).portrait.toDataURL();
  portraitCache.set(key, url);
  return url;
}
