import {
  applyEvent,
  collabReduce,
  emptyCollab,
  type AgentLocation,
  type CollabState,
  applyProfile,
  profileKeyFor,
  sanitizeProfile,
  type AgentProfile,
  type OfficeTheme as Theme,
  appearanceFromSeed,
  initialRuntime,
  isStale,
  workedMs,
  type AgentRecord,
  type AgentRuntime,
  type CharacterAppearance,
  type DomainEvent,
  type OfficeTheme,
} from '@agentville/domain';
import { create } from 'zustand';
import { DEFAULT_SCENES, type SceneDefinition } from '../game/scenes/layouts';
import { fromLayoutDoc, toLayoutDoc } from '../game/scenes/editing';
import type { LocalePreference } from '../i18n';
import { repository } from '../persistence/repository';
import type { BridgeState, BridgeStatus, HooksStatus } from '../integration/types';
import { loadPrefs, savePrefs, type Prefs } from './persistence';

export type AppMode = 'demo' | 'live';
export type SettingsTab = 'general' | 'account' | 'monitoring';
export type Link = 'offline' | 'connecting' | 'online';

const MAX_EVENTS = 2000;
const MAX_SEEN_IDS = 5000;
const STALE_BUSY_MS = 5 * 60_000;
const STALE_IDLE_MS = 60 * 60_000;

export interface AppState {
  mode: AppMode;
  /** Agents as shown (base record + profile overrides). */
  agents: Record<string, AgentRecord>;
  /** Agents as discovered, before customization. */
  baseAgents: Record<string, AgentRecord>;
  profiles: Record<string, AgentProfile>;
  /** Agent-team tasks, team membership and file conflicts derived from events. */
  collab: CollabState;
  /** User-edited office layouts; themes without one use the default scene. */
  layouts: Partial<Record<Theme, SceneDefinition>>;
  /** While in a team office: the team's shared layouts, which replace the local ones. */
  teamLayouts?: Partial<Record<Theme, SceneDefinition>>;
  persistenceError?: string;
  runtime: Record<string, AgentRuntime>;
  /** Append-only, bounded event log (newest last). */
  events: DomainEvent[];
  seenIds: Set<string>;
  selectedAgentId?: string;
  followAgentId?: string;
  prefs: Prefs;
  storageAvailable: boolean;
  consoleOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  /** Agent whose character editor is open. */
  customizing?: string;
  /** Bridge process state reported by the desktop shell. */
  bridge: BridgeState;
  /** UI ↔ bridge stream connectivity. */
  link: Link;
  bridgeStatus?: BridgeStatus;
  /** Hook installation status per provider id (undefined while unknown). */
  hooks: Partial<Record<string, HooksStatus>>;

  setMode: (mode: AppMode) => void;
  upsertAgent: (agent: AgentRecord) => void;
  hydrate: () => Promise<void>;
  setLocation: (agentId: string, location: AgentLocation) => void;
  saveProfile: (key: string, patch: Omit<AgentProfile, 'key' | 'updatedAt'>) => Promise<void>;
  resetProfile: (key: string) => Promise<void>;
  saveLayout: (theme: Theme, scene: SceneDefinition) => Promise<void>;
  resetLayout: (theme: Theme) => Promise<void>;
  removeAgent: (id: string) => void;
  ingest: (event: DomainEvent) => void;
  /** Replays persisted sessions/events in one batch at startup. */
  restoreHistory: (sessions: AgentRecord[], events: DomainEvent[]) => void;
  sweepStale: (now: number) => void;
  select: (id?: string) => void;
  follow: (id?: string) => void;
  setTheme: (theme: OfficeTheme) => void;
  setLocale: (locale: LocalePreference) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  setAppearance: (id: string, appearance: CharacterAppearance) => void;
  toggleConsole: (open?: boolean) => void;
  toggleSettings: (open?: boolean, tab?: SettingsTab) => void;
  openCustomizer: (agentId?: string) => void;
  setBridgeState: (s: BridgeState) => void;
  setLink: (l: Link) => void;
  setBridgeStatus: (s: BridgeStatus) => void;
  setHooks: (provider: string, h?: HooksStatus) => void;
  clearHooks: () => void;
  /** Removes agents (and their runtime) of one origin, e.g. leaving Demo mode. */
  clearOrigin: (origin: AgentRecord['origin']) => void;
  resetWorld: () => void;
}

const { prefs: initialPrefs, available } = loadPrefs();

export const useApp = create<AppState>((set, get) => ({
  mode: initialPrefs.mode,
  agents: {},
  baseAgents: {},
  profiles: {},
  collab: emptyCollab(),
  layouts: {},
  runtime: {},
  events: [],
  seenIds: new Set(),
  prefs: initialPrefs,
  storageAvailable: available,
  consoleOpen: initialPrefs.consoleOpen,
  settingsOpen: false,
  settingsTab: 'general',
  bridge: { state: 'stopped' },
  link: 'offline',
  hooks: {},

  setMode: (mode) => {
    get().clearOrigin('demo');
    set({ mode, selectedAgentId: undefined, followAgentId: undefined });
    get().setPref('mode', mode);
  },

  upsertAgent: (agent) =>
    set((s) => {
      const base = s.baseAgents[agent.id] ? agent : withSeparateLook(agent, s);
      return {
        baseAgents: { ...s.baseAgents, [agent.id]: base },
        agents: { ...s.agents, [agent.id]: applyProfile(base, s.profiles[profileKeyFor(base)]) },
        runtime: s.runtime[agent.id] ? s.runtime : { ...s.runtime, [agent.id]: initialRuntime() },
      };
    }),

  setLocation: (agentId, location) =>
    set((s) => {
      const base = s.baseAgents[agentId];
      if (!base) return s;
      const next = { ...base, location };
      return { baseAgents: { ...s.baseAgents, [agentId]: next }, agents: { ...s.agents, [agentId]: applyProfile(next, s.profiles[profileKeyFor(next)]) } };
    }),

  hydrate: async () => {
    try {
      const snap = await repository.snapshot();
      if (!snap) return;
      const profiles: Record<string, AgentProfile> = {};
      for (const row of snap.profiles) {
        try {
          profiles[row.key] = sanitizeProfile(row.key, JSON.parse(row.doc), appearanceFromSeed(row.key), row.updatedAt);
        } catch {
          // Unreadable rows are skipped; the defaults apply for that character.
        }
      }
      const layouts: Partial<Record<Theme, SceneDefinition>> = {};
      for (const row of snap.layouts) {
        const theme = row.key as Theme;
        if (!DEFAULT_SCENES[theme]) continue;
        try {
          const scene = fromLayoutDoc(JSON.parse(row.doc), DEFAULT_SCENES[theme]);
          if (scene !== DEFAULT_SCENES[theme]) layouts[theme] = scene;
        } catch {
          // fall back to the default layout
        }
      }
      set((s) => ({ profiles, layouts, agents: effective(s.baseAgents, profiles), persistenceError: undefined }));
    } catch (e) {
      set({ persistenceError: String(e) });
    }
  },

  saveProfile: async (key, patch) => {
    const profile: AgentProfile = { ...get().profiles[key], ...patch, key, updatedAt: Date.now() };
    set((s) => {
      const profiles = { ...s.profiles, [key]: profile };
      return { profiles, agents: effective(s.baseAgents, profiles) };
    });
    const { key: _k, updatedAt: _u, ...doc } = profile;
    await repository.putProfile(key, doc);
  },

  resetProfile: async (key) => {
    set((s) => {
      const { [key]: _removed, ...profiles } = s.profiles;
      return { profiles, agents: effective(s.baseAgents, profiles) };
    });
    await repository.deleteProfile(key);
  },

  saveLayout: async (theme, scene) => {
    const team = get().teamLayouts;
    if (team) {
      set({ teamLayouts: { ...team, [theme]: scene } });
      layoutSink.current?.(theme, scene);
      return;
    }
    set((s) => ({ layouts: { ...s.layouts, [theme]: scene } }));
    await repository.putLayout(theme, toLayoutDoc(scene));
  },

  resetLayout: async (theme) => {
    const team = get().teamLayouts;
    if (team) {
      const { [theme]: _removed, ...rest } = team;
      set({ teamLayouts: rest });
      layoutSink.current?.(theme, null);
      return;
    }
    set((s) => {
      const { [theme]: _removed, ...layouts } = s.layouts;
      return { layouts };
    });
    await repository.deleteLayout(theme);
  },

  removeAgent: (id) =>
    set((s) => {
      const { [id]: _a, ...agents } = s.agents;
      const { [id]: _b, ...baseAgents } = s.baseAgents;
      const { [id]: _r, ...runtime } = s.runtime;
      return { agents, baseAgents, runtime, selectedAgentId: s.selectedAgentId === id ? undefined : s.selectedAgentId };
    }),

  ingest: (event) => {
    const next = ingestStep(get(), event);
    if (next) set(next);
  },

  restoreHistory: (sessions, history) => {
    let s: AppState = get();
    // Session records first so their events have someone to attach to.
    const baseAgents = { ...s.baseAgents };
    for (const a of sessions) if (!baseAgents[a.id] && a.origin !== 'demo') baseAgents[a.id] = a;
    const runtime = { ...s.runtime };
    for (const id of Object.keys(baseAgents)) runtime[id] ??= initialRuntime();
    s = { ...s, baseAgents, agents: effective(baseAgents, s.profiles), runtime };
    for (const e of history) s = { ...s, ...(ingestStep(s, e) ?? {}) };
    // Restored sessions are history: nobody is in the office until they speak again.
    // A stretch of work cut off by the app closing ends at its last event. Sessions that were still
    // running when the app quit are only presumed gone: their next hook brings them back.
    const restored = Object.fromEntries(
      Object.entries(s.runtime).map(([id, r]) => [
        id,
        baseAgents[id] && !get().runtime[id]
          ? // Event numbering restarts with every receiver boot, so a restored session forgets its last number.
            { ...r, status: 'disconnected' as const, presumedGone: r.status !== 'disconnected' || r.presumedGone, lastSeq: undefined, openTools: [], pendingPermission: undefined, busySince: undefined, workedMs: workedMs(r, r.lastEventAt ?? 0) }
          : r,
      ]),
    );
    set({ baseAgents: s.baseAgents, agents: s.agents, runtime: restored, events: s.events, seenIds: s.seenIds, collab: s.collab });
  },

  sweepStale: (now) => {
    const s = get();
    let changed = false;
    const runtime = { ...s.runtime };
    for (const [id, r] of Object.entries(s.runtime)) {
      const agent = s.agents[id];
      if (agent && agent.origin !== 'demo' && isStale(r, now, STALE_BUSY_MS, STALE_IDLE_MS)) {
        runtime[id] = applyEvent(r, {
          id: `stale-${id}-${now}`,
          at: now,
          receivedAt: now,
          source: 'app',
          agentId: id,
          payload: { kind: 'session.disconnected', reason: 'stale' },
        });
        changed = true;
      }
    }
    if (changed) set({ runtime });
  },

  select: (id) => set({ selectedAgentId: id }),
  follow: (id) => set({ followAgentId: id }),
  setTheme: (theme) => get().setPref('theme', theme),
  setLocale: (locale) => get().setPref('locale', locale),
  setPref: (key, value) => {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    savePrefs(prefs);
  },
  setAppearance: (id, appearance) =>
    set((s) => (s.agents[id] ? { agents: { ...s.agents, [id]: { ...s.agents[id]!, appearance } } } : s)),
  toggleConsole: (open) => {
    const next = open ?? !get().consoleOpen;
    set({ consoleOpen: next });
    get().setPref('consoleOpen', next);
  },
  toggleSettings: (open, tab) => set({ settingsOpen: open ?? !get().settingsOpen, settingsTab: tab ?? (open ? get().settingsTab : 'general') }),
  openCustomizer: (customizing) => set({ customizing }),
  setBridgeState: (bridge) => set({ bridge }),
  setLink: (link) => set({ link }),
  setBridgeStatus: (bridgeStatus) => set({ bridgeStatus }),
  setHooks: (provider, h) => set((s) => ({ hooks: { ...s.hooks, [provider]: h } })),
  clearHooks: () => set({ hooks: {} }),
  clearOrigin: (origin) =>
    set((s) => {
      const keep = Object.values(s.agents).filter((a) => a.origin !== origin);
      const ids = new Set(keep.map((a) => a.id));
      return {
        collab: origin === 'demo' ? emptyCollab() : s.collab,
        agents: Object.fromEntries(keep.map((a) => [a.id, a])),
        baseAgents: Object.fromEntries(Object.entries(s.baseAgents).filter(([id]) => ids.has(id))),
        runtime: Object.fromEntries(Object.entries(s.runtime).filter(([id]) => ids.has(id))),
        events: s.events.filter((e) => e.source !== origin),
      };
    }),
  resetWorld: () => {
    get().clearOrigin('demo');
    set({ selectedAgentId: undefined, followAgentId: undefined });
  },
}));

/** One event applied to the store state; null for duplicates. Pure apart from reading `s`. */
function ingestStep(s: AppState, event: DomainEvent): Partial<AppState> | null {
    if (s.seenIds.has(event.id)) return null; // duplicate delivery
    const seenIds = new Set(s.seenIds);
    seenIds.add(event.id);
    if (seenIds.size > MAX_SEEN_IDS) seenIds.delete(seenIds.values().next().value!);

    const agents = { ...s.agents };
    const baseAgents = { ...s.baseAgents };
    const runtime = { ...s.runtime };
    const p = event.payload;

    if (p.kind === 'subagent.started') {
      const parent = agents[event.agentId];
      const id = `${event.agentId}/${p.subagentId}`;
      if (!agents[id]) {
        const base: AgentRecord = {
          id,
          name: p.agentType ?? 'Subagent',
          role: 'researcher',
          origin: parent?.origin ?? 'external',
          provider: parent?.provider,
          kind: 'subagent',
          parentId: event.agentId,
          agentType: p.agentType,
          appearance: { ...appearanceFromSeed(id), neckwear: 'lanyard' },
          projectPath: parent?.projectPath,
          createdAt: event.receivedAt,
        };
        baseAgents[id] = base;
        agents[id] = applyProfile(base, s.profiles[profileKeyFor(base)]);
      }
      runtime[id] = applyEvent(runtime[id] ?? initialRuntime(), { ...event, agentId: id, payload: { kind: 'session.started' } });
    }
    if (p.kind === 'subagent.stopped') {
      const id = `${event.agentId}/${p.subagentId}`;
      if (runtime[id]) runtime[id] = applyEvent(runtime[id]!, { ...event, agentId: id, payload: { kind: 'session.ended' } });
    }

    // Events from inside a subagent/teammate we never saw start (e.g. hooks installed mid-run).
    const slash = event.agentId.indexOf('/');
    if (slash > 0 && !agents[event.agentId] && agents[event.agentId.slice(0, slash)]) {
      const parentId = event.agentId.slice(0, slash);
      const parent = agents[parentId]!;
      const base: AgentRecord = {
        id: event.agentId,
        name: 'Subagent',
        role: 'researcher',
        origin: parent.origin,
        provider: parent.provider,
        kind: 'subagent',
        parentId,
        appearance: { ...appearanceFromSeed(event.agentId), neckwear: 'lanyard' },
        projectPath: parent.projectPath,
        createdAt: event.receivedAt,
      };
      baseAgents[event.agentId] = base;
      agents[event.agentId] = applyProfile(base, s.profiles[profileKeyFor(base)]);
      runtime[event.agentId] = applyEvent(initialRuntime(), { ...event, payload: { kind: 'session.started' } });
    }

    if (agents[event.agentId]) runtime[event.agentId] = applyEvent(runtime[event.agentId] ?? initialRuntime(), event);
    if (p.kind === 'location.changed' && baseAgents[event.agentId]) {
      baseAgents[event.agentId] = { ...baseAgents[event.agentId]!, location: { ...baseAgents[event.agentId]!.location, cwd: p.cwd } };
      agents[event.agentId] = applyProfile(baseAgents[event.agentId]!, s.profiles[profileKeyFor(baseAgents[event.agentId]!)]);
    }

    // Agent teams: which character (if any) is the teammate behind a team event.
    const teammateAgent = (e: typeof event): string | null => {
      if (e.agentId.includes('/')) return e.agentId;
      const pl = e.payload as { teamName?: string };
      const prefix = /^session-(.{1,8})$/.exec(pl.teamName ?? '')?.[1];
      return prefix && e.sessionId && !e.sessionId.startsWith(prefix) ? e.agentId : null; // split-pane teammate session
    };
    const collab = collabReduce(s.collab, event, teammateAgent);
    if (collab !== s.collab && (p.kind === 'task.created' || p.kind === 'task.completed' || p.kind === 'teammate.idle')) {
      for (const team of Object.values(collab.teams)) {
        const leadId = Object.values(baseAgents).find((a) => a.kind === 'agent' && team.leadSessionPrefix && runtime[a.id]?.sessionId?.startsWith(team.leadSessionPrefix))?.id;
        const annotate = (id: string, team_: AgentRecord['team'], rename?: string) => {
          const b = baseAgents[id];
          if (!b || (b.team?.role === team_?.role && b.team?.key === team_?.key && (!rename || b.name === rename))) return;
          baseAgents[id] = { ...b, team: team_, name: rename ?? b.name };
          agents[id] = applyProfile(baseAgents[id]!, s.profiles[profileKeyFor(baseAgents[id]!)]);
        };
        if (leadId && baseAgents[leadId]) annotate(leadId, { key: team.key, role: 'lead' });
        for (const [name, agentId] of Object.entries(team.members)) {
          if (agentId && agentId !== leadId) annotate(agentId, { key: team.key, role: 'teammate', teammateName: name }, baseAgents[agentId]?.kind === 'subagent' ? name : undefined);
        }
      }
    }
    if (p.kind === 'collaboration.started' || p.kind === 'collaboration.ended') {
      for (const participant of p.kind === 'collaboration.started' ? p.participants : Object.keys(runtime)) {
        if (participant !== event.agentId && runtime[participant]) runtime[participant] = applyEvent(runtime[participant]!, { ...event, agentId: participant });
      }
    }

    const events = s.events.length >= MAX_EVENTS ? [...s.events.slice(-MAX_EVENTS + 1), event] : [...s.events, event];
    return { agents, baseAgents, runtime, events, seenIds, collab };
}

/**
 * A new session joining a project that already has a session in the office
 * keeps its own look: the project's customization belongs to the first one.
 */
export function withSeparateLook(agent: AgentRecord, s: Pick<AppState, 'baseAgents' | 'runtime'>): AgentRecord {
  if (agent.origin !== 'external' || agent.kind !== 'agent' || !agent.projectPath || agent.separateLook) return agent;
  const key = profileKeyFor(agent);
  const busy = Object.values(s.baseAgents).some((o) => o.id !== agent.id && profileKeyFor(o) === key && (s.runtime[o.id]?.status ?? 'disconnected') !== 'disconnected');
  return busy ? { ...agent, separateLook: true } : agent;
}

function effective(base: Record<string, AgentRecord>, profiles: Record<string, AgentProfile>): Record<string, AgentRecord> {
  return Object.fromEntries(Object.entries(base).map(([id, a]) => [id, applyProfile(a, profiles[profileKeyFor(a)])]));
}

/** Where layout edits go while in a team office (set by the team client). */
export const layoutSink: { current?: (theme: Theme, scene: SceneDefinition | null) => void } = {};

/** The office layout currently in effect for a theme: the team's while in a team office. */
export function sceneFor(s: Pick<AppState, 'layouts' | 'teamLayouts'>, theme: Theme): SceneDefinition {
  if (s.teamLayouts) return s.teamLayouts[theme] ?? DEFAULT_SCENES[theme];
  return s.layouts[theme] ?? DEFAULT_SCENES[theme];
}

/** Agents belonging to the current mode: Demo shows fixtures only, Live shows real sessions only. */
export function inMode(mode: AppMode, origin: AgentRecord['origin']) {
  return mode === 'demo' ? origin === 'demo' : origin !== 'demo';
}
