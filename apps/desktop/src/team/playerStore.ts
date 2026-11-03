import { appearanceFromSeed, sanitizeAppearance, type CharacterAppearance } from '@agentville/domain';
import { cleanName } from '@agentville/team-protocol';
import { create } from 'zustand';
import { useAccount } from '../account/accountStore';

/**
 * You, as a character in the office: a nickname and a look. Stored locally;
 * shared with a team only while you're in a team office.
 */
interface PlayerState {
  name: string;
  appearance: CharacterAppearance;
  editorOpen: boolean;
  /** Saves locally and to your account (unless `sync: false`, used when the account is the source). */
  save: (name: string, appearance: CharacterAppearance, opts?: { sync?: boolean }) => void;
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
  save: (name, appearance, opts) => {
    const next = { name: cleanName(name) ?? '', appearance };
    persist(next);
    set(next);
    if (opts?.sync !== false) useAccount.getState().saveProfile(next.name, appearance);
  },
  openEditor: (editorOpen) => set({ editorOpen }),
}));
