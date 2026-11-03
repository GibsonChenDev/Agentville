import { describe, expect, it } from 'vitest';
import { BOTTOMS, HAIR_STYLES, TOPS, appearanceFromSeed, inferGender, styleGender, stylesFor, withGender, type CharacterAppearance } from './appearance';
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
