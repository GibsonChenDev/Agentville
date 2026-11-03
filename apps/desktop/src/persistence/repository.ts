import type { OfficeTheme } from '@agentville/domain';
import { isTauri } from '../integration/platform';

/**
 * Durable storage for customizations. The desktop app uses SQLite through Rust
 * (src-tauri/src/db.rs); outside the desktop shell it falls back to
 * localStorage with the same document format.
 */
export interface StoredRow {
  key: string;
  doc: string;
  updatedAt: number;
}

export interface HistoryRows {
  sessions: { key: string; doc: string; updatedAt: number }[];
  events: { id: string; doc: string }[];
}

export interface Repository {
  readonly kind: 'sqlite' | 'local';
  appendHistory(sessions: { agentId: string; doc: string }[], events: { id: string; agentId: string; at: number; doc: string }[]): Promise<void>;
  loadHistory(since: number, limit: number): Promise<HistoryRows>;
  clearHistory(): Promise<void>;
  snapshot(): Promise<{ profiles: StoredRow[]; layouts: StoredRow[] }>;
  putProfile(key: string, doc: unknown): Promise<void>;
  deleteProfile(key: string): Promise<void>;
  putLayout(theme: OfficeTheme, doc: unknown): Promise<void>;
  deleteLayout(theme: OfficeTheme): Promise<void>;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

const sqlite: Repository = {
  kind: 'sqlite',
  snapshot: () => invoke('store_snapshot'),
  putProfile: (key, doc) => invoke('profile_put', { key, doc: JSON.stringify(doc) }),
  deleteProfile: (key) => invoke('profile_delete', { key }),
  putLayout: (theme, doc) => invoke('layout_put', { theme, doc: JSON.stringify(doc) }),
  deleteLayout: (theme) => invoke('layout_delete', { theme }),
  appendHistory: (sessions, events) => invoke('history_append', { sessions, events }),
  loadHistory: (since, limit) => invoke('history_load', { since, limit }),
  clearHistory: () => invoke('history_clear'),
};

const LS_KEY = 'agentville.store.v1';
type LocalDb = { profiles: Record<string, StoredRow>; layouts: Record<string, StoredRow> };

function readLocal(): LocalDb {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as LocalDb | null;
    return raw && typeof raw === 'object' ? { profiles: raw.profiles ?? {}, layouts: raw.layouts ?? {} } : { profiles: {}, layouts: {} };
  } catch {
    return { profiles: {}, layouts: {} };
  }
}

function writeLocal(db: LocalDb) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

const HISTORY_KEY = 'agentville.history.v1';
const LOCAL_EVENT_CAP = 2000;
type LocalHistory = { sessions: Record<string, { key: string; doc: string; updatedAt: number }>; events: { id: string; at: number; doc: string }[] };
function readHistory(): LocalHistory {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null') as LocalHistory | null;
    return raw ?? { sessions: {}, events: [] };
  } catch {
    return { sessions: {}, events: [] };
  }
}

const local: Repository = {
  kind: 'local',
  appendHistory: async (sessions, events) => {
    const h = readHistory();
    const now = Date.now();
    for (const s of sessions) h.sessions[s.agentId] = { key: s.agentId, doc: s.doc, updatedAt: now };
    const known = new Set(h.events.map((e) => e.id));
    for (const e of events) if (!known.has(e.id)) h.events.push({ id: e.id, at: e.at, doc: e.doc });
    h.events = h.events.sort((a, b) => a.at - b.at).slice(-LOCAL_EVENT_CAP);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  },
  loadHistory: async (since, limit) => {
    const h = readHistory();
    return {
      sessions: Object.values(h.sessions).filter((s) => s.updatedAt >= since),
      events: h.events.filter((e) => e.at >= since).slice(-limit),
    };
  },
  clearHistory: async () => localStorage.removeItem(HISTORY_KEY),
  snapshot: async () => {
    const db = readLocal();
    return { profiles: Object.values(db.profiles), layouts: Object.values(db.layouts) };
  },
  putProfile: async (key, doc) => {
    const db = readLocal();
    db.profiles[key] = { key, doc: JSON.stringify(doc), updatedAt: Date.now() };
    writeLocal(db);
  },
  deleteProfile: async (key) => {
    const db = readLocal();
    delete db.profiles[key];
    writeLocal(db);
  },
  putLayout: async (theme, doc) => {
    const db = readLocal();
    db.layouts[theme] = { key: theme, doc: JSON.stringify(doc), updatedAt: Date.now() };
    writeLocal(db);
  },
  deleteLayout: async (theme) => {
    const db = readLocal();
    delete db.layouts[theme];
    writeLocal(db);
  },
};

export const repository: Repository = isTauri ? sqlite : local;
