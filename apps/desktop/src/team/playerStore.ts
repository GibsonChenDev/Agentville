import { appearanceFromSeed, sanitizeAppearance, type CharacterAppearance } from '@agentville/domain';
import { cleanName } from '@agentville/team-protocol';
import { create } from 'zustand';

/**
 * You, as a character in the office: a nickname and a look. Stored locally;
 * shared with a team only while you're in a team office.
 */
interface PlayerState {
  name: string;
  appearance: CharacterAppearance;
  editorOpen: boolean;
  save: (name: string, appearance: CharacterAppearance) => void;
  openEditor: (open: boolean) => void;
}

const KEY = 'agentville.player.v1';

function load(): { name: string; appearance: CharacterAppearance } {
  const fallback = appearanceFromSeed(`player-${Math.random()}`);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { name?: unknown; appearance?: unknown } | null;
    if (raw) return { name: cleanName(raw.name) ?? '', appearance: sanitizeAppearance(raw.appearance, fallback) };
  } catch {
    // fall through to a fresh character
  }
  const fresh = { name: '', appearance: fallback };
  persist(fresh);
  return fresh;
}

function persist(v: { name: string; appearance: CharacterAppearance }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // storage unavailable: the character lasts for this session
  }
}

export const usePlayer = create<PlayerState>((set) => ({
  ...load(),
  editorOpen: false,
  save: (name, appearance) => {
    const next = { name: cleanName(name) ?? '', appearance };
    persist(next);
    set(next);
  },
  openEditor: (editorOpen) => set({ editorOpen }),
}));
