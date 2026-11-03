import { describe, expect, it } from 'vitest';
import { NavGrid } from '../navigation/grid';
import { FURNITURE } from '../furniture/furniture';
import { interactableAt, interactablesFor } from './interactables';
import { DEFAULT_SCENES } from './layouts';

describe('interactables', () => {
  it('offers every desk, sofa place, beanbag, arcade and dice table in the built-in offices', () => {
    for (const scene of Object.values(DEFAULT_SCENES)) {
      const list = interactablesFor(scene);
      expect(list.filter((i) => i.kind === 'desk')).toHaveLength(scene.workstations.length);
      const sofas = scene.furniture.filter((f) => f.kind === 'sofa').length;
      const beans = scene.furniture.filter((f) => f.kind === 'beanbag').length;
      expect(list.filter((i) => i.kind === 'sofa')).toHaveLength(sofas * 2 + beans);
      expect(list.filter((i) => i.kind === 'arcade')).toHaveLength(scene.furniture.filter((f) => f.kind === 'arcade').length);
      expect(list.filter((i) => i.kind === 'dice')).toHaveLength(scene.furniture.filter((f) => f.kind === 'dice_table').length);
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
});
