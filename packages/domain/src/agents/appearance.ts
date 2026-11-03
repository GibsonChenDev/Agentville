/**
 * Character appearance. Values are option ids; colors are palette ids resolved
 * by the renderer so that every combination stays inside the art direction palette.
 */
export const HAIR_STYLES = ['short', 'bob', 'long', 'bun', 'curly', 'buzz', 'ponytail', 'mohawk'] as const;
export const HAIR_COLORS = ['espresso', 'black', 'auburn', 'blonde', 'silver', 'teal', 'rose', 'ginger'] as const;
export const SKIN_TONES = ['porcelain', 'light', 'tan', 'olive', 'brown', 'deep'] as const;
export const FACES = ['smile', 'calm', 'focused', 'cheerful'] as const;
export const TOPS = ['hoodie', 'tee', 'shirt', 'blazer', 'sweater', 'vest'] as const;
export const BOTTOMS = ['jeans', 'chinos', 'skirt', 'shorts', 'joggers'] as const;
export const SHOES = ['sneakers', 'boots', 'loafers', 'hightops'] as const;
const BASE_ACCESSORIES = ['none', 'glasses', 'headphones', 'cap', 'beanie', 'scarf', 'lanyard'] as const;
const BASE_OUTFIT_COLORS = ['coral', 'mustard', 'sage', 'teal', 'navy', 'plum', 'charcoal', 'cream', 'denim', 'forest'] as const;
/** Bought in the shop (see CATALOG in team-protocol); never chosen for auto-generated looks. */
export const PREMIUM_ACCESSORIES = ['flower', 'cat_ears', 'wizard_hat', 'crown'] as const;
export const PREMIUM_OUTFIT_COLORS = ['neon', 'gold'] as const;
export const ACCESSORIES = [...BASE_ACCESSORIES, ...PREMIUM_ACCESSORIES] as const;
export const OUTFIT_COLORS = [...BASE_OUTFIT_COLORS, ...PREMIUM_OUTFIT_COLORS] as const;
export const EQUIPMENT = ['laptop', 'monitor', 'dual_monitor', 'desktop_tower', 'tablet', 'debug_rig'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type HairColor = (typeof HAIR_COLORS)[number];
export type SkinTone = (typeof SKIN_TONES)[number];
export type Face = (typeof FACES)[number];
export type Top = (typeof TOPS)[number];
export type Bottom = (typeof BOTTOMS)[number];
export type Shoes = (typeof SHOES)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type OutfitColor = (typeof OUTFIT_COLORS)[number];
/** Visual only. Equipment never grants or implies runtime capabilities. */
export type Equipment = (typeof EQUIPMENT)[number];

export interface CharacterAppearance {
  hairStyle: HairStyle;
  hairColor: HairColor;
  skin: SkinTone;
  face: Face;
  top: Top;
  topColor: OutfitColor;
  bottom: Bottom;
  bottomColor: OutfitColor;
  shoes: Shoes;
  shoesColor: OutfitColor;
  accessory: Accessory;
  equipment: Equipment;
}

/** Deterministic appearance from a seed, used for auto-discovered agents and subagents. */
export function appearanceFromSeed(seed: string): CharacterAppearance {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  return {
    hairStyle: pick(HAIR_STYLES),
    hairColor: pick(HAIR_COLORS),
    skin: pick(SKIN_TONES),
    face: pick(FACES),
    top: pick(TOPS),
    topColor: pick(BASE_OUTFIT_COLORS),
    bottom: pick(BOTTOMS),
    bottomColor: pick(['denim', 'charcoal', 'navy', 'cream', 'forest'] as const),
    shoes: pick(SHOES),
    shoesColor: pick(['charcoal', 'cream', 'coral', 'navy'] as const),
    accessory: pick(BASE_ACCESSORIES),
    equipment: pick(EQUIPMENT),
  };
}
