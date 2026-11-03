/**
 * Character appearance. Values are option ids; colors are palette ids resolved
 * by the renderer so that every combination stays inside the art direction palette.
 */
export const GENDERS = ['male', 'female'] as const;
export const HAIR_STYLES = ['short', 'bob', 'long', 'bun', 'curly', 'buzz', 'ponytail', 'mohawk', 'twintails', 'undercut'] as const;
export const HAIR_COLORS = ['espresso', 'black', 'auburn', 'blonde', 'silver', 'teal', 'rose', 'ginger'] as const;
export const SKIN_TONES = ['porcelain', 'light', 'tan', 'olive', 'brown', 'deep'] as const;
export const FACES = ['smile', 'calm', 'focused', 'cheerful'] as const;
export const TOPS = ['hoodie', 'tee', 'shirt', 'blazer', 'sweater', 'vest', 'polo', 'suit', 'blouse', 'cardigan', 'camisole', 'dress'] as const;
export const BOTTOMS = ['jeans', 'chinos', 'skirt', 'shorts', 'joggers', 'cargo', 'pleated'] as const;
export const SHOES = ['sneakers', 'boots', 'loafers', 'hightops'] as const;
const BASE_ACCESSORIES = ['none', 'glasses', 'headphones', 'cap', 'beanie', 'scarf', 'lanyard'] as const;
const BASE_OUTFIT_COLORS = ['coral', 'mustard', 'sage', 'teal', 'navy', 'plum', 'charcoal', 'cream', 'denim', 'forest'] as const;
/** Bought in the shop (see CATALOG in team-protocol); never chosen for auto-generated looks. */
export const PREMIUM_ACCESSORIES = ['flower', 'cat_ears', 'wizard_hat', 'crown', 'bow', 'sunglasses', 'party_hat', 'bunny_ears', 'chef_hat', 'santa_hat', 'antenna', 'devil_horns', 'top_hat', 'viking', 'halo'] as const;
export const PREMIUM_OUTFIT_COLORS = ['neon', 'gold', 'sakura', 'mint', 'sky', 'lavender', 'ruby', 'onyx'] as const;
export const ACCESSORIES = [...BASE_ACCESSORIES, ...PREMIUM_ACCESSORIES] as const;
export const OUTFIT_COLORS = [...BASE_OUTFIT_COLORS, ...PREMIUM_OUTFIT_COLORS] as const;
export const EQUIPMENT = ['laptop', 'monitor', 'dual_monitor', 'desktop_tower', 'tablet', 'debug_rig'] as const;

export type Gender = (typeof GENDERS)[number];
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
  /** Body: face details and silhouette. Never limits which clothes or hair can be chosen. */
  gender: Gender;
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

// ───────────────────────────────── men's / women's styles

/** Which styles are men's or women's; anything not listed is unisex. Only for grouping and defaults: anyone can wear anything. */
export const STYLE_GENDER: { hairStyle: Partial<Record<HairStyle, Gender>>; top: Partial<Record<Top, Gender>>; bottom: Partial<Record<Bottom, Gender>> } = {
  hairStyle: { short: 'male', buzz: 'male', mohawk: 'male', undercut: 'male', bob: 'female', long: 'female', bun: 'female', ponytail: 'female', twintails: 'female' },
  top: { shirt: 'male', blazer: 'male', vest: 'male', polo: 'male', suit: 'male', blouse: 'female', cardigan: 'female', camisole: 'female', dress: 'female' },
  bottom: { chinos: 'male', cargo: 'male', skirt: 'female', pleated: 'female' },
};

export type GenderedField = keyof typeof STYLE_GENDER;

/** 'male', 'female' or 'any' (unisex) for a hair style, top or bottom. */
export function styleGender(field: GenderedField, value: string): Gender | 'any' {
  return (STYLE_GENDER[field] as Record<string, Gender>)[value] ?? 'any';
}

const LISTS = { hairStyle: HAIR_STYLES, top: TOPS, bottom: BOTTOMS } as const;

/** The styles that suit a gender by default: its own plus the unisex ones. */
export function stylesFor<F extends GenderedField>(field: F, gender: Gender): CharacterAppearance[F][] {
  return (LISTS[field] as readonly string[]).filter((v) => styleGender(field, v) !== (gender === 'male' ? 'female' : 'male')) as CharacterAppearance[F][];
}

const DEFAULT_STYLE: Record<Gender, Pick<CharacterAppearance, GenderedField>> = {
  male: { hairStyle: 'short', top: 'polo', bottom: 'chinos' },
  female: { hairStyle: 'long', top: 'blouse', bottom: 'pleated' },
};

/**
 * Changes the body's gender. Hair and clothes that belong to the other gender
 * switch to this gender's defaults; unisex ones stay. The person can pick any
 * style again afterwards — nothing is off limits.
 */
export function withGender(a: CharacterAppearance, gender: Gender): CharacterAppearance {
  const out = { ...a, gender };
  const other = gender === 'male' ? 'female' : 'male';
  for (const field of ['hairStyle', 'top', 'bottom'] as const) if (styleGender(field, a[field]) === other) (out as Record<string, string>)[field] = DEFAULT_STYLE[gender][field];
  return out;
}

/** For looks saved before characters had a gender: read it from the hair and clothes (a tie goes by hair, then bottom). */
export function inferGender(a: Pick<CharacterAppearance, GenderedField>): Gender {
  let score = 0;
  for (const field of ['hairStyle', 'top', 'bottom'] as const) {
    const g = styleGender(field, a[field]);
    score += g === 'female' ? 1 : g === 'male' ? -1 : 0;
  }
  if (score) return score > 0 ? 'female' : 'male';
  for (const field of ['hairStyle', 'bottom', 'top'] as const) {
    const g = styleGender(field, a[field]);
    if (g !== 'any') return g;
  }
  return 'male';
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
  const gender = pick(GENDERS);
  return {
    gender,
    hairStyle: pick(stylesFor('hairStyle', gender)),
    hairColor: pick(HAIR_COLORS),
    skin: pick(SKIN_TONES),
    face: pick(FACES),
    top: pick(stylesFor('top', gender)),
    topColor: pick(BASE_OUTFIT_COLORS),
    bottom: pick(stylesFor('bottom', gender)),
    bottomColor: pick(['denim', 'charcoal', 'navy', 'cream', 'forest'] as const),
    shoes: pick(SHOES),
    shoesColor: pick(['charcoal', 'cream', 'coral', 'navy'] as const),
    accessory: pick(BASE_ACCESSORIES),
    equipment: pick(EQUIPMENT),
  };
}
