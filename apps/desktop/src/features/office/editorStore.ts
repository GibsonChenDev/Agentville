import type { OfficeTheme } from '@agentville/domain';
import { create } from 'zustand';
import { addFurniture, moveFurniture, removeFurniture, setDeskFacing, validateScene, type EditResult, type LayoutError } from '../../game/scenes/editing';
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
  error?: LayoutError;
  dirty: boolean;
  saving: boolean;
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
      const r = addFurniture(draft, kind, x, y);
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
  };
});

/** Would `item` be valid at (x, y)? Used for the live green/red placement ghost. */
export function canPlace(item: { id?: string; kind: string }, x: number, y: number): boolean {
  const { draft } = useEditor.getState();
  if (!draft) return false;
  const r = item.id ? moveFurniture(draft, item.id, x, y) : addFurniture(draft, item.kind, x, y);
  return r.ok;
}
