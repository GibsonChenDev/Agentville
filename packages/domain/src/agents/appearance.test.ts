import { describe, expect, it } from 'vitest';
import { ACCESSORIES, BOTTOMS, EYEWEAR, HAIR_STYLES, NECKWEAR, SHOES, TOPS, accessorySlot, appearanceFromSeed, inferGender, styleGender, stylesFor, withGender, type CharacterAppearance } from './appearance';
import { sanitizeAppearance } from './profile';

describe('male and female characters', () => {
  it('auto-generated characters come out both male and female, dressed for their gender by default', () => {
    const looks = Array.from({ length: 200 }, (_, i) => appearanceFromSeed(`agent-${i}`));
    const women = looks.filter((a) => a.gender === 'female');
    expect(women.length).toBeGreaterThan(60);
    expect(looks.length - women.length).toBeGreaterThan(60);
    for (const a of looks) {
      const other = a.gender === 'male' ? 'female' : 'male';
      for (const field of ['hairStyle', 'top', 'bottom'] as const) expect(styleGender(field, a[field]), `${a.gender} ${field} ${a[field]}`).not.toBe(other);
    }
  });

  it("every style is men's, women's or unisex, and each gender has several of each", () => {
    for (const [field, list] of [
      ['hairStyle', HAIR_STYLES],
      ['top', TOPS],
      ['bottom', BOTTOMS],
    ] as const) {
      for (const g of ['male', 'female'] as const) {
        const own = list.filter((v) => styleGender(field, v) === g);
        expect(own.length, `${g} ${field}`).toBeGreaterThanOrEqual(2);
        expect(stylesFor(field, g).length).toBeGreaterThan(own.length); // plus unisex
      }
    }
  });

  it("switching gender swaps the other gender's clothes for defaults but keeps unisex ones", () => {
    const man: CharacterAppearance = { ...appearanceFromSeed('x'), gender: 'male', hairStyle: 'undercut', top: 'hoodie', bottom: 'cargo' };
    const woman = withGender(man, 'female');
    expect(woman).toMatchObject({ gender: 'female', hairStyle: 'long', top: 'hoodie', bottom: 'pleated' });
    expect(withGender(woman, 'male')).toMatchObject({ gender: 'male', hairStyle: 'short', top: 'hoodie', bottom: 'chinos' });
  });

  it('anyone can wear anything: a man in a dress or a woman in a suit stays that way', () => {
    const fallback = appearanceFromSeed('y');
    expect(sanitizeAppearance({ ...fallback, gender: 'male', top: 'dress', hairStyle: 'twintails' }, fallback)).toMatchObject({ gender: 'male', top: 'dress', hairStyle: 'twintails' });
    expect(sanitizeAppearance({ ...fallback, gender: 'female', top: 'suit', bottom: 'cargo' }, fallback)).toMatchObject({ gender: 'female', top: 'suit', bottom: 'cargo' });
  });

  it('looks saved before characters had a gender get one from their hair and clothes', () => {
    const fallback = { ...appearanceFromSeed('z'), gender: 'male' as const };
    const { gender: _g, ...old } = { ...fallback, hairStyle: 'bun', top: 'sweater', bottom: 'skirt' };
    expect(sanitizeAppearance(old, fallback).gender).toBe('female');
    expect(inferGender({ hairStyle: 'curly', top: 'hoodie', bottom: 'jeans' })).toBe('male');
    // A tie goes by hair, then by the bottom: curly hair + shirt + skirt reads as a woman.
    expect(inferGender({ hairStyle: 'curly', top: 'shirt', bottom: 'skirt' })).toBe('female');
    expect(inferGender({ hairStyle: 'buzz', top: 'blouse', bottom: 'jeans' })).toBe('male');
    expect(sanitizeAppearance({ ...old, gender: 'robot' }, fallback).gender).toBe('female');
  });
});

describe('clothing slots', () => {
  const base = appearanceFromSeed('slots');

  it('every piece of clothing and every slot can be taken off', () => {
    for (const list of [TOPS, BOTTOMS, SHOES, ACCESSORIES, EYEWEAR, NECKWEAR] as readonly (readonly string[])[]) expect(list).toContain('none');
    const undressed = { ...base, top: 'none', bottom: 'none', shoes: 'none', accessory: 'none', eyewear: 'none', neckwear: 'none' } as const;
    expect(sanitizeAppearance(undressed, base)).toEqual(undressed);
  });

  it('auto-generated characters are always dressed', () => {
    for (let i = 0; i < 300; i++) {
      const a = appearanceFromSeed(`seed-${i}`);
      expect([a.top, a.bottom, a.shoes]).not.toContain('none');
    }
  });

  it('glasses, a hat and a scarf can be worn together', () => {
    const look = { ...base, accessory: 'cap', eyewear: 'glasses', neckwear: 'scarf' } as const;
    expect(sanitizeAppearance(look, base)).toMatchObject({ accessory: 'cap', eyewear: 'glasses', neckwear: 'scarf' });
  });

  it('looks saved with a single accessory move it to its slot', () => {
    const old = (accessory: string) => {
      const { eyewear: _e, neckwear: _n, ...rest } = { ...base, accessory };
      return sanitizeAppearance(rest, { ...base, eyewear: 'glasses', neckwear: 'scarf' });
    };
    expect(old('glasses')).toMatchObject({ accessory: 'none', eyewear: 'glasses', neckwear: 'none' });
    expect(old('sunglasses')).toMatchObject({ accessory: 'none', eyewear: 'sunglasses', neckwear: 'none' });
    expect(old('lanyard')).toMatchObject({ accessory: 'none', eyewear: 'none', neckwear: 'lanyard' });
    // A hat alone meant no glasses and no scarf, whatever the fallback says.
    expect(old('cap')).toMatchObject({ accessory: 'cap', eyewear: 'none', neckwear: 'none' });
  });

  it('shop accessories go to their slot', () => {
    expect(accessorySlot('sunglasses')).toBe('eyewear');
    expect(accessorySlot('lanyard')).toBe('neckwear');
    expect(accessorySlot('crown')).toBe('accessory');
  });
});

describe('auto-generated looks', () => {
  it('stay the same when new styles are added (they are picked by position)', () => {
    // Recorded before the tank top, turtleneck, jersey, lab coat, ripped jeans, leggings, maxi skirt, sandals, heels, beret, bucket hat, headband, round glasses, bow tie and necklace were added.
    const before: Record<string, CharacterAppearance> = {
      "ext-abc": {"gender": "male", "hairStyle": "mohawk", "hairColor": "black", "skin": "olive", "face": "calm", "top": "sweater", "topColor": "sage", "bottom": "cargo", "bottomColor": "navy", "shoes": "hightops", "shoesColor": "charcoal", "accessory": "none", "eyewear": "none", "neckwear": "scarf", "equipment": "monitor"},
      "ext-codex-01a1": {"gender": "male", "hairStyle": "curly", "hairColor": "silver", "skin": "tan", "face": "focused", "top": "polo", "topColor": "coral", "bottom": "jeans", "bottomColor": "forest", "shoes": "boots", "shoesColor": "charcoal", "accessory": "none", "eyewear": "none", "neckwear": "lanyard", "equipment": "desktop_tower"},
      "agent-7": {"gender": "female", "hairStyle": "long", "hairColor": "teal", "skin": "light", "face": "cheerful", "top": "tee", "topColor": "mustard", "bottom": "skirt", "bottomColor": "navy", "shoes": "boots", "shoesColor": "charcoal", "accessory": "headphones", "eyewear": "none", "neckwear": "none", "equipment": "debug_rig"},
      "x": {"gender": "female", "hairStyle": "bob", "hairColor": "blonde", "skin": "deep", "face": "calm", "top": "cardigan", "topColor": "forest", "bottom": "shorts", "bottomColor": "navy", "shoes": "boots", "shoesColor": "cream", "accessory": "beanie", "eyewear": "none", "neckwear": "none", "equipment": "desktop_tower"},
      "sub-1/2": {"gender": "male", "hairStyle": "buzz", "hairColor": "rose", "skin": "porcelain", "face": "focused", "top": "hoodie", "topColor": "teal", "bottom": "shorts", "bottomColor": "charcoal", "shoes": "hightops", "shoesColor": "coral", "accessory": "headphones", "eyewear": "none", "neckwear": "none", "equipment": "dual_monitor"},
    };
    for (const [seed, look] of Object.entries(before)) expect(appearanceFromSeed(seed), seed).toEqual(look);
  });
});
