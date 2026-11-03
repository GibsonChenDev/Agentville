import { ACCESSORIES, OFFICE_THEMES, OUTFIT_COLORS, PREMIUM_ACCESSORIES, PREMIUM_OUTFIT_COLORS, appearanceFromSeed, sanitizeAppearance } from '@agentville/domain';
import { CATALOG, cleanChat, cleanLayoutDoc, type ChatMessage, type MemberView } from '@agentville/team-protocol';
import { describe, expect, it } from 'vitest';
import { placementAllowance, ownerTag } from '../account/accountStore';
import { FURNITURE, SHOP_FURNITURE } from '../game/furniture/furniture';
import { addFurniture, fromLayoutDoc, placedCount, toLayoutDoc, validateScene } from '../game/scenes/editing';
import { DEFAULT_SCENES } from '../game/scenes/layouts';
import en from '../locales/en/office.json';
import zh from '../locales/zh-TW/office.json';
import { officeTheme } from '../world/officeTheme';
import { MAX_PEER_AGENTS, peerAgents } from './peerAgents';
import { mergeChat, type TeamState } from './teamStore';

const member = (id: string, agents: number, extra: Partial<MemberView> = {}): MemberView => ({ id, name: id, appearance: {}, owner: false, online: true, agents, ...extra });
const team = (members: MemberView[], me = 'me'): Pick<TeamState, 'members' | 'membership' | 'status'> =>
  ({ status: 'online', members: Object.fromEntries(members.map((m) => [m.id, m])), membership: { memberId: me } }) as Pick<TeamState, 'members' | 'membership' | 'status'>;

describe('more agents than the office can seat', () => {
  it("draws at most a fixed number of teammates' agents, shared fairly between teammates", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => member(`m${i}`, 32));
    const shown = peerAgents(team(fifty) as TeamState);
    expect(shown).toHaveLength(MAX_PEER_AGENTS);
    // round-robin: the first 40 teammates each get one agent before anyone gets a second
    expect(new Set(shown.map((a) => a.record.id.split(':')[1])).size).toBe(MAX_PEER_AGENTS);
  });

  it('shows every agent when there are few, and none for offline teammates or yourself', () => {
    const shown = peerAgents(team([member('a', 2), member('b', 1), member('c', 5, { online: false }), member('me', 9)]) as TeamState);
    expect(shown.map((a) => a.record.id).sort()).toEqual(['peer:a:0', 'peer:a:1', 'peer:b:0']);
  });

  it("every built-in office has 10 desks; the rest wait on open floor (see crowd.test.ts)", () => {
    for (const theme of OFFICE_THEMES) expect(DEFAULT_SCENES[theme].workstations.length, theme).toBe(10);
  });
});

describe('outfits are visible to teammates', () => {
  it('every look sold in the shop survives the teammate-side check', () => {
    const fallback = appearanceFromSeed('x');
    for (const accessory of PREMIUM_ACCESSORIES) expect(sanitizeAppearance({ ...fallback, accessory }, fallback).accessory).toBe(accessory);
    for (const color of PREMIUM_OUTFIT_COLORS) expect(sanitizeAppearance({ ...fallback, topColor: color, shoesColor: color }, fallback)).toMatchObject({ topColor: color, shoesColor: color });
  });

  it('the shop sells exactly the premium looks the character renderer knows', () => {
    const looks = CATALOG.filter((i) => i.kind !== 'furniture');
    expect(looks.filter((i) => i.kind === 'accessory').map((i) => i.value).sort()).toEqual([...PREMIUM_ACCESSORIES].sort());
    expect(looks.filter((i) => i.kind === 'color').map((i) => i.value).sort()).toEqual([...PREMIUM_OUTFIT_COLORS].sort());
    for (const i of looks) expect([...ACCESSORIES, ...OUTFIT_COLORS] as string[]).toContain(i.value);
  });
});

describe('office decorations', () => {
  it('every decoration sold has a sprite and a name in both languages', () => {
    const sold = CATALOG.filter((i) => i.kind === 'furniture').map((i) => i.value);
    expect(sold.sort()).toEqual([...SHOP_FURNITURE].sort());
    for (const kind of sold) {
      expect(FURNITURE[kind], kind).toBeDefined();
      expect((en.furniture as Record<string, string>)[kind], kind).toBeTruthy();
      expect((zh.furniture as Record<string, string>)[kind], kind).toBeTruthy();
    }
  });

  it('a layout with bought decorations round-trips through the relay and back unchanged', () => {
    let scene = DEFAULT_SCENES.garden;
    for (const [kind, x, y] of [
      ['piano', 13, 17],
      ['dog', 16, 9],
    ] as const) {
      const r = addFurniture(scene, kind, x, y, '1a2b3c4d');
      if (!r.ok) throw new Error(`${kind}: ${r.error}`);
      scene = r.scene;
    }
    const wire = cleanLayoutDoc(JSON.parse(JSON.stringify(toLayoutDoc(scene))));
    expect(wire).not.toBeNull();
    const back = fromLayoutDoc(wire, DEFAULT_SCENES.garden);
    expect(back.furniture.filter((f) => f.kind === 'piano' || f.kind === 'dog').map((f) => f.id)).toEqual(['item-1a2b3c4d-u1', 'item-1a2b3c4d-u2']);
  });

  it('a decoration this version has never heard of (bought in a newer app) is skipped, not the whole layout', () => {
    const doc = toLayoutDoc(DEFAULT_SCENES.loft);
    const moved = { ...doc, furniture: [...doc.furniture.map((f) => (f.id === 'arcade' ? { ...f, x: 26 } : f)), { id: 'item-u9', kind: 'hologram', x: 13, y: 17 }] };
    const back = fromLayoutDoc(moved, DEFAULT_SCENES.loft);
    expect(back).not.toBe(DEFAULT_SCENES.loft);
    expect(back.furniture.find((f) => f.id === 'arcade')?.x).toBe(26);
    expect(back.furniture.some((f) => f.kind === 'hologram')).toBe(false);
    expect(validateScene(back)).toBeNull();
  });

  it('you can place only as many copies as you bought; in a team office teammates’ copies don’t count against you', () => {
    const inv = ['deco.cat', 'deco.cat'];
    let scene = DEFAULT_SCENES.loft;
    const add = (owner?: string) => {
      const r = addFurniture(scene, 'cat', 13, 17 - placedCount(scene, 'cat'), owner);
      if (!r.ok) throw new Error(r.error);
      scene = r.scene;
    };
    // personal office: every cat is yours
    add();
    expect(placementAllowance(inv, 'cat', (o) => placedCount(scene, 'cat', o), false)).toEqual({ owned: 2, used: 1, left: 1 });
    add();
    expect(placementAllowance(inv, 'cat', (o) => placedCount(scene, 'cat', o), false)?.left).toBe(0);
    // team office: two cats from a teammate, none from you yet
    scene = DEFAULT_SCENES.loft;
    add('bbbbbbbb');
    add('bbbbbbbb');
    const mine = ownerTag('aaaaaaaa1234');
    expect(placementAllowance(inv, 'cat', (o) => placedCount(scene, 'cat', o), true, mine)).toEqual({ owned: 2, used: 0, left: 2 });
    add(mine);
    expect(placementAllowance(inv, 'cat', (o) => placedCount(scene, 'cat', o), true, mine)?.left).toBe(1);
    // free furniture has no limit; not knowing your account means nothing to place
    expect(placementAllowance(inv, 'sofa', () => 0, true, mine)).toBeNull();
    expect(placementAllowance(inv, 'cat', () => 0, true, undefined)?.left).toBe(0);
  });
});

describe('switching the map', () => {
  it("in a team office everyone sees the team's map; your own office keeps yours", () => {
    const inTeam = { membership: { roomId: 'r' } as TeamState['membership'], room: { theme: 'seaside' } as TeamState['room'] };
    expect(officeTheme('loft', inTeam)).toBe('seaside');
    expect(officeTheme('loft', { membership: undefined, room: undefined })).toBe('loft');
  });

  it('a map from a newer app version falls back to your own map instead of breaking', () => {
    const inTeam = { membership: { roomId: 'r' } as TeamState['membership'], room: { theme: 'moonbase' } as TeamState['room'] };
    expect(officeTheme('garden', inTeam)).toBe('garden');
  });

  it('there are five maps, each a valid office', () => {
    expect(OFFICE_THEMES).toHaveLength(5);
    for (const theme of OFFICE_THEMES) expect(validateScene(DEFAULT_SCENES[theme]), theme).toBeNull();
  });
});

describe('team chat on this computer', () => {
  const msg = (id: string, at: number, text = id): ChatMessage => ({ id, from: 'a', name: 'Alice', text, at });

  it('a reconnect resends history without duplicating it, and the list stays in time order', () => {
    const shown = mergeChat([], [msg('m1', 1), msg('m2', 2)]);
    const live = mergeChat(shown, [msg('m3', 3)]);
    expect(mergeChat(live, [msg('m1', 1), msg('m2', 2), msg('m3', 3)]).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(mergeChat([msg('late', 9)], [msg('early', 4)]).map((m) => m.id)).toEqual(['early', 'late']);
  });

  it('keeps only the newest 50', () => {
    const many = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, i));
    const kept = mergeChat([], many);
    expect(kept).toHaveLength(50);
    expect(kept[0]!.id).toBe('m20');
  });

  it('cleans what you type the same way the relay does', () => {
    expect(cleanChat('  hi\n\nthere  ')).toBe('hi there');
    expect(cleanChat('   ')).toBeNull();
    expect(cleanChat('字'.repeat(300))).toHaveLength(300);
    expect(cleanChat('字'.repeat(301))).toBeNull();
  });
});
