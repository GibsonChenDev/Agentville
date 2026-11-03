import { cleanLayoutDoc, type LayoutDocWire } from '@agentville/team-protocol';

/**
 * The look of each team office you've been in (its map and saved layouts), as
 * last seen. Walking back in shows it at once, instead of drawing your own
 * office first and jumping to the team's when the relay answers.
 */
export interface CachedOffice {
  theme: string;
  layouts: Record<string, LayoutDocWire>;
}

const KEY = 'agentville.offices.v1';
const THEME = /^[a-z0-9_-]{1,24}$/;

function load(): Record<string, CachedOffice> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, { theme?: unknown; layouts?: unknown }>;
    const out: Record<string, CachedOffice> = {};
    for (const [roomId, v] of Object.entries(raw ?? {})) {
      if (!v || typeof v.theme !== 'string' || !THEME.test(v.theme)) continue;
      const layouts: Record<string, LayoutDocWire> = {};
      for (const [theme, doc] of Object.entries((v.layouts as Record<string, unknown>) ?? {})) {
        const clean = THEME.test(theme) ? cleanLayoutDoc(doc) : null;
        if (clean) layouts[theme] = clean;
      }
      out[roomId] = { theme: v.theme, layouts };
    }
    return out;
  } catch {
    return {};
  }
}

function save(all: Record<string, CachedOffice>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // not remembered: the office still loads, it just may flash on the way in
  }
}

export function cachedOffice(roomId: string): CachedOffice | undefined {
  return load()[roomId];
}

export function rememberOffice(roomId: string, office: CachedOffice) {
  save({ ...load(), [roomId]: office });
}

export function forgetOffice(roomId: string) {
  const { [roomId]: _gone, ...rest } = load();
  save(rest);
}
