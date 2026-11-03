import { OFFICE_THEMES } from '@agentville/domain';
import { describe, expect, it } from 'vitest';
import { addFurniture, fromLayoutDoc, moveFurniture, removeFurniture, setDeskFacing, toLayoutDoc, validateScene } from './editing';
import { DEFAULT_SCENES } from './layouts';

const loft = DEFAULT_SCENES.loft;

describe('office layout editing', () => {
  it.each(OFFICE_THEMES)('default %s layout is valid', (theme) => {
    expect(validateScene(DEFAULT_SCENES[theme])).toBeNull();
  });

  it('moves furniture and keeps desk seats attached', () => {
    const r = moveFurniture(loft, 'desk-b1', 2, 15);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ws = r.scene.workstations.find((w) => w.deskId === 'desk-b1')!;
    expect(ws.seat).toEqual({ x: 2, y: 16 });
  });

  it('rejects overlaps, walls, the doorway and gathering spots', () => {
    expect(moveFurniture(loft, 'plant-x', 5, 5)).toEqual({ ok: false, error: 'unknown_item' });
    expect(moveFurniture(loft, 'm3', 4, 10)).toEqual({ ok: false, error: 'overlaps' });
    expect(moveFurniture(loft, 'm3', 0, 10)).toEqual({ ok: false, error: 'out_of_bounds' });
    expect(moveFurniture(loft, 'm3', 5, 2)).toEqual({ ok: false, error: 'out_of_bounds' });
    expect(moveFurniture(loft, 'm3', loft.door.x, loft.door.y)).toEqual({ ok: false, error: 'blocks_door' });
    const spot = loft.meetingSpots[0]!;
    expect(moveFurniture(loft, 'm3', spot.x, spot.y)).toEqual({ ok: false, error: 'blocks_spot' });
  });

  it('rejects layouts that wall off a seat', () => {
    // Enclose the seat of window desk b1, which is at (2,5).
    let scene = loft;
    for (const [x, y] of [
      [1, 5],
      [1, 6],
      [2, 6],
      [3, 6],
      [3, 5],
    ] as const) {
      const r = addFurniture(scene, 'plant_succulent', x, y);
      if (!r.ok) {
        expect(r.error).toBe('blocks_path');
        return;
      }
      scene = r.scene;
    }
    throw new Error('expected a blocked path');
  });

  it('adds desks as new workstations and can flip their facing', () => {
    const r = addFurniture(loft, 'desk', 14, 15);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const added = r.scene.workstations.at(-1)!;
    expect(added).toMatchObject({ facing: 'up', seat: { x: 14, y: 16 } });
    const flipped = setDeskFacing(r.scene, added.deskId, 'down');
    expect(flipped.ok && flipped.scene.workstations.at(-1)!.seat).toEqual({ x: 14, y: 14 });
  });

  it('removes furniture and their workstations, but never the last desk', () => {
    const r = removeFurniture(loft, 'desk-b1');
    expect(r.ok && r.scene.workstations.some((w) => w.deskId === 'desk-b1')).toBe(false);
    let scene = loft;
    for (const ws of loft.workstations.slice(1)) {
      const next = removeFurniture(scene, ws.deskId);
      if (next.ok) scene = next.scene;
    }
    expect(removeFurniture(scene, loft.workstations[0]!.deskId)).toEqual({ ok: false, error: 'last_desk' });
  });

  it('round-trips through the stored document and rejects tampering', () => {
    const r = addFurniture(loft, 'plant_monstera', 14, 16);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(JSON.stringify(toLayoutDoc(r.scene)));
    expect(fromLayoutDoc(doc, loft).furniture).toHaveLength(loft.furniture.length + 1);
    expect(fromLayoutDoc({ ...doc, version: 2 }, loft)).toBe(loft);
    // Unknown kinds (e.g. a decoration from a newer app version) are dropped, keeping the rest of the layout.
    const withRocket = fromLayoutDoc({ ...doc, furniture: [...doc.furniture, { id: 'x', kind: 'rocket', x: 1, y: 5 }] }, loft);
    expect(withRocket.furniture).toHaveLength(loft.furniture.length + 1);
    expect(withRocket.furniture.some((f) => f.kind === 'rocket')).toBe(false);
    expect(fromLayoutDoc({ ...doc, furniture: [...doc.furniture, { id: 'x', kind: 'sofa', x: 4, y: 10 }] }, loft)).toBe(loft);
    expect(fromLayoutDoc(null, loft)).toBe(loft);
  });
});
