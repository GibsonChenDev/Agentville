import type { OfficeTheme } from '@agentville/domain';
import { create } from 'zustand';
import { addFurniture, moveFurniture, placedCount, removeFurniture, setDeskFacing, validateScene, type EditResult, type LayoutError } from '../../game/scenes/editing';
import { ownerTag, placementAllowance, useAccount } from '../../account/accountStore';
import { DEFAULT_SCENES, type SceneDefinition } from '../../game/scenes/layouts';
import { sceneFor, useApp } from '../../state/store';
import { currentOfficeTheme } from '../../world/officeTheme';

/**
 * Office editor session. Edits apply to a draft scene that the world renders
 * live; nothing is stored until Save. Every edit goes through the pure rules in
 * game/scenes/editing.ts, so an invalid move is rejected with a reason.
 */
interface EditorState {
  active: boolean;
  theme?: OfficeTheme;
  draft?: SceneDefinition;
  selectedId?: string;
  placing?: string;
  error?: LayoutError | 'over_limit';
  dirty: boolean;
  saving: boolean;
  /** Height of the editor panel over the bottom of the office, so the map can be framed above it. */
  panelHeight: number;
  start: () => void;
  cancel: () => void;
  select: (id?: string) => void;
  setPlacing: (kind?: string) => void;
  move: (id: string, x: number, y: number) => void;
  place: (kind: string, x: number, y: number) => void;
  remove: () => void;
  flipDesk: () => void;
  resetToDefault: () => void;
  save: () => Promise<void>;
  setPanelHeight: (px: number) => void;
}

export const useEditor = create<EditorState>((set, get) => {
  const apply = (r: EditResult, extra: Partial<EditorState> = {}) => {
    if (r.ok) set({ draft: r.scene, error: undefined, dirty: true, ...extra });
    else set({ error: r.error });
  };
  return {
    active: false,
    dirty: false,
    saving: false,
    panelHeight: 0,
    start: () => {
      const app = useApp.getState();
      const theme = currentOfficeTheme();
      app.select(undefined);
      app.follow(undefined);
      set({ active: true, theme, draft: sceneFor(app, theme), selectedId: undefined, placing: undefined, error: undefined, dirty: false });
    },
    cancel: () => set({ active: false, draft: undefined, selectedId: undefined, placing: undefined, error: undefined, dirty: false }),
    select: (selectedId) => set({ selectedId, error: undefined }),
    setPlacing: (placing) => set({ placing, selectedId: undefined, error: undefined }),
    move: (id, x, y) => {
      const { draft } = get();
      if (draft) apply(moveFurniture(draft, id, x, y), { selectedId: id });
    },
    place: (kind, x, y) => {
      const { draft } = get();
      if (!draft) return;
      const allowance = allowanceFor(draft, kind);
      if (allowance && !allowance.left) return set({ error: 'over_limit' });
      const r = addFurniture(draft, kind, x, y, allowance ? ownerTag(useAccount.getState().account?.id) : undefined);
      apply(r, r.ok ? { selectedId: r.scene.furniture.at(-1)!.id, placing: undefined } : {});
    },
    remove: () => {
      const { draft, selectedId } = get();
      if (draft && selectedId) apply(removeFurniture(draft, selectedId), { selectedId: undefined });
    },
    flipDesk: () => {
      const { draft, selectedId } = get();
      const ws = draft?.workstations.find((w) => w.deskId === selectedId);
      if (draft && ws) apply(setDeskFacing(draft, ws.deskId, ws.facing === 'up' ? 'down' : 'up'));
    },
    resetToDefault: () => {
      const { theme } = get();
      if (theme) set({ draft: DEFAULT_SCENES[theme], selectedId: undefined, error: undefined, dirty: true });
    },
    save: async () => {
      const { theme, draft } = get();
      if (!theme || !draft || validateScene(draft)) return;
      set({ saving: true });
      try {
        if (draft === DEFAULT_SCENES[theme]) await useApp.getState().resetLayout(theme);
        else await useApp.getState().saveLayout(theme, draft);
        set({ active: false, draft: undefined, selectedId: undefined, placing: undefined, dirty: false });
      } finally {
        set({ saving: false });
      }
    },
    setPanelHeight: (panelHeight) => set({ panelHeight }),
  };
});

/** Copies of a shop decoration you can still place in this draft; null for free furniture. */
export function allowanceFor(draft: SceneDefinition, kind: string) {
  const account = useAccount.getState().account;
  return placementAllowance(account?.inventory, kind, (owner) => placedCount(draft, kind, owner), !!useApp.getState().teamLayouts, ownerTag(account?.id));
}

/** Would `item` be valid at (x, y)? Used for the live green/red placement ghost. */
export function canPlace(item: { id?: string; kind: string }, x: number, y: number): boolean {
  const { draft } = useEditor.getState();
  if (!draft) return false;
  if (!item.id && allowanceFor(draft, item.kind)?.left === 0) return false;
  const r = item.id ? moveFurniture(draft, item.id, x, y) : addFurniture(draft, item.kind, x, y);
  return r.ok;
}
