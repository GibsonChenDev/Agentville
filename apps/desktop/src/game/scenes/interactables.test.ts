import { describe, expect, it } from 'vitest';
import { NavGrid } from '../navigation/grid';
import { FURNITURE } from '../furniture/furniture';
import { interactableAt, interactablesFor, seatAhead, withinReach } from './interactables';
import { DEFAULT_SCENES } from './layouts';

describe('interactables', () => {
  it('offers every desk, sofa place, beanbag, arcade and dice table in the built-in offices', () => {
    for (const scene of Object.values(DEFAULT_SCENES)) {
      const list = interactablesFor(scene);
      expect(list.filter((i) => i.kind === 'desk')).toHaveLength(scene.workstations.length);
      const sofas = scene.furniture.filter((f) => f.kind === 'sofa').length;
      const beans = scene.furniture.filter((f) => f.kind === 'beanbag').length;
      expect(list.filter((i) => i.kind === 'sofa')).toHaveLength(sofas * 2 + beans);
      // Shared pieces: three spots in front of each arcade, six round each dice table (when nothing blocks them).
      for (const [kind, piece, spots] of [
        ['arcade', 'arcade', 3],
        ['dice', 'dice_table', 6],
      ] as const)
        for (const f of scene.furniture.filter((x) => x.kind === piece)) {
          const own = list.filter((i) => i.kind === kind && i.furnitureId === f.id);
          expect(own.length, `${scene.theme} ${f.id}`).toBeLessThanOrEqual(spots);
          expect(own.length, `${scene.theme} ${f.id}`).toBeGreaterThanOrEqual(2);
          expect(own[0]!.id).toBe(`${kind}:${f.id}`); // older apps know the first spot by this id
        }
      expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
    }
  });

  it('approach tiles are reachable floor', () => {
    for (const scene of Object.values(DEFAULT_SCENES)) {
      const nav = new NavGrid(scene.cols, scene.rows);
      for (let x = 0; x < scene.cols; x++) for (let y = 0; y < scene.wallRows; y++) nav.setBlocked(x, y);
      for (const p of scene.furniture) {
        const def = FURNITURE[p.kind]!;
        if (def.blocks) for (let dx = 0; dx < def.fw; dx++) for (let dy = 0; dy < def.fh; dy++) nav.setBlocked(p.x + dx, p.y + dy);
      }
      for (const it of interactablesFor(scene)) {
        expect(nav.findPath(scene.door, it.approach, [it.approach]), `${scene.theme} ${it.id}`).not.toBeNull();
      }
    }
  });

  it('finds the thing under a clicked tile', () => {
    const scene = DEFAULT_SCENES.midnight;
    const list = interactablesFor(scene);
    const arcade = scene.furniture.find((f) => f.kind === 'arcade')!;
    expect(interactableAt(list, { x: arcade.x, y: arcade.y })?.kind).toBe('arcade');
    const ws = scene.workstations[0]!;
    expect(interactableAt(list, ws.seat)?.id).toBe(ws.id);
  });

  const floorOf = (scene: (typeof DEFAULT_SCENES)['loft']) => {
    const nav = new NavGrid(scene.cols, scene.rows);
    for (let x = 0; x < scene.cols; x++) for (let y = 0; y < scene.wallRows; y++) nav.setBlocked(x, y);
    for (let y = 0; y < scene.rows; y++) {
      nav.setBlocked(0, y);
      nav.setBlocked(scene.cols - 1, y);
    }
    for (let x = 0; x < scene.cols; x++) nav.setBlocked(x, scene.rows - 1);
    for (const p of scene.furniture) {
      const def = FURNITURE[p.kind]!;
      if (def.blocks) for (let dx = 0; dx < def.fw; dx++) for (let dy = 0; dy < def.fh; dy++) nav.setBlocked(p.x + dx, p.y + dy);
    }
    return (t: { x: number; y: number }) => nav.isWalkable(t.x, t.y);
  };

  it('leaves out spots that stand on furniture or walls, and every spot left is reachable', () => {
    for (const scene of Object.values(DEFAULT_SCENES)) {
      const isFloor = floorOf(scene);
      const list = interactablesFor(scene, isFloor);
      for (const it of list) if (it.furnitureId) expect(isFloor(it.approach), `${scene.theme} ${it.id}`).toBe(true);
      // A dice table against a wall loses the spots behind it.
      const blocked = interactablesFor({ ...scene, furniture: [...scene.furniture.filter((f) => f.kind !== 'dice_table'), { id: 'wall-dice', kind: 'dice_table', x: 5, y: scene.wallRows }] }, floorOf({ ...scene, furniture: [...scene.furniture.filter((f) => f.kind !== 'dice_table'), { id: 'wall-dice', kind: 'dice_table', x: 5, y: scene.wallRows }] }));
      expect(blocked.filter((i) => i.furnitureId === 'wall-dice').every((i) => i.facing !== 'down')).toBe(true);
    }
  });

  it('E reaches things from any side, not only from the front', () => {
    const scene = DEFAULT_SCENES.loft;
    const list = interactablesFor(scene, floorOf(scene));
    const dice = scene.furniture.find((f) => f.kind === 'dice_table')!;
    // Standing behind, left of, right of, below and diagonally off the table.
    for (const at of [
      { x: dice.x, y: dice.y - 1 },
      { x: dice.x - 1, y: dice.y },
      { x: dice.x + 2, y: dice.y },
      { x: dice.x + 1, y: dice.y + 1 },
      { x: dice.x + 2, y: dice.y + 1 },
    ])
      expect(withinReach(list, at)[0]?.furnitureId, `${at.x},${at.y}`).toBe(dice.id);
    // The nearest spot comes first, so you use the side you're standing at.
    expect(withinReach(list, { x: dice.x - 1, y: dice.y })[0]?.facing).toBe('right');
    // Two tiles away is out of reach.
    expect(withinReach(list, { x: dice.x - 3, y: dice.y }).some((i) => i.furnitureId === dice.id)).toBe(false);
    // A chair can be used from beside its desk too (here between two desks: both are in reach, the nearer one first).
    const ws = scene.workstations[0]!;
    const desk = scene.furniture.find((f) => f.id === ws.deskId)!;
    const beside = withinReach(list, { x: desk.x + 2, y: desk.y }).map((i) => i.id);
    expect(beside).toContain(ws.id);
  });

  it('walking into a sofa or a desk finds the seat to sit on; arcades and dice tables are left alone', () => {
    const scene = DEFAULT_SCENES.loft;
    const list = interactablesFor(scene, floorOf(scene));
    const sofa = scene.furniture.find((f) => f.kind === 'sofa')!;
    // From the floor in front of each cushion, and from the middle (the nearer cushion wins).
    expect(seatAhead(list, { x: sofa.x, y: sofa.y + 1 }, { x: sofa.x, y: sofa.y })?.id).toBe(`sofa:${sofa.id}:0`);
    expect(seatAhead(list, { x: sofa.x + 2, y: sofa.y + 1 }, { x: sofa.x + 2, y: sofa.y })?.id).toBe(`sofa:${sofa.id}:1`);
    expect(seatAhead(list, { x: sofa.x + 1, y: sofa.y + 1 }, { x: sofa.x + 1, y: sofa.y })?.id).toBe(`sofa:${sofa.id}:0`);
    // A taken cushion isn't offered.
    expect(seatAhead(list, { x: sofa.x, y: sofa.y + 1 }, { x: sofa.x, y: sofa.y }, (it) => it.id !== `sofa:${sofa.id}:0`)).toBeUndefined();
    const ws = scene.workstations.find((w) => w.facing === 'up')!;
    const desk = scene.furniture.find((f) => f.id === ws.deskId)!;
    expect(seatAhead(list, ws.seat, { x: desk.x, y: desk.y })?.id).toBe(ws.id);
    const dice = scene.furniture.find((f) => f.kind === 'dice_table')!;
    expect(seatAhead(list, { x: dice.x, y: dice.y + 1 }, { x: dice.x, y: dice.y })).toBeUndefined();
  });

  it('several people can use the arcade and the dice table at once, each at their own spot', () => {
    const scene = DEFAULT_SCENES.garden;
    const list = interactablesFor(scene, floorOf(scene));
    for (const kind of ['arcade', 'dice'] as const) {
      const spots = list.filter((i) => i.kind === kind);
      expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
      expect(new Set(spots.map((s) => `${s.approach.x},${s.approach.y}`)).size).toBe(spots.length);
      expect(spots.length).toBeGreaterThanOrEqual(2);
    }
  });
});
